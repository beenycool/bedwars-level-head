import { randomUUID } from 'node:crypto';
import {
  GLOBAL_JOBS_LEADER_LOCK_KEY,
  GLOBAL_JOBS_LEADER_RETRY_MS,
  GLOBAL_JOBS_LEADER_TTL_MS,
} from '../config';
import { logger } from '../util/logger';
import { getRedisClient } from './redis';

interface GlobalLeaderCallbacks {
  onLeaderStart: () => Promise<void> | void;
  onLeaderStop: () => Promise<void> | void;
}

const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

let heartbeatInterval: NodeJS.Timeout | null = null;
let heartbeatInFlight = false;
let callbacks: GlobalLeaderCallbacks | null = null;
let leaderToken = `${process.pid}:${randomUUID()}`;
let isLeader = false;
let hasRedisLock = false;

async function transitionToLeader(reason: string): Promise<void> {
  if (isLeader || !callbacks) {
    return;
  }

  isLeader = true;
  logger.info(`[leader] Became global jobs leader (${reason})`);

  try {
    await callbacks.onLeaderStart();
  } catch (error) {
    logger.error('[leader] onLeaderStart failed', error);
  }
}

async function transitionFromLeader(reason: string): Promise<void> {
  if (!isLeader || !callbacks) {
    return;
  }

  isLeader = false;
  logger.info(`[leader] Relinquishing global jobs leadership (${reason})`);

  try {
    await callbacks.onLeaderStop();
  } catch (error) {
    logger.error('[leader] onLeaderStop failed', error);
  }
}

async function releaseRedisLock(): Promise<void> {
  if (!hasRedisLock) {
    return;
  }

  const client = getRedisClient();
  if (!client || client.status !== 'ready') {
    hasRedisLock = false;
    return;
  }

  try {
    await client.eval(RELEASE_LOCK_SCRIPT, 1, GLOBAL_JOBS_LEADER_LOCK_KEY, leaderToken);
  } catch (error) {
    logger.error('[leader] Failed to release Redis lock', error);
  } finally {
    hasRedisLock = false;
  }
}

async function heartbeat(): Promise<void> {
  if (heartbeatInFlight || !callbacks) {
    return;
  }

  heartbeatInFlight = true;
  try {
    const client = getRedisClient();

    if (!client || client.status !== 'ready') {
      hasRedisLock = false;
      await transitionFromLeader('redis-unavailable');
      return;
    }

    if (isLeader && !hasRedisLock) {
      await transitionFromLeader('redis-recovered-reacquiring-lock');
    }

    if (hasRedisLock) {
      const renewed = await client.eval(
        RENEW_LOCK_SCRIPT,
        1,
        GLOBAL_JOBS_LEADER_LOCK_KEY,
        leaderToken,
        GLOBAL_JOBS_LEADER_TTL_MS.toString(),
      );

      if (Number(renewed) === 1) {
        await transitionToLeader('redis-lock-renewed');
        return;
      }

      hasRedisLock = false;
      await transitionFromLeader('redis-lock-lost');
    }

    const acquired = await client.set(
      GLOBAL_JOBS_LEADER_LOCK_KEY,
      leaderToken,
      'PX',
      GLOBAL_JOBS_LEADER_TTL_MS,
      'NX',
    );

    if (acquired === 'OK') {
      hasRedisLock = true;
      await transitionToLeader('redis-lock-acquired');
      return;
    }

    await transitionFromLeader('another-instance-holds-lock');
  } catch (error) {
    logger.error('[leader] Heartbeat failed', error);
    hasRedisLock = false;
    await transitionFromLeader('heartbeat-error');
  } finally {
    heartbeatInFlight = false;
  }
}

export function startGlobalLeaderElection(nextCallbacks: GlobalLeaderCallbacks): void {
  callbacks = nextCallbacks;
  leaderToken = `${process.pid}:${randomUUID()}`;

  if (heartbeatInterval) {
    return;
  }

  void heartbeat();
  heartbeatInterval = setInterval(() => {
    void heartbeat();
  }, GLOBAL_JOBS_LEADER_RETRY_MS);
  heartbeatInterval.unref();
}

export async function stopGlobalLeaderElection(): Promise<void> {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  await transitionFromLeader('shutdown');
  await releaseRedisLock();
  callbacks = null;
}

export function isGlobalLeader(): boolean {
  return isLeader;
}
