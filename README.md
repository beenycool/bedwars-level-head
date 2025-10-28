## BedWars Level Head

A lightweight and simplified fork of the classic **Levelhead** mod, rebuilt to  display a player's BedWars star above their head on Hypixel.
All other features from the original Levelhead have been removed to ensure the mod is as lightweight and focused as possible.


### Getting Started

1. Install the mod and launch the game.
2. Open the config via the command `/bedwarslevel` (aliases: `/bwl`, `/bedwarslvl`) or through the OneConfig menu and customize display settings.

#### Commands

Currently implemented:

- `/(bedwarslevel|bwl|bedwarslvl)` opens the OneConfig menu for this mod.

Planned (not yet implemented):

- `/levelhead apikey <key>` and related subcommands. These are not available in the client. The backend handles API access; client-side key storage will be added only if needed.
---

### Configuration

For advanced customization, you can edit the `config/levelhead.json` file located in your `.minecraft` directory. Here you can change the header text, colors, on-screen offsets, and more.

If you are using a configuration file from an older version of Levelhead, please ensure the `type` field is set to `"BEDWARS_STAR"` for the mod to function correctly.

---

### Credits & License

This project is a fork of the original **Levelhead** mod created by **Sk1er LLC** and is licensed under the **GNU General Public License v3**. This mod would not exist without their foundational work.

Credit also goes to the Hypixel team for providing the public API that makes this functionality possible.
