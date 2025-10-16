import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DB_PATH } from '../config';

interface CacheEntry {
  payload: string;
  expires_at: number;
}

const resolvedPath = path.isAbsolute(CACHE_DB_PATH)
  ? CACHE_DB_PATH
  : path.resolve(process.cwd(), CACHE_DB_PATH);

const directory = path.dirname(resolvedPath);
if (!fs.existsSync(directory)) {
  fs.mkdirSync(directory, { recursive: true });
}

const db = new Database(resolvedPath);

db.pragma('journal_mode = WAL');
db.exec(
  `CREATE TABLE IF NOT EXISTS player_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
);

const selectStatement = db.prepare<[string], CacheEntry>('SELECT payload, expires_at FROM player_cache WHERE cache_key = ?');
const upsertStatement = db.prepare<[string, string, number]>('INSERT INTO player_cache (cache_key, payload, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at');
const deleteStatement = db.prepare<[string]>('DELETE FROM player_cache WHERE cache_key = ?');
const purgeExpiredStatement = db.prepare<[number]>('DELETE FROM player_cache WHERE expires_at <= ?');

export function purgeExpiredEntries(now: number = Date.now()): void {
  purgeExpiredStatement.run(now);
}

export function getCachedPayload<T>(key: string): T | null {
  const row = selectStatement.get(key) as CacheEntry | undefined;
  if (!row) {
    return null;
  }

  if (row.expires_at <= Date.now()) {
    deleteStatement.run(key);
    return null;
  }

  try {
    return JSON.parse(row.payload) as T;
  } catch (error) {
    deleteStatement.run(key);
    return null;
  }
}

export function setCachedPayload<T>(key: string, value: T, ttlMs: number): void {
  const expiresAt = Date.now() + ttlMs;
  const payload = JSON.stringify(value);
  purgeExpiredEntries();
  upsertStatement.run(key, payload, expiresAt);
}

export function closeCache(): void {
  db.close();
}
