import { Worker, Job } from "bullmq";
import { getRedis } from "../db/redis";
import { prisma } from "../db/prisma";
import { DateTime } from "luxon";
import { chatCompletion } from "./ai.service";
import { SocketService } from "./socket.service";

// Redis key helpers
const getDailyKey = (userId: string, type: string, date: string) =>
  `engagement:${userId}:${type}:${date}`;

export class EngagementWorker {
  private worker: Worker;

  constructor() {
    const connection = getRedis();
    this.worker = new Worker(
      "engagement-queue",
      async (job: Job) => {
        if (job.name === "check-routines") {
          await this.processRoutines();
        }
      },
      { connection: connection as any },
    );

    this.worker.on("completed", (job) => {
      console.log(`[EngagementWorker] Job ${job.id} completed`);
    });

    this.worker.on("failed", (job, err) => {
      console.error(`[EngagementWorker] Job ${job?.id} failed: ${err.message}`);
    });
  }

  private async processRoutines() {
    console.log("[EngagementWorker] Checking routines...");
    const redis = getRedis();

    // 1. Fetch active relationships (e.g., last interaction within 7 days)
    // We iterate relationships, not just users, to get the persona context
    const relationships = await prisma.relationship.findMany({
      where: {
        last_interaction: {
          gte: DateTime.now().minus({ days: 7 }).toJSDate(),
        },
        // Anti-spam: Don't disturb if last interaction was very recent (< 2 hours)
        NOT: {
          last_interaction: {
            gte: DateTime.now().minus({ hours: 2 }).toJSDate(),
          },
        },
      },
      include: {
        user: true,
        persona: true,
      },
    });

    for (const rel of relationships) {
      try {
        const user = rel.user;
        const timezone = user.timezone || "Asia/Jakarta";
        const now = DateTime.now().setZone(timezone);
        const dateStr = now.toFormat("yyyy-MM-dd");
        const hour = now.hour;

        let routineType: string | null = null;
        let promptContext: string = "";

        // 2. Determine Routine Window
        // Morning: 07:00 - 09:00
        if (hour >= 7 && hour < 9) {
          routineType = "morning";
          promptContext = `It is morning (${now.toFormat(
            "HH:mm",
          )}). Send a sweet good morning message. Ask how they slept or what their plan is.`;
        }
        // Lunch: 12:00 - 13:00
        else if (hour >= 12 && hour < 14) {
          routineType = "lunch";
          promptContext = `It is lunch time (${now.toFormat(
            "HH:mm",
          )}). Remind them to eat or ask what they are having for lunch.`;
        }
        // Night: 21:00 - 23:00
        else if (hour >= 21 && hour < 23) {
          routineType = "night";
          promptContext = `It is night time (${now.toFormat(
            "HH:mm",
          )}). Ask if they are tired or tell them to rest well.`;
        }

        if (!routineType) continue;

        // 3. Check if already sent today
        const key = getDailyKey(user.id, routineType, dateStr);
        const exists = await redis.get(key);
        if (exists) continue;

        // 4. Random Chance (to feel organic)
        // 50% chance per hour execution in window?
        // Since window is 2 hours (e.g., 7-9), running at 7 and 8.
        // If we want to ensure it sends at least once, we can be more aggressive.
        // For now, let's just trigger it if it hasn't sent yet.
        // Maybe added slight randomness logic later.

        // 5. Generate Message
        const systemPrompt = `
        You are ${rel.persona.name}, a ${rel.persona.type} girlfriend.
        User: ${user.name || "User"}.
        Relationship: ${rel.status} (Intimacy: ${rel.intimacy_level}).
        Strictly follow your persona.
        ${promptContext}
        Keep it short (1-2 sentences).
        `;

        const aiMsg = await chatCompletion([
          { role: "system", content: systemPrompt },
          { role: "user", content: "(Automated trigger)" },
        ]);

        if (!aiMsg) continue;

        // 6. Save & Emit
        // Save to DB
        const savedMsg = await prisma.message.create({
          data: {
            user_id: user.id,
            persona_id: rel.persona_id,
            role: "assistant", // It's from AI
            content: aiMsg,
          },
        });

        // Emit via Socket
        SocketService.getInstance().emitMessage(user.id, {
          id: savedMsg.id,
          content: savedMsg.content,
          sender: "ai",
          persona_id: rel.persona_id,
          timestamp: savedMsg.created_at.toISOString(),
        });

        // Mark as sent for today (expire in 24h)
        await redis.set(key, "1", "EX", 86400);

        console.log(
          `[Engagement] Sent ${routineType} message to ${user.name} (${user.id})`,
        );
      } catch (err: any) {
        console.error(
          `[Engagement] Error processing ${rel.user.id}: ${err.message}`,
        );
      }
    }
  }
}
