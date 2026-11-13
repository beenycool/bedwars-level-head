package club.sk1er.mods.levelhead.commands

import net.minecraft.util.IChatComponent
import net.minecraft.util.EnumChatFormatting as ChatColor

/**
 * Single source of truth for stat-fetch failure messaging.
 *
 * Used by /levelhead whois and the fetchers so the same failure produces the same
 * wording everywhere.
 */
object FetchFeedback {

    /** Interactive feedback for a permanent fetch failure ("reason" from FetchResult). */
    fun permanentErrorFeedback(reason: String?, modeName: String): IChatComponent {
        if (reason == "OFFLINE_MODE") {
            return CommandUtils.buildInteractiveFeedback(
                messagePrefix = "${ChatColor.RED}The stats backend is unreachable. Use ",
                command = "/levelhead",
                run = true,
                suffix = "${ChatColor.RED} to check the backend URL.",
                hoverTextOverride = "${ChatColor.GREEN}Click to open settings"
            )
        }
        return genericErrorFeedback(reason, modeName, permanent = true)
    }

    /** Interactive feedback for a temporary fetch failure ("reason" from FetchResult). */
    fun temporaryErrorFeedback(reason: String?, modeName: String): IChatComponent =
        genericErrorFeedback(reason, modeName, permanent = false)

    /** Interactive feedback for an unexpected exception thrown while running a command. */
    fun unexpectedErrorFeedback(action: String): IChatComponent {
        val component = CommandUtils.buildInteractiveFeedback(
            messagePrefix = "${ChatColor.RED}Unexpected error while $action. Try ",
            command = "/levelhead status",
            run = true,
            suffix = "${ChatColor.RED} to check your connection or check logs for details. If this issue persists, please make an issue on GitHub: ",
            hoverTextOverride = "${ChatColor.GREEN}Click to check status"
        )
        return component.appendSibling(
            CommandUtils.createClickableUrl("https://github.com/beenycool/bedwars-level-head/", "${ChatColor.AQUA}GitHub.")
        )
    }

    private fun genericErrorFeedback(reason: String?, modeName: String, permanent: Boolean): IChatComponent {
        val detail = reason ?: "unknown"
        val baseError = if (permanent) {
            "$modeName request failed ($detail)"
        } else {
            "$modeName stats temporarily unavailable ($detail)"
        }
        return CommandUtils.buildInteractiveFeedback(
            messagePrefix = "${ChatColor.RED}$baseError.${ChatColor.YELLOW} Check ",
            command = "/levelhead status",
            run = true,
            suffix = "${ChatColor.YELLOW} to see your connection status.",
            hoverTextOverride = "${ChatColor.GREEN}Click to check status"
        )
    }
}
