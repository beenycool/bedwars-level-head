# Decisions

- Scope: mod/client only (no changes under `backend/`).
- Verbosity: requests + tag updates, plus render sampling (throttled).
- Automated tests: skip.
- Logging visibility: prefer gated `Levelhead.logger.info(...)` for debug signals so they show up in `latest.log` without log level changes.
- Redaction: never log API keys, proxy tokens, or auth headers; avoid full response bodies.
