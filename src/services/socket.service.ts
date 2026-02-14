import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../db/prisma";

export class SocketService {
  private static instance: SocketService;
  private io: SocketIOServer | null = null;

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public init(listener: any): void {
    if (this.io) {
      console.warn("[SocketService] Already initialized");
      return;
    }

    this.io = new SocketIOServer(listener, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.io.on("connection", (socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      socket.on("join", async (walletAddress: string) => {
        if (walletAddress) {
          try {
            const user = await prisma.user.findUnique({
              where: { wallet_address: walletAddress.toLowerCase() },
            });

            if (user) {
              const room = `user:${user.id}`;
              socket.join(room);
              console.log(
                `[Socket] ${socket.id} joined room: ${room} (Wallet: ${walletAddress})`,
              );
            } else {
              console.warn(
                `[Socket] User not found for wallet: ${walletAddress}`,
              );
            }
          } catch (err) {
            console.error("[Socket] Error joining room:", err);
          }
        }
      });

      // Handle Typing Indicator (Sync across devices)
      socket.on("typing", (isTyping: boolean) => {
        // Broadcast to the sender's room (excluding sender)?
        // Or just log it for now since we don't have P2P.
        // For multi-device, we need to know the room.
        // Socket doesn't track room automatically unless we store it.
        // For simplicity, we just look at the rooms the socket is in.
        for (const room of socket.rooms) {
          if (room !== socket.id) {
            socket.to(room).emit("typing", isTyping);
          }
        }
      });

      socket.on("disconnect", () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
      });
    });

    console.log("[SocketService] Initialized");
  }

  public emitBalanceUpdate(userId: string, newBalance: number): void {
    if (!this.io) return;

    const room = `user:${userId}`;
    this.io.to(room).emit("balance:update", {
      balance: newBalance,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Socket] Emitted balance update to ${room}: ${newBalance}`);
  }

  public emitNotification(
    userId: string,
    title: string,
    message: string,
    type: "info" | "success" | "warning" | "error" = "info",
  ): void {
    if (!this.io) return;

    const room = `user:${userId}`;
    this.io.to(room).emit("notification", {
      title,
      message,
      type,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Socket] Notification sent to ${room}: ${title}`);
  }

  public emitMessage(userId: string, message: any): void {
    if (!this.io) return;

    const room = `user:${userId}`;
    this.io.to(room).emit("message:receive", message);

    console.log(
      `[Socket] Message sent to ${room} (Persona: ${message.persona_id})`,
    );
  }
}
