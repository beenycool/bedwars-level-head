import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ADMIN_API_KEYS } from '../config';
import { HttpError } from '../util/httpError';

/**
 * Extract API key from request headers
 * Supports both Authorization: Bearer <token> and X-API-Key: <token>
 */
function extractApiKey(req: Request): string | null {
    // Check Authorization header with Bearer scheme
    const authHeader = req.get('authorization');
    if (typeof authHeader === 'string') {
        const [scheme, ...rest] = authHeader.split(' ');
        if (scheme && scheme.toLowerCase() === 'bearer') {
            const token = rest.join(' ').trim();
            if (token.length > 0) {
                return token;
            }
        }
    }

    // Check X-API-Key header
    const apiKeyHeader = req.get('x-api-key');
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim().length > 0) {
        return apiKeyHeader.trim();
    }

    return null;
}

/**
 * Middleware to enforce API key authentication for player data submissions
 * Prevents unauthorized cache poisoning by requiring a valid API key
 */
export const enforceSubmitAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
    const apiKey = extractApiKey(req);

    if (!apiKey) {
        next(
            new HttpError(
                401,
                'MISSING_API_KEY',
                'API key is required. Provide it via Authorization: Bearer <key> or X-API-Key: <key> header.',
            ),
        );
        return;
    }

    if (!ADMIN_API_KEYS.includes(apiKey)) {
        next(
            new HttpError(
                403,
                'INVALID_API_KEY',
                'The provided API key is not valid or does not have permission to submit player data.',
            ),
        );
        return;
    }

    next();
};
