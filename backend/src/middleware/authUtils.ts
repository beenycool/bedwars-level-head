import crypto from 'crypto';
import { promisify } from 'node:util';
import { MAX_TOKEN_LENGTH } from './authConstants';

const scryptAsync = promisify(crypto.scrypt);

/**
 * Validates a token against a list of allowed key hashes in a timing-safe manner.
 *
 * @param token The incoming API token to validate.
 * @param allowedKeyHashes Pre-computed list of allowed scrypt hashes.
 * @param salt The salt used for hashing.
 * @param keyLen The length of the derived key.
 * @param hashOpts Scrypt options (N, r, p).
 * @returns A boolean indicating if the token is valid.
 */
export async function timingSafeTokenValidation(
  token: string,
  allowedKeyHashes: Buffer[],
  salt: Buffer,
  keyLen: number,
  hashOpts: crypto.ScryptOptions
): Promise<boolean> {
  if (!token) return false;

  // Prevent DoS via long tokens
  if (token.length > MAX_TOKEN_LENGTH) return false;

  // Hash the incoming token using Scrypt with the same low-cost parameters
  const tokenHash = (await scryptAsync(token, salt, keyLen, hashOpts)) as Buffer;

  // To prevent timing attacks, we must iterate through all keys and not short-circuit.
  // Using reduce with a bitwise OR ensures we process every key without conditional branching.
  const match = allowedKeyHashes.reduce(
    (acc, keyHash) => acc | Number(crypto.timingSafeEqual(tokenHash, keyHash)),
    0
  );

  return Boolean(match);
}
