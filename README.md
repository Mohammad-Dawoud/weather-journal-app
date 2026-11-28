# Weather Journal App

A local JavaScript and Express weather journal from Udacity's Front End Web Developer Nanodegree. The recovered app restores the submitted interface, adds responsive and keyboard-focus corrections, and keeps one sample note and its weather per browser session. It uses offline weather fixtures by default and supports opt-in OpenWeather lookups. [Source, font and provider notices](NOTICE.md)

## Run the local demo

Use Git, Node.js 24.22.3 and npm 11.19.1. In PowerShell, clone the repository and install from the lockfile with lifecycle scripts disabled. The temporary config files keep the install separate from personal npm configuration. On a shell without the Windows command wrapper, use `npm` in place of `npm.cmd`.

```powershell
git clone https://github.com/Mohammad-Dawoud/weather-journal-app.git
Set-Location -LiteralPath 'weather-journal-app'
$userNpmConfig = New-TemporaryFile
$globalNpmConfig = New-TemporaryFile
try {
    npm.cmd ci --ignore-scripts --registry=https://registry.npmjs.org/ "--userconfig=$($userNpmConfig.FullName)" "--globalconfig=$($globalNpmConfig.FullName)"
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
} finally {
    Remove-Item -LiteralPath $userNpmConfig.FullName, $globalNpmConfig.FullName
}
npm.cmd start
```

Open the loopback address printed by the app, by default [http://127.0.0.1:4189](http://127.0.0.1:4189). If the port is busy, set `$env:PORT` to a free port and start again. Press Ctrl+C to stop. Use sample notes only.

| Fixture ZIP | Example temperature | Display date (UTC) |
| ----------- | ------------------- | ------------------ |
| `02139`     | 37.4 °F             | 2025-01-15         |
| `10001`     | 43.7 °F             | 2025-01-15         |
| `90210`     | 68 °F               | 2025-01-15         |

Enter `02139` and a sample note, then choose **Generate** or use the keyboard. The page displays the fixture's fixed UTC observation date, Fahrenheit temperature and trimmed note. Try an invalid ZIP such as `1234`, then an unknown fixture ZIP such as `99999`. A failed save leaves the last valid entry visible. Refresh to see the same session entry. A private window starts empty. Entries live only in server memory, expire after 30 minutes idle and disappear on restart.

## Routes and verification

Fixture mode is the default and runs without an API key or external weather calls.

The page reads `GET /all` to establish its session. It sends a five-digit ZIP string and a nonempty note up to 500 characters to `POST /addWeatherData`, then waits for a successful response before rereading `GET /all`. JSON is limited to 4 KiB. The server binds only to `127.0.0.1`, accepts its exact local Host and write Origin, and supports up to 32 isolated sessions.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd exec -- playwright install chromium
npm.cmd run test:e2e
```

Local verification on Windows x64 passed 25 Node tests and 12 Playwright cases using Chromium. Two of three automated live scenarios completed. Owner manual verification confirmed the interrupted scenario and one additional ZIP, bringing the combined evidence to four distinct successful ZIPs. The owner also passed all six final manual checks. Browser installation is needed only for browser tests. Those tests use deterministic fixtures and consume no OpenWeather quota. [Playwright browser setup](https://playwright.dev/docs/browsers)

## Optional live mode

Stop fixture mode first. Use an active OpenWeather key with access to ZIP Geocoding and Current Weather. Create an ignored `.local/live.env` file from the template if it does not already exist. Edit the file locally to supply `OPENWEATHER_API_KEY`. The server reads it only when started in live mode. `PORT` is set in the shell as in the fixture instructions. [Empty configuration template](.env.example)

```powershell
New-Item -ItemType Directory -Path '.local' -Force | Out-Null
if (-not (Test-Path -LiteralPath '.local/live.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.local/live.env'
}
```

After saving the private configuration, start live mode.

```powershell
npm.cmd run start:live
```

Open the loopback address printed by the server. Look for **Live US weather** and the OpenWeather attribution. Enter a five-digit US ZIP and a sample note, then choose **Generate**. The server sends the ZIP first and then sends the provider's coordinates for current weather in Fahrenheit. The displayed UTC date comes from the provider timestamp. A failed lookup keeps the previous entry. Use Ctrl+C to stop. [ZIP Geocoding](https://openweathermap.org/api/geocoding-api) · [Current Weather](https://openweathermap.org/api/current)

Live requests are capped at two in-flight lookups and 20 upstream calls per rolling minute per process. Each request has a three-second deadline, with six seconds for the full lookup. Failed live lookups stay in live mode. The app keeps only the latest normalized entry for each session in memory. Weather data is provided by OpenWeather. The live page carries the official logo and link, and its only external navigation is a user-selected link. [Free-plan limits](https://openweathermap.org/price) · [Data licensing](https://openweathermap.org/guide#licensing) · [Attribution guidance](https://openweathermap.org/faq#license)

This recovery was verified for loopback use with sample notes. It has no persistent journal storage or production hosting configuration. Public live deployment and redistribution of provider data are separate from publication of the source.
