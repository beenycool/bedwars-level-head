package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.display.LevelheadDisplay
import net.minecraft.entity.player.EntityPlayer
import java.util.UUID

fun LevelheadDisplay.update() {
    // No-op: kept for compatibility; behavior now driven by DisplayConfig directly
}

val String.dashUUID: UUID?
    get() {
        if (this.length != 32) return null
        val arr = this.toCharArray().toMutableList()
        arr.add(20, '-')
        arr.add(16, '-')
        arr.add(12, '-')
        arr.add(8, '-')
        return UUID.fromString(arr.joinToString(""))
    }

val UUID.trimmed: String
    get() = this.toString().replace("-", "")

val EntityPlayer.isNPC: Boolean
    get() = this.uniqueID.version() == 2