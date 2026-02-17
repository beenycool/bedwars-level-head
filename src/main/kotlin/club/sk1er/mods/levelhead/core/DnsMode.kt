package club.sk1er.mods.levelhead.core

/**
 * Enum representing different DNS resolution modes.
 */
enum class DnsMode(
    val displayName: String,
    val description: String
) {
    /**
     * Force IPv4 only.
     */
    IPV4_ONLY(
        displayName = "IPv4 Only",
        description = "Force IPv4 resolution. Helps on some broken networks but breaks IPv6-only environments."
    ),

    /**
     * Prefer IPv4, fall back to IPv6 if no IPv4 addresses are found.
     */
    IPV4_FIRST(
        displayName = "IPv4 First",
        description = "Prefer IPv4 resolution, but fall back to IPv6 if IPv4 is unavailable."
    ),

    /**
     * Use system default resolution.
     */
    SYSTEM_DEFAULT(
        displayName = "System Default",
        description = "Use the system's default DNS resolution (may use IPv4 or IPv6)."
    );

    companion object {
        /**
         * Get a DnsMode from its index in the enum.
         */
        fun fromIndex(index: Int): DnsMode {
            return entries.getOrNull(index) ?: IPV4_FIRST
        }

    }
}
