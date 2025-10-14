package club.sk1er.mods.levelhead

import club.sk1er.mods.levelhead.auth.MojangAuth
import club.sk1er.mods.levelhead.commands.LevelheadCommand
import club.sk1er.mods.levelhead.bedwars.BedwarsFetcher
import club.sk1er.mods.levelhead.config.DisplayConfig
import club.sk1er.mods.levelhead.config.LevelheadConfig
import club.sk1er.mods.levelhead.core.BedwarsModeDetector
import club.sk1er.mods.levelhead.core.BedwarsStar
import club.sk1er.mods.levelhead.core.DisplayManager
import club.sk1er.mods.levelhead.core.RateLimiter
import club.sk1er.mods.levelhead.core.dashUUID
import club.sk1er.mods.levelhead.core.trimmed
import club.sk1er.mods.levelhead.display.AboveHeadDisplay
import club.sk1er.mods.levelhead.display.LevelheadDisplay
import club.sk1er.mods.levelhead.display.LevelheadTag
import club.sk1er.mods.levelhead.render.AboveHeadRender
import club.sk1er.mods.levelhead.render.ChatRender
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import gg.essential.api.EssentialAPI
import gg.essential.universal.UMinecraft
import gg.essential.universal.wrappers.UPlayer
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.minecraft.client.entity.EntityPlayerSP
import net.minecraft.entity.player.EntityPlayer
import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.event.entity.EntityJoinWorldEvent
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLPostInitializationEvent
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent
import net.minecraftforge.fml.common.network.FMLNetworkEvent
import okhttp3.MediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import org.apache.logging.log4j.LogManager
import java.util.UUID
import org.apache.logging.log4j.Logger
import java.awt.Color
import java.io.File
import java.text.DecimalFormat
import java.time.Duration
import java.util.*

@Mod(modid = Levelhead.MODID, name = "Levelhead", version = Levelhead.VERSION, modLanguageAdapter = "gg.essential.api.utils.KotlinAdapter")
object Levelhead {
    val logger: Logger = LogManager.getLogger()
    val okHttpClient = OkHttpClient()
    val gson = Gson()
    val jsonParser = JsonParser()

    val EMPTY_BODY: RequestBody = RequestBody.create(null, byteArrayOf())

