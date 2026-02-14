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
import { CronService } from "./services/cron.service";
import { EngagementWorker } from "./services/engagement.worker";
import { SocketService } from "./services/socket.service";

import os from "os";

// ─── Native Fetch for Ngrok ──────────────────────────
// Bun has built-in fetch, so we don't need node-fetch

// ─── Helper: Get LAN IP ──────────────────────────────
function getLocalExternalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      // Skip internal (non-127.0.0.1) and non-ipv4
      if ("IPv4" !== iface.family || iface.internal) {
        continue;
      }
      return iface.address;
    }
  }
  return "localhost";
}

// ─── Helper: Get Ngrok URL ───────────────────────────
async function getNgrokUrl(): Promise<string | null> {
  try {
    const response = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (!response.ok) return null;
    const data = (await response.json()) as any;
    const tunnel = data.tunnels?.find((t: any) => t.proto === "https");
    return tunnel?.public_url || null;
  } catch {
    return null;
  }
}

// ─── Server Setup ────────────────────────────────────

const PORT = process.env.PORT || 8000;

const server = Hapi.server({
  port: PORT,
  host: "0.0.0.0",
  routes: {
    cors: {
      origin: ["*"], // TODO: Restrict this to your frontend domain in production
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
            description: `
**Base URL**: /

**Real-Time Features (WebSocket)**:
- Connect to this server using Socket.io
- Events: \`balance:update\`
- See **frontend_guide.md** for full documentation.
            `,
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

    // Initialize Socket.io
    SocketService.getInstance().init(server.listener);

    // Initialize Engagement Worker & Cron
    new EngagementWorker();
    await CronService.getInstance().init();

    console.log("Server running on %s", server.info.uri);
    const localUrl = `http://localhost:${PORT}`;
    const lanIp = getLocalExternalIp();
    const networkUrl = `http://${lanIp}:${PORT}`;
    const ngrokUrl = await getNgrokUrl();

    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║                   💕 AI Girlfriend Bot                   ║");
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║   🚀 Local:     ${localUrl.padEnd(33)}║`);
    console.log(`║   📡 Network:   ${networkUrl.padEnd(33)}║`);
    if (ngrokUrl) {
      console.log(`║   🌍 Public:    ${ngrokUrl.padEnd(33)}║`);
    }
    console.log("╚══════════════════════════════════════════════════════════╝");
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
