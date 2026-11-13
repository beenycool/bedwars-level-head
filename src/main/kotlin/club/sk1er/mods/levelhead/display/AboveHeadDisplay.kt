package club.sk1er.mods.levelhead.display

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.config.DisplayConfig
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import net.minecraft.potion.Potion
import net.minecraft.scoreboard.Team.EnumVisible
import kotlin.math.min

class AboveHeadDisplay(config: DisplayConfig) : LevelheadDisplay(config) {

    override fun loadOrRender(player: EntityPlayer?): Boolean {
        if (player == null) return false
        if (player.isPotionActive(Potion.invisibility)) return false
        if (!renderFromTeam(player)) return false
        if (player.riddenByEntity != null) return false
        val localPlayer = Minecraft.getMinecraft()?.thePlayer ?: return false
        val min = min(4096, Levelhead.displayManager.config.renderDistance * Levelhead.displayManager.config.renderDistance)
        return player.getDistanceSqToEntity(localPlayer) <= min
                && (!player.hasCustomName() || player.customNameTag.isNotEmpty())
                && player.displayNameString.isNotEmpty()
                && super.loadOrRender(player)
                && !player.isInvisible
                && !player.isInvisibleToPlayer(localPlayer)
                && !player.isSneaking
    }

    private fun renderFromTeam(player: EntityPlayer): Boolean {
        if (player.isUser) return true
        val team = player.team
        val team1 = Minecraft.getMinecraft()?.thePlayer?.team
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
