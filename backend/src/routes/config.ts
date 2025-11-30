import { Router } from 'express';

const router = Router();

/**
 * GET /api/config/motd
 * Returns the current Message of the Day configuration for the mod.
 * This can be used to display announcements or welcome messages to users.
 */
router.get('/motd', (_req, res) => {
  res.json({
    enabled: true,
    message: 'Welcome to the Levelhead 8.3 Custom Build!',
    color: 'GOLD',
  });
});

/**
 * GET /api/config/version
 * Returns the current recommended version information.
 */
router.get('/version', (_req, res) => {
  res.json({
    latestVersion: '8.3.0',
    minVersion: '8.0.0',
    updateUrl: 'https://modrinth.com/mod/bedwars-level-head',
  });
});

export default router;



