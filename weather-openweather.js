const https = require("node:https");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

const PROVIDER = "https://api.openweathermap.org";
const REQUEST_MS = 3000;
const LOOKUP_MS = 6000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_ACTIVE_LOOKUPS = 2;
const MAX_CALLS_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

class OpenWeatherError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function isKey(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
}

function readLiveKey() {
  try {
    const contents = readFileSync(
      path.join(__dirname, ".local", "live.env"),
      "utf8",
    );
    const key = parseEnv(contents).OPENWEATHER_API_KEY;
    return isKey(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

function validCoordinates(value) {
  return (
    Number.isFinite(value?.lat) &&
    Math.abs(value.lat) <= 90 &&
    Number.isFinite(value?.lon) &&
    Math.abs(value.lon) <= 180
  );
}

async function readJson(get, url, overallSignal, isGeocoding) {
  const signal = AbortSignal.any([
    overallSignal,
    AbortSignal.timeout(REQUEST_MS),
  ]);
  try {
    signal.throwIfAborted();
    const response = await new Promise((resolve, reject) => {
      const request = get(
        url,
        {
          signal,
          rejectUnauthorized: true,
          agent: false,
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "identity",
          },
        },
        resolve,
      );
      request.once("error", reject);
    });

    if (response.statusCode !== 200) {
      response.destroy();
      if (isGeocoding && response.statusCode === 404) return null;
      if ([401, 403].includes(response.statusCode)) {
        throw new OpenWeatherError("weather_credentials");
      }
      if (response.statusCode === 429) {
        throw new OpenWeatherError("weather_rate_limited");
      }
      throw new OpenWeatherError("weather_unavailable");
    }

    let size = 0;
    const chunks = [];
    if (
      Number(response.headers["content-length"]) > MAX_RESPONSE_BYTES ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers["content-type"] ?? "",
      ) ||
      ![undefined, "identity"].includes(response.headers["content-encoding"])
    ) {
      response.destroy();
      throw new OpenWeatherError("weather_unavailable");
    }
    for await (const chunk of response) {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) {
        response.destroy();
        throw new OpenWeatherError("weather_unavailable");
      }
      chunks.push(chunk);
    }
    signal.throwIfAborted();
    const result = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new OpenWeatherError("weather_unavailable");
    }
    return result;
  } catch (error) {
    if (error instanceof OpenWeatherError) throw error;
    throw new OpenWeatherError(
      signal.aborted ? "weather_timeout" : "weather_unavailable",
    );
  }
}

function createOpenWeatherLookup({
  key,
  get = https.get,
  now = performance.now.bind(performance),
}) {
  if (!isKey(key)) throw new OpenWeatherError("weather_credentials");
  const recentCalls = [];
  let active = 0;
  let credentialsRejected = false;
  let pausedUntil = 0;

  async function request(endpoint, params, signal) {
    if (signal.aborted) throw new OpenWeatherError("weather_timeout");
    if (credentialsRejected) throw new OpenWeatherError("weather_credentials");
    const time = now();
    while (recentCalls.length && recentCalls[0] <= time - MINUTE_MS) {
      recentCalls.shift();
    }
    if (time < pausedUntil || recentCalls.length >= MAX_CALLS_PER_MINUTE) {
      throw new OpenWeatherError("weather_rate_limited");
    }

    const url = new URL(endpoint, PROVIDER);
    url.search = new URLSearchParams({ ...params, appid: key });
    recentCalls.push(time);
    try {
      return await readJson(get, url, signal, endpoint === "/geo/1.0/zip");
    } catch (error) {
      if (error.code === "weather_credentials") credentialsRejected = true;
      if (error.code === "weather_rate_limited")
        pausedUntil = now() + MINUTE_MS;
      throw error;
    }
  }

  return async function lookupOpenWeather(zip, { signal }) {
    if (typeof zip !== "string" || !/^[0-9]{5}$/.test(zip)) {
      throw new OpenWeatherError("weather_unavailable");
    }
    if (active >= MAX_ACTIVE_LOOKUPS) {
      throw new OpenWeatherError("weather_busy");
    }

    const lookupSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(LOOKUP_MS),
    ]);
    active += 1;
    try {
      const place = await request(
        "/geo/1.0/zip",
        { zip: zip + ",US" },
        lookupSignal,
      );
      if (place === null) return null;
      if (
        place.zip !== zip ||
        place.country !== "US" ||
        !validCoordinates(place)
      ) {
        throw new OpenWeatherError("weather_unavailable");
      }

      const weather = await request(
        "/data/2.5/weather",
        { lat: String(place.lat), lon: String(place.lon), units: "imperial" },
        lookupSignal,
      );
      if (
        !validCoordinates(weather.coord) ||
        !Number.isFinite(weather.main?.temp) ||
        !Number.isInteger(weather.dt) ||
        weather.dt < 0 ||
        weather.dt > 253402300799
      ) {
        throw new OpenWeatherError("weather_unavailable");
      }
      return { temperatureF: weather.main.temp, observedAtSeconds: weather.dt };
    } finally {
      active -= 1;
    }
  };
}

module.exports = {
  createOpenWeatherLookup,
  readLiveKey,
  OpenWeatherError,
  LOOKUP_MS,
};
