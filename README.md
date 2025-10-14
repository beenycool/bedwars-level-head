## General Information
BedWars Levelhead is a Minecraft mod for the Hypixel Network (`mc.hypixel.net`) that displays a player's BedWars star above their head while you are in BedWars lobbies or matches. The mod no longer includes any other Levelhead functionality—only BedWars stars remain.

## Commands
* `/levelhead` — Shows a short help message explaining how to configure the mod.
* `/levelhead apikey <key>` — Stores your Hypixel API key so the mod can fetch BedWars statistics. Dashes are optional, and you can also use `/levelhead apikey clear` to remove the stored key.
* `/levelhead clearapikey` — Alias for clearing the stored Hypixel API key from `config/bedwars-level-head.cfg`.
* `/levelhead reload` — Cancels active fetches, clears cached BedWars stars, and re-requests data for nearby players.

## Setting your Hypixel API key
1. Join Hypixel (`mc.hypixel.net`) and run `/api new` to generate an API key. Copy the key from chat.
2. Run `/levelhead apikey <key>` in-game (replace `<key>` with the value you copied). The mod will save it to `config/bedwars-level-head.cfg`.
3. If you ever need to remove or replace the key, use `/levelhead apikey clear` or repeat the steps above with a new key.

## Configuration
Display settings such as header text, colors, and offsets are stored in `config/levelhead.json`. The mod keeps the existing file format so you can copy settings from previous installations or edit the JSON manually. If you reuse a config from an older version of Levelhead, set its `type` field to `BEDWARS_STAR` so the display renders BedWars stars instead of network levels.

