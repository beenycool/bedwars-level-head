package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.config.DisplayConfig
import net.minecraft.entity.player.EntityPlayer

/**
 * One render target (above-head or tab).
 *
 * It no longer owns a tag cache. A tag is derived from [club.sk1er.mods.levelhead.core.StatsStore]
 * at render time through the memoised
 * [club.sk1er.mods.levelhead.core.TagFormatter], so there is nothing to invalidate
 * here when stats or settings change.
 */
abstract class LevelheadDisplay(val config: DisplayConfig) {
    open fun loadOrRender(player: EntityPlayer?) = !player!!.displayName.formattedText.contains("§k", true)
}
