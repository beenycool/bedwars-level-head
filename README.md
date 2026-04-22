# BedWars Levelhead

[![Better Stack Badge](https://uptime.betterstack.com/status-badges/v2/monitor/2eno7.svg)](https://uptime.betterstack.com/?utm_source=status_badge)

A fork of the original [Levelhead](https://github.com/Sk1erLLC/Levelhead) mod by Sk1er LLC, rebuilt to show BedWars stars (and other Hypixel game stats) above players' heads on Hypixel. Built for Minecraft 1.8.9 Forge with [OneConfig](https://polyfrost.org/).

The mod ships with a community proxy backend so you don't need your own Hypixel API key to get started.

## Supported Game Modes

The mod auto-detects which game you're in and switches the display accordingly:

- **BedWars** - Star level with prestige colors, FKDR, winstreak
- **Duels** - Division title/symbol, WLR, KDR, winstreak
- **SkyWars** - Star level with prestige colors, WLR, KDR

Each mode has customisable stat templates so you can pick what shows up.

## Features

- Renders stats above (or below) player nametags and in the Tab list
- Prestige-colored stars that match Hypixel's in-game colors for BedWars and SkyWars
- Nick detection (shows "NICKED" instead of incorrect data)
- Multiple backend modes: Community API, your own API key, fallback (tries both), or offline
- Configurable cache TTL, rate limiting, and vertical offset
- Custom stat format templates with tokens like `%star%`, `%fkdr%`, `%ws%`, `%division%`, etc.
- Automatic update checker via Modrinth
- Full OneConfig GUI for all settings (no config file editing needed)
- Self-hostable proxy backend with Docker support

## Installation

1. Drop the mod jar into your `mods/` folder (requires Forge 1.8.9).
2. Join Hypixel (`mc.hypixel.net`).
3. Run `/levelhead` in chat to see your current config and all available subcommands.

By default the mod uses the community proxy, so no API key setup is required. If you want to use your own key, grab one from [developer.hypixel.net](https://developer.hypixel.net) and paste it into the OneConfig GUI or run `/levelhead apikey <key>`.

## Commands

| Command | Description |
|---|---|
| `/levelhead` | Shows status info and lists all subcommands |
| `/levelhead header <text>` | Set the header text above the star |
| `/levelhead color <#RRGGBB\|name>` | Set header color |
| `/levelhead offset <value>` | Adjust vertical offset |
| `/levelhead self <on\|off>` | Toggle showing your own tag |
| `/levelhead cache purge [player]` | Clear cached data (all or per-player) |
| `/levelhead status` | Show backend latency, cache, and rate limit info |
| `/levelhead whois <player\|uuid>` | Look up a player's stats |
| `/levelhead reload` | Re-fetch all visible displays |

### Advanced commands

These are for power users and self-hosters. Messing with them without understanding what they do can break your display.

| Command | Description |
|---|---|
| `/levelhead proxy <url>` | Point the mod at a custom backend |
| `/levelhead proxy clear` | Reset to the default community proxy |
| `/levelhead proxy auth <user> <pass>` | Set proxy auth credentials |
| `/levelhead apikey <key>` | Set a local Hypixel API key |
| `/levelhead clearapikey` | Remove the stored API key |

## Configuration

All settings are accessible through the OneConfig GUI in-game. You can also edit `config/bedwars-levelhead.json` directly if you prefer.

Key options include backend mode, header text/color, stat display format, vertical offset, render distance, cache size, Tab list stats, and more. There's a "Reset Settings" button in the GUI to restore defaults.

If you're migrating from an older Levelhead install, make sure the `"type"` field in your config is set to `"BEDWARS_STAR"`.

## Backend

The mod talks to a Node.js proxy backend that handles Hypixel API calls and caches responses. The backend supports PostgreSQL and Azure SQL for its cache layer, Redis for rate limiting, and exposes Prometheus metrics.

See [backend/README.md](backend/README.md) for self-hosting instructions (Docker Compose or manual setup) and the full configuration reference.

Quick deploy (one-click) options for the backend:

- Render: [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/beenycool/bedwars-level-head)
- Railway: [![Deploy to Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/beenycool/bedwars-level-head)

## Building from Source

Requires JDK 8+ and Gradle.

```bash
./gradlew remapJar
```

The output jar will be in `build/libs/`.

## License

Licensed under the [GNU General Public License v3](LICENSE).

This project is a fork of the original Levelhead mod by [Sk1er LLC](https://github.com/Sk1erLLC/Levelhead). Credit to the Hypixel team for the public API.
