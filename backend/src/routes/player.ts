import { Router } from 'express';
import { requireModHandshake } from '../middleware/auth';
import { enforceRateLimit } from '../middleware/rateLimit';
import { resolvePlayer } from '../services/player';

const router = Router();

router.get('/:identifier', requireModHandshake, enforceRateLimit, async (req, res, next) => {
  const { identifier } = req.params;

  try {
    const payload = await resolvePlayer(identifier);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

export default router;
