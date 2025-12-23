package club.sk1er.mods.levelhead.core

/**
 * Enum representing different backend connection modes for fetching stats.
 */
enum class BackendMode(
    val displayName: String,
    val description: String
) {
    /**
     * Use only the community proxy/database for stats.
     * Fastest and doesn't require an API key but may have less fresh data.
     */
    PROXY_ONLY(
        displayName = "Proxy Only",
        description = "Use only the community database (fastest, no API key needed)"
    ),

    /**
     * Use only the direct Hypixel API.
     * Requires an API key, most up-to-date data but rate limited.
     */
    DIRECT_API(
        displayName = "Direct API",
        description = "Use only your Hypixel API key (most accurate, requires API key)"
    ),

    /**
     * Try proxy first, fall back to direct API if proxy fails.
     * Best of both worlds - fast when proxy works, reliable when it doesn't.
     */
    FALLBACK(
        displayName = "Fallback",
        description = "Try proxy first, use API key if proxy fails (recommended)"
    ),

    /**
     * Offline/cache-only mode.
     * Only shows cached data, no network requests.
     */
    OFFLINE(
        displayName = "Offline",
        description = "Use only cached data (no network requests)"
    );

    companion object {
        /**
         * Get a BackendMode from its index in the enum.
         */
        fun fromIndex(index: Int): BackendMode {
            return entries.getOrNull(index) ?: FALLBACK
        }

        /**
         * Get all display names as a list.
         */
        fun displayNames(): List<String> = entries.map { it.displayName }
    }
}
