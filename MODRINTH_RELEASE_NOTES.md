# BedWars Levelhead 8.3.0 Release Notes

## TL;DR
- `/levelhead` now acts as a full control center with status reporting and inline configuration tools.
- `/levelhead whois` accepts usernames or UUIDs and can query either your proxy or Hypixel directly.
- Display updates propagate instantly with refreshed prestige colors and ✪-styled stars.
- Backend adds a `/stats` dashboard, richer lookup history, and more verbose cache/TTL controls.

## BedWars Levelhead 8.3.0 Highlights

### Mod & Commands
- In-game `/levelhead` has become a full control center: the default handler now reports mod status, header text, offset, self-visibility, and proxy configuration so players know their setup at a glance.
- New subcommands let you tune everything without leaving chat—set header text/color/chroma, adjust vertical offset, toggle showing your own tag, manage proxy credentials, purge backend cache entries, and run rich status/debug snapshots to inspect rate limits, cache health, and proxy connectivity.
- `/levelhead whois` now understands usernames *and* UUIDs, fetching stats from either the configured proxy or Hypixel directly with helpful feedback, ✪-styled star readouts, and graceful error handling.
- Display management gained new helpers so updating the primary tag immediately rewrites cached headers/colors/chroma and avoids unnecessary refetches, keeping overlays consistent when you tweak settings.
- Prestige styling has been refreshed with an expanded palette, ensuring the ✪ footer color matches Hypixel’s latest tiers while keeping chroma effects where appropriate.
- The mod now ships as version 8.3.0, aligning with the backend upgrade and making release tracking easier for Modrinth users.

### Proxy & Backend Improvements
- Player lookups feed a new history service that records identifier, nick status, data source, install ID, and computed BedWars stars; the `/stats` route renders the latest queries in an HTML table with proper escaping for safe sharing.
- A shared BedWars math helper now derives stars from raw experience so the proxy and mod stay perfectly in sync on level calculations.
- Cache diagnostics were overhauled: hits/misses log detailed reasons, purge jobs report how many rows were cleared, and stored responses capture ETag/Last-Modified metadata for smarter revalidation.
- Configuration now enforces a 1–24 hour TTL window (default 24h) for cache entries, reflecting documented limits and preventing accidental misconfiguration.
- Server startup emits structured request timing logs, exposes the new `/stats` dashboard, and keeps health/metrics endpoints for observability during deployments.

Use these notes directly on Modrinth to showcase everything that landed since commit `92b95b0177e431ad864d73aa49ee13672dd37bd8`.
