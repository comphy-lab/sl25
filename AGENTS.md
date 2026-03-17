# AGENTS.md

## Purpose

This repository is a small Flask website for the SL theory drop-impact calculator. Keep changes aligned with the actual app structure:

- `app.py` creates the Flask app and registers blueprints.
- `calculateReynoldsNumber.py` serves `/` and computes Reynolds number on `/add`.
- `regimeDecide.py` classifies the regime and predicts `predBeta` on `/regime`.
- `templates/index.html` is the only frontend page.

## Working Rules

- Treat `requirements.txt`, `runtime.txt`, and `vercel.json` as the source of truth for runtime and deployment.
- Keep `README.md` and this file updated when routes, startup behavior, or deployment assumptions change.
- Do not add websocket behavior unless the frontend actually needs it; `Flask-SocketIO` is currently unused.
- Do not use `git commit` unless the user explicitly asks for a commit.

## Runtime Facts

- Python version: `python-3.9`.
- Dependencies: `Flask`, `Flask-SocketIO`, `numpy`.
- Local start command: `python app.py`.
- Deployment target: Vercel via `@vercel/python`.

## API Contract

- `POST /add` and `POST /regime` expect JSON with `weberNumber` and `ohnesorgeNumber`.
- The code checks presence, numeric conversion, and positive values.
- `/add` returns Reynolds number.
- `/regime` returns regime labels `I`, `II`, `III`, or `IV`, plus `predBeta`.

## Repo Notes

- The frontend loads MathJax and a polyfill from external CDNs and embeds a YouTube iframe.
- There are no automated tests or pinned dependency versions in the repo right now.
- If you change the calculator logic, update both the frontend copy and the README examples so the behavior stays consistent.
