# Levelhead Proxy Backend

This folder contains a minimal HTTP API that the Levelhead BedWars mod can tunnel through. It enforces the mod handshake, proxies requests to Hypixel with a static API key, and surfaces player-facing error messages that the mod can display in chat.

## Configuration

The backend uses environment variables for all secrets and tunables:

| Variable | Required | Description |
| --- | --- | --- |
| `HYPIXEL_API_KEY` | ✅ | Hypixel API key owned by the proxy operator. |
| `PROXY_AUTH_TOKENS` | ✅ | Comma-separated list of bearer tokens accepted from the mod. |
| `RATE_LIMIT_MAX` | ❌ | Requests allowed per window (defaults to `300`). |
| `RATE_LIMIT_WINDOW_MS` | ❌ | Window length in milliseconds (defaults to `300000`, i.e. 5 minutes). |
| `PORT` | ❌ | Port to bind to (defaults to `3000`). |
| `HOST` | ❌ | Host/IP to bind to (defaults to `0.0.0.0`). |
| `HYPIXEL_API_BASE_URL` | ❌ | Override for Hypixel API base URL. |
| `CLOUDFLARE_TUNNEL` | ❌ | Optional Cloudflare Tunnel URL printed on boot. |
| `CACHE_TTL_MS` | ❌ | Cache lifetime in milliseconds (defaults to 45 minutes, clamped between 5-180 minutes). |
| `CACHE_DB_URL` | ✅ | PostgreSQL connection string for the response cache database. |

Set these variables in your deployment environment (or a `.env` file for local testing). When connecting to the shared Nest
Postgres service from within a Nest container, the connection string should follow the format
`postgres://<username>@localhost/<username>_<database>?sslmode=disable&host=/var/run/postgresql`.

## Development

```bash
cd backend
npm install
npm run dev
```

Requests must include the following headers or they will be rejected:

- `User-Agent: Levelhead/<version>`
- `X-Levelhead-Install: <32 hex characters>`
- `Authorization: Bearer <one of PROXY_AUTH_TOKENS>`

Each bearer token is bound to the first `X-Levelhead-Install` value that uses it; subsequent requests that reuse the token with a different install identifier are rejected.

Successful responses mirror the shapes already supported by the mod so no client update is required.
