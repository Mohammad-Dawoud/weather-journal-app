# Weather Journal App

A local weather journal recovered from my Udacity Front End Web Developer coursework. This JavaScript and Express demo saves one sample note and its weather per browser session. The published starting commit contains my client and route excerpts. The local recovery restores the submitted interface with responsive and keyboard-focus corrections and supports offline fixtures and optional OpenWeather lookups. [Source and font notices](NOTICE.md)

## Run the local demo

Use Node.js 24.22.3 and npm 11.19.1. For a checkout with the reviewed lock, use the trusted npm registry and isolated, empty npm user/global config files. Install with lifecycle scripts disabled. In the prepared SPPP checkout the dependencies and pinned tools are already available. In PowerShell:

```powershell
Set-Location -LiteralPath 'D:/Software-Portfolio/02-Working-Copies/P3-T05-A/ND0011-P03-Weather-Journal-App'
$journalNode = (Resolve-Path -LiteralPath '../../P3-T01-A/ND0067-P01-Image-Processing-API/.local/node-v24.22.3-win-x64').Path
$env:Path = "$journalNode;$env:Path"
$env:PORT = '4189'
npm run start
```

Open [http://127.0.0.1:4189](http://127.0.0.1:4189). Use the address printed by the app, including the port. If it is busy, choose a different free port. Press Ctrl+C to stop. Use sample notes only.

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
npm run check
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path -LiteralPath '../../P3-T03-A/ND0067-P03-My-Store/.local/browsers').Path
npm run test:e2e
```

The browser tests use Playwright 1.65.1 and Chromium headless shell 159.0.8154.6 (revision 1255). The browser is already present in the prepared SPPP workspace. The app serves plain static assets directly through Express.

## Optional live mode

Use an active OpenWeather key with access to ZIP Geocoding and Current Weather. In a new checkout, use [.env.example](.env.example) to prepare an ignored `.local/live.env` file and enter the value for `OPENWEATHER_API_KEY` locally. Keep the file private. The server reads that value from the file when explicitly started in live mode. `PORT` is set in the shell as in the fixture instructions.

```powershell
npm.cmd run start:live
```

Open the loopback address printed by the server. Look for **Live US weather** and the OpenWeather attribution. Enter a five-digit US ZIP and a sample note, then choose **Generate**. The server sends the ZIP first and then sends the provider's coordinates for current weather in Fahrenheit. The displayed UTC date comes from the provider timestamp. A failed lookup keeps the previous entry. Use Ctrl+C to stop. [ZIP Geocoding](https://openweathermap.org/api/geocoding-api) · [Current Weather](https://openweathermap.org/api/current)

Live requests are capped at two in-flight lookups and 20 upstream calls per rolling minute per process. Each request has a three-second deadline, with six seconds for the full lookup. Failed live lookups stay in live mode. The app keeps only the latest normalized entry for each session in memory. Weather data is provided by OpenWeather. The live page carries the official logo and link, and its only external navigation is a user-selected link. [Free-plan limits](https://openweathermap.org/price) · [Data licensing](https://openweathermap.org/guide#licensing) · [Attribution guidance](https://openweathermap.org/faq#license)

The app is prepared for local review. Publication, deployment and provider data redistribution require separate review.
