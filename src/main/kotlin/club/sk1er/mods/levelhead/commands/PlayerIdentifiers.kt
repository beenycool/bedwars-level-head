package club.sk1er.mods.levelhead.commands

object PlayerIdentifiers {
    val UUID_WITH_DASH_PATTERN = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
    val UUID_NO_DASH_PATTERN = Regex("^[0-9a-f]{32}$", RegexOption.IGNORE_CASE)
    val IGN_PATTERN = Regex("^[a-zA-Z0-9_]{1,16}$")
}