    lateinit var auth: MojangAuth
        private set
    var types: JsonObject = JsonObject()
        private set
    var rawPurchases: JsonObject = JsonObject()
        private set
    var paidData: JsonObject = JsonObject()
        private set
    var purchaseStatus: JsonObject = JsonObject()
        private set
    val allowedTypes: JsonObject
        get() = JsonObject().merge(types, true).also { obj ->
            if (!obj.has(BedwarsModeDetector.BEDWARS_STAR_TYPE)) {
                obj.add(BedwarsModeDetector.BEDWARS_STAR_TYPE, JsonObject().apply {
                    addProperty("name", BedwarsModeDetector.DEFAULT_HEADER)
                })
            }
            paidData["stats"].asJsonObject.entrySet().filter {
                purchaseStatus[it.key].asBoolean
            }.map { obj.add(it.key, it.value) }
        }
    val displayManager: DisplayManager = DisplayManager(File(File(UMinecraft.getMinecraft().mcDataDir, "config"), "levelhead.json"))
    val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val mutex: Mutex = Mutex()
    val rateLimiter: RateLimiter = RateLimiter(150, Duration.ofMinutes(5))
    private val format: DecimalFormat = DecimalFormat("#,###")
    val DarkChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.2f)
    val ChromaColor: Int
        get() = Color.HSBtoRGB(System.currentTimeMillis() % 1000 / 1000f, 0.8f, 0.8f)
    val chromaColor: Color
        get() = Color(ChromaColor)
    val selfLevelheadTag: LevelheadTag
        get() {
            val uuid = UPlayer.getUUID() ?: return LevelheadTag(UUID(0L, 0L))
            val display = displayManager.aboveHead.getOrNull(0) ?: return LevelheadTag(uuid)
            return display.cache.getOrPut(uuid) { LevelheadTag(uuid) }
        }

    const val MODID = "level_head"
    const val VERSION = "8.2.3"

    @Mod.EventHandler
    fun preInit(event: FMLPreInitializationEvent) {
        val configDirectory = event.modConfigurationDirectory ?: File(UMinecraft.getMinecraft().mcDataDir, "config")
        val configFile = File(configDirectory, "bedwars-level-head.cfg")
        LevelheadConfig.initialize(configFile)
        scope.launch {
            refreshTypes()
        }
    }

    @Mod.EventHandler
    fun postInit(ignored: FMLPostInitializationEvent) {
        MinecraftForge.EVENT_BUS.register(AboveHeadRender)
        MinecraftForge.EVENT_BUS.register(ChatRender)
        MinecraftForge.EVENT_BUS.register(this)
        EssentialAPI.getCommandRegistry().registerCommand(LevelheadCommand())
    }

    suspend fun refreshTypes() {
        mutex.withLock(types) {
            types = jsonParser.parse(getWithAgent("https://api.sk1er.club/levelhead_config")).asJsonObject
        }
    }

    suspend fun refreshRawPurchases() {
        mutex.withLock(rawPurchases) {
            rawPurchases = jsonParser.parse(getWithAgent(
                "https://api.sk1er.club/purchases/" + UMinecraft.getMinecraft().session.profile.id.toString()
            )).asJsonObject
            if (!rawPurchases.has("remaining_levelhead_credits")) {
                rawPurchases.addProperty("remaining_levelhead_credits", 0)
            }
        }
    }

    suspend fun refreshPaidData() {
        mutex.withLock(paidData) {
            paidData = jsonParser.parse(getWithAgent("https://api.sk1er.club/levelhead_data")).asJsonObject
        }
    }

    suspend fun refreshPurchaseStates() {
        mutex.withLock(purchaseStatus) {
            purchaseStatus = jsonParser.parse(getWithAgent(
                "https://api.sk1er.club/levelhead_purchase_status/" + UMinecraft.getMinecraft().session.profile.id.toString()
            )).asJsonObject
            LevelheadPurchaseStates.chat = purchaseStatus["chat"].asBoolean
            LevelheadPurchaseStates.tab = purchaseStatus["tab"].asBoolean
            LevelheadPurchaseStates.aboveHead = purchaseStatus["head"].asInt
            LevelheadPurchaseStates.customLevelhead = purchaseStatus["custom_levelhead"].asBoolean
            for (i in displayManager.aboveHead.size..LevelheadPurchaseStates.aboveHead) {
                displayManager.aboveHead.add(AboveHeadDisplay(DisplayConfig()))
            }
            displayManager.adjustIndices()
        }
    }

    @SubscribeEvent
    fun joinServer(event: FMLNetworkEvent.ClientConnectedToServerEvent) {
        auth = MojangAuth()
        auth.auth()
        if (auth.isFailed) {
            EssentialAPI.getNotifications().push("An error occurred while logging logging into Levelhead", auth.failMessage)
        }
        scope.launch {
            refreshPurchaseStates()
            refreshRawPurchases()
            refreshPaidData()
            refreshTypes()
        }

    }

    @SubscribeEvent
    fun playerJoin(event: EntityJoinWorldEvent) {
        // when you join world
        if (event.entity is EntityPlayerSP) {
            scope.coroutineContext.cancelChildren()
            rateLimiter.resetState()
            displayManager.joinWorld(resetDetector = true)
        // when others join world
        } else if (event.entity is EntityPlayer && !auth.isFailed) {
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

    fun getWithAgent(url: String): String {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/4.76 (SK1ER LEVEL HEAD V${VERSION})")
            .get()
            .build()
        return kotlin.runCatching {
            okHttpClient.newCall(request).execute().use { response ->
                response.body()?.string()
                    ?: "{\"success\":false,\"cause\":\"API_DOWN\"}"
            }
        }.getOrDefault("{\"success\":false,\"cause\":\"API_DOWN\"}")
    }

    fun postWithAgent(url: String, jsonObject: JsonObject): String {
        val body = RequestBody.create(MediaType.parse("application/json"), gson.toJson(jsonObject))
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/4.76 (SK1ER LEVEL HEAD V${VERSION})")
            .post(body)
            .build()
        return kotlin.runCatching {
            okHttpClient.newCall(request).execute().use { response ->
                response.body()?.string()
                    ?: "{\"success\":false,\"cause\":\"API_DOWN\"}"
            }
        }.getOrDefault("{\"success\":false,\"cause\":\"API_DOWN\"}")
    }

    fun JsonObject.merge(other: JsonObject, override: Boolean): JsonObject {
        other.entrySet().map { it.key }.filter { key ->
            override || !this.has(key)
        }.map { key ->
            this.add(key, other[key])
        }
        return this
    }

    class LevelheadRequest(val uuid: String, val display: LevelheadDisplay, val allowOverride: Boolean, val type: String = display.config.type)

    object LevelheadPurchaseStates {
        var chat: Boolean = false
        var tab: Boolean = false
        var aboveHead: Int = 1
        var customLevelhead: Boolean = false
    }
}