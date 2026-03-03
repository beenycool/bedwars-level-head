import { extractBedwarsExperience, parseIfModifiedSince } from '../../src/util/requestUtils';

// Mock dependencies that might be imported transitively and cause side effects
jest.mock('../../src/services/history', () => ({
  recordPlayerQuery: jest.fn()
}));

jest.mock('../../src/services/player', () => ({}));

describe('Request Utils', () => {
  describe('extractBedwarsExperience', () => {
    it('should extract experience from standard hypixel response', () => {
      const payload = {
        bedwars_experience: 12345
      };
      expect(extractBedwarsExperience(payload as any)).toBe(12345);
    });

    it('should extract experience from nested hypixel stats', () => {
      const payload = {
        data: {
          bedwars: {
            Experience: 67890
          }
        }
      };
      expect(extractBedwarsExperience(payload as any)).toBe(67890);
    });

    it('should return null for missing experience', () => {
      expect(extractBedwarsExperience({})).toBeNull();
    });
  });

  describe('parseIfModifiedSince', () => {
    it('should parse valid date string', () => {
      const date = new Date('2023-01-01T00:00:00Z');
      expect(parseIfModifiedSince(date.toUTCString())).toBe(date.getTime());
    });

    it('should return undefined for invalid date', () => {
      expect(parseIfModifiedSince('invalid-date')).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(parseIfModifiedSince(undefined)).toBeUndefined();
    });
  });
});
