import type { Plugin, Request, ResponseToolkit } from "@hapi/hapi";
import Boom from "@hapi/boom";
import Joi from "joi";
import { getAuthUser } from "./auth";
import {
  getBalance,
  processDeposit,
  processWithdraw,
} from "../services/token.service";
import { checkAndClaimDailyReward } from "../services/relationship.service";

// ─── Token Plugin ────────────────────────────────────

export const tokenRoutes: Plugin<void> = {
  name: "token-routes",
  version: "1.0.0",
  register: async (server) => {
    // GET /token/balance
    server.route({
      method: "GET",
      path: "/token/balance",
      options: {
        validate: {
          headers: Joi.object({
            "x-wallet-address": Joi.string().required(),
          }).unknown(),
        },
        tags: ["api", "token"],
        description: "Get user token balance",
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);
        const balance = await getBalance(user.id);

        return h
          .response({
            success: true,
            balance,
          })
          .code(200);
      },
    });

    // POST /token/deposit
    server.route({
      method: "POST",
      path: "/token/deposit",
      options: {
        validate: {
          headers: Joi.object({
            "x-wallet-address": Joi.string().required(),
          }).unknown(),
          payload: Joi.object({
            tx_hash: Joi.string().required(),
            amount: Joi.number().positive().required(),
          }),
        },
        tags: ["api", "token"],
        description: "Deposit tokens (verify on-chain transaction)",
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);
        const { tx_hash, amount } = request.payload as {
          tx_hash: string;
          amount: number;
        };

        try {
          // TODO: In production, verify tx_hash on-chain via Monad RPC
          // For now, trust the submitted tx_hash and amount
          await processDeposit(user.id, amount, tx_hash);

          const newBalance = await getBalance(user.id);

          return h
            .response({
              success: true,
              message: "Deposit successful",
              balance: newBalance,
            })
            .code(200);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Deposit failed";
          throw Boom.badRequest(msg);
        }
      },
    });

    // POST /token/withdraw
    server.route({
      method: "POST",
      path: "/token/withdraw",
      options: {
        validate: {
          headers: Joi.object({
            "x-wallet-address": Joi.string().required(),
          }).unknown(),
          payload: Joi.object({
            amount: Joi.number().positive().required(),
          }),
        },
        tags: ["api", "token"],
        description: "Withdraw tokens",
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);
        const { amount } = request.payload as { amount: number };

        try {
          await processWithdraw(user.id, amount);

          const newBalance = await getBalance(user.id);

          return h
            .response({
              success: true,
              message: "Withdrawal initiated",
              balance: newBalance,
              // TODO: Return actual tx_hash from on-chain transfer
            })
            .code(200);
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Withdrawal failed";
          throw Boom.badRequest(msg);
        }
      },
    });

    // POST /token/daily-reward
    server.route({
      method: "POST",
      path: "/token/daily-reward",
      options: {
        validate: {
          headers: Joi.object({
            "x-wallet-address": Joi.string().required(),
          }).unknown(),
        },
        tags: ["api", "token"],
        description: "Claim daily login reward",
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);

        const result = await checkAndClaimDailyReward(user.id);

        if (!result.claimed) {
          return h
            .response({
              success: false,
              message: "Daily reward already claimed today",
            })
            .code(200);
        }

        const newBalance = await getBalance(user.id);

        return h
          .response({
            success: true,
            message: `🎁 Daily reward claimed! +${result.reward} tokens`,
            reward: result.reward,
            streak_bonus: result.streakBonus,
            balance: newBalance,
          })
          .code(200);
      },
    });
  },
};
