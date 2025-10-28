package me.beeny.bedwarslevelhead

import net.minecraftforge.common.MinecraftForge
import net.minecraftforge.fml.common.Mod
import net.minecraftforge.fml.common.event.FMLInitializationEvent
import cc.polyfrost.oneconfig.events.EventManager
import cc.polyfrost.oneconfig.events.event.InitializationEvent
import cc.polyfrost.oneconfig.libs.eventbus.Subscribe
import cc.polyfrost.oneconfig.utils.commands.CommandManager

@Mod(
    modid = "bedwarslevelhead",
    name = "BedWars Level Head",
    version = "2.0.0",
    acceptedMinecraftVersions = "[1.8.9]"
)
class BedwarsLevelHeadMod {

    @Mod.EventHandler
    fun init(event: FMLInitializationEvent) {
        BedwarsLevelHead.init()
        MinecraftForge.EVENT_BUS.register(BedwarsLevelHead.events)

        EventManager.INSTANCE.register(this)

        CommandManager.register(me.beeny.bedwarslevelhead.commands.BedwarsLevelCommand())
    }

    @Subscribe
    fun onInitialization(event: InitializationEvent) {
        println("BedWars Level Head initialized with OneConfig v1 API")
    }
}
