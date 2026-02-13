import { prisma } from "../db/prisma";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { monadTestnet } from "viem/chains";
import { SocketService } from "./socket.service";

// ─── Get Balance ─────────────────────────────────────

export async function getBalance(userId: string): Promise<number> {
  const balance = await prisma.balance.findUnique({
    where: { user_id: userId },
  });
  return balance?.token_balance ?? 0;
}

// ─── Reserve Tokens (atomic check + deduct) ──────────

export async function reserveTokens(
  userId: string,
  amount: number,
): Promise<boolean> {
  try {
    const result = await prisma.balance.updateMany({
      where: {
        user_id: userId,
        token_balance: { gte: amount },
      },
      data: {
        token_balance: { decrement: amount },
      },
    });

    if (result.count > 0) {
      // Emit update
      const newBalance = await getBalance(userId);
      SocketService.getInstance().emitBalanceUpdate(userId, newBalance);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Commit Deduction (record transaction) ───────────

export async function commitDeduction(
  userId: string,
  amount: number,
): Promise<void> {
  await prisma.transaction.create({
    data: {
      user_id: userId,
      type: "chat",
      amount: -amount,
    },
  });
}

// ─── Rollback Tokens ─────────────────────────────────

export async function rollbackTokens(
  userId: string,
  amount: number,
): Promise<void> {
  const updated = await prisma.balance.update({
    where: { user_id: userId },
    data: {
      token_balance: { increment: amount },
    },
  });
  SocketService.getInstance().emitBalanceUpdate(userId, updated.token_balance);
}

// ─── Viem Client ─────────────────────────────────────

const client = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.MONAD_RPC_URL),
});

// ─── Process Deposit ─────────────────────────────────

// Exchange Rate: 1 MON = 100 Tokens
const EXCHANGE_RATE = 100;

export async function processDeposit(
  userId: string,
  amount: number,
  txHash: string,
): Promise<void> {
  // 1. Check if txHash already processed
  const existing = await prisma.transaction.findFirst({
    where: { tx_hash: txHash },
  });
  if (existing) {
    throw new Error("Transaction already processed");
  }

  // 2. Verify On-Chain
  const tx = await client.getTransaction({
    hash: txHash as `0x${string}`,
  });

  if (!tx) {
    throw new Error("Transaction not found on Monad Testnet");
  }

  // 3. Validation Checks
  if (
    tx.to?.toLowerCase() !== process.env.MONAD_TREASURY_ADDRESS?.toLowerCase()
  ) {
    throw new Error("Invalid transaction recipient (not our treasury)");
  }

  // Verify amount (allow small floating point diffs)
  const valueInMon = parseFloat(formatEther(tx.value));
  if (Math.abs(valueInMon - amount) > 0.0001) {
    throw new Error(`Amount mismatch: claimed ${amount}, actual ${valueInMon}`);
  }

  // 4. Calculate Tokens to Credit
  const tokensToCredit = amount * EXCHANGE_RATE;

  // 5. Update Database
  const [updatedBalance] = await prisma.$transaction([
    prisma.balance.upsert({
      where: { user_id: userId },
      create: { user_id: userId, token_balance: tokensToCredit },
      update: { token_balance: { increment: tokensToCredit } },
    }),
    prisma.transaction.create({
      data: {
        user_id: userId,
        type: "purchase",
        amount: tokensToCredit, // Record in Tokens
        tx_hash: txHash,
      },
    }),
  ]);

  // Emit update
  SocketService.getInstance().emitBalanceUpdate(
    userId,
    updatedBalance.token_balance,
  );
}

// ─── Process Withdraw ────────────────────────────────

export async function processWithdraw(
  userId: string,
  amount: number,
): Promise<void> {
  const reserved = await reserveTokens(userId, amount);
  if (!reserved) {
    throw new Error("Insufficient balance");
  }

  await prisma.transaction.create({
    data: {
      user_id: userId,
      type: "withdraw",
      amount: -amount,
    },
  });
}

// ─── Get Chat Cost ───────────────────────────────────

export async function getChatCost(): Promise<number> {
  const config = await prisma.appConfig.findUnique({
    where: { key: "chat_cost" },
  });
  return config ? parseFloat(config.value) : 1;
}

// ─── Ensure Balance Exists ───────────────────────────

export async function ensureBalance(userId: string): Promise<void> {
  const updated = await prisma.balance.upsert({
    where: { user_id: userId },
    create: { user_id: userId, token_balance: 50 },
    update: {},
  });
  // Optional: Emit here if it's a new user or just ensuring?
  // If it's new user, they might not be connected to socket yet.
  // But good to have.
  SocketService.getInstance().emitBalanceUpdate(userId, updated.token_balance);
}
