const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const https = require("node:https");
const { test } = require("node:test");
const { createApp } = require("../server");
const { lookupFixture } = require("../weather-fixture");
const { OpenWeatherError } = require("../weather-openweather");

async function openApp(t, options = {}) {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const app = createApp({ origin, ...options });
  server.on("request", app);

  function request(path, { method = "GET", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = http.request(
        { hostname: "127.0.0.1", port, path, method, headers },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("error", reject);
          res.on("end", () => {
            const content = Buffer.concat(chunks).toString();
            resolve({
              status: res.statusCode,
              headers: res.headers,
              content,
              data: res.headers["content-type"]?.startsWith("application/json")
                ? JSON.parse(content)
                : undefined,
            });
          });
        },
      );
      outgoing.on("error", reject);
      outgoing.end(body);
    });
  }

  const read = (cookie) =>
    request("/all", { headers: cookie ? { cookie } : {} });
  const post = (cookie, fields, headers = {}) =>
    request("/addWeatherData", {
      method: "POST",
      headers: {
        origin,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: typeof fields === "string" ? fields : JSON.stringify(fields),
    });

  return { app, origin, request, read, post };
}

function cookieFrom(response) {
  return response.headers["set-cookie"][0].split(";")[0];
}

const sample = { zip: "02139", feelings: "Synthetic test note." };
const stored = {
  date: "2025-01-15",
  temperatureF: 37.4,
  feelings: sample.feelings,
};

test("serves the restored UI and only the static asset directory", async (t) => {
  const { app, request } = await openApp(t);
  assert.equal(app.get("trust proxy"), false);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.content, /id="zip"/);
  assert.match(page.headers["content-security-policy"], /connect-src 'self'/);
  for (const asset of ["/app.js", "/styles.css"]) {
    assert.equal((await request(asset)).status, 200);
  }
  for (const name of ["overpass", "hindsiliguri", "josefinsans"]) {
    const font = await request(`/fonts/${name}.ttf`);
    assert.equal(font.status, 200);
    assert.match(font.headers["content-type"], /^font\/ttf\b/);
    const notice = await request(`/fonts/${name}-OFL.txt`);
    assert.equal(notice.status, 200);
    assert.match(notice.content, /SIL OPEN FONT LICENSE Version 1.1/i);
  }
  for (const path of [
    "/server.js",
    "/package.json",
    "/.env.example",
    "/.local/live.env",
    "/licenses/udacity-fend-MIT.txt",
    "/.local/original-ui-b1/capture-verification.json",
    "/ALL",
    "/all/",
  ]) {
    assert.equal((await request(path)).status, 404);
  }
});

test("initializes an opaque session and returns an uncached empty entry", async (t) => {
  const { read } = await openApp(t);
  const response = await read();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { entry: null });
  assert.equal(response.headers["cache-control"], "no-store");
  const cookie = response.headers["set-cookie"][0];
  assert.match(
    cookie,
    /^weather_journal_session=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict$/,
  );
  assert.notEqual(cookieFrom(response), cookieFrom(await read()));
});

