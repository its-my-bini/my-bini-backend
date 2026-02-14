import type { Plugin, Request, ResponseToolkit } from "@hapi/hapi";
import Boom from "@hapi/boom";
import Joi from "joi";
import { prisma } from "../db/prisma";
import { ensureBalance } from "../services/token.service";
import { verifyMessage } from "viem";

// ─── Auth Helper: Extract user from wallet address header ──

export async function getAuthUser(request: Request) {
  const walletAddress = request.headers["x-wallet-address"] as string;
  if (!walletAddress) {
    throw Boom.unauthorized("Missing x-wallet-address header");
  }

  const user = await prisma.user.findUnique({
    where: { wallet_address: walletAddress.toLowerCase() },
  });

  if (!user) {
    throw Boom.unauthorized("User not found. Please login first.");
  }

  return user;
}

// ─── Auth Plugin ─────────────────────────────────────

export const authRoutes: Plugin<void> = {
  name: "auth-routes",
  version: "1.0.0",
  register: async (server) => {
    // POST /auth/wallet-login
    server.route({
      method: "POST",
      path: "/auth/wallet-login",
      options: {
        validate: {
          payload: Joi.object({
            wallet_address: Joi.string().required(),
            signature: Joi.string().optional(),
            message: Joi.string().optional(),
            name: Joi.string().optional(),
            timezone: Joi.string().optional().default("Asia/Jakarta"),
          }),
        },
        tags: ["api", "auth"],
        description: "Login or register with wallet address",
        response: {
          schema: Joi.object({
            success: Joi.boolean(),
            user: Joi.object({
              id: Joi.string(),
              wallet_address: Joi.string(),
              name: Joi.string().allow(null),
              timezone: Joi.string(),
              created_at: Joi.date(),
              token_balance: Joi.number(),
            }),
          }).label("WalletLoginResponse"),
        },
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const { wallet_address, signature, message, name, timezone } =
          request.payload as {
            wallet_address: string;
            signature?: string;
            message?: string;
            name?: string;
            timezone?: string;
          };

        const normalizedAddress = wallet_address.toLowerCase();

        // Optional: Verify EIP-191 signature if provided
        // Ignore "string" placeholder from Swagger UI
        if (
          signature &&
          message &&
          signature !== "string" &&
          message !== "string"
        ) {
          try {
            const valid = await verifyMessage({
              address: normalizedAddress as `0x${string}`,
              message,
              signature: signature as `0x${string}`,
            });

            if (!valid) {
              throw Boom.unauthorized("Invalid signature");
            }
          } catch {
            throw Boom.unauthorized("Signature verification failed");
          }
        }

        // Upsert user
        const user = await prisma.user.upsert({
          where: { wallet_address: normalizedAddress },
          create: { wallet_address: normalizedAddress, name, timezone },
          update: {
            ...(name ? { name } : {}),
            ...(timezone ? { timezone } : {}),
          },
        });

        // Ensure balance exists
        await ensureBalance(user.id);

        // Get balance
        const balance = await prisma.balance.findUnique({
          where: { user_id: user.id },
        });

        return h
          .response({
            success: true,
            user: {
              id: user.id,
              wallet_address: user.wallet_address,
              name: user.name,
              timezone: user.timezone,
              created_at: user.created_at,
              token_balance: balance?.token_balance ?? 0,
            },
          })
          .code(200);
      },
    });

    // GET /user/profile
    server.route({
      method: "GET",
      path: "/user/profile",
      options: {
        tags: ["api", "auth"],
        description: "Get user profile with balances and relationships",
        response: {
          schema: Joi.object({
            success: Joi.boolean(),
            profile: Joi.object({
              id: Joi.string(),
              wallet_address: Joi.string(),
              name: Joi.string().allow(null),
              created_at: Joi.date(),
              token_balance: Joi.number(),
              personas: Joi.array().items(
                Joi.object({
                  id: Joi.string(),
                  name: Joi.string(),
                  type: Joi.string(),
                  selected_at: Joi.date(),
                }),
              ),
              relationships: Joi.array().items(
                Joi.object({
                  persona_id: Joi.string(),
                  persona_name: Joi.string(),
                  persona_type: Joi.string(),
                  persona_age: Joi.number(),
                  persona_birthday: Joi.string(),
                  persona_hobbies: Joi.array().items(Joi.string()),
                  persona_likes: Joi.array().items(Joi.string()),
                  persona_dislikes: Joi.array().items(Joi.string()),
                  persona_background: Joi.string(),
                  intimacy_level: Joi.number(),
                  status: Joi.string(),
                  last_interaction: Joi.date(),
                  last_message: Joi.string(),
                  last_message_at: Joi.date(),
                }),
              ),
            }),
          }).label("UserProfileResponse"),
        },
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);

        const [balance, relationships, userPersonas] = await Promise.all([
          prisma.balance.findUnique({ where: { user_id: user.id } }),
          prisma.relationship.findMany({
            where: { user_id: user.id },
            include: {
              persona: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  age: true,
                  birthday: true,
                  hobbies: true,
                  likes: true,
                  dislikes: true,
                  background: true,
                },
              },
            },
          }),
          prisma.userPersona.findMany({
            where: { user_id: user.id },
            include: { persona: true },
          }),
        ]);

        // Fetch last message for each relationship
        const relationshipsWithLastMessage = await Promise.all(
          relationships.map(async (r) => {
            const lastMsg = await prisma.message.findFirst({
              where: {
                user_id: user.id,
                persona_id: r.persona_id,
              },
              orderBy: { created_at: "desc" },
              select: { content: true, created_at: true },
            });

            return {
              persona_id: r.persona.id,
              persona_name: r.persona.name,
              persona_type: r.persona.type,
              persona_age: r.persona.age,
              persona_birthday: r.persona.birthday,
              persona_hobbies: r.persona.hobbies,
              persona_likes: r.persona.likes,
              persona_dislikes: r.persona.dislikes,
              persona_background: r.persona.background,
              intimacy_level: r.intimacy_level,
              status: r.status,
              last_interaction: r.last_interaction,
              last_message: lastMsg?.content || "No messages yet",
              last_message_at: lastMsg?.created_at || r.last_interaction,
            };
          }),
        );

        return h
          .response({
            success: true,
            profile: {
              id: user.id,
              wallet_address: user.wallet_address,
              name: user.name,
              created_at: user.created_at,
              token_balance: balance?.token_balance ?? 0,
              personas: userPersonas.map((up) => ({
                id: up.persona.id,
                name: up.persona.name,
                type: up.persona.type,
                selected_at: up.created_at,
              })),
              relationships: relationshipsWithLastMessage,
            },
          })
          .code(200);
      },
    });
  },
};
