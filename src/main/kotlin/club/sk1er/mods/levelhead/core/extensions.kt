package club.sk1er.mods.levelhead.core

import club.sk1er.mods.levelhead.Levelhead
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import kotlinx.coroutines.suspendCancellableCoroutine
import net.minecraft.client.Minecraft
import net.minecraft.entity.player.EntityPlayer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import java.util.*
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException


fun LevelheadDisplay.update() {
    val player = Minecraft.getMinecraft().thePlayer ?: return
    val activeMode = ModeManager.getActiveGameMode() ?: return
    this.cache[Levelhead.DisplayCacheKey(player.uniqueID, activeMode)]?.let { tag ->
        tag.header.let { header ->
            header.color = this.config.headerColor
            header.value = "${this.config.headerString}: "
        }
        tag.footer.let { footer ->
            footer.color = this.config.footerColor
        }
    }
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

suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation {
        cancel()
    }
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response)
        }

        override fun onFailure(call: Call, e: IOException) {
            if (!continuation.isCancelled) {
                continuation.resumeWithException(e)
            }
        }
    })
}
