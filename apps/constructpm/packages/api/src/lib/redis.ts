import { Redis } from 'ioredis';
import { env } from './env.js';

let available = false;

export const redis = new Redis(env.REDIS_URL, {
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  // AVAILABILITY: never stop reconnecting. The previous strategy returned null
  // after five attempts, which ends the connection permanently — ioredis then
  // never tries again for the life of the process. A Redis restart (a deploy
  // that recreates the container, an OOM kill) therefore left the API with a
  // dead client, and the Redis-backed rate limiter rejected every request as
  // "rate limited" until someone restarted the API by hand. Capped exponential
  // backoff instead; the rate limiter falls back to memory in the meantime.
  retryStrategy: (times) => Math.min(times * 200, 5_000),
  // A rate limiter must never queue commands while disconnected — it would add
  // seconds of latency to every request and then fail anyway. Fail fast so the
  // in-memory insurance limiter takes over immediately.
  enableOfflineQueue: false,
});

// 'ready' rather than 'connect': commands issued between TCP connect and AUTH
// completing are rejected, so 'connect' overstates availability.
redis.on('ready', () => { available = true; console.info('[redis] Ready'); });
redis.on('close', () => {
  if (available) console.warn('[redis] Connection closed — reconnecting; rate limiting is in-memory until it returns');
  available = false;
});
// ioredis emits 'error' on every failed attempt; without a listener it would
// throw. Logging each one would flood the log during an outage, so stay quiet
// here and let 'close'/'ready' tell the story.
redis.on('error', () => { available = false; });

export const safeRedis = {
  get: async (k: string) => { try { return available ? await redis.get(k) : null; } catch { return null; } },
  set: async (k: string, v: string, ttl?: number) => { try { if (available) ttl ? await redis.set(k, v, 'EX', ttl) : await redis.set(k, v); } catch { /* degraded */ } },
  del: async (k: string) => { try { if (available) await redis.del(k); } catch { /* degraded */ } },
  isAvailable: () => available,
};

export async function connectRedis() {
  try { await redis.connect(); } catch { console.warn('[redis] Degraded mode'); }
}
