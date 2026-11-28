# Weather Journal App

A local weather journal recovered from my Udacity Front End Web Developer coursework. This JavaScript and Express demo saves one sample note and fixture weather per browser session. The published starting commit contains my client and route excerpts. The local recovery restores the submitted interface with responsive and keyboard-focus corrections, while retaining the recovered server, session controls and fixture tests. See the [source and font notices](NOTICE.md) for the HTML, CSS and locally served fonts.

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

The page reads `GET /all` to establish its session. It sends a five-digit ZIP string and a nonempty note up to 500 characters to `POST /addWeatherData`, then waits for a successful response before rereading `GET /all`. JSON is limited to 4 KiB. The server binds only to `127.0.0.1`, accepts its exact local Host and write Origin, and supports up to 32 isolated sessions.

```powershell
npm run check
npm test
$env:PLAYWRIGHT_BROWSERS_PATH = (Resolve-Path -LiteralPath '../../P3-T03-A/ND0067-P03-My-Store/.local/browsers').Path
npm run test:e2e
```

The browser tests use Playwright 1.65.1 and Chromium headless shell 159.0.8154.6 (revision 1255). The browser is already present in the prepared SPPP workspace. The app serves plain static assets directly through Express.

Fixture mode makes no external weather requests and needs no credentials. A future separately approved live adapter may read `OPENWEATHER_API_KEY` from a private server environment and implement the existing normalized fixture-provider contract. Genuine OpenWeather access, deployment and redistribution remain outside this recovery scope.
