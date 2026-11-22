package club.sk1er.mods.levelhead.bedwars

import com.google.gson.JsonObject

sealed class FetchResult {
    data class Success(val payload: JsonObject) : FetchResult()
    data class TemporaryError(val reason: String? = null) : FetchResult()
    data class PermanentError(val reason: String? = null) : FetchResult()

    /** Cache-only miss: the backend had nothing cached. Benign, never a failure. */
    object Absent : FetchResult()
}
