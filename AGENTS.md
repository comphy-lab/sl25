# AGENTS.md

## Purpose

This repository is a small Flask website for the SL theory drop-impact calculator. Keep changes aligned with the actual app structure:

- `app.py` creates the Flask app and registers blueprints.
- `batchProcess.py` handles `POST /batch` CSV uploads for batch `beta` prediction.
- `calculateReynoldsNumber.py` serves `/` and computes Reynolds number on `/add`.
- `regimeDecide.py` classifies the regime, predicts `predBeta` on `/regime`, and serves `/regime-diagram.svg`.
- `phase_diagram_svg.py` renders the server-side SVG for the Weber-Ohnesorge regime map.
- `templates/index.html` is the only frontend page, with `static/site.css` and `static/site.js` as load-bearing frontend assets.

## Working Rules

- Treat `requirements.txt`, `runtime.txt`, and `vercel.json` as the source of truth for runtime and deployment.
- Keep `README.md` and this file updated when routes, startup behavior, or deployment assumptions change.
- Do not add websocket event handlers unless the frontend actually needs them; `Flask-SocketIO` currently wraps app startup, but there is no socket event logic.
- Do not use `git commit` unless the user explicitly asks for a commit.

## Runtime Facts

- Python version: `python-3.9`.
- Dependencies: `Flask`, `Flask-SocketIO`, `numpy`, `matplotlib`.
- Local start command: `python app.py` or `./deploy.sh`.
- `./deploy.sh` defaults to a non-debug loopback bind and only permits `FLASK_DEBUG=1` with loopback hosts.
- Deployment target: Vercel via `@vercel/python`.
- The public `comphy-lab.org/sl25` entry point uses the versioned
  `cloudflare/sl2-proxy.mjs` Worker. Its Wrangler configuration deliberately
  keeps `workers.dev` and preview URLs disabled.

## API Contract

- `POST /add` and `POST /regime` expect JSON with `weberNumber` and `ohnesorgeNumber`.
- `POST /batch` expects `multipart/form-data` with a `file` field containing a CSV that includes `We` and `Oh` columns.
- `GET /regime-diagram.svg` accepts optional `weberNumber`, `ohnesorgeNumber`, and `theme` query params.
- The code checks presence, numeric conversion, positivity, and the theory range `1 <= We <= 10^3`, `10^-3 <= Oh <= 10^2`.
- `/add` returns Reynolds number.
- `/batch` returns a CSV with `beta` filled in, marks invalid rows as `error`, and surfaces row-level issues in `X-Row-Errors`.
- `/regime` returns regime labels `I`, `II`, `III`, or `IV`, plus `predBeta`.
- `/regime-diagram.svg` returns the server-rendered phase diagram SVG.

## Repo Notes

- The frontend loads MathJax and a polyfill from external CDNs and embeds a YouTube iframe.
- There are no automated tests or pinned dependency versions in the repo right now.
- Requests are capped at 1 MB via `MAX_CONTENT_LENGTH` to keep batch uploads bounded.
- Cloudflare rate limits protect only requests that traverse `sl2-proxy`; the
  direct Vercel hostname remains an explicit origin bypass.
- If you change the calculator logic, update both the frontend copy and the README examples so the behavior stays consistent.
