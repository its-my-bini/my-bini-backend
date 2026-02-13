import { prisma } from "../db/prisma";

// ─── Status Thresholds ───────────────────────────────

function getStatusFromLevel(level: number): string {
  if (level >= 70) return "lover";
  if (level >= 40) return "close";
  if (level >= 20) return "friend";
  return "stranger";
}

// ─── Update Intimacy ────────────────────────────────

export async function updateIntimacy(
  userId: string,
  personaId: string,
  delta: number = 1,
): Promise<{ intimacy_level: number; status: string }> {
  const relationship = await prisma.relationship.findUnique({
    where: { user_id_persona_id: { user_id: userId, persona_id: personaId } },
  });

  if (!relationship) {
    throw new Error("Relationship not found");
  }

  const newLevel = Math.min(
    100,
    Math.max(0, relationship.intimacy_level + delta),
  );
  const newStatus = getStatusFromLevel(newLevel);

  const updated = await prisma.relationship.update({
    where: { id: relationship.id },
    data: {
      intimacy_level: newLevel,
      status: newStatus,
      last_interaction: new Date(),
    },
  });

  return {
    intimacy_level: updated.intimacy_level,
    status: updated.status,
  };
}

// ─── Get Relationship ────────────────────────────────

export async function getRelationship(userId: string, personaId: string) {
  return prisma.relationship.findUnique({
    where: { user_id_persona_id: { user_id: userId, persona_id: personaId } },
  });
}

// ─── Check Streak & Daily Reward ─────────────────────

export async function checkAndClaimDailyReward(userId: string): Promise<{
  claimed: boolean;
  reward: number;
  streakBonus: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if already claimed today
  const todayLog = await prisma.usageLog.findUnique({
    where: {
      user_id_date: {
        user_id: userId,
        date: today,
      },
    },
  });

  if (todayLog && todayLog.messages_sent > 0) {
    return { claimed: false, reward: 0, streakBonus: 0 };
  }

  // Get daily reward amount
  const config = await prisma.appConfig.findUnique({
    where: { key: "daily_reward" },
  });
  const rewardAmount = config ? parseFloat(config.value) : 5;

  // Check streak (3 consecutive days)
  let streakBonus = 0;
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const recentLogs = await prisma.usageLog.findMany({
    where: {
      user_id: userId,
      date: { gte: threeDaysAgo, lt: today },
      messages_sent: { gt: 0 },
    },
    orderBy: { date: "desc" },
  });

  // Check if user chatted for the last 3 consecutive days
  if (recentLogs.length >= 3) {
    streakBonus = 2; // Bonus intimacy for streak
  }

  // Credit reward
  await prisma.$transaction([
    prisma.balance.upsert({
      where: { user_id: userId },
      create: { user_id: userId, token_balance: rewardAmount },
      update: { token_balance: { increment: rewardAmount } },
    }),
    prisma.transaction.create({
      data: {
        user_id: userId,
        type: "reward",
        amount: rewardAmount,
      },
    }),
    prisma.usageLog.upsert({
      where: { user_id_date: { user_id: userId, date: today } },
      create: { user_id: userId, date: today },
      update: {},
    }),
  ]);

  return {
    claimed: true,
    reward: rewardAmount,
    streakBonus,
  };
}

// ─── Track Usage ─────────────────────────────────────

export async function trackUsage(
  userId: string,
  tokensUsed: number,
): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.usageLog.upsert({
    where: { user_id_date: { user_id: userId, date: today } },
    create: {
      user_id: userId,
      date: today,
      tokens_used: tokensUsed,
      messages_sent: 1,
    },
    update: {
      tokens_used: { increment: tokensUsed },
      messages_sent: { increment: 1 },
    },
  });
}
