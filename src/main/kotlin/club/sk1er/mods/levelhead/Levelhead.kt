package club.sk1er.mods.levelhead

import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.RateLimiter
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.core.trimmed
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.render.AboveHeadRender
import com.google.gson.Gson
import com.google.gson.JsonParser
import gg.essential.api.EssentialAPI
import gg.essential.universal.UMinecraft
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import net.minecraft.client.entity.EntityPlayerSP
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.event.entity.EntityJoinWorldEvent
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLPostInitializationEvent
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.network.FMLNetworkEvent
import okhttp3.OkHttpClient
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger
import java.awt.Color
import java.io.File
import java.time.Duration
import java.util.concurrent.TimeUnit

@Mod(modid = Levelhead.MODID, name = "Levelhead", version = Levelhead.VERSION, modLanguageAdapter = "gg.essential.api.utils.KotlinAdapter")
object Levelhead {
    val logger: Logger = LogManager.getLogger()
    val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(5, TimeUnit.SECONDS)
        .build()
    val gson = Gson()
    val jsonParser = JsonParser()

    val displayManager: DisplayManager = DisplayManager(File(File(UMinecraft.getMinecraft().mcDataDir, "config"), "levelhead.json"))
    val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    val rateLimiter: RateLimiter = RateLimiter(150, Duration.ofMinutes(5))

    val DarkChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.2f)
    val ChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.8f)
    val chromaColor: Color
        get() = Color(ChromaColor)

    const val MODID = "level_head"
    const val VERSION = "8.2.3"

    @Mod.EventHandler
    fun preInit(event: FMLPreInitializationEvent) {
        val configDirectory = event.modConfigurationDirectory ?: File(UMinecraft.getMinecraft().mcDataDir, "config")
        val configFile = File(configDirectory, "bedwars-level-head.cfg")
        LevelheadConfig.initialize(configFile)
    }

    @Mod.EventHandler
    fun postInit(@Suppress("UNUSED_PARAMETER") event: FMLPostInitializationEvent) {
        MinecraftForge.EVENT_BUS.register(AboveHeadRender)
        MinecraftForge.EVENT_BUS.register(BedwarsModeDetector)
        MinecraftForge.EVENT_BUS.register(this)
        EssentialAPI.getCommandRegistry().registerCommand(LevelheadCommand())
    }

    @SubscribeEvent
    fun joinServer(@Suppress("UNUSED_PARAMETER") event: FMLNetworkEvent.ClientConnectedToServerEvent) {
        BedwarsFetcher.resetWarnings()
        scope.coroutineContext.cancelChildren()
        rateLimiter.resetState()
        displayManager.clearCachesWithoutRefetch()
        scope.launch { displayManager.requestAllDisplays() }
    }

    @SubscribeEvent
    fun playerJoin(event: EntityJoinWorldEvent) {
        if (event.entity is EntityPlayerSP) {
            scope.coroutineContext.cancelChildren()
            rateLimiter.resetState()
            displayManager.joinWorld(resetDetector = true)
        } else if (event.entity is EntityPlayer) {
            displayManager.playerJoin(event.entity as EntityPlayer)
        }
    }

    fun fetch(requests: List<LevelheadRequest>): Job {
        return scope.launch {
            if (!BedwarsModeDetector.shouldRequestData()) return@launch

            rateLimiter.consume()

            requests
                .groupBy { it.uuid }
                .forEach { (trimmedUuid, groupedRequests) ->
                    val uuid = trimmedUuid.dashUUID ?: return@forEach
                    val player = BedwarsFetcher.fetchPlayer(uuid)
                    val experience = BedwarsStar.extractExperience(player)
                    val star = experience?.let { BedwarsStar.calculateStar(it) }
                    val starString = star?.let { "$it★" } ?: "?"

                    groupedRequests
                        .filter { it.type == BedwarsModeDetector.BEDWARS_STAR_TYPE }
                        .forEach { req ->
                            val footerTemplate = req.display.config.footerString
                            val footerValue = footerTemplate?.replace("%star%", starString, true) ?: starString
                            val style = star?.let { BedwarsStar.styleForStar(it) }
                                ?: BedwarsStar.PrestigeStyle(req.display.config.footerColor, req.display.config.footerChroma)
                            val tag = LevelheadTag.build(uuid) {
                                header {
                                    value = "${req.display.config.headerString}: "
                                    color = req.display.config.headerColor
                                    chroma = req.display.config.headerChroma
                                }
                                footer {
                                    value = footerValue
                                    color = style.color
                                    chroma = style.chroma
                                }
                            }
                            req.display.cache[uuid] = tag
                        }
                }
        }
    }

    class LevelheadRequest(val uuid: String, val display: LevelheadDisplay, val allowOverride: Boolean, val type: String = display.config.type)
}
