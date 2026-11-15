import { bedwarsStars } from '../../src/util/bedwarsStars';

/**
 * The thresholds mirror `core/BedwarsStar.kt`: 500, 1,000, 2,000 and 3,500 XP for the
 * first four levels, 5,000 XP per level after that, and 487,000 XP per prestige.
 */
describe('bedwarsStars', () => {
  it('returns null for unknown experience (displayed as a dash, not zero stars)', () => {
    expect(bedwarsStars(null)).toBeNull();
    expect(bedwarsStars(undefined)).toBeNull();
  });

  it('returns zero for non-positive experience', () => {
    expect(bedwarsStars(0)).toBe(0);
    expect(bedwarsStars(-100)).toBe(0);
  });

  it('handles the four discounted early levels', () => {
    expect(bedwarsStars(499)).toBe(0);
    expect(bedwarsStars(500)).toBe(1);
    expect(bedwarsStars(1_499)).toBe(1);
    expect(bedwarsStars(1_500)).toBe(2);
    expect(bedwarsStars(3_499)).toBe(2);
    expect(bedwarsStars(3_500)).toBe(3);
    expect(bedwarsStars(6_999)).toBe(3);
    expect(bedwarsStars(7_000)).toBe(4);
  });

  it('uses a flat 5,000 XP per level past level four', () => {
    expect(bedwarsStars(12_000)).toBe(5);
    expect(bedwarsStars(11_999)).toBe(4);
  });

  it('counts each prestige as 100 levels', () => {
    expect(bedwarsStars(487_000)).toBe(100);
    expect(bedwarsStars(487_000 + 7_000)).toBe(104);
    expect(bedwarsStars(487_000 * 6)).toBe(600);
  });
});
