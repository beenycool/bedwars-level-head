import { createHmac, timingSafeEqual } from 'node:crypto';
import { COMMUNITY_SUBMIT_SECRET } from '../config';
import { logger } from '../util/logger';
import { validateTimestampAndNonce, validatePlayerSubmission, matchesCriticalFields } from '../util/validation';
import { canonicalize } from '../util/signature';
import { isValidBedwarsObject } from '../util/typeChecks';
import { MinimalPlayerStats, extractMinimalStats } from './hypixel';
import { getPlayerStatsFromCache, setIgnMapping, setPlayerStatsBoth } from './statsCache';

interface VerificationResult {
  valid: boolean;
  source: string | null;
  error?: string;
  statusCode?: number;
  verifiedDisplayname?: string;
}

interface SignedData {
  timestamp: number;
  nonce: string;
  [key: string]: unknown;
}

export class SubmissionService {
  private buildSubmitterKeyId(ipAddress: string): string {
    if (!COMMUNITY_SUBMIT_SECRET || COMMUNITY_SUBMIT_SECRET.length === 0) {
      throw new Error('COMMUNITY_SUBMIT_SECRET must be set for player submissions.');
    }
    return createHmac('sha256', COMMUNITY_SUBMIT_SECRET).update(ipAddress).digest('hex');
  }

  private verifySignedSubmission(uuid: string, data: SignedData, signature?: string): boolean {
    if (!COMMUNITY_SUBMIT_SECRET || !signature) {
      return false;
    }

    try {
      const canonical = canonicalize(data);
      const digest = createHmac('sha256', COMMUNITY_SUBMIT_SECRET).update(`${uuid}:${canonical}`).digest();
      const provided = Buffer.from(signature, 'hex');
      if (provided.length !== digest.length) {
        return false;
      }
      return timingSafeEqual(provided, digest);
    } catch (error) {
      logger.warn('Failed to verify signed submission', error);
      return false;
    }
  }

  private async verifyHypixelOrigin(
    uuid: string,
    data: unknown,
    signature?: string,
    keyId?: string,
  ): Promise<VerificationResult> {
    try {
      const submittedData = data as SignedData;

      if (this.verifySignedSubmission(uuid, submittedData, signature)) {
        const timestamp = submittedData.timestamp;
        const nonce = submittedData.nonce;

        if (typeof timestamp !== 'number' || typeof nonce !== 'string') {
          return {
            valid: false,
            source: null,
            error: 'Missing timestamp or nonce in signed payload.',
            statusCode: 400,
          };
        }

        const nonceValidation = await validateTimestampAndNonce(timestamp, nonce, keyId || 'default');
        if (!nonceValidation.valid) {
          return {
            valid: false,
            source: null,
            error: nonceValidation.error,
            statusCode: nonceValidation.statusCode,
          };
        }

        return { valid: true, source: 'community_verified' };
      }

      const { fetchHypixelPlayer } = await import('./hypixel');
      const result = await fetchHypixelPlayer(uuid);

      if (!result.payload || result.notModified) {
        return { valid: false, source: null };
      }

      const hypixelData = result.payload.data?.bedwars;
      if (!isValidBedwarsObject(hypixelData)) {
        return { valid: false, source: null };
      }

      if (matchesCriticalFields(hypixelData, submittedData)) {
        const submittedName = (data as any).displayname;
        const actualName = result.payload.player?.displayname;

        if (typeof submittedName === 'string' && typeof actualName === 'string') {
          if (submittedName.trim() !== actualName.trim()) {
            return { valid: false, source: null, error: 'Displayname mismatch' };
          }
        }

        return {
          valid: true,
          source: 'community_verified',
          verifiedDisplayname: actualName,
        };
      }

      return { valid: false, source: null };
    } catch (error) {
      logger.error('Failed to verify Hypixel origin:', error);
      return { valid: false, source: null };
    }
  }

  private buildMinimalStatsFromSubmission(data: Record<string, unknown>): MinimalPlayerStats {
    const rawExperience = data.bedwars_experience ?? data.Experience ?? data.experience;
    const numericExperience = Number(rawExperience);
    const bedwarsExperience = Number.isFinite(numericExperience) ? numericExperience : null;

    const rawDisplayname = data.displayname;
    const displayname =
      typeof rawDisplayname === 'string' && rawDisplayname.trim().length > 0
        ? rawDisplayname.trim()
        : null;
    const rawFinalKills = Number(data.final_kills_bedwars ?? 0);
    const rawFinalDeaths = Number(data.final_deaths_bedwars ?? 0);
    const bedwarsFinalKills = Number.isFinite(rawFinalKills) ? rawFinalKills : 0;
    const bedwarsFinalDeaths = Number.isFinite(rawFinalDeaths) ? rawFinalDeaths : 0;

    return {
      displayname,
      bedwars_experience: bedwarsExperience,
      bedwars_final_kills: bedwarsFinalKills,
      bedwars_final_deaths: bedwarsFinalDeaths,
      duels_wins: 0,
      duels_losses: 0,
      duels_kills: 0,
      duels_deaths: 0,
      skywars_experience: null,
      skywars_wins: 0,
      skywars_losses: 0,
      skywars_kills: 0,
      skywars_deaths: 0,
    };
  }

