const fs = require("node:fs/promises");
const { once } = require("node:events");
const http = require("node:http");
const path = require("node:path");
const { expect, test } = require("@playwright/test");
const { createApp } = require("../server");
const { lookupFixture } = require("../weather-fixture");

let server;
let origin;
let entered;
let release;
let externalRequests;
let pageErrors;

test.beforeEach(async ({ context, page }) => {
  entered = Promise.withResolvers();
  release = Promise.withResolvers();
  externalRequests = [];
  pageErrors = [];
  server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  server.on(
    "request",
    createApp({
      origin,
      async lookupWeather(zip, options) {
        if (zip === "10001") {
          entered.resolve();
          await release.promise;
        }
        return lookupFixture(zip, options);
      },
    }),
  );
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url());
      await route.abort();
      return;
    }
    await route.continue();
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await expect(page.locator("#generate")).toBeEnabled();
});

test.afterEach(async () => {
  release?.resolve();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function enter(page, zip, feelings) {
  await page.getByLabel("US ZIP code").fill(zip);
  await page.getByLabel("How are you feeling?").fill(feelings);
  await page.getByRole("button", { name: "Save entry" }).click();
}

async function evidence(page, name) {
  const folder = process.env.WEATHER_JOURNAL_EVIDENCE;
  if (folder) {
    await fs.mkdir(folder, { recursive: true });
    await page.screenshot({
      path: path.join(folder, `${test.info().project.name}-${name}.png`),
      scale: "css",
    });
  }
}

test("empty, saved, and error views match the rubric and fit the viewport", async ({
  page,
}) => {
  const zip = page.locator("#zip");
  await expect(zip).toHaveAttribute("placeholder", "enter zip code here");
  await expect(page.locator("textarea#feelings")).toBeVisible();
  await expect(page.locator("button#generate")).toBeVisible();
  await expect(page.getByText("No entry yet.")).toBeVisible();
  await expect(
    page.getByText(/Local demo using fixture weather/),
  ).toBeVisible();
  for (const id of ["date", "temp", "content"]) {
    await expect(page.locator(`#entryHolder > div#${id}`)).toHaveCount(1);
  }
  await evidence(page, "empty");

  await enter(page, "02139", "Synthetic note for the Weather Journal demo.");
  await expect(page.getByRole("status")).toHaveText("Entry saved.");
  await expect(zip).toHaveValue("02139");
  await expect(page.locator("#date")).toHaveText("Date (UTC): 2025-01-15");
  await expect(page.locator("#temp")).toHaveText("Temperature: 37.4 °F");
  await expect(page.locator("#content")).toContainText(
    "Synthetic note for the Weather Journal demo.",
  );
  await expect(page.locator("#entryHolder")).toBeVisible();
  await evidence(page, "success");

  await enter(
    page,
    "99999",
    "Synthetic note that should not replace the saved note.",
  );
  await expect(page.getByRole("status")).toHaveText(
    "No fixture weather is available for this ZIP.",
  );
  await expect(page.locator("#content")).toContainText(
    "Synthetic note for the Weather Journal demo.",
  );
  await evidence(page, "error");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("uses keyboard focus, rejects invalid input and saves once by keyboard", async ({
  page,
}) => {
  const zip = page.getByLabel("US ZIP code");
  const note = page.getByLabel("How are you feeling?");
  const button = page.getByRole("button", { name: "Save entry" });
  const writes = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });

  await zip.fill("1234");
  await note.fill("Synthetic keyboard note.");
  await button.focus();
  await page.keyboard.press("Space");
  await expect(zip).toBeFocused();
  expect(writes).toHaveLength(0);
  await zip.fill("90210");
  await zip.focus();
  await page.keyboard.press("Tab");
  await expect(note).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status")).toHaveText("Entry saved.");
  await expect(page.locator("#temp")).toHaveText("Temperature: 68 °F");
  expect(writes).toHaveLength(1);
});

test("waits for a delayed save before issuing the follow-up read", async ({
  page,
}) => {
  const seen = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/all" || pathname === "/addWeatherData") {
      seen.push(`${request.method()} ${pathname}`);
    }
  });
  await enter(page, "10001", "Synthetic delayed note.");
  await entered.promise;
  try {
    await expect(page.getByRole("status")).toHaveText("Saving entry…");
    await expect(page.locator("#generate")).toBeDisabled();
    await expect(page.locator("#emptyEntry")).toBeVisible();
    expect(seen).toEqual(["POST /addWeatherData"]);
  } finally {
    release.resolve();
  }
  await expect(page.getByRole("status")).toHaveText("Entry saved.");
  await expect(page.locator("#temp")).toHaveText("Temperature: 43.7 °F");
  expect(seen).toEqual(["POST /addWeatherData", "GET /all"]);
});

test("renders markup-like notes as literal text and preserves the entry across reload", async ({
  page,
}) => {
  await enter(page, "02139", "<b>Synthetic text</b>");
  await expect(page.locator("#content")).toHaveText(
    "Feelings: <b>Synthetic text</b>",
  );
  await expect(page.locator("#content b")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#content")).toHaveText(
    "Feelings: <b>Synthetic text</b>",
  );
});

test("isolates independent browser contexts", async ({ browser, page }) => {
  await enter(page, "02139", "Synthetic note for the first context.");
  await expect(page.getByRole("status")).toHaveText("Entry saved.");
  const second = await browser.newContext();
  try {
    await second.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === origin) {
        await route.continue();
      } else {
        externalRequests.push(route.request().url());
        await route.abort();
      }
    });
    const tab = await second.newPage();
    await tab.goto(origin);
    await expect(tab.locator("#generate")).toBeEnabled();
    await expect(tab.locator("#emptyEntry")).toBeVisible();
    await expect(tab.locator("#entryHolder")).toBeHidden();
  } finally {
    await second.close();
  }
});

test("reports an unsuccessful GET after a successful save and recovers on refresh", async ({
  page,
}) => {
  await page.route("**/all", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await enter(page, "90210", "Synthetic note saved before a read failed.");
  await expect(page.getByRole("status")).toHaveText(
    /Entry saved, but the latest entry could not load/,
  );
  await expect(page.locator("#entryHolder")).toBeHidden();
  await page.unroute("**/all");
  await page.reload();
  await expect(page.locator("#content")).toContainText(
    "Synthetic note saved before a read failed.",
  );
});
