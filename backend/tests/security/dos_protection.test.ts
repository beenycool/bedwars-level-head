import { resolvePlayer } from '../../src/services/player';
import { HttpError } from '../../src/util/httpError';

// Mock dependencies to avoid actual network/DB calls
jest.mock('../../src/services/statsCache', () => ({
  getPlayerStatsFromCacheWithSWR: jest.fn().mockResolvedValue(null),
  getIgnMapping: jest.fn().mockResolvedValue(null),
  buildPlayerCacheKey: jest.fn().mockReturnValue('mock-key'),
  setIgnMapping: jest.fn().mockResolvedValue(undefined),
  setPlayerStatsBoth: jest.fn().mockResolvedValue(undefined),
  setPlayerStatsL1: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/hypixel', () => ({
  fetchHypixelPlayer: jest.fn(),
  extractMinimalStats: jest.fn(),
}));

jest.mock('../../src/services/mojang', () => ({
  lookupProfileByUsername: jest.fn(),
}));

describe('DoS Protection - Input Length Limits', () => {
  it('should reject excessively long identifiers immediately', async () => {
    const longIdentifier = 'a'.repeat(100);

    await expect(resolvePlayer(longIdentifier))
      .rejects
      .toThrow(HttpError);

    try {
      await resolvePlayer(longIdentifier);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      if (error instanceof HttpError) {
        expect(error.status).toBe(400);
        expect(error.causeCode).toBe('INVALID_IDENTIFIER');
        expect(error.message).toContain('too long');
      }
    }
  });

  it('should allow valid length identifiers', async () => {
    // We expect this to fail later in the process (e.g. invalid UUID format)
    // but NOT with "too long".
    // We use a string that matches neither uuidRegex nor ignRegex to trigger the default HttpError.
    const validLengthIdentifier = 'invalid-format-but-valid-length';

    await expect(resolvePlayer(validLengthIdentifier)).rejects.toThrow(HttpError);

    try {
      await resolvePlayer(validLengthIdentifier);
      fail('Should have thrown an HttpError');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      if (error instanceof HttpError) {
        // It should NOT be the length error
        expect(error.message).not.toContain('too long');
      }
    }
  });
});
