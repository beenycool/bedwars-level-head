/**
 * BedWars star level from raw `bedwars_experience`.
 *
 * This mirrors `core/BedwarsStar.kt` in the mod so the tracking page shows the same
 * number the tag does. Keep the two in sync: the first four levels cost less than
 * the flat 5,000 XP used afterwards, and every 487,000 XP is one prestige (100 levels).
 */

const FIRST_LEVEL_EXPERIENCE = [500, 1000, 2000, 3500] as const;
const EXPERIENCE_PER_LEVEL = 5000;
const EXPERIENCE_PER_PRESTIGE = 487_000;

export function bedwarsStars(experience: number | null | undefined): number | null {
  if (experience === null || experience === undefined || !Number.isFinite(experience)) {
    return null;
  }
  if (experience <= 0) {
    return 0;
  }

  let remaining = Math.floor(experience);
  let level = 0;

  const prestiges = Math.floor(remaining / EXPERIENCE_PER_PRESTIGE);
  level += prestiges * 100;
  remaining -= prestiges * EXPERIENCE_PER_PRESTIGE;

  for (const cost of FIRST_LEVEL_EXPERIENCE) {
    if (remaining < cost) {
      return level;
    }
    level += 1;
    remaining -= cost;
  }

  if (remaining > 0) {
    level += Math.floor(remaining / EXPERIENCE_PER_LEVEL);
  }

  return level;
}
