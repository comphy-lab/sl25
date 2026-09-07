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
- The canonical public hostname is `sl25.comphy-lab.org`, served through the
  versioned `cloudflare/sl2-proxy.mjs` Worker. Legacy `/sl25` and `/sl2` GET/HEAD
  requests redirect with HTTP 308; root API routes remain for compatibility.
  Wrangler keeps `workers.dev` and preview URLs disabled.

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

- The frontend loads MathJax from an external CDN and embeds a YouTube iframe;
  the obsolete polyfill has been removed.
- The Worker has a 22-test Node suite and the WSGI boundary has nine Python
  origin/compatibility tests. Python dependency versions remain unpinned.
- Requests are capped at 1 MB via `MAX_CONTENT_LENGTH` to keep batch uploads bounded.
- `SL25_ORIGIN_TOKEN` is a Cloudflare Worker secret; only its SHA-256 verifier
  belongs in `origin-auth.json`. The imported WSGI app authenticates all requests
  outside Flask/Socket.IO, while Vercel Standard Protection covers old and preview
  deployment URLs. Keep both controls and verify them separately after release.
- The Worker may authenticate only the documented public paths and methods.
  Never forward client credentials, follow origin redirects with the secret,
  expose it to browsers, or reopen arbitrary legacy proxy paths.
- Deploy the credential-bearing Worker before the guarded origin. Local anonymous
  use goes through `python app.py` or `deploy.sh`; imported WSGI entry points stay
  protected without relying on a platform environment flag.
- If you change the calculator logic, update both the frontend copy and the README examples so the behavior stays consistent.
