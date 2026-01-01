#!/bin/bash
# Cleanup script to clear existing large Redis cache entries
# This should be run once after deploying the minimal stats caching changes
# Source: REDIS_URL environment variable

set -e

if [ -z "$REDIS_URL" ]; then
  echo "Error: REDIS_URL environment variable not set"
  exit 1
fi

echo "Clearing existing large cache entries from Redis..."
echo "This will remove all cache:player:* and cache:ign:* keys"
echo ""

# Display current memory usage before
echo "Current Redis memory usage:"
redis-cli -u "$REDIS_URL" INFO memory | grep used_memory_human

# Count keys before deletion
PLAYER_COUNT=$(redis-cli -u "$REDIS_URL" KEYS 'cache:player:*' | wc -l)
IGN_COUNT=$(redis-cli -u "$REDIS_URL" KEYS 'cache:ign:*' | wc -l)
TOTAL_KEYS=$((PLAYER_COUNT + IGN_COUNT))

echo ""
echo "Found $PLAYER_COUNT player cache entries and $IGN_COUNT IGN cache entries ($TOTAL_KEYS total)"
echo ""

# Ask for confirmation
read -p "Are you sure you want to delete all cached player data? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted. No changes made."
  exit 0
fi

# Delete cache entries
if [ "$PLAYER_COUNT" -gt 0 ]; then
  echo "Deleting $PLAYER_COUNT player cache entries..."
  redis-cli -u "$REDIS_URL" --scan --pattern 'cache:player:*' | xargs redis-cli -u "$REDIS_URL" del
fi

if [ "$IGN_COUNT" -gt 0 ]; then
  echo "Deleting $IGN_COUNT IGN cache entries..."
  redis-cli -u "$REDIS_URL" --scan --pattern 'cache:ign:*' | xargs redis-cli -u "$REDIS_URL" del
fi

echo ""
echo "Memory usage after cleanup:"
redis-cli -u "$REDIS_URL" INFO memory | grep used_memory_human

echo ""
echo "Cleanup complete! New entries will use minimal stats (~300-400 bytes instead of ~57KB)"