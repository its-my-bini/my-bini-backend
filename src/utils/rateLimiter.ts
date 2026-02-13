import { getRedis } from "../db/redis";

// ─── Rate Limiter (Sliding Window) ───────────────────

const MAX_MESSAGES_PER_MINUTE = 20;
const WINDOW_SECONDS = 60;

export async function checkRateLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  const redis = getRedis();
  const key = `rate:chat:${userId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_SECONDS * 1000;

  // Use Redis pipeline for atomicity
  const pipeline = redis.pipeline();

  // Remove old entries outside the window
  pipeline.zremrangebyscore(key, 0, windowStart);
  // Count current entries in window
  pipeline.zcard(key);
  // Add current request
  pipeline.zadd(key, now, `${now}-${Math.random()}`);
  // Set expiry on the key
  pipeline.expire(key, WINDOW_SECONDS);

  const results = await pipeline.exec();

  const currentCount = (results?.[1]?.[1] as number) || 0;
  const allowed = currentCount < MAX_MESSAGES_PER_MINUTE;

  if (!allowed) {
    // Get the oldest entry to calculate reset time
    const oldest = await redis.zrange(key, 0, 0, "WITHSCORES");
    const oldestTimestamp = oldest.length >= 2 ? parseInt(oldest[1]!) : now;
    const resetIn = Math.ceil(
      (oldestTimestamp + WINDOW_SECONDS * 1000 - now) / 1000,
    );

    return {
      allowed: false,
      remaining: 0,
      resetIn: Math.max(1, resetIn),
    };
  }

  return {
    allowed: true,
    remaining: MAX_MESSAGES_PER_MINUTE - currentCount - 1,
    resetIn: WINDOW_SECONDS,
  };
}
