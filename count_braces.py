import sys

filename = "src/main/kotlin/club/sk1er/mods/levelhead/commands/LevelheadCommand.kt"

with open(filename, 'r') as f:
    lines = f.readlines()

stack = []
for i, line in enumerate(lines):
    line_stripped = line.strip()
    for char in line:
        if char == '{':
            stack.append(i + 1)
        elif char == '}':
            if stack:
                stack.pop()
            else:
                print(f"Extra closing brace at line {i + 1}")

if stack:
    print(f"Unclosed braces starting at lines: {stack}")
