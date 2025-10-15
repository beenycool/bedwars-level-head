import { Router } from 'express';
import { requireModHandshake } from '../middleware/auth';
import { enforceRateLimit } from '../middleware/rateLimit';
import { fetchPlayer } from '../services/hypixel';
import { HttpError } from '../util/httpError';

const uuidRegex = /^[0-9a-f]{32}$/i;

const router = Router();

router.get('/:uuid', requireModHandshake, enforceRateLimit, async (req, res, next) => {
  const { uuid } = req.params;

  if (!uuidRegex.test(uuid)) {
    next(new HttpError(400, 'INVALID_UUID', 'UUID must be 32 hexadecimal characters without dashes.'));
    return;
  }

  try {
    const payload = await fetchPlayer(uuid);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

export default router;
