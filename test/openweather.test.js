const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { test } = require("node:test");
const { createOpenWeatherLookup } = require("../weather-openweather");

const key = "a".repeat(32);
const place = { zip: "02139", country: "US", lat: 42.36, lon: -71.1 };
const current = {
  coord: { lat: 42.36, lon: -71.1 },
  main: { temp: 37.4 },
  dt: Date.UTC(2025, 0, 15, 0, 30) / 1000,
  timezone: -18000,
};
const options = () => ({ signal: new AbortController().signal });

function provider(...steps) {
  const calls = [];
  const get = (url, requestOptions, receive) => {
    calls.push({ url, options: requestOptions });
    const request = new EventEmitter();
    const reply = steps.shift();
    assert.ok(reply, "unexpected upstream request");
    if (reply.wait) {
      requestOptions.signal.addEventListener(
        "abort",
        () => {
          request.emit("error", new Error("synthetic request aborted"));
        },
        { once: true },
      );
    } else {
      const chunks = reply.chunks ?? [Buffer.from(JSON.stringify(reply.body))];
      const response = Readable.from(chunks);
      response.headers = {
        "content-type": "application/json",
        ...reply.headers,
      };
      response.statusCode = reply.status ?? 200;
      queueMicrotask(() => receive(response));
    }
    return request;
  };
  return { get, calls };
}

test("uses the fixed US ZIP and imperial HTTPS APIs, retaining UTC timestamp and Fahrenheit", async () => {
  const { get, calls } = provider({ body: place }, { body: current });
  const lookup = createOpenWeatherLookup({ key, get });
  assert.deepEqual(await lookup("02139", options()), {
    temperatureF: 37.4,
    observedAtSeconds: current.dt,
  });
  assert.equal(
    new Date(current.dt * 1000).toISOString(),
    "2025-01-15T00:30:00.000Z",
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ url }) => url.pathname),
    ["/geo/1.0/zip", "/data/2.5/weather"],
  );
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    zip: "02139,US",
    appid: key,
  });
  assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), {
    lat: "42.36",
    lon: "-71.1",
    units: "imperial",
    appid: key,
  });
  for (const call of calls) {
    assert.equal(call.url.origin, "https://api.openweathermap.org");
    assert.equal(call.options.rejectUnauthorized, true);
    assert.deepEqual(call.options.headers, {
      Accept: "application/json",
      "Accept-Encoding": "identity",
    });
  }
});

test("unknown ZIP is null and never triggers a weather call", async () => {
  const { get, calls } = provider({ status: 404, body: {} });
  assert.equal(
    await createOpenWeatherLookup({ key, get })("02139", options()),
    null,
  );
  assert.equal(calls.length, 1);
});

test("missing and syntactically invalid key are rejected without a request", () => {
  const { get, calls } = provider();
  for (const invalid of [undefined, "", "bad value"]) {
    assert.throws(() => createOpenWeatherLookup({ key: invalid, get }), {
      message: "weather_credentials",
    });
  }
  assert.equal(calls.length, 0);
});

test("authentication and entitlement errors stop dispatch and redact provider details", async () => {
  for (const status of [401, 403]) {
    const body = { message: "sensitive synthetic body " + key };
    const { get, calls } = provider({ status, body });
    const lookup = createOpenWeatherLookup({ key, get });
    await assert.rejects(lookup("02139", options()), (error) => {
      assert.equal(error.message, "weather_credentials");
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.stack, /sensitive synthetic body|aaaaaaaa/);
      return true;
    });
    await assert.rejects(lookup("10001", options()), {
      message: "weather_credentials",
    });
    assert.equal(calls.length, 1);
  }
});

