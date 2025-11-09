package club.sk1er.mods.levelhead.config

import club.sk1er.mods.levelhead.Levelhead
import com.google.gson.Gson
import java.io.File
import java.io.FileReader
import java.io.FileWriter

private data class PersistedApiKey(val apiKey: String?)

/**
 * ApiKeyStore for BedWars Levelhead
 * 
 * This class provides secure API key storage and migration capabilities.
 * It supports both OneConfig secure storage and legacy file storage.
 */
object ApiKeyStore {
    private val gson = Gson()
    @Volatile
    private var storeFile: File? = null

    fun initialize(file: File) {
        storeFile = file
    }

    /**
     * Load API key from legacy file storage
     * 
     * @return The stored API key, or null if not found
     */
    fun loadFromLegacy(): String? {
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

    /**
     * Save API key to legacy file storage (for migration compatibility)
     * 
     * @param apiKey The API key to save
     */
    fun saveToLegacy(apiKey: String) {
        val file = storeFile ?: return
        val sanitized = apiKey.trim()
        if (sanitized.isEmpty()) {
            clearLegacy()
            return
        }

        kotlin.runCatching {
            file.parentFile?.takeIf { !it.exists() }?.mkdirs()
            FileWriter(file).use { writer ->
                gson.toJson(PersistedApiKey(sanitized), writer)
            }
        }.onFailure { throwable ->
            Levelhead.logger.error("Failed to persist API key to legacy store", throwable)
        }
    }

    /**
     * Clear API key from legacy file
     */
    fun clearLegacy() {
        val file = storeFile ?: return
        if (!file.exists()) {
            return
        }

        if (!file.delete()) {
            Levelhead.logger.warn("Failed to delete persisted API key store at {}", file.absolutePath)
        }
    }
    
    /**
     * Clear API key from both legacy file and signal OneConfig to clear secure storage
     */
    fun clear() {
        clearLegacy()
        // OneConfig secure storage will be cleared by setting the field directly
        // This is handled by the LevelheadConfig.setApiKey("") method
    }
    
    /**
     * Migrate existing API key from legacy file to OneConfig
     * This should be called with the OneConfig field setter
     * 
     * @param oneConfigSetter A lambda that sets the OneConfig field
     * @return true if migration was successful, false otherwise
     */
    fun migrateToOneConfig(oneConfigSetter: (String) -> Unit): Boolean {
        val legacyKey = loadFromLegacy() ?: return false
        
        return kotlin.runCatching {
            oneConfigSetter(legacyKey)
            Levelhead.logger.info("Migrated API key from legacy store to OneConfig secure storage")
            true
        }.onFailure { throwable ->
            Levelhead.logger.warn("Failed to migrate API key to OneConfig secure storage", throwable)
        }.getOrDefault(false)
    }
}
