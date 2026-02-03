-- Migration: Create player_stats_cache and ign_uuid_cache tables (minimal stats L2)

CREATE TABLE IF NOT EXISTS player_stats_cache (
  cache_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  expires_at BIGINT NOT NULL,
  etag TEXT,
  last_modified BIGINT,
  source TEXT DEFAULT 'hypixel',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_stats_expires ON player_stats_cache (expires_at);

CREATE TABLE IF NOT EXISTS ign_uuid_cache (
  ign TEXT PRIMARY KEY,
  uuid TEXT,
  nicked BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ign_uuid_expires ON ign_uuid_cache (expires_at);

-- Azure SQL equivalent (reference only):
-- IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[player_stats_cache]') AND type in (N'U'))
--   CREATE TABLE player_stats_cache (
--     cache_key NVARCHAR(450) PRIMARY KEY,
--     payload NVARCHAR(MAX) NOT NULL,
--     expires_at BIGINT NOT NULL,
--     etag NVARCHAR(255),
--     last_modified BIGINT,
--     source NVARCHAR(64),
--     created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
--   );
-- IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_player_stats_expires')
--   CREATE INDEX idx_player_stats_expires ON player_stats_cache (expires_at);
-- IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ign_uuid_cache]') AND type in (N'U'))
--   CREATE TABLE ign_uuid_cache (
--     ign NVARCHAR(32) PRIMARY KEY,
--     uuid NVARCHAR(32),
--     nicked BIT NOT NULL DEFAULT 0,
--     expires_at BIGINT NOT NULL,
--     updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
--   );
-- IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_ign_uuid_expires')
--   CREATE INDEX idx_ign_uuid_expires ON ign_uuid_cache (expires_at);
