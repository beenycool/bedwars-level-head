-- Migration: Drop player_cache table (player caching moved to two-tier L1 Redis + L2 SQL cache)
-- Run this after verifying Redis L1 cache is working correctly and migration 003 has added player_stats_cache tables
--
-- This script is safe to run multiple times (IF EXISTS / IF NOT EXISTS checks)

-- For PostgreSQL
DROP TABLE IF EXISTS player_cache CASCADE;

-- For Azure SQL / SQL Server
-- IF OBJECT_ID('dbo.player_cache', 'U') IS NOT NULL
--     DROP TABLE dbo.player_cache;