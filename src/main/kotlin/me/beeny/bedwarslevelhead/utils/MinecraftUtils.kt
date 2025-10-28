package me.beeny.bedwarslevelhead.utils

import net.minecraft.client.Minecraft
import net.minecraft.client.entity.EntityPlayerSP
import net.minecraft.scoreboard.Scoreboard

object MinecraftUtils {

    fun getPlayerName(): String {
        return Minecraft.getMinecraft().thePlayer?.name ?: ""
    }

    fun isOnHypixel(): Boolean {
		val serverData = Minecraft.getMinecraft().currentServerData ?: return false
		val rawServerIp = serverData.serverIP ?: return false
		val host = rawServerIp.substringBefore(':').trim().lowercase()
		if (host.isEmpty()) return false
		return host == "hypixel.net" || host.endsWith(".hypixel.net")
    }

    fun isInGame(): Boolean {
        return Minecraft.getMinecraft().theWorld != null && Minecraft.getMinecraft().thePlayer != null
    }

    fun getScoreboard(): Scoreboard? {
        return Minecraft.getMinecraft().theWorld?.scoreboard
    }
}