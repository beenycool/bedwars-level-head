import re

with open("src/main/kotlin/club/sk1er/mods/levelhead/config/migration/ConfigMigrator.kt", "r") as f:
    content = f.read()

# Fix master version parsing
master_parsing = """        if (source.has("master") && source.get("master").isJsonObject) {
            val master = source.getAsJsonObject("master")
            if (master.has("version") && master.get("version").isJsonPrimitive && master.getAsJsonObject().get("version").asJsonPrimitive.isNumber) {
                version = master.get("version").asInt
            }
        }"""
content = re.sub(r'        if \(source\.has\("master"\) && source\.getAsJsonObject\("master"\)\.has\("version"\)\) \{\n            version = source\.getAsJsonObject\("master"\)\.get\("version"\)\.asInt\n        \}', master_parsing, content)

# Fix master version setting
master_writing = """        if (!migrated.has("master") || !migrated.get("master").isJsonObject) {
            migrated.add("master", JsonObject())
        }
        migrated.getAsJsonObject("master").addProperty("version", CURRENT_VERSION)"""
content = re.sub(r'        if \(!migrated\.has\("master"\)\) \{\n            migrated\.add\("master", JsonObject\(\)\)\n        \}\n        migrated\.getAsJsonObject\("master"\)\.addProperty\("version", CURRENT_VERSION\)', master_writing, content)

# Fix V0 -> V1 array parsing
v0v1_parsing = """        if (source.has("head") && source.get("head").isJsonArray) {
            val headArray = source.getAsJsonArray("head")
            for (i in 0 until headArray.size()) {
                val elem = headArray.get(i)
                if (!elem.isJsonObject) continue
                val display = elem.asJsonObject

                // Read legacy 'type' and convert to 'gameMode'
                val typeElem = display.get("type")
                if (typeElem != null && typeElem.isJsonPrimitive && typeElem.asJsonPrimitive.isString) {
                    val typeStr = typeElem.asString
                    val gameMode = GameMode.fromTypeId(typeStr) ?: GameMode.BEDWARS
                    display.addProperty("gameMode", gameMode.name)
                } else if (!display.has("gameMode")) {
                    display.addProperty("gameMode", GameMode.BEDWARS.name)
                }
            }
        }"""
content = re.sub(r'        if \(source\.has\("head"\) && source\.get\("head"\)\.isJsonArray\) \{\n            val headArray = source\.getAsJsonArray\("head"\)\n            for \(i in 0 until headArray\.size\(\)\) \{\n                val display = headArray\.get\(i\)\.asJsonObject\n                \n                // Read legacy \'type\' and convert to \'gameMode\'\n                val typeElem = display\.get\("type"\)\n                if \(typeElem != null && typeElem\.isJsonPrimitive && typeElem\.asJsonPrimitive\.isString\) \{\n                    val typeStr = typeElem\.asString\n                    val gameMode = GameMode\.fromTypeId\(typeStr\) \?: GameMode\.BEDWARS\n                    display\.addProperty\("gameMode", gameMode\.name\)\n                \} else if \(!display\.has\("gameMode"\)\) \{\n                    display\.addProperty\("gameMode", GameMode\.BEDWARS\.name\)\n                \}\n            \}\n        \}', v0v1_parsing, content)


# Fix V1 -> V2 array parsing
v1v2_parsing = """        if (source.has("head") && source.get("head").isJsonArray) {
            val headArray = source.getAsJsonArray("head")
            for (i in 0 until headArray.size()) {
                val elem = headArray.get(i)
                if (!elem.isJsonObject) continue
                val display = elem.asJsonObject

                val modeElem = display.get("gameMode")
                val headerElem = display.get("headerString")
                val modeStr = if (modeElem != null && modeElem.isJsonPrimitive && modeElem.asJsonPrimitive.isString) modeElem.asString else GameMode.BEDWARS.name
                val headerStr = if (headerElem != null && headerElem.isJsonPrimitive && headerElem.asJsonPrimitive.isString) headerElem.asString else null

                if (modeStr != GameMode.BEDWARS.name) {
                    val previousType = modeStr
                    val normalizedHeader = normalizedManagedHeader(headerStr, GameMode.BEDWARS)

                    if (i == 0 && normalizedHeader != null && !headerStr.equals(normalizedHeader, ignoreCase = true)) {
                        display.addProperty("headerString", normalizedHeader)
                        runCatching { Levelhead.logger.info(
                            "Migrating legacy display #1 header '{}' -> '{}' while normalizing to BEDWARS.",
                            headerStr ?: "null",
                            normalizedHeader
                        ) }
                    }

                    runCatching { Levelhead.logger.info("Migrating legacy display #${i + 1} from mode '$previousType' to 'BEDWARS'.") }
                    display.addProperty("gameMode", GameMode.BEDWARS.name)
                }
            }
        }"""
content = re.sub(r'        if \(source\.has\("head"\) && source\.get\("head"\)\.isJsonArray\) \{\n            val headArray = source\.getAsJsonArray\("head"\)\n            for \(i in 0 until headArray\.size\(\)\) \{\n                val display = headArray\.get\(i\)\.asJsonObject\n                val modeElem = display\.get\("gameMode"\)\n                val headerElem = display\.get\("headerString"\)\n                val modeStr = if \(modeElem != null && !modeElem\.isJsonNull\) modeElem\.asString else GameMode\.BEDWARS\.name\n                val headerStr = if \(headerElem != null && !headerElem\.isJsonNull\) headerElem\.asString else null\n                \n                if \(modeStr != GameMode\.BEDWARS\.name\) \{\n                    val previousType = modeStr\n                    val normalizedHeader = normalizedManagedHeader\(headerStr, GameMode\.BEDWARS\)\n                    \n                    if \(i == 0 && normalizedHeader != null && !headerStr\.equals\(normalizedHeader, ignoreCase = true\)\) \{\n                        display\.addProperty\("headerString", normalizedHeader\)\n                        runCatching \{ Levelhead\.logger\.info\(\n                            "Migrating legacy display #1 header \'\{\}\' -> \'\{\}\' while normalizing to BEDWARS\.",\n                            headerStr \?: "null",\n                            normalizedHeader\n                        \) \}\n                    \}\n\n                    runCatching \{ Levelhead\.logger\.info\("Migrating legacy display #\$\{i \+ 1\} from mode \'\$previousType\' to \'BEDWARS\'\."\) \}\n                    display\.addProperty\("gameMode", GameMode\.BEDWARS\.name\)\n                \}\n            \}\n        \}', v1v2_parsing, content)


with open("src/main/kotlin/club/sk1er/mods/levelhead/config/migration/ConfigMigrator.kt", "w") as f:
    f.write(content)
