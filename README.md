# FA-Helper-App

Static React + TypeScript app for preparing India ITR support views for foreign equity transactions.

## Features

- Shareworks RSU releases upload
- long-share sales upload
- historical price upload
- USD/INR rate upload using SBI `TT BUY`
- Schedule FA A3 view
- Capital Gains view

## Run Locally

### Prerequisites

- Node.js 20+ recommended
- npm

### Steps

```bash
git clone <your-repo-url>
cd <repo-name>
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Build

```bash
npm run build
```

## Test

```bash
npm test
```

## Lint

```bash
npm run lint
```

## Data Files

The app expects these CSVs to be uploaded through the UI at runtime:

- Shareworks `RSU Releases` CSV
- Shareworks `Sales - Long Shares` CSV
- historical price CSV
- USD/INR rate CSV using SBI `TT BUY`

Personal or sample account data is intentionally not stored in this app repository.

## Sample Files

Safe example upload files are included in `sample/`:

- `sample/RSU Releases.sample.csv`
- `sample/Sales - Long Shares.sample.csv`
- `sample/TEAM-HistoricalData.sample.csv`
- `sample/SBI_REFERENCE_RATES_USD.sample.csv`

These are dummy/public-style samples for testing the UI flow and do not contain your real account data.
