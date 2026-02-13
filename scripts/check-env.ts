import dotenv from "dotenv";
dotenv.config();

console.log("Loaded REDIS_URL:", process.env.REDIS_URL);
console.log(
  "Port parsed:",
  new URL(process.env.REDIS_URL || "redis://localhost:6379").port,
);
