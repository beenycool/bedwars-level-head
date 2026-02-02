-- Migration: Drop player_cache table (player caching moved to two-tier L1 Redis + L2 SQL cache)
-- This migration runs before 003 in filename order. If running manually and you need the new
-- player_stats_cache tables first, apply migration 003 before dropping player_cache.
--
-- This script is safe to run multiple times (IF EXISTS / IF NOT EXISTS checks)

-- For PostgreSQL
DROP TABLE IF EXISTS player_cache CASCADE;

-- For Azure SQL / SQL Server
-- IF OBJECT_ID('dbo.player_cache', 'U') IS NOT NULL
--     DROP TABLE dbo.player_cache;