test("keeps leading zeroes and stores a trimmed note with fixture Fahrenheit and UTC date", async (t) => {
  const { read, post } = await openApp(t);
  const cookie = cookieFrom(await read());
  const result = await post(cookie, {
    ...sample,
    feelings: "  Synthetic test note.  ",
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(result.data, { entry: stored });
  assert.deepEqual((await read(cookie)).data, { entry: stored });
});

test("enforces exact host and journal origin and scopes the CORS middleware", async (t) => {
  const { read, post, origin, request } = await openApp(t);
  const cookie = cookieFrom(await read());
  const cross = "http://127.0.0.1:1";
  const forbidden = await request("/all", {
    headers: { Host: "localhost", "X-Forwarded-Host": new URL(origin).host },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers["cache-control"], "no-store");
  assert.equal(
    (await request("/all", { headers: { Origin: cross } })).status,
    403,
  );
  assert.equal((await post(cookie, sample, { Origin: cross })).status, 403);
  assert.equal((await post(cookie, sample, { Origin: "" })).status, 403);
  const preflight = await request("/addWeatherData", {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], origin);
  assert.equal(preflight.headers["access-control-allow-credentials"], "true");
  assert.equal(
    (await request("/styles.css", { headers: { Origin: origin } })).headers[
      "access-control-allow-origin"
    ],
    undefined,
  );
  assert.deepEqual((await read(cookie)).data, { entry: null });
});

test("rejects missing and invalid data, unexpected fields and wrong media", async (t) => {
  const { read, post } = await openApp(t);
  const cookie = cookieFrom(await read());
  for (const fields of [
    undefined,
    {},
    { zip: "02139" },
    { ...sample, zip: 2139 },
    { ...sample, zip: "1234" },
    { ...sample, zip: "12X45" },
    { ...sample, zip: "02139 " },
    { ...sample, feelings: "   " },
    { ...sample, feelings: 5 },
    { ...sample, feelings: "a".repeat(501) },
    { ...sample, temperatureF: 900 },
  ]) {
    assert.equal(
      (await post(cookie, fields)).status,
      400,
      JSON.stringify(fields),
    );
  }
  assert.deepEqual((await post(cookie, '{"zip":')).data, {
    error: "invalid_json",
  });
  assert.equal(
    (await post(cookie, sample, { "Content-Type": "text/plain" })).status,
    415,
  );
  assert.equal(
    (await post(cookie, sample, { "Content-Encoding": "gzip" })).status,
    415,
  );
  assert.equal(
    (await post(cookie, { ...sample, feelings: "a".repeat(4096) })).status,
    413,
  );
  assert.equal(
    (await post(cookie, { ...sample, feelings: "a".repeat(500) })).status,
    200,
  );
});

test("unknown ZIP and rejected writes preserve the latest valid entry", async (t) => {
  const { read, post } = await openApp(t);
  const cookie = cookieFrom(await read());
  assert.equal((await post(cookie, sample)).status, 200);
  const unknown = await post(cookie, { ...sample, zip: "99999" });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.data, { error: "unknown_zip" });
  assert.equal((await post(cookie, { ...sample, feelings: "" })).status, 400);
  assert.deepEqual((await read(cookie)).data, { entry: stored });
});

test("keeps provider exceptions or malformed fields out of responses and leaves data intact", async (t) => {
  const { read, post } = await openApp(t, {
    async lookupWeather(zip, options) {
      if (zip === "00001") throw new Error("synthetic provider debug text");
      if (zip === "00002")
        return { temperatureF: Infinity, observedAtSeconds: 1 };
      if (zip === "00003")
        return { temperatureF: 60, observedAtSeconds: 253402300800 };
      return lookupFixture(zip, options);
    },
  });
  const cookie = cookieFrom(await read());
  await post(cookie, sample);
  for (const zip of ["00001", "00002", "00003"]) {
    const failure = await post(cookie, { ...sample, zip });
    assert.equal(failure.status, 502);
    assert.deepEqual(failure.data, { error: "weather_unavailable" });
    assert.doesNotMatch(failure.content, /synthetic provider debug text/);
    assert.deepEqual((await read(cookie)).data, { entry: stored });
  }
});

test("cancels on timeout and a late provider result cannot overwrite newer data", async (t) => {
  const late = Promise.withResolvers();
  let signal;
  const { read, post } = await openApp(t, {
    weatherTimeoutMs: 40,
    lookupWeather(zip, options) {
      if (zip !== "10001") return lookupFixture(zip, options);
      signal = options.signal;
      return late.promise;
    },
  });
  const cookie = cookieFrom(await read());
  assert.equal((await post(cookie, sample)).status, 200);
  const timeout = await post(cookie, { ...sample, zip: "10001" });
  assert.equal(timeout.status, 504);
  assert.deepEqual(timeout.data, { error: "weather_timeout" });
  assert.equal(signal.aborted, true);
  assert.deepEqual((await read(cookie)).data, { entry: stored });
  assert.equal((await post(cookie, { ...sample, zip: "90210" })).status, 200);
  late.resolve({ temperatureF: 100, observedAtSeconds: 0 });
  assert.equal((await read(cookie)).data.entry.temperatureF, 68);
});

test("protects concurrent writes per browser without blocking another session", async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const { read, post } = await openApp(t, {
    async lookupWeather(zip, options) {
      if (zip === "10001") {
        entered.resolve();
        await release.promise;
      }
      return lookupFixture(zip, options);
    },
  });
  const a = cookieFrom(await read());
  const b = cookieFrom(await read());
  await post(a, sample);
  const pending = post(a, { ...sample, zip: "10001" });
  await entered.promise;
  try {
    const overlap = await post(a, { ...sample, zip: "90210" });
    assert.equal(overlap.status, 409);
    assert.deepEqual(overlap.data, { error: "save_in_progress" });
    assert.deepEqual((await read(a)).data, { entry: stored });
    assert.deepEqual((await read(b)).data, { entry: null });
    assert.equal((await post(b, { ...sample, zip: "90210" })).status, 200);
    assert.equal((await read(b)).data.entry.temperatureF, 68);
  } finally {
    release.resolve();
  }
  assert.equal((await pending).status, 200);
  assert.equal((await read(a)).data.entry.temperatureF, 43.7);
  assert.equal((await read(b)).data.entry.temperatureF, 68);
});

test("bounds sessions without eviction and uses sliding 30-minute idle expiration", async (t) => {
  let time = 0;
  const { read, post } = await openApp(t, { now: () => time });
  const a = cookieFrom(await read());
  const b = cookieFrom(await read());
  await post(a, sample);
  await post(b, { ...sample, zip: "10001" });
  for (let i = 2; i < 32; i++) {
    assert.equal((await read()).status, 200);
  }
  const full = await read();
  assert.equal(full.status, 429);
  assert.equal(full.headers["set-cookie"], undefined);
  time = 29 * 60 * 1000;
  assert.deepEqual((await read(a)).data, { entry: stored });
  time = 30 * 60 * 1000;
  assert.equal((await post(b, sample)).status, 409);
  const renewed = await read(b);
  assert.deepEqual(renewed.data, { entry: null });
  assert.notEqual(cookieFrom(renewed), b);
  assert.deepEqual((await read(a)).data, { entry: stored });
});

test("does not honor an arbitrary or ambiguous session cookie", async (t) => {
  const { read, post } = await openApp(t);
  const a = cookieFrom(await read());
  await post(a, sample);
  const forged = `weather_journal_session=${"0".repeat(64)}`;
  assert.equal((await post(forged, sample)).status, 409);
  assert.deepEqual((await read(forged)).data, { entry: null });
  assert.deepEqual((await read(`${a}; ${forged}`)).data, { entry: null });
});

test("a new server starts empty and refuses a previous instance's session", async (t) => {
  const first = await openApp(t);
  const cookie = cookieFrom(await first.read());
  assert.equal((await first.post(cookie, sample)).status, 200);
  const second = await openApp(t);
  assert.equal((await second.post(cookie, sample)).status, 409);
  assert.deepEqual((await second.read(cookie)).data, { entry: null });
});

test("fixture mode stays offline even with a configured key path", async (t) => {
  const spy = t.mock.method(https, "get", () => {
    throw new Error("Unexpected weather network call");
  });
  const { request, read, post } = await openApp(t);
  const page = await request("/");
  assert.match(page.content, /data-weather-mode="fixture"/);
  assert.doesNotMatch(page.content, /Weather data provided by OpenWeather/);
  const cookie = cookieFrom(await read());
  assert.deepEqual((await post(cookie, sample)).data, { entry: stored });
  assert.equal(spy.mock.callCount(), 0);
  assert.throws(() => createApp({ origin: "http://127.0.0.1:1", live: true }), {
    message: "Live mode requires an OpenWeather lookup.",
  });
});

test("live failures never fall back and preserve the last successful journal entry", async (t) => {
  let error;
  const { request, read, post } = await openApp(t, {
    live: true,
    async lookupWeather() {
      if (error) throw new OpenWeatherError(error);
      return {
        temperatureF: 51.5,
        observedAtSeconds: Date.UTC(2025, 0, 15, 0, 30) / 1000,
      };
    },
  });
  for (const url of ["/", "/index.html"]) {
    const page = await request(url);
    assert.match(page.content, /data-weather-mode="live"/);
    assert.match(
      page.content,
      /href="https:\/\/openweathermap.org\/"[^>]*>Weather data provided by OpenWeather/,
    );
    assert.match(page.content, /src="\/openweather-logo.png"/);
    assert.doesNotMatch(page.content, /Fixture ZIPs include/);
    assert.equal(page.headers["cache-control"], "no-store");
  }
  const logo = await request("/openweather-logo.png");
  assert.equal(logo.status, 200);
  assert.match(logo.headers["content-type"], /^image\/png/);

  const cookie = cookieFrom(await read());
  const liveEntry = { ...stored, temperatureF: 51.5 };
  assert.deepEqual((await post(cookie, sample)).data, { entry: liveEntry });
  for (const [code, status] of [
    ["weather_credentials", 502],
    ["weather_rate_limited", 429],
    ["weather_busy", 503],
    ["weather_timeout", 504],
    ["weather_unavailable", 502],
    ["https://example.invalid/?appid=synthetic", 502],
  ]) {
    error = code;
    const rejected = await post(cookie, {
      zip: "10001",
      feelings: "Stay unchanged.",
    });
    assert.equal(rejected.status, status);
    assert.deepEqual(rejected.data, {
      error: code.startsWith("weather_") ? code : "weather_unavailable",
    });
    assert.doesNotMatch(rejected.content, /appid|synthetic/);
    assert.equal(rejected.headers["cache-control"], "no-store");
    assert.deepEqual((await read(cookie)).data, { entry: liveEntry });
  }
});
