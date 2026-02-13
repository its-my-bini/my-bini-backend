import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

async function configureRedis() {
  const redis = new Redis(process.env.REDIS_URL!);

  try {
    console.log("Setting maxmemory-policy to noeviction...");
    await redis.config("SET", "maxmemory-policy", "noeviction");
    console.log("Successfully set maxmemory-policy to noeviction");

    const policy = await redis.config("GET", "maxmemory-policy");
    console.log("Current policy:", policy);
  } catch (error) {
    console.error("Failed to configure Redis:", error);
  } finally {
    redis.disconnect();
  }
}

configureRedis();
