import os

file_path = 'src/main/kotlin/club/sk1er/mods/levelhead/bedwars/ProxyClient.kt'

with open(file_path, 'r') as f:
    content = f.read()

old_catch = """        } catch (ex: Exception) {
            false
        }"""

new_catch = """        } catch (ex: Exception) {
            Levelhead.logger.warn("Failed to check backend health", ex)
            false
        }"""

if old_catch in content:
    new_content = content.replace(old_catch, new_catch)
    with open(file_path, 'w') as f:
        f.write(new_content)
    print("File updated successfully.")
else:
    print("Could not find the target code block to replace.")
