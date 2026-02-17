import re

with open('backend/src/routes/stats.ts', 'r') as f:
    content = f.read()

# Pattern for the typeParam definition
type_param_def = r"    const typeParam = typeof req.query.type === 'string' \? req.query.type : undefined;\n"

# Pattern for the memory block
memory_block = r"""if \(typeParam === 'memory'\) \{
      const data = await getResourceMetricsHistory\(\{
        startDate: validStartDate,
        endDate: validEndDate,
      \}\);

      const csv = toCSV\(data\);

      res.setHeader\('Content-Type', 'text/csv'\);
      res.setHeader\('Content-Disposition', 'attachment; filename="memory_stats.csv"'\);
      res.send\(csv\);
      return;
    \}
"""

# We want to keep the FIRST occurrence (in /csv) but maybe fix indentation.
# And remove SUBSEQUENT occurrences (in /data and /).

# Let's split the file into parts to safely target /data and /.
# Or just find all occurrences and keep the first one.

parts = content.split('router.get(')
# part 0: imports and helper functions
# part 1: '/csv' handler
# part 2: '/data' handler
# part 3: '/' handler

if len(parts) < 4:
    print("Error: Could not split file correctly")
    exit(1)

# Fix indentation in part 1 (/csv)
# The added block has 0 indentation for the 'if', but it is inside try { ...
# The 'const typeParam' line has 4 spaces.
# The 'try' block has 2 spaces indentation? No, usually 2 or 4.
# Based on 'const limitParam ...' which has 4 spaces, the 'if' should have 4 spaces.
# But my sed inserted it with 0 spaces? No, sed command:
# sed -i "/.../a \    if ..."
# The backslash followed by spaces adds indentation.
# Let's check the file content again.
# In the read_file output:
# if (typeParam === 'memory') {
# It seems to be at start of line (0 spaces) in the read_file output?
# No, wait.
# 116:if (typeParam === 'memory') {
# It looks like it has NO indentation in the grep output if it was 0 spaces.
# But '108:    const typeParam...' has spaces.
# Let's look at read_file output again.
# if (typeParam === 'memory') {
#       const data ...
# The 'if' line seems to have 0 indentation relative to 'const validStartDate'.
# 'const validStartDate' has 4 spaces.
# So 'if' should have 4 spaces.

# In the python script, I will replace the raw block with indented block in part 1.
# And remove it from part 2 and 3.

# Define the block as it appears in the file (likely with minimal indentation on the first line if sed failed to indent)
# Actually, I'll regex replace specifically in the strings.

def remove_memory_logic(text):
    text = text.replace(type_param_def, "")
    # The block might have varying indentation or just be the one I inserted.
    # I'll try to match exact string from my previous insertion.
    # Note: sed insertion might have put it on a new line with some indentation.

    # Let's match flexible whitespace
    pattern = r"\s*if \(typeParam === 'memory'\) \{[\s\S]+?return;\s*\}"
    text = re.sub(pattern, "", text)
    return text

# Process part 2 (/data)
parts[2] = remove_memory_logic(parts[2])

# Process part 3 (/)
parts[3] = remove_memory_logic(parts[3])

# Process part 1 (/csv) - Fix indentation
# I want to ensure it has 4 spaces indentation.
# The block is:
# if (typeParam === 'memory') {
#   ...
# }
# It is currently likely at column 0.
# I want it to be at column 4.

def fix_indentation(text):
    # Find the block
    pattern = r"(\n)(if \(typeParam === 'memory'\) \{[\s\S]+?return;\s*\})"
    match = re.search(pattern, text)
    if match:
        block = match.group(2)
        # Indent every line of the block
        indented_block = ""
        lines = block.split('\n')
        for i, line in enumerate(lines):
            if i == 0:
                indented_block += "    " + line.strip() + "\n"
            else:
                if line.strip() == "":
                    indented_block += "\n"
                else:
                    # Inner lines should have 6 spaces (4 + 2) or 8 (4 + 4)?
                    # The file uses 2 spaces for indentation?
                    # 'const router = Router();' is at top level.
                    # 'router.get' is top level.
                    # '  try {' -> 2 spaces.
                    # '    const ...' -> 4 spaces.
                    # So indentation unit is 2 spaces.
                    # The 'if' should be at 4 spaces.
                    # The body of 'if' should be at 6 spaces.
                    indented_block += "      " + line.strip() + "\n"

        # Remove trailing newline from block if needed
        indented_block = indented_block.rstrip()
        return text.replace(block, indented_block)
    return text

parts[1] = fix_indentation(parts[1])

# Reassemble
new_content = 'router.get('.join(parts)

with open('backend/src/routes/stats.ts', 'w') as f:
    f.write(new_content)

print("Cleanup complete")
