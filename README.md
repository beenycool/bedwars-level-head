## BedWars Level Head

A lightweight and simplified fork of the classic **Levelhead** mod, rebuilt to  display a player's BedWars star above their head on Hypixel.
All other features from the original Levelhead have been removed to ensure the mod is as lightweight and focused as possible.


### Getting Started
currently still waiting for a hypixel api key 

1.  Log in to the Hypixel network (`mc.hypixel.net`).
2.  boom
#### Commands (not needed unless error or something)

*   `/levelhead`
    *    Shows a short help message explaining how to configure the mod.

*   `/levelhead apikey <key>`
    *    Stores your Hypixel API key to allow the mod to fetch BedWars statistics. The `<key>` should be replaced with the key you get from requesting the developer api key from Hypixel if the backend is down. Dashes in the key are optional.

*   `/levelhead apikey clear`
    *    Removes the Hypixel API key that is currently stored in the mod's configuration.

*   `/levelhead clearapikey`
    *    This is an alias (a shortcut) for the `/levelhead apikey clear` command. It does the exact same thing.

*   `/levelhead reload`
    *    Clears all cached BedWars stars and forces the mod to re-request the data for all players currently visible on your screen. This is useful if data seems outdated or incorrect.
---

### Configuration

For advanced customization, you can edit the `config/levelhead.json` file located in your `.minecraft` directory. Here you can change the header text, colors, on-screen offsets, and more.

If you are using a configuration file from an older version of Levelhead, please ensure the `type` field is set to `"BEDWARS_STAR"` for the mod to function correctly.

---

### Credits & License

This project is a fork of the original **Levelhead** mod created by **Sk1er LLC** and is licensed under the **GNU General Public License v3**. This mod would not exist without their foundational work.

Credit also goes to the Hypixel team for providing the public API that makes this functionality possible.
