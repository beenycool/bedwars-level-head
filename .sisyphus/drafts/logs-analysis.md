# Draft: Log Analysis (latest.log + fml-client-latest.log)

## Files Reviewed
- `latest.log`
- `fml-client-latest.log`

## Notable Errors / Warnings

### latest.log
- **OpenAL / SoundSystem error**: `Error in class 'LibraryLWJGLOpenAL'` + `Invalid enumerated parameter value.` (occurs during OpenAL init, followed by SoundSystem restart).
- **Skin/textures decode failure** (repeated): `Could not decode textures payload` with `com.google.gson.JsonSyntaxException` / `IllegalStateException: Expected BEGIN_OBJECT but was STRING at line 1 column 1`.
  - Stacktrace points at `com.mojang.authlib.yggdrasil.YggdrasilMinecraftSessionService.getTextures` via `SkinManager` and rendering code paths (skull renderer / HUD caching / render passes).

### fml-client-latest.log
- **Mixin injection warning**: `Injection warning: LVT ... ImageBufferDownloadMixin_ImprovedHeadRendering` (Patcher mixin; local variable table mismatch). Potentially impacts head/skin rendering tweaks.
- **OptiFine reflector warnings**: `java.lang.NullPointerException` + `Error finding Chunk.hasEntities` / `Field not present: net.minecraft.world.chunk.Chunk.hasEntities`.
- **Hytils Reborn friend list fetch error**: `Failed retrieving friend list ... Invalid UUID string: success`.
- **Crash-report header during loading**: `---- Minecraft Crash Report ----` but explicitly marked as *not an error* (`Loading screen debug info`).

## BedWars Levelhead Signals
- Config loads via OneConfig: `club.sk1er.mods.levelhead.config.LevelheadConfig/bedwars_levelhead` loading `OneConfig\profiles\Default Profile\bedwars-levelhead.json`.
- Ongoing OneConfig autosaves include `club.sk1er.mods.levelhead.config.LevelheadConfig/`: appears to save on a 60s cadence (e.g. 10:18, 10:19, 10:20, 10:21... in `fml-client-latest.log`).
- Startup debug sample (from `fml-client-latest.log` around 10:08) shows mode resolution: `resolveGameMode: typeId=BEDWARS_STAR -> BEDWARS`.
- No obvious Levelhead-thrown exceptions in the sampled sections; main errors appear in SoundSystem, Mojang textures/skins decode, OptiFine/Patcher/Hytils.

## Open Questions
- What is the intended comparison target for “improvements” (previous log run? specific mod behavior like stars rendering?)
- Are the "Could not decode textures payload" errors user-visible (missing skins/heads) or just noisy logs?
- User asks: what is displayed above the star number (likely Levelhead "header" line). Logs do not show configured header content.
