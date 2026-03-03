file_path = "src/main/kotlin/club/sk1er/mods/levelhead/commands/LevelheadCommand.kt"

with open(file_path, "r") as f:
    content = f.read()

import re

# We will modify sendSuccessWithStatusLink to just call sendMessage(component: IChatComponent) which already adds the prefix.
# Oh, sendMessage(IChatComponent) DOES exist! And it DOES add the prefix!
# Let's check the implementation of sendSuccessWithStatusLink
