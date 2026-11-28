const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  reporter: "list",
  workers: 1,
  timeout: 20000,
  use: {
    browserName: "chromium",
    serviceWorkers: "block",
    launchOptions: {
      args: [
        "--disable-background-networking",
        "--disable-component-update",
        "--no-proxy-server",
      ],
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
