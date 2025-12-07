package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.core.isNPC
import club.sk1er.mods.levelhead.core.trimmed
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.potion.Potion
import net.minecraft.scoreboard.Team.EnumVisible
import java.util.*
import kotlin.math.min
import kotlin.properties.Delegates


class AboveHeadDisplay(config: DisplayConfig) : LevelheadDisplay(DisplayPosition.ABOVE_HEAD, config) {

    var bottomValue = true
    var index by Delegates.notNull<Int>()

    override fun loadOrRender(player: EntityPlayer?): Boolean {
        if (player == null) return false
        val localPlayer = Minecraft.getMinecraft().thePlayer ?: return false
        // Check server-side invisibility first (e.g., spectators, hidden players)
        if (player.isInvisibleToPlayer(localPlayer)) return false
        if (player.isInvisible) return false
        if (player.isPotionActive(
            //#if MC==10809
            Potion.invisibility
            //#endif
        )) return false
        if (!renderFromTeam(player)) return false
        //#if MC==10809
        if (player.riddenByEntity != null) return false
        //#else
        //$$ if (!player.getPassengers().isEmpty()) return false
        //#endif
        val min = min(4096, Levelhead.displayManager.config.renderDistance * Levelhead.displayManager.config.renderDistance)
        val nearLocalPlayer = player.getDistanceSqToEntity(localPlayer) <= min
        if (!nearLocalPlayer) return false

        return (!player.hasCustomName() || player.customNameTag.isNotEmpty())
                && player.displayNameString.isNotEmpty()
                && super.loadOrRender(player)
    }

    private fun renderFromTeam(player: EntityPlayer): Boolean {
        if (player.isUser) return true
        val team = player.team
        val team1 = Minecraft.getMinecraft().thePlayer?.team
        if (team != null) {
            return when (team.nameTagVisibility) {
                EnumVisible.NEVER -> false
                EnumVisible.HIDE_FOR_OTHER_TEAMS -> team1 == null || team.isSameTeam(team1)
                EnumVisible.HIDE_FOR_OWN_TEAM -> team1 == null || !team.isSameTeam(team1)
                EnumVisible.ALWAYS -> true
                else -> true
            }
        }
        return true
    }

    override fun toString(): String = "head${Levelhead.displayManager.aboveHead.indexOf(this)+1}"

}