import { Router } from 'express';
import { requireModHandshake } from '../middleware/auth';
import { enforceRateLimit } from '../middleware/rateLimit';
import { resolvePlayer } from '../services/player';

function parseIfModifiedSince(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function shouldReturnNotModified(
  clientEtag: string | undefined,
  clientModifiedSince: number | undefined,
  serverEtag: string | null,
  serverLastModified: number | null,
): boolean {
  if (clientEtag && serverEtag) {
    return clientEtag === serverEtag;
  }

  if (!clientEtag && clientModifiedSince && serverLastModified) {
    return serverLastModified <= clientModifiedSince;
  }

  return false;
}

const router = Router();

router.get('/:identifier', requireModHandshake, enforceRateLimit, async (req, res, next) => {
  const { identifier } = req.params;
  const ifNoneMatch = req.header('if-none-match')?.trim();
  const ifModifiedSince = parseIfModifiedSince(req.header('if-modified-since'));
  res.locals.metricsRoute = '/api/player/:identifier';

  try {
    const resolved = await resolvePlayer(identifier, {
      etag: ifNoneMatch,
      lastModified: ifModifiedSince,
    });

    if (shouldReturnNotModified(ifNoneMatch, ifModifiedSince, resolved.etag, resolved.lastModified)) {
      res.status(304).end();
      return;
    }

    if (resolved.etag) {
      res.set('ETag', resolved.etag);
    }

    if (resolved.lastModified) {
      res.set('Last-Modified', new Date(resolved.lastModified).toUTCString());
    }

    res.json(resolved.payload);
  } catch (error) {
    next(error);
  }
});

export default router;
