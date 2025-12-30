-- Migration: Drop player_cache table (player caching moved to Redis)
-- Run this after verifying Redis cache is working correctly
--
-- This script is safe to run multiple times (IF EXISTS / IF NOT EXISTS checks)

-- For PostgreSQL
DROP TABLE IF EXISTS player_cache CASCADE;

-- For Azure SQL / SQL Server
-- IF OBJECT_ID('dbo.player_cache', 'U') IS NOT NULL
--     DROP TABLE dbo.player_cache;