## BedWars Levelhead

BedWars Levelhead is a lightweight reimagining of the classic **Levelhead** mod that focuses on showing BedWars stars above players on Hypixel.
[![Better Stack Badge](https://uptime.betterstack.com/status-badges/v2/monitor/2eno7.svg)](https://uptime.betterstack.com/?utm_source=status_badge)
### Getting Started
1. Install the mod just like any other Forge/LiteLoader mod compatible with your client.
2. Join Hypixel (`mc.hypixel.net`).
3. Run `/levelhead` to view your current configuration and available subcommands.
4. If you use the public proxy, no Hypixel API key is required. To run fully offline or during backend outages, get an API key from developer.hypixel.net and configure it with `/levelhead apikey <key>`.

---

### Command Reference
- `/levelhead` – Displays status (backend URL, cache health, install ID) and explains all subcommands.
- `/levelhead header <text>` – Set the header line displayed above stars.
- `/levelhead color <#RRGGBB|name>` – Choose a color for the header.
- `/levelhead offset <value>` – Adjust the vertical offset of the display.
- `/levelhead self <on|off>` – Control whether you see your own tag.
- `/levelhead cache purge [player]` – Clear cache entries globally or for a specific player.
- `/levelhead status` – Show backend latency, cache state, and rate limit information.
- `/levelhead whois <player|uuid>` – Fetch BedWars stats from the proxy or Hypixel directly.
- `/levelhead reload` – Invalidate all cached displays and re-fetch fresh data.

#### Developer Commands (Advanced)
> ⚠️ The following commands are for advanced configuration. Incorrect usage may cause display issues.

- `/levelhead proxy <url>` / `/levelhead proxy clear` – Configure or reset the backend endpoint.
- `/levelhead proxy auth <username> <password>` – Supply proxy authentication credentials.
- `/levelhead apikey <key>` / `clearapikey` – Manage a local Hypixel API key fallback.

> **Tip:** Run `/levelhead help` or `/levelhead` with no arguments in-game to see live documentation tailored to your configuration.

---

### Advanced Configuration
For fine-grained control, edit `config/levelhead.json` in your `.minecraft` directory. This file exposes header text, colors, offsets, proxy details, and more. If you migrate from an older Levelhead config, ensure the `"type"` field is set to `"BEDWARS_STAR"`.

To restore the mod to its original settings, open the BedWars Levelhead configuration screen (via OneConfig) and click **Reset Settings**. This resets both general options and display settings back to their defaults.


### Credits & License
This project is a fork of the original **Levelhead** mod created by **Sk1er LLC** and is licensed under the **GNU General Public License v3**. Credit also goes to the Hypixel team for providing the public API that powers BedWars stats.
