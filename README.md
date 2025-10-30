## BedWars Levelhead

BedWars Levelhead is a lightweight reimagining of the classic **Levelhead** mod that focuses on showing BedWars stars above players on Hypixel. The 8.3.0 release delivers a modernized command suite, instant display updates, and an optional backend with improved observability.

### TL;DR
- `/levelhead` now doubles as a control center with live status, configuration shortcuts, and debug readouts.
- `/levelhead whois` supports usernames or UUIDs and can pull stats from either the Levelhead proxy or Hypixel directly.
- Display headers, colors, chroma, and offsets update immediately thanks to refreshed display management helpers.
- The backend tracks detailed lookup history, serves a `/stats` dashboard, and enforces smarter cache TTL bounds.


### Getting Started
1. Install the mod just like any other Forge/LiteLoader mod compatible with your client.
2. Join Hypixel (`mc.hypixel.net`).
3. Run `/levelhead` to view your current configuration and available subcommands.
4. If you use the public proxy, no Hypixel API key is required. To run fully offline or during backend outages, request an API key from Hypixel (`/api new`) and configure it with `/levelhead apikey <key>`.

---

### Command Reference
- `/levelhead` – Displays status (backend URL, cache health, install ID) and explains all subcommands.
- `/levelhead header <text>` – Set the header line displayed above stars.
- `/levelhead color <#RRGGBB|name>` – Choose a color for the header; `chroma` enables rainbow cycling.
- `/levelhead chroma <on|off>` – Toggle chroma animation on the header text.
- `/levelhead offset <value>` – Adjust the vertical offset of the display.
- `/levelhead self <on|off>` – Control whether you see your own tag.
- `/levelhead proxy <url>` / `/levelhead proxy clear` – Configure or reset the backend endpoint.
- `/levelhead proxy auth <username> <password>` – Supply proxy authentication credentials.
- `/levelhead cache purge [player]` – Clear cache entries globally or for a specific player.
- `/levelhead status` – Show backend latency, cache state, and rate limit information.
- `/levelhead whois <player|uuid>` – Fetch BedWars stats from the proxy or Hypixel directly.
- `/levelhead apikey <key>` / `clearapikey` – Manage a local Hypixel API key fallback.
- `/levelhead reload` – Invalidate all cached displays and re-fetch fresh data.

> **Tip:** Run `/levelhead help` or `/levelhead` with no arguments in-game to see live documentation tailored to your configuration.

---

### Advanced Configuration
For fine-grained control, edit `config/levelhead.json` in your `.minecraft` directory. This file exposes header text, colors, offsets, proxy details, and more. If you migrate from an older Levelhead config, ensure the `"type"` field is set to `"BEDWARS_STAR"`.

---

### Backend & Deployment
The repository ships with a Kotlin-based backend/proxy (`backend/`) that powers shared caching and the `/stats` dashboard. Operators can:
- Configure environment variables (see `backend/.env.example`) to tune cache TTLs, logging, and proxy credentials.
- Deploy via the provided `systemd` unit file or container manifests.
- Monitor structured request logs and `/stats` output to observe recent lookups.

---

### Credits & License
This project is a fork of the original **Levelhead** mod created by **Sk1er LLC** and is licensed under the **GNU General Public License v3**. Credit also goes to the Hypixel team for providing the public API that powers BedWars stats.
