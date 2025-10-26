package me.truffle.bedwarslevelhead.utils

import net.minecraft.client.Minecraft
import net.minecraft.client.entity.EntityPlayerSP

object MinecraftUtils {

    fun getPlayerName(): String {
        return Minecraft.getMinecraft().thePlayer?.name ?: ""
    }

    fun isOnHypixel(): Boolean {
        val serverData = Minecraft.getMinecraft().currentServerData ?: return false
        return serverData.serverIP?.contains("hypixel.net") == true
    }

    fun isInGame(): Boolean {
        return Minecraft.getMinecraft().theWorld != null && Minecraft.getMinecraft().thePlayer != null
    }
}