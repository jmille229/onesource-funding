import { Redis } from 'ioredis';
import { env } from './env.js';

let available = false;

export const redis = new Redis(env.REDIS_URL, {
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
});

redis.on('connect', () => { available = true; console.info('[redis] Connected'); });
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
