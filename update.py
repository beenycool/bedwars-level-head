import os

path = 'src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt'
with open(path, 'r') as f:
    content = f.read()

old_code = """    private fun notifyNetworkIssue(ex: IOException) {
        if (networkIssueWarned.compareAndSet(false, true)) {
            Levelhead.sendChat("${ChatColor.RED}Proxy stats offline. ${ChatColor.YELLOW}Retrying in 60s.")
        }
        Levelhead.logger.error("Network error while fetching proxy BedWars data", ex)
    }"""

new_code = """    private suspend fun notifyNetworkIssue(ex: IOException) {
        if (networkIssueWarned.compareAndSet(false, true)) {
            val isHealthy = checkBackendHealth()
            if (isHealthy) {
                Levelhead.sendChat("${ChatColor.RED}Proxy stats request failed (Backend Online). ${ChatColor.YELLOW}Retrying in 60s.")
            } else {
                Levelhead.sendChat("${ChatColor.RED}Proxy stats offline. ${ChatColor.YELLOW}Retrying in 60s.")
            }
        }
        Levelhead.logger.error("Network error while fetching proxy BedWars data", ex)
    }

    private suspend fun checkBackendHealth(): Boolean {
        val healthUrl = HttpUrl.parse(LevelheadConfig.proxyBaseUrl)
            ?.newBuilder()
            ?.addPathSegment("healthz")
            ?.build() ?: return false

        val request = Request.Builder()
            .url(healthUrl)
            .get()
            .build()

        return try {
            Levelhead.okHttpClient.newCall(request).await().use { response ->
                if (!response.isSuccessful) return@use false
                val body = response.body()?.string() ?: return@use false
                val json = kotlin.runCatching { JsonParser.parseString(body).asJsonObject }.getOrNull() ?: return@use false
                json.get("status")?.asString == "ok"
            }
        } catch (ex: Exception) {
            false
        }
    }"""

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(path, 'w') as f:
        f.write(content)
    print("Updated successfully")
else:
    print("Code block not found")
