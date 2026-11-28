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
  await page.getByLabel("Enter Zipcode here").fill(zip);
  await page.getByLabel("How are you feeling today?").fill(feelings);
  await page.getByRole("button", { name: "Generate" }).click();
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
  await expect(
    page
      .locator("main#app")
      .getByRole("heading", { name: "Weather Journal App" }),
  ).toHaveCSS("color", "rgb(59, 72, 115)");
  await expect(
    page
      .locator("#app > .entry")
      .getByRole("heading", { name: "Most Recent Entry" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(244, 244, 249)",
  );
  await expect(page.locator("main#app")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator(".zip label")).toHaveCSS("text-align", "center");
  await expect(zip).toHaveCSS("width", "250px");
  const appearance = await page.evaluate(async () => {
    await document.fonts.ready;
    const panel = document.querySelector("#app");
    const textarea = document.querySelector("#feelings");
    const button = document.querySelector("#generate").getBoundingClientRect();
    return {
      width: window.innerWidth,
      zoom: window.visualViewport.scale,
      centeredButton:
        Math.abs(button.left + button.width / 2 - window.innerWidth / 2) < 1,
      wideTextarea: textarea.clientWidth > panel.clientWidth * 0.8,
      fonts: Array.from(document.fonts, ({ family, status }) => ({
        family: family.replaceAll('"', ""),
        status,
      })),
    };
  });
  expect(appearance.width).toBe(page.viewportSize().width);
  expect(appearance.zoom).toBe(1);
  expect(appearance.centeredButton).toBe(true);
  expect(appearance.wideTextarea).toBe(true);
  expect(appearance.fonts).toHaveLength(3);
  expect(appearance.fonts).toEqual(
    expect.arrayContaining(
      ["Overpass", "Hind Siliguri", "Josefin Sans"].map((family) => ({
        family,
        status: "loaded",
      })),
    ),
  );
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
  for (const id of ["date", "temp"]) {
    await expect(page.locator(`#${id}`)).toHaveCSS("color", "rgb(222, 117, 4)");
  }
  await evidence(page, "success");

  await zip.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const generate = page.getByRole("button", { name: "Generate" });
  await expect(generate).toBeFocused();
  await expect(generate).toHaveCSS("outline-style", "solid");
  await expect(generate).toHaveCSS("outline-width", "3px");
  await evidence(page, "keyboard-focus");

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
  const zip = page.getByLabel("Enter Zipcode here");
  const note = page.getByLabel("How are you feeling today?");
  const button = page.getByRole("button", { name: "Generate" });
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
  await expect(note).toHaveCSS("outline-width", "3px");
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
