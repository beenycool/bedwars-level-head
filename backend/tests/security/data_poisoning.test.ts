import { matchesCriticalFields } from '../../src/util/validation';

describe('Data Poisoning Vulnerability', () => {
    it('should fail if final_kills_bedwars mismatch', () => {
        const source = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10,
            final_kills_bedwars: 50,
            final_deaths_bedwars: 5
        };
        const submitted = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10,
            final_kills_bedwars: 9999, // POISONED
            final_deaths_bedwars: 5
        };

        expect(matchesCriticalFields(source, submitted)).toBe(false);
    });

    it('should pass when all critical fields match', () => {
        const source = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10,
            final_kills_bedwars: 50,
            final_deaths_bedwars: 5
        };
        const submitted = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10,
            final_kills_bedwars: 50,
            final_deaths_bedwars: 5
        };

        expect(matchesCriticalFields(source, submitted)).toBe(true);
    });

    it('should fail if submitted omits a critical field present in source', () => {
        const source = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10,
            final_kills_bedwars: 50
        };
        const submitted = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10
        };

        expect(matchesCriticalFields(source, submitted)).toBe(false);
    });

    it('should fail if final_deaths_bedwars mismatch', () => {
        const source = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10,
            final_kills_bedwars: 50,
            final_deaths_bedwars: 5
        };
        const submitted = {
            bedwars_experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10,
            final_kills_bedwars: 50,
            final_deaths_bedwars: 9999 // POISONED
        };

        expect(matchesCriticalFields(source, submitted)).toBe(false);
    });

    it('should fail if experience (lowercase) mismatch', () => {
        const source = {
            experience: 1000,
            kills_bedwars: 100,
            wins_bedwars: 10
        };
        const submitted = {
            experience: 9999, // POISONED
            kills_bedwars: 100,
            wins_bedwars: 10
        };

        expect(matchesCriticalFields(source, submitted)).toBe(false);
    });
});
