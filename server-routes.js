const { randomBytes } = require("node:crypto");
const cors = require("cors");
const express = require("express");
const { OpenWeatherError } = require("./weather-openweather");

const SESSION_COOKIE = "weather_journal_session";
const SESSION_CAPACITY = 32;
const IDLE_MS = 30 * 60 * 1000;
const liveErrorStatus = new Map([
  ["weather_credentials", 502],
  ["weather_rate_limited", 429],
  ["weather_busy", 503],
  ["weather_timeout", 504],
]);

function readSessionId(cookie) {
  const parts = (cookie ?? "").split(";").map((part) => part.trim());
  const matches = parts.filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const id = matches[0]?.slice(SESSION_COOKIE.length + 1);
  return matches.length === 1 && /^[0-9a-f]{64}$/.test(id) ? id : undefined;
}

function sessionStore(now) {
  const sessions = new Map();
  return {
    get(req) {
      const time = now();
      for (const [id, session] of sessions) {
        if (!session.saving && time - session.lastSeen >= IDLE_MS) {
          sessions.delete(id);
        }
      }
      const session = sessions.get(readSessionId(req.get("cookie")));
      if (session) {
        session.lastSeen = time;
      }
      return session;
    },
    create(res) {
      if (sessions.size >= SESSION_CAPACITY) {
        return undefined;
      }
      const id = randomBytes(32).toString("hex");
      const session = { projectData: null, lastSeen: now(), saving: false };
      sessions.set(id, session);
      res.cookie(SESSION_COOKIE, id, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      });
      return session;
    },
  };
}

function readJournalInput(body) {
  if (
    !body ||
    typeof body.zip !== "string" ||
    !/^[0-9]{5}$/.test(body.zip) ||
    typeof body.feelings !== "string" ||
    Object.keys(body).length !== 2
  ) {
    return undefined;
  }
  const feelings = body.feelings.trim();
  if (!feelings || feelings.length > 500) {
    return undefined;
  }
  return { zip: body.zip, feelings };
}

function normalizeEntry(weather, feelings) {
  if (
    !weather ||
    !Number.isFinite(weather.temperatureF) ||
    !Number.isInteger(weather.observedAtSeconds) ||
    weather.observedAtSeconds < 0 ||
    weather.observedAtSeconds > 253402300799
  ) {
    throw new Error("Invalid weather");
  }
  return {
    date: new Date(weather.observedAtSeconds * 1000).toISOString().slice(0, 10),
    temperatureF: weather.temperatureF,
    feelings,
  };
}

async function resolveWeather(lookupWeather, zip, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve({ error: "weather_timeout", status: 504 });
        controller.abort();
      }, timeoutMs);
    });
    const lookup = Promise.resolve()
      .then(() => lookupWeather(zip, { signal: controller.signal }))
      .then((weather) => ({ weather }));
    return await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function mountJournalRoutes(
  app,
  { origin, lookupWeather, now, weatherTimeoutMs },
) {
  const sessions = sessionStore(now);
  const localCors = cors({
    origin,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  });

  function checkOrigin(req, res, next) {
    const from = req.get("origin");
    if (from !== origin && (from || req.method !== "GET")) {
      return res.status(403).json({ error: "origin_denied" });
    }
    next();
  }

  function requireJson(req, res, next) {
    const media = req.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (media !== "application/json") {
      return res.status(415).json({ error: "unsupported_media" });
    }
    next();
  }

  function sendData(req, res) {
    const session = sessions.get(req) ?? sessions.create(res);
    if (!session) {
      return res.status(429).json({ error: "session_capacity" });
    }
    return res.json({ entry: session.projectData });
  }

  async function addWeatherData(req, res) {
    const input = readJournalInput(req.body);
    if (!input) {
      return res.status(400).json({ error: "invalid_input" });
    }

    const session = sessions.get(req);
    if (!session) {
      return res.status(409).json({ error: "session_required" });
    }
    if (session.saving) {
      return res.status(409).json({ error: "save_in_progress" });
    }

    session.saving = true;
    try {
      const result = await resolveWeather(
        lookupWeather,
        input.zip,
        weatherTimeoutMs,
      );
      if (result.error) {
        return res.status(result.status).json({ error: result.error });
      }
      if (result.weather === null) {
        return res.status(404).json({ error: "unknown_zip" });
      }
      const entry = normalizeEntry(result.weather, input.feelings);
      session.projectData = entry;
      return res.json({ entry });
    } catch (error) {
      if (
        error instanceof OpenWeatherError &&
        liveErrorStatus.has(error.code)
      ) {
        return res
          .status(liveErrorStatus.get(error.code))
          .json({ error: error.code });
      }
      return res.status(502).json({ error: "weather_unavailable" });
    } finally {
      session.lastSeen = now();
      session.saving = false;
    }
  }

  app.options(["/all", "/addWeatherData"], checkOrigin, localCors);
  app.get("/all", checkOrigin, localCors, sendData);
  app.post(
    "/addWeatherData",
    checkOrigin,
    localCors,
    requireJson,
    express.json({ limit: 4096, inflate: false }),
    addWeatherData,
  );
}

module.exports = { mountJournalRoutes };
