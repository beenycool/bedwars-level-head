package club.sk1er.mods.levelhead.commands

import net.minecraft.util.IChatComponent
import net.minecraft.util.EnumChatFormatting as ChatColor

object FetchErrorMessages {

    fun permanentError(
        reason: String?,
        modeName: String,
    suggestion: String? = null,
    onMissingKey: () -> IChatComponent? = { null },
        onOffline: () -> IChatComponent? = { null },
        onGeneric: (humanMessage: String) -> IChatComponent? = { null },
        fallbackCommand: String? = null,
        fallbackSuffix: String? = null,
    ): Pair<String, IChatComponent?> {
        when (reason) {
            "MISSING_KEY" -> {
                val msg = "${modeName} needs your Hypixel API key. Use /levelhead apikey <key> to set it."
        return msg to (onMissingKey() ?: CommandUtils.buildInteractiveFeedback(
            messagePrefix = "${ChatColor.YELLOW}${suggestion.orEmpty()}${ChatColor.YELLOW}",
                    command = "/levelhead apikey <key>",
                    suggestedCommand = "/levelhead apikey ",
                    suffix = "${ChatColor.YELLOW} with your Hypixel API key."
                ))
            }
            "INVALID_KEY" -> {
                val msg = "Hypixel rejected your API key. Update it with /levelhead apikey <key>."
                return msg to CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}$msg${ChatColor.YELLOW} Try ",
                    command = "/levelhead apikey <key>",
                    suggestedCommand = "/levelhead apikey ",
                    suffix = "${ChatColor.YELLOW} with a valid key."
                )
            }
            "OFFLINE_MODE" -> {
                val msg = "Mod is in offline mode. No data will be fetched."
                return msg to (onOffline() ?: CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.YELLOW}$msg${ChatColor.YELLOW} Use ",
                    command = "/levelhead gui",
                    run = true,
                    suffix = "${ChatColor.YELLOW} to change the backend mode."
                ))
            }
            "COMMUNITY_DATABASE_UNAVAILABLE" -> {
                val msg = "Community database is unavailable right now."
                return msg to CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}$msg${ChatColor.YELLOW} Check ",
                    command = "/levelhead status",
                    run = true,
                    suffix = "${ChatColor.YELLOW} or try /levelhead profile list for presets."
                )
            }
            "INVALID_PROXY_URL" -> {
                val msg = "Proxy URL is invalid. Check your proxy configuration."
                return msg to CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}$msg${ChatColor.YELLOW} Use ",
                    command = "/levelhead proxy url <url>",
                    suggestedCommand = "/levelhead proxy url ",
                    suffix = "${ChatColor.YELLOW} to fix it."
                )
            }
            "INVALID_URL" -> {
                val msg = "Internal URL build failed. This is likely a bug."
                return msg to null
            }
            else -> {
                val human = formatGenericReason(reason, modeName)
                val component = onGeneric(human) ?: if (fallbackCommand != null) {
                    CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}$human.${ChatColor.YELLOW} Check ",
                        command = fallbackCommand,
                        run = true,
                        suffix = fallbackSuffix ?: "${ChatColor.YELLOW} for details."
                    )
                } else null
                return "$human." to component
            }
        }
    }

    fun temporaryError(
        reason: String?,
        modeName: String,
        onGeneric: (humanMessage: String) -> IChatComponent? = { null },
        fallbackCommand: String? = null,
        fallbackSuffix: String? = null,
    ): Pair<String, IChatComponent?> {
        when (reason) {
            "PROXY_AUTH" -> {
                val msg = "Proxy rejected your auth token. Check your proxy token configuration."
                return msg to CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}$msg${ChatColor.YELLOW} Use ",
                    command = "/levelhead proxy token <token>",
                    suggestedCommand = "/levelhead proxy token ",
                    suffix = "${ChatColor.YELLOW} to update it."
                )
            }
            "PROXY_RATE_LIMIT" -> {
                val msg = "Proxy rate limit reached. Will retry automatically."
                return msg to null
            }
            "PROXY_ERROR" -> {
                val msg = "Proxy returned an error. Backend may be unhealthy."
                return msg to CommandUtils.buildInteractiveFeedback(
                    messagePrefix = "${ChatColor.RED}$msg${ChatColor.YELLOW} Check ",
                    command = "/levelhead status",
                    run = true,
                    suffix = "${ChatColor.YELLOW} for details."
                )
            }
            "PARSE_ERROR" -> {
                val msg = "Failed to parse $modeName response. This may be a temporary issue."
                return msg to null
            }
            "MISSING_DATA" -> {
                val msg = "Proxy returned incomplete data for this player."
                return msg to null
            }
            "NOT_FOUND" -> {
                val msg = "Player not found in proxy cache."
                return msg to null
            }
            else -> {
                val human = formatGenericReason(reason, modeName)
                val component = onGeneric(human) ?: if (fallbackCommand != null) {
                    CommandUtils.buildInteractiveFeedback(
                        messagePrefix = "${ChatColor.RED}$human.${ChatColor.YELLOW} Check ",
                        command = fallbackCommand,
                        run = true,
                        suffix = fallbackSuffix ?: "${ChatColor.YELLOW} for details."
                    )
                } else null
                return "$human." to component
            }
        }
    }

    private fun formatGenericReason(reason: String?, modeName: String): String {
        if (reason == null) return "$modeName request failed"
        return when {
            reason.startsWith("HYPIXEL_") -> "Hypixel API returned an error (${reason.removePrefix("HYPIXEL_")}). Server may be busy"
            reason.startsWith("HTTP_") -> "Proxy returned HTTP error (${reason.removePrefix("HTTP_")})"
            reason.startsWith("PROXY_") -> "Proxy error: ${reason.removePrefix("PROXY_").lowercase().replace('_', ' ')}"
            reason.isBlank() -> "$modeName request failed"
            else -> "$modeName request failed ($reason)"
        }
    }
}
