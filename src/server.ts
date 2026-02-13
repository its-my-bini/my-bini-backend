import Hapi from "@hapi/hapi";
import { prisma } from "./db/prisma";
import { closeRedis } from "./db/redis";
import { authRoutes } from "./routes/auth";
import { personaRoutes } from "./routes/persona";
import { tokenRoutes } from "./routes/token";
import { chatRoutes } from "./routes/chat";
import {
  startSummaryWorker,
  closeSummaryWorker,
} from "./services/summary.worker";

// ─── Server Setup ────────────────────────────────────

const PORT = parseInt(process.env.SERVER_PORT || "3000", 10);

const server = Hapi.server({
  port: PORT,
  host: "0.0.0.0",
  routes: {
    cors: {
      origin: ["*"],
      headers: ["Accept", "Content-Type", "x-wallet-address"],
      additionalHeaders: ["x-wallet-address"],
    },
    validate: {
      failAction: async (_request, _h, err) => {
        throw err;
      },
    },
  },
});

// ─── Health Check ────────────────────────────────────

server.route({
  method: "GET",
  path: "/health",
  handler: () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  }),
});

// ─── Register Plugins ────────────────────────────────

async function registerPlugins() {
  await server.register([authRoutes, personaRoutes, tokenRoutes, chatRoutes]);
}

// ─── Start Server ────────────────────────────────────

async function start() {
  try {
    // Register Swagger plugins
    await server.register([
      require("@hapi/inert"),
      require("@hapi/vision"),
      {
        plugin: require("hapi-swagger"),
        options: {
          info: {
            title: "AI Girlfriend Bot API Documentation",
            version: "1.0.0",
          },
        },
      },
    ]);

    // Register route plugins
    await registerPlugins();

    // Start the summary worker
    startSummaryWorker();

    // Start serving
    await server.start();

    console.log("╔══════════════════════════════════════════╗");
    console.log("║   💕 AI Girlfriend Bot Backend           ║");
    console.log(`║   🚀 Server running on port ${PORT}         ║`);
    console.log("║   📡 Ready for connections               ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log("");
    console.log("Available routes:");
    console.log("  POST /auth/wallet-login");
    console.log("  GET  /user/profile");
    console.log("  GET  /personas");
    console.log("  POST /user/select-persona");
    console.log("  POST /chat");
    console.log("  GET  /chat/history");
    console.log("  GET  /token/balance");
    console.log("  POST /token/deposit");
    console.log("  POST /token/withdraw");
    console.log("  POST /token/daily-reward");
    console.log("  GET  /health");
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

// ─── Graceful Shutdown ───────────────────────────────

async function shutdown() {
  console.log("\n🛑 Shutting down gracefully...");
  await server.stop({ timeout: 5000 });
  await closeSummaryWorker();
  await closeRedis();
  await prisma.$disconnect();
  console.log("✅ Server stopped");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ─── Start ───────────────────────────────────────────

start();