  public async processSubmission(
    uuid: string,
    data: unknown,
    signature: string | undefined,
    ipAddress: string
  ): Promise<{ success: boolean; message?: string; statusCode?: number; error?: string }> {
    const normalizedUuid = uuid.trim().toLowerCase();

    // Validate submission data structure
    const jsonString = JSON.stringify(data);
    const validation = validatePlayerSubmission(jsonString, data);
    if (!validation.valid) {
      const errorDetails = validation.errors.map((err) => `${err.field}: ${err.message}`).join('; ');
      return {
        success: false,
        statusCode: 422,
        error: `Player data validation failed: ${errorDetails}`
      };
    }

    let keyId: string;
    try {
        keyId = this.buildSubmitterKeyId(ipAddress);
    } catch (e) {
        return { success: false, statusCode: 503, error: 'Service unavailable' };
    }

    const verificationResult = await this.verifyHypixelOrigin(normalizedUuid, data, signature, keyId);
    if (!verificationResult.valid) {
      const statusCode = verificationResult.statusCode || 403;
      const errorCode = statusCode === 409 ? 'REPLAY_DETECTED' : 'INVALID_ORIGIN';
      const message = verificationResult.error || 'Player data could not be verified as originating from Hypixel API. This may indicate fabricated data.';
      return { success: false, statusCode, error: message }; // errorCode could be returned separately if needed
    }

    const cacheKey = `player:${normalizedUuid}`;
    const submission = data as Record<string, unknown>;
    const existingEntry = await getPlayerStatsFromCache(cacheKey, true);

    let minimalStats: MinimalPlayerStats;
    const isFullResponse = (submission.player && typeof submission.player === 'object');

    if (isFullResponse) {
      minimalStats = extractMinimalStats(submission as any);
    } else {
      minimalStats = this.buildMinimalStatsFromSubmission(submission);
    }

    const verifiedName = verificationResult.verifiedDisplayname;
    const displaynameToUse = verifiedName ?? minimalStats.displayname;

    let mergedStats: MinimalPlayerStats;

    if (existingEntry?.value) {
      mergedStats = { ...existingEntry.value };

      const hasExperience = Object.prototype.hasOwnProperty.call(submission, 'bedwars_experience') ||
                          Object.prototype.hasOwnProperty.call(submission, 'Experience') ||
                          Object.prototype.hasOwnProperty.call(submission, 'experience');

      if (isFullResponse) {
        Object.assign(mergedStats, minimalStats);
        mergedStats.displayname = displaynameToUse ?? mergedStats.displayname;
      } else {
        mergedStats.displayname = displaynameToUse ?? mergedStats.displayname;

        if (hasExperience && minimalStats.bedwars_experience !== null) {
          mergedStats.bedwars_experience = minimalStats.bedwars_experience;
        }
        if (Object.prototype.hasOwnProperty.call(submission, 'final_kills_bedwars')) {
          mergedStats.bedwars_final_kills = minimalStats.bedwars_final_kills;
        }
        if (Object.prototype.hasOwnProperty.call(submission, 'final_deaths_bedwars')) {
          mergedStats.bedwars_final_deaths = minimalStats.bedwars_final_deaths;
        }
      }
    } else {
      mergedStats = { ...minimalStats, displayname: displaynameToUse };
    }

    const etag = `contrib-${Date.now()}`;
    const lastModified = Date.now();

    await setPlayerStatsBoth(cacheKey, mergedStats, {
      etag,
      lastModified,
      source: verificationResult.source as any,
    });

    if (mergedStats.displayname) {
      await setIgnMapping(mergedStats.displayname.toLowerCase(), normalizedUuid, false);
    }

    logger.info(`[player/submit] Accepted contribution for uuid=${normalizedUuid} source=${verificationResult.source}`);
    return { success: true, statusCode: 202, message: 'Contribution accepted.' };
  }
}

export const submissionService = new SubmissionService();