test("rate-limited responses pause dispatch with no automatic retry", async () => {
  const { get, calls } = provider(
    { status: 429, body: {} },
    { status: 404, body: {} },
  );
  let time = 0;
  const lookup = createOpenWeatherLookup({ key, get, now: () => time });
  await assert.rejects(lookup("02139", options()), {
    message: "weather_rate_limited",
  });
  time = 59_000;
  await assert.rejects(lookup("02139", options()), {
    message: "weather_rate_limited",
  });
  assert.equal(calls.length, 1);
  time = 60_000;
  assert.equal(await lookup("02139", options()), null);
  assert.equal(calls.length, 2);
});

test("enforces a rolling twenty-call budget across geocoding and weather", async () => {
  const { get, calls } = provider(
    ...Array.from({ length: 10 }, () => [
      { body: place },
      { body: current },
    ]).flat(),
    { status: 404, body: {} },
  );
  let time = 0;
  const lookup = createOpenWeatherLookup({ key, get, now: () => time });
  for (let i = 0; i < 10; i++) await lookup("02139", options());
  await assert.rejects(lookup("02139", options()), {
    message: "weather_rate_limited",
  });
  assert.equal(calls.length, 20);
  time = 60_000;
  assert.equal(await lookup("02139", options()), null);
  assert.equal(calls.length, 21);
});

test("aborts a stalled upstream request at three seconds without a second call", async () => {
  const { get, calls } = provider({ wait: true });
  const timeout = setTimeout(() => {}, 4000);
  try {
    await assert.rejects(
      createOpenWeatherLookup({ key, get })("02139", options()),
      { message: "weather_timeout" },
    );
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal.aborted, true);
});

test("honors enclosing cancellation and limits simultaneous lookups", async () => {
  const { get, calls } = provider({ wait: true }, { wait: true });
  const lookup = createOpenWeatherLookup({ key, get });
  const controller = new AbortController();
  const first = assert.rejects(lookup("02139", controller), {
    message: "weather_timeout",
  });
  const second = assert.rejects(lookup("02139", controller), {
    message: "weather_timeout",
  });
  try {
    await assert.rejects(lookup("02139", options()), {
      message: "weather_busy",
    });
  } finally {
    controller.abort();
    await Promise.all([first, second]);
  }
  assert.equal(calls.length, 2);
});

test("rejects oversized declared and streamed bodies, raw malformed JSON and unsupported encoding", async () => {
  const bad = [
    { headers: { "content-length": "65537" }, body: place },
    { chunks: [Buffer.alloc(32768), Buffer.alloc(32769)] },
    { chunks: [Buffer.from("{ broken JSON " + key)] },
    { headers: { "content-encoding": "gzip" }, body: place },
  ];
  for (const item of bad) {
    const { get, calls } = provider(item);
    await assert.rejects(
      createOpenWeatherLookup({ key, get })("02139", options()),
      { message: "weather_unavailable" },
    );
    assert.equal(calls.length, 1);
  }
});

test("rejects redirects and upstream failures without follow-up calls", async () => {
  for (const status of [301, 302, 307, 308, 500, 503]) {
    const { get, calls } = provider({
      status,
      headers: { location: "https://example.invalid" },
      body: {},
    });
    await assert.rejects(
      createOpenWeatherLookup({ key, get })("02139", options()),
      { message: "weather_unavailable" },
    );
    assert.equal(calls.length, 1);
  }
});

test("rejects invalid coordinates, wrong geocoding identity and malformed weather fields", async () => {
  const malformed = [
    [{ body: { ...place, lat: 91 } }],
    [{ body: { ...place, zip: 2139 } }],
    [{ body: { ...place, country: "GB" } }],
    [
      { body: place },
      { body: { ...current, coord: { lat: "42.36", lon: -71.1 } } },
    ],
    [{ body: place }, { body: { ...current, dt: 2.5 } }],
    [{ body: place }, { body: { ...current, main: { temp: "37.4" } } }],
  ];
  for (const steps of malformed) {
    const { get, calls } = provider(...steps);
    await assert.rejects(
      createOpenWeatherLookup({ key, get })("02139", options()),
      { message: "weather_unavailable" },
    );
    assert.equal(calls.length, steps.length);
  }
});
