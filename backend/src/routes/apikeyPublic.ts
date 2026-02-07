import { Router } from 'express';
import { enforcePublicRateLimit } from '../middleware/rateLimitPublic';
import { HttpError } from '../util/httpError';
import {
  validateApiKey,
  getApiKeyValidation,
  formatTimeAgo,
  isValidApiKeyFormat,
} from '../services/apiKeyManager';
import { isRedisAvailable } from '../services/redis';

const router = Router();

function formatValidationResponse(validation: Awaited<ReturnType<typeof validateApiKey>>) {
  return {
    keyHash: validation.keyHash,
    validationStatus: validation.validationStatus,
    lastValidatedAt: validation.lastValidatedAt,
    timeAgo: formatTimeAgo(validation.lastValidatedAt),
    validatedCount: validation.validatedCount,
    ...(validation.errorMessage && { error: validation.errorMessage }),
  };
}

/**
 * POST /api/public/apikey/status
 * Public endpoint to check API key validation status
 * Users can submit their key to check if it's valid
 */
router.post('/status', enforcePublicRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/public/apikey/status';
  const { key, forceRefresh } = req.body ?? {};

  if (typeof key !== 'string' || key.trim().length === 0) {
    next(new HttpError(400, 'MISSING_KEY', 'API key is required in request body.'));
    return;
  }

  if (!isValidApiKeyFormat(key)) {
    next(new HttpError(400, 'INVALID_KEY', 'API key must be a valid UUID.'));
    return;
  }

  try {
    const shouldRefresh = Boolean(forceRefresh);
    if (!shouldRefresh) {
      if (!isRedisAvailable()) {
        next(new HttpError(503, 'STATUS_UNKNOWN', 'API key status unavailable. Please retry.'));
        return;
      }

      const cached = await getApiKeyValidation(key.trim());
      if (cached) {
        res.json({
          success: true,
          data: formatValidationResponse(cached),
        });
        return;
      }
    }

    // Validate the key and store/update its status
    const validation = await validateApiKey(key.trim());
    
    res.json({
      success: true,
      data: formatValidationResponse(validation),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/public/apikey/status
 * Check status using x-api-key header (for client mods)
 */
router.get('/status', enforcePublicRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/public/apikey/status';
  const apiKey = req.get('x-api-key');

  if (!apiKey || typeof apiKey !== 'string') {
    next(new HttpError(400, 'MISSING_KEY', 'API key is required in x-api-key header.'));
    return;
  }

  if (!isValidApiKeyFormat(apiKey)) {
    next(new HttpError(400, 'INVALID_KEY', 'API key must be a valid UUID.'));
    return;
  }

  try {
    if (!isRedisAvailable()) {
      next(new HttpError(503, 'STATUS_UNKNOWN', 'API key status unavailable. Please retry.'));
      return;
    }

    // Check existing validation without re-validating
    const validation = await getApiKeyValidation(apiKey.trim());
    
    if (!validation) {
      // Key not found in storage, validate it now
      const newValidation = await validateApiKey(apiKey.trim());
      res.json({
        success: true,
        data: formatValidationResponse(newValidation),
      });
      return;
    }

    res.json({
      success: true,
      data: formatValidationResponse(validation),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
