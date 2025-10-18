package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import com.google.gson.Gson
import java.io.File
import java.io.FileReader
import java.io.FileWriter

private data class PersistedApiKey(val apiKey: String?)

object ApiKeyStore {
    private val gson = Gson()
    @Volatile
    private var storeFile: File? = null

    fun initialize(file: File) {
        storeFile = file
    }

    fun load(): String? {
        val file = storeFile ?: return null
        if (!file.exists()) {
            return null
        }

        return kotlin.runCatching {
            FileReader(file).use { reader ->
                gson.fromJson(reader, PersistedApiKey::class.java)?.apiKey?.trim().orEmpty()
            }
        }.onFailure { throwable ->
            Levelhead.logger.warn("Failed to read persisted API key store", throwable)
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    fun save(apiKey: String) {
        val file = storeFile ?: return
        val sanitized = apiKey.trim()
        if (sanitized.isEmpty()) {
            clear()
            return
        }

        kotlin.runCatching {
            file.parentFile?.takeIf { !it.exists() }?.mkdirs()
            FileWriter(file).use { writer ->
                gson.toJson(PersistedApiKey(sanitized), writer)
            }
        }.onFailure { throwable ->
            Levelhead.logger.error("Failed to persist API key", throwable)
        }
    }

    fun clear() {
        val file = storeFile ?: return
        if (!file.exists()) {
            return
        }

        if (!file.delete()) {
            Levelhead.logger.warn("Failed to delete persisted API key store at {}", file.absolutePath)
        }
    }
}
