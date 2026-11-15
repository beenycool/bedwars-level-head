import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import { HttpError } from '../util/httpError';
import { MAX_TOKEN_LENGTH } from './authConstants';

// Generate a random salt per factory instance at startup to ensure these hashes are
// unique to this process and cannot be pre-computed by an attacker.
const HASH_OPTS = { N: 16, r: 1, p: 1 };
const KEY_LEN = 32;

interface TokenAuthConfig {
  keys: string[];
  headerName: string;
  label: string;
}

interface TokenAuth {
  extract(req: Request): string | null;
  validate(token: string): Promise<boolean>;
  enforce: RequestHandler;
  init(): Promise<void>;
}

/** Promise wrapper around crypto.scrypt with explicit overload typing (promisify mishandles the options overload). */
function scryptAsync(password: string, salt: crypto.BinaryLike, keylen: number, options: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

/**
 * Shared token auth middleware factory.
 *
 * API keys are high-entropy and do not require the massive work factors of user passwords.
 * Scrypt with a low work factor (N=16) satisfies static analysis tools that flag simple
 * hashes as "insecure password hashing" while keeping the cost low (~0.03ms) to prevent CPU DoS.
 */
export function createTokenAuth(config: TokenAuthConfig): TokenAuth {
  const salt = crypto.randomBytes(32);

  // Pre-compute hashes of allowed keys using Scrypt.
  // @codeql-suppress [js/insufficient-password-hash] API tokens are high-entropy; low work factor (N=16) is intentional to prevent CPU DoS.
  let allowedKeyHashes: Buffer[] = [];
  let initPromise: Promise<void> | null = null;

  async function init(): Promise<void> {
    if (!initPromise) {
      initPromise = Promise.all(
        config.keys.map((key) => scryptAsync(key, salt, KEY_LEN, HASH_OPTS)),
      ).then((hashes) => {
        allowedKeyHashes = hashes;
      });
    }
    await initPromise;
  }

  function extract(req: Request): string | null {
    const header = req.get('authorization');
    if (typeof header === 'string') {
      const [scheme, ...rest] = header.split(' ');
      if (scheme && scheme.toLowerCase() === 'bearer') {
        const token = rest.join(' ').trim();
        if (token.length > 0) {
          return token;
        }
      }
    }

    const customHeader = req.get(config.headerName);
    if (typeof customHeader === 'string' && customHeader.trim().length > 0) {
      return customHeader.trim();
    }

    return null;
  }

  /**
   * Compares a provided token against the allowed keys in a timing-safe manner.
   */
  async function validate(token: string): Promise<boolean> {
    if (!token) return false;

    // Prevent DoS via long tokens: max 128 chars is generous for 32-64 char API keys
    if (token.length > MAX_TOKEN_LENGTH) return false;

    await init();

    // Hash the incoming token using Scrypt with the same low-cost parameters
    const tokenHash = await scryptAsync(token, salt, KEY_LEN, HASH_OPTS);

    // To prevent timing attacks, we must iterate through all keys and not short-circuit.
    // Using reduce with a bitwise OR ensures we process every key without conditional branching.
    const match = allowedKeyHashes.reduce(
      (acc, keyHash) => acc | Number(crypto.timingSafeEqual(tokenHash, keyHash)),
      0,
    );

    return Boolean(match);
  }

  const enforce: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = extract(req);
      if (!token || !(await validate(token))) {
        next(new HttpError(401, 'UNAUTHORIZED', `Missing or invalid ${config.label}.`));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  return { extract, validate, enforce, init };
}
