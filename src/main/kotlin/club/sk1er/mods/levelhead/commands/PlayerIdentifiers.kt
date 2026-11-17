package club.sk1er.mods.levelhead.commands

import club.sk1er.mods.levelhead.core.DebugLogging

object PlayerIdentifiers {
    val UUID_WITH_DASH_PATTERN = DebugLogging.UUID_REGEX
    val UUID_NO_DASH_PATTERN = DebugLogging.TRIMMED_UUID_REGEX
    val IGN_PATTERN = Regex("^[a-zA-Z0-9_]{1,16}$")
}
