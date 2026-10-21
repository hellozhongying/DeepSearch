# Repository Guidelines

## Project Structure & Module Organization

`server.mjs` serves the static site and proxies `/api/search` and `/api/fetch` requests to DeepSeek. `query.mjs` contains query helpers shared with the browser. The UI lives in `public/`: `index.html` defines the page, `style.css` contains responsive styles, and `app.js` manages filters, URL state, pagination, and result rendering. Backend tests are in `test/search.test.mjs`. Keep API credentials and upstream calls on the server.

## Build, Test, and Development Commands

Use Node.js 20 or newer. This project has no install or build step and no third-party runtime dependencies.

- `DEEPSEEK_API_KEY=your_key npm start` starts the site at `http://localhost:3000`.
- `PORT=3001 DEEPSEEK_API_KEY=your_key npm start` uses another port.
- `npm test` runs the Node built-in test suite without a live DeepSeek request.
- `node --check server.mjs && node --check public/app.js` checks JavaScript syntax.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation in JavaScript and HTML, semicolons, and single-quoted JavaScript strings. Follow existing `camelCase` names for functions and variables and kebab-case CSS classes such as `.results-content`. Keep DOM text insertion safe with `textContent`; validate external URLs before adding links or images. There is no configured formatter or linter, so keep edits consistent with adjacent code.

## Testing Guidelines

Add focused `node:test` cases to `test/search.test.mjs` for changes to query validation, date ranges, upstream requests, or error handling. Name tests for the behavior they verify. Mock `fetch` for API tests; do not require a real key or network access. There is no coverage threshold. For UI changes, check the homepage and results page at desktop and mobile widths and exercise time and language filters.

## Commits & Pull Requests

The initial commit uses an imperative subject (`Add initial implementation of DeepSearch application`). Follow that style with short subjects such as `Adjust results page spacing`. Pull requests should explain the user-visible change, list checks run, and include before/after screenshots for visual changes; link an issue when one exists.

## Security & Configuration

Set `DEEPSEEK_API_KEY` in the server environment. Never commit keys or expose them in `public/`. The search endpoint incurs per-request costs; add rate limiting before public deployment.
