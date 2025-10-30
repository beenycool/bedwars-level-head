const XP_PER_LEVEL = 5000;
const LEVELS_PER_PRESTIGE = 100;
const XP_PER_PRESTIGE = 487_000;
const EASY_LEVEL_XP = [500, 1000, 2000, 3500];

function clampExperience(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

export function computeBedwarsLevel(experienceInput: number): number {
  const experience = clampExperience(experienceInput);

  let level = 0;
  let remaining = experience;

  const prestiges = Math.floor(remaining / XP_PER_PRESTIGE);
  level += prestiges * LEVELS_PER_PRESTIGE;
  remaining -= prestiges * XP_PER_PRESTIGE;

  for (const xp of EASY_LEVEL_XP) {
    if (remaining >= xp) {
      level += 1;
      remaining -= xp;
    } else {
      return level + remaining / xp;
    }
  }

  level += Math.floor(remaining / XP_PER_LEVEL);
  const remainder = remaining % XP_PER_LEVEL;

  return remainder > 0 ? level + remainder / XP_PER_LEVEL : level;
}

export function computeBedwarsStar(experience: number): number {
  return Math.floor(computeBedwarsLevel(experience));
}
