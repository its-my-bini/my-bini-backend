import { Queue } from "bullmq";
import { getRedis } from "../db/redis";

export class CronService {
  private static instance: CronService;
  public engagementQueue: Queue;

  private constructor() {
    const connection = getRedis();
    this.engagementQueue = new Queue("engagement-queue", {
      connection: connection as any,
    });
  }

  public static getInstance(): CronService {
    if (!CronService.instance) {
      CronService.instance = new CronService();
    }
    return CronService.instance;
  }

  public async init() {
    console.log("[CronService] Initializing schedules...");

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await this.engagementQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await this.engagementQueue.removeRepeatableByKey(job.key);
    }

    // Schedule: Every hour (at minute 0)
    await this.engagementQueue.add(
      "check-routines",
      {},
      {
        repeat: {
          pattern: "0 * * * *", // Every hour
        },
      },
    );

    console.log("[CronService] Scheduled 'check-routines' (Every hour)");
  }
}
