package club.sk1er.mods.levelhead.core

/**
 * Enum representing different backend connection modes for fetching stats.
 */
enum class BackendMode(
    val displayName: String,
    val description: String
) {
    /**
     * Use only the community database/cache for stats.
     * Fastest and doesn't require an API key but may have less fresh data.
     */
    COMMUNITY_CACHE_ONLY(
        displayName = "Community API",
        description = "Use only the community database (fastest, no API key needed)"
    ),

    /**
     * Use only the direct Hypixel API.
     * Requires an API key, most up-to-date data but rate limited.
     */
    DIRECT_API(
        displayName = "Own API Key",
        description = "Use only your Hypixel API key (most accurate, requires API key)"
    ),

    /**
     * Try community database first, fall back to direct API if database fails.
     * Best of both worlds - fast when database works, reliable when it doesn't.
     */
    FALLBACK(
        displayName = "Fallback (Recommended)",
        description = "Try community database first, use API key if database fails (recommended)"
    ),

    /**
     * Offline/cache-only mode.
     * Only shows cached data, no network requests.
     */
    OFFLINE(
        displayName = "Offline Mode",
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
