/**
 * Jest setup: provide dummy values for the environment variables that `src/config.ts`
 * requires at import time so suites that don't mock the config module can load the app
 * modules they exercise. Tests that mock `src/config` are unaffected.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

if (!process.env.HYPIXEL_API_KEY) {
  process.env.HYPIXEL_API_KEY = 'test-hypixel-api-key';
}

if (!process.env.CACHE_DB_URL) {
  process.env.CACHE_DB_URL = 'postgresql://postgres:postgres@localhost:5432/levelhead_test';
}

if (!process.env.ADMIN_API_KEYS) {
  process.env.ADMIN_API_KEYS = 'test-admin-key';
}
