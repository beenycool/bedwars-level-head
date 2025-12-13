package club.sk1er.mods.levelhead.bedwars

import com.google.gson.JsonObject

sealed class FetchResult {
    data class Success(val payload: JsonObject, val etag: String? = null) : FetchResult()
    object NotModified : FetchResult()
    data class TemporaryError(val reason: String? = null) : FetchResult()
    data class PermanentError(val reason: String? = null) : FetchResult()
}
