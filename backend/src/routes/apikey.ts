import { Router } from 'express';
import { enforceRateLimit } from '../middleware/rateLimit';
import { enforceAdminAuth } from '../middleware/adminAuth';
import { HttpError } from '../util/httpError';
import {
  storeApiKey,
  validateApiKey,
  getApiKeyValidation,
  getApiKeyValidationByHash,
  listApiKeys,
  deleteApiKey,
  formatTimeAgo,
  summarizeApiKeyStatuses,
  isValidApiKeyFormat,
  type ApiKeyValidation,
} from '../services/apiKeyManager';

const router = Router();

function toApiKeyResponse(validation: ApiKeyValidation, includeTimeAgo: boolean = true) {
  return {
    keyHash: validation.keyHash,
    lastValidatedAt: validation.lastValidatedAt,
    validationStatus: validation.validationStatus,
    validatedCount: validation.validatedCount,
    errorMessage: validation.errorMessage,
    ...(includeTimeAgo ? { timeAgo: formatTimeAgo(validation.lastValidatedAt) } : {}),
  };
}

/**
 * POST /api/admin/apikey/validate
 * Validates an API key and stores it with validation metadata
 */
router.post('/validate', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/apikey/validate';
  const { key } = req.body ?? {};

  if (typeof key !== 'string' || key.trim().length === 0) {
    next(new HttpError(400, 'MISSING_KEY', 'API key is required in request body.'));
    return;
  }

  if (!isValidApiKeyFormat(key)) {
    next(new HttpError(400, 'INVALID_KEY', 'API key must be a valid UUID.'));
    return;
  }

  try {
    const validation = await validateApiKey(key.trim());
    res.json({
      success: true,
      data: toApiKeyResponse(validation),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/apikey/store
 * Stores an API key without immediate validation
 */
router.post('/store', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/apikey/store';
  const { key } = req.body ?? {};

  if (typeof key !== 'string' || key.trim().length === 0) {
    next(new HttpError(400, 'MISSING_KEY', 'API key is required in request body.'));
    return;
  }

  if (!isValidApiKeyFormat(key)) {
    next(new HttpError(400, 'INVALID_KEY', 'API key must be a valid UUID.'));
    return;
  }

  try {
    const stored = await storeApiKey(key.trim());
    res.json({
      success: true,
      data: toApiKeyResponse(stored, false),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/apikey/status/:keyHash
 * Get validation status for a specific API key by hash
 */
router.get('/status/:keyHash', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/apikey/status/:keyHash';
  const { keyHash } = req.params;

  if (!keyHash || typeof keyHash !== 'string') {
    next(new HttpError(400, 'INVALID_KEY_HASH', 'Key hash is required.'));
    return;
  }

  try {
    const validation = await getApiKeyValidationByHash(keyHash);
    if (!validation) {
      next(new HttpError(404, 'KEY_NOT_FOUND', 'API key not found.'));
      return;
    }

    res.json({
      success: true,
      data: toApiKeyResponse(validation),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/apikey/list
 * List all stored API keys with their validation status
 */
router.get('/list', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/apikey/list';

  try {
    const keys = await listApiKeys();
    res.json({
      success: true,
      count: keys.length,
      data: keys.map((key) => toApiKeyResponse(key)),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/admin/apikey/:keyHash
 * Delete an API key by hash
 */
router.delete('/:keyHash', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/apikey/:keyHash';
  const { keyHash } = req.params;

  if (!keyHash || typeof keyHash !== 'string') {
    next(new HttpError(400, 'INVALID_KEY_HASH', 'Key hash is required.'));
    return;
  }

  if (!/^[a-fA-F0-9]{64}$/.test(keyHash)) {
    next(new HttpError(400, 'INVALID_KEY_HASH_FORMAT', 'Key hash format is invalid.'));
    return;
  }

  try {
    const deleted = await deleteApiKey(keyHash);
    if (!deleted) {
      next(new HttpError(404, 'KEY_NOT_FOUND', 'API key not found.'));
      return;
    }

    res.json({
      success: true,
      message: 'API key deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/apikey/summary
 * Summarize validation status for all stored API keys
 */
router.get('/summary', enforceAdminAuth, enforceRateLimit, async (req, res, next) => {
  res.locals.metricsRoute = '/api/admin/apikey/summary';

  try {
    const results = await summarizeApiKeyStatuses();
    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
