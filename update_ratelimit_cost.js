const fs = require('fs');

const targetFile = 'backend/src/middleware/rateLimitPublic.ts';
let content = fs.readFileSync(targetFile, 'utf8');

const newCostFn = `  getCost(req: Request) {
    // Cost is the number of UUIDs in the batch request
    const body = req.body as { uuids?: unknown } | undefined;
    if (!body || !Array.isArray(body.uuids)) {
      return 1; // Minimum cost for invalid/empty requests
    }
    // Count unique, non-empty strings in a single pass up to 20
    const uniqueIdentifiers = new Set<string>();
    for (let i = 0; i < body.uuids.length; i++) {
      if (uniqueIdentifiers.size >= 20 || i >= 20) break; // Stop after considering 20 items or reaching max cap
      const value = body.uuids[i];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          uniqueIdentifiers.add(trimmed);
        }
      }
    }
    return Math.max(1, uniqueIdentifiers.size); // Minimum cost of 1
  },`;

content = content.replace(/  getCost\(req: Request\) \{[\s\S]*?\},/g, newCostFn);

fs.writeFileSync(targetFile, content);
