import sys

content = open('backend/src/services/statsCache.ts').read()

search_start = "export async function clearAllPlayerStatsCaches(): Promise<number> {"
search_end = "    return deleted + statsResult.rowCount + ignResult.rowCount;"

new_content = """export async function clearAllPlayerStatsCaches(): Promise<number> {
  if (isRedisAvailable()) {
    await incrementCacheVersion();
  }

  await ensureInitialized();

  try {
    const statsResult = await pool.query('DELETE FROM player_stats_cache');
    const ignResult = await pool.query('DELETE FROM ign_uuid_cache');
    markDbAccess();
    return statsResult.rowCount + ignResult.rowCount;"""

# Replace the block from search_start to search_end
import re
pattern = re.compile(re.escape(search_start) + ".*?" + re.escape(search_end), re.DOTALL)
content = pattern.sub(new_content, content)

with open('backend/src/services/statsCache.ts', 'w') as f:
    f.write(content)
