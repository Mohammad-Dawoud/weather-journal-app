const path = require("node:path");
const { readFileSync } = require("node:fs");
const express = require("express");
const { mountJournalRoutes } = require("./server-routes");
const { lookupFixture } = require("./weather-fixture");
const {
  createOpenWeatherLookup,
  readLiveKey,
  LOOKUP_MS,
} = require("./weather-openweather");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4189;

function createApp({
  origin,
  lookupWeather,
  now = Date.now,
  live = false,
  weatherTimeoutMs = live ? LOOKUP_MS : 3000,
}) {
  if (live && !lookupWeather) {
    throw new Error("Live mode requires an OpenWeather lookup.");
  }
  const localHost = new URL(origin).host;
  const app = express();
  app.disable("x-powered-by");
  app.enable("case sensitive routing");
  app.enable("strict routing");
  app.set("trust proxy", false);

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });

    if (req.path === "/all" || req.path === "/addWeatherData") {
      res.set("Cache-Control", "no-store");
    }
    if (req.get("host") !== localHost) {
      return res.status(403).json({ error: "host_denied" });
    }
    next();
  });

  mountJournalRoutes(app, {
    origin,
    lookupWeather: lookupWeather ?? lookupFixture,
    now,
    weatherTimeoutMs,
  });
  if (live) {
    const page = readFileSync(
      path.join(__dirname, "website", "index.html"),
      "utf8",
    )
      .replace('data-weather-mode="fixture"', 'data-weather-mode="live"')
      .replace(
        "Local demo using fixture weather. Use a short sample note.",
        'Live US weather. Use a short sample note. <a href="https://openweathermap.org/">Weather data provided by OpenWeather <img class="provider-logo" src="/openweather-logo.png" alt="" width="106" height="60" /></a>',
      )
      .replace(
        "Fixture ZIPs include 02139, 10001 and 90210.",
        "Enter a five-digit US ZIP code.",
      );
    app.get(["/", "/index.html"], (_req, res) => {
      res.set("Cache-Control", "no-store").type("html").send(page);
    });
  }
  app.use(express.static(path.join(__dirname, "website")));
  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    switch (error.type) {
      case "entity.parse.failed":
        return res.status(400).json({ error: "invalid_json" });
      case "entity.too.large":
        return res.status(413).json({ error: "body_too_large" });
      case "charset.unsupported":
      case "encoding.unsupported":
        return res.status(415).json({ error: "unsupported_media" });
      default:
        return res.status(500).json({ error: "internal_error" });
    }
  });
  return app;
}

function start() {
  const args = process.argv.slice(2);
  const live = args.length === 1 && args[0] === "--live";
  if (args.length && !live) {
    console.error(
      "Use npm run start for fixtures or npm run start:live for live weather.",
    );
    process.exitCode = 1;
    return;
  }
  const input = process.env.PORT ?? String(DEFAULT_PORT);
  const port = Number(input);
  if (!/^\d{1,5}$/.test(input) || port < 1 || port > 65535) {
    console.error("PORT must be an integer from 1 to 65535.");
    process.exitCode = 1;
    return;
  }

  const origin = `http://${HOST}:${port}`;
  let lookupWeather;
  if (live) {
    if (process.env.NODE_DEBUG || process.env.NODE_DEBUG_NATIVE) {
      console.error(
        "Turn off Node network debugging before starting live mode.",
      );
      process.exitCode = 1;
      return;
    }
    const key = readLiveKey();
    if (!key) {
      console.error(
        "Live mode requires a valid OPENWEATHER_API_KEY in .local/live.env.",
      );
      process.exitCode = 1;
      return;
    }
    lookupWeather = createOpenWeatherLookup({ key });
  }
  const server = createApp({ origin, live, lookupWeather }).listen(
    port,
    HOST,
    () => {
      console.log(
        `Weather Journal App (${live ? "live" : "fixtures"}) listening at ${origin}`,
      );
    },
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;

  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? "The loopback port is busy. Choose a different PORT."
        : "Could not start the local Weather Journal App.",
    );
    process.exitCode = 1;
  });

  function stop() {
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) {
        console.error("Could not close the Weather Journal listener cleanly.");
        process.exitCode = 1;
        return;
      }
      console.log("Weather Journal listener closed.");
    });
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (process.platform === "win32") {
    process.once("SIGBREAK", stop);
  }
}

if (require.main === module) {
  start();
}

module.exports = { createApp };
