/**
 * Tests for player data submission validation
 */

import { describe, it, expect } from '@jest/globals';
import {
    validatePayloadSize,
    validateObjectDepth,
    validateBedwarsStats,
    validatePlayerSubmission,
} from '../src/util/validation';

describe('Player Submission Validation', () => {
    describe('validatePayloadSize', () => {
        it('should accept payloads under the size limit', () => {
            const smallPayload = JSON.stringify({ test: 'data' });
            const result = validatePayloadSize(smallPayload);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject payloads exceeding 1MB', () => {
            const largePayload = 'x'.repeat(1024 * 1024 + 1);
            const result = validatePayloadSize(largePayload);
            expect(result.valid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].field).toBe('_payload');
        });
    });

    describe('validateObjectDepth', () => {
        it('should accept shallow objects', () => {
            const shallowData = { a: 1, b: { c: 2 } };
            const result = validateObjectDepth(shallowData);
            expect(result.valid).toBe(true);
        });

        it('should reject deeply nested objects', () => {
            let deepData: any = {};
            let current = deepData;
            for (let i = 0; i < 15; i++) {
                current.nested = {};
                current = current.nested;
            }
            const result = validateObjectDepth(deepData);
            expect(result.valid).toBe(false);
            expect(result.errors[0].field).toBe('_structure');
        });
    });

    describe('validateBedwarsStats', () => {
        it('should accept valid Bedwars stats', () => {
            const validStats = {
                bedwars_experience: 1000000,
                Experience: 1000000,
                kills_bedwars: 5000,
                deaths_bedwars: 3000,
                final_kills_bedwars: 2000,
                final_deaths_bedwars: 1500,
                wins_bedwars: 1200,
                losses_bedwars: 800,
                fkdr: 1.33,
                winstreak: 5,
                displayname: 'TestPlayer',
            };
            const result = validateBedwarsStats(validStats);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should allow stats with additional fields', () => {
            const statsWithExtras = {
                bedwars_experience: 1000000,
                unknown_field: 'malicious',
                another_unknown: 123,
            };
            const result = validateBedwarsStats(statsWithExtras);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject stats with invalid types', () => {
            const invalidStats = {
                bedwars_experience: 'not a number',
                kills_bedwars: true,
                displayname: 123,
            };
            const result = validateBedwarsStats(invalidStats);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should reject stats with negative values', () => {
            const invalidStats = {
                bedwars_experience: 1000000,
                kills_bedwars: -100,
                deaths_bedwars: -50,
            };
            const result = validateBedwarsStats(invalidStats);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.message.includes('non-negative'))).toBe(true);
        });

        it('should require at least one experience field', () => {
            const invalidStats = {
                kills_bedwars: 5000,
                deaths_bedwars: 3000,
            };
            const result = validateBedwarsStats(invalidStats);
            expect(result.valid).toBe(false);
            expect(result.errors.some((e) => e.field === 'bedwars_experience')).toBe(true);
        });

        it('should reject non-object data', () => {
            const result1 = validateBedwarsStats(null);
            expect(result1.valid).toBe(false);

            const result2 = validateBedwarsStats([]);
            expect(result2.valid).toBe(false);

            const result3 = validateBedwarsStats('string');
            expect(result3.valid).toBe(false);
        });

        it('should accept optional fields', () => {
            const minimalStats = {
                bedwars_experience: 1000000,
            };
            const result = validateBedwarsStats(minimalStats);
            expect(result.valid).toBe(true);
        });

        it('should accept nested mode-specific stats', () => {
            const statsWithModes = {
                bedwars_experience: 1000000,
                eight_one_: {
                    kills_bedwars: 100,
                    deaths_bedwars: 50,
                },
                four_four_: {
                    wins_bedwars: 200,
                },
            };
            const result = validateBedwarsStats(statsWithModes);
            expect(result.valid).toBe(true);
        });
    });

    describe('validatePlayerSubmission', () => {
        it('should accept valid complete submission', () => {
            const validData = {
                bedwars_experience: 1000000,
                Experience: 1000000,
                kills_bedwars: 5000,
                deaths_bedwars: 3000,
                final_kills_bedwars: 2000,
                final_deaths_bedwars: 1500,
                wins_bedwars: 1200,
                losses_bedwars: 800,
                fkdr: 1.33,
            };
            const jsonString = JSON.stringify(validData);
            const result = validatePlayerSubmission(jsonString, validData);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject submission with all validation issues', () => {
            const invalidData = {
                bedwars_experience: 1000000,
                unknown_malicious_field: 'attack',
                kills_bedwars: -100,
            };
            const jsonString = JSON.stringify(invalidData);
            const result = validatePlayerSubmission(jsonString, invalidData);
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it('should fail on oversized payload', () => {
            const hugeData = {
                bedwars_experience: 1000000,
                massive_field: 'x'.repeat(1024 * 1024),
            };
            const jsonString = JSON.stringify(hugeData);
            const result = validatePlayerSubmission(jsonString, hugeData);
            expect(result.valid).toBe(false);
            expect(result.errors[0].field).toBe('_payload');
        });
    });
});
