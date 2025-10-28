package me.beeny.bedwarslevelhead.commands

import cc.polyfrost.oneconfig.utils.commands.annotations.Command
import cc.polyfrost.oneconfig.utils.commands.annotations.Main
import me.beeny.bedwarslevelhead.BedwarsLevelHead

@Command(value = "bedwarslevel", aliases = ["bwl", "bedwarslvl"], description = "Open BedWars Level Head config")
class BedwarsLevelCommand {

    @Main
    fun main() {
        BedwarsLevelHead.config.openGui()
    }
}
