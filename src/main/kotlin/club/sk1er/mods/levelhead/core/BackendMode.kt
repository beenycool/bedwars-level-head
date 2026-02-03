package club.sk1er.mods.levelhead.core

enum class BackendMode(val index: Int, val displayName: String) {
    COMMUNITY(0, "Community API"),
    OWN_API_KEY(1, "Own API Key"),
    FALLBACK(2, "Fallback"),
    OFFLINE(3, "Offline Mode");

    companion object {
        fun fromIndex(index: Int): BackendMode {
            return entries.firstOrNull { it.index == index } ?: FALLBACK
        }
    }
}
