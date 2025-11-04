package me.beeny.bedwarslevelhead

import cc.polyfrost.oneconfig.config.Config
import cc.polyfrost.oneconfig.config.annotations.*
import cc.polyfrost.oneconfig.config.core.OneColor
import cc.polyfrost.oneconfig.config.data.Mod
import cc.polyfrost.oneconfig.config.data.ModType

class BedwarsLevelHeadConfig : Config(
    Mod("BedWars Level Head", ModType.HYPIXEL),
    "bedwarslevelhead.json"
) {
    @Switch(
        name = "Enabled",
        description = "Toggle the entire mod on/off",
        category = "General",
        subcategory = "Toggle"
    )
    var enabled = true

    @Switch(
        name = "Show Own Level",
        description = "Display your own level above your head",
        category = "General",
        subcategory = "Display"
    )
    var showOwnLevel = true

    @Dropdown(
        name = "Position",
        description = "Where to display the level relative to name",
        category = "Display",
        options = ["Above", "Below", "Right", "Left"]
    )
    var position = 0

    @Color(
        name = "Text Color",
        description = "Color for level text display",
        category = "Display"
    )
    var textColor: OneColor = OneColor(255, 255, 255)

    @Slider(
        name = "Text Scale",
        description = "Scale of the level text",
        category = "Display",
        min = 5f,
        max = 20f,
        step = 1
    )
    var textScaleSteps = 10

    @Switch(
        name = "HUD Overlay",
        description = "Also render level as a 2D HUD overlay",
        category = "Display",
        subcategory = "HUD"
    )
    var hudEnabled = false

    @Dropdown(
        name = "HUD Position",
        description = "Screen position for HUD overlay",
        category = "Display",
        subcategory = "HUD",
        options = ["Top Left", "Top Center", "Top Right", "Bottom Left", "Bottom Center", "Bottom Right"]
    )
    var hudPosition = 1

    @Switch(
        name = "Tab List Integration",
        description = "Show levels in player tab list",
        category = "Integration"
    )
    var tabListEnabled = true

    @Switch(
        name = "Scoreboard Detection",
        description = "Detect levels from scoreboard",
        category = "Detection"
    )
    var scoreboardDetection = true

    @Switch(
        name = "Chat Detection",
        description = "Detect levels from chat messages",
        category = "Detection"
    )
    var chatDetection = true

    @Text(
        name = "Level Format",
        description = "Format for displaying levels. Use %level% as placeholder",
        category = "Formatting",
        placeholder = "&7[&f%level%⭐&7]",
        multiline = false
    )
    var levelFormat = "&7[&f%level%⭐&7]"

    @Switch(
        name = "Debug Mode",
        description = "Enable debug messages in chat",
        category = "Advanced"
    )
    var debug = false

    val textScale: Float
        get() = textScaleSteps / 10f

    init {
        initialize()
    }
}
