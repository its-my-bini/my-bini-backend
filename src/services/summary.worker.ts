import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { getRedisUrl } from "../db/redis";
import { prisma } from "../db/prisma";
import { summarizeConversation } from "./ai.service";
import { updateMemory } from "./memory.service";

// ─── Queue Setup ─────────────────────────────────────

const QUEUE_NAME = "summary-jobs";

let summaryQueue: Queue | null = null;
let summaryWorker: Worker | null = null;

function createConnection() {
  return new IORedis(getRedisUrl(), { maxRetriesPerRequest: null });
}

export function getSummaryQueue(): Queue {
  if (!summaryQueue) {
    summaryQueue = new Queue(QUEUE_NAME, {
      connection: createConnection() as any,
    });
  }
  return summaryQueue;
}

// ─── Push Summary Job ────────────────────────────────

export async function pushSummaryJob(
  userId: string,
  personaId: string,
): Promise<void> {
  const queue = getSummaryQueue();
  await queue.add(
    "summarize",
    { userId, personaId },
    {
      delay: 5000, // Wait 5 seconds after last message
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 10000,
      },
    },
  );
}

// ─── Start Worker ────────────────────────────────────

export function startSummaryWorker(): void {
  if (summaryWorker) return;

  summaryWorker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { userId, personaId } = job.data as {
        userId: string;
        personaId: string;
      };

      console.log(
        `[SummaryWorker] Processing summary for user=${userId}, persona=${personaId}`,
      );

      try {
        // Fetch last 50–100 messages
        const messages = await prisma.message.findMany({
          where: {
            user_id: userId,
            persona_id: personaId,
            deleted_at: null,
          },
          orderBy: { created_at: "desc" },
          take: 75,
          select: { role: true, content: true },
        });

        if (messages.length < 10) {
          console.log(
            "[SummaryWorker] Not enough messages to summarize, skipping",
          );
          return;
        }

        // Reverse to chronological order
        const chronological = messages.reverse();

        // Generate summary via GLM
        const summary = await summarizeConversation(chronological);

        // Update memory
        await updateMemory(userId, personaId, "summary", {
          summary,
          message_count: chronological.length,
          updated_at: new Date().toISOString(),
        });

        console.log(
          `[SummaryWorker] Summary updated for user=${userId}, persona=${personaId}`,
        );
      } catch (error) {
        console.error("[SummaryWorker] Error:", error);
        throw error; // Re-throw for retry
      }
    },
    {
      connection: createConnection() as any,
      concurrency: 2,
    },
  );

  summaryWorker.on("completed", (job) => {
    console.log(`[SummaryWorker] Job ${job.id} completed`);
  });

  summaryWorker.on("failed", (job, err) => {
    console.error(`[SummaryWorker] Job ${job?.id} failed:`, err.message);
  });

  console.log("[SummaryWorker] Started");
}

// ─── Cleanup ─────────────────────────────────────────

export async function closeSummaryWorker(): Promise<void> {
  if (summaryWorker) {
    await summaryWorker.close();
    summaryWorker = null;
  }
  if (summaryQueue) {
    await summaryQueue.close();
    summaryQueue = null;
  }
}
