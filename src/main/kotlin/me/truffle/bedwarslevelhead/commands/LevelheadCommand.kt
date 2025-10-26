package me.truffle.bedwarslevelhead.command

import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import me.truffle.bedwarslevelhead.BedwarsLevelHead

@Command(
    value = "bedwarslevel",
    aliases = ["bwl", "bedwarslvl"],
    description = "Configure BedWars Level Head settings"
)
class BedwarsLevelCommand {

    @Main
    fun handle() {
        // OneConfig automatically opens the config GUI
        // This method can be empty or used for custom logic
        println("Opening BedWars Level Head configuration...")
    }
}