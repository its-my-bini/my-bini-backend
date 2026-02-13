import type { Plugin, Request, ResponseToolkit } from "@hapi/hapi";
import Boom from "@hapi/boom";
import Joi from "joi";
import { prisma } from "../db/prisma";
import { getAuthUser } from "./auth";
import {
  getContext,
  extractAndUpdateProfile,
} from "../services/memory.service";
import {
  reserveTokens,
  commitDeduction,
  rollbackTokens,
  getChatCost,
} from "../services/token.service";
import { updateIntimacy, trackUsage } from "../services/relationship.service";
import { chatCompletion } from "../services/ai.service";
import { buildPrompt } from "../utils/promptBuilder";
import { checkRateLimit } from "../utils/rateLimiter";
import { pushSummaryJob } from "../services/summary.worker";

// ─── Chat Plugin ─────────────────────────────────────

export const chatRoutes: Plugin<void> = {
  name: "chat-routes",
  version: "1.0.0",
  register: async (server) => {
    // ─── POST /chat ──────────────────────────────────
    server.route({
      method: "POST",
      path: "/chat",
      options: {
        validate: {
          headers: Joi.object({
            "x-wallet-address": Joi.string().required(),
          }).unknown(),
          payload: Joi.object({
            persona_id: Joi.string().required(),
            message: Joi.string().min(1).max(2000).required(),
          }),
        },
        tags: ["api", "chat"],
        description: "Send a chat message to AI girlfriend",
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);
        const { persona_id, message } = request.payload as {
          persona_id: string;
          message: string;
        };
        const streamRequest = request.query.stream === "true";

        if (streamRequest) {
          const { PassThrough } = await import("stream");
          const stream = new PassThrough();
          const send = (data: any) => stream.write(JSON.stringify(data) + "\n");

          (async () => {
            try {
              // Status: Sent (Request received)
              send({ type: "status", status: "sent", timestamp: new Date() });

              // 1. Rate limit check
              const rateCheck = await checkRateLimit(user.id);
              if (!rateCheck.allowed) {
                send({
                  type: "error",
                  error: `Rate limit exceeded. Try again in ${rateCheck.resetIn} seconds.`,
                });
                stream.end();
                return;
              }

              // 2. Check user has selected this persona
              const userPersona = await prisma.userPersona.findUnique({
                where: {
                  user_id_persona_id: {
                    user_id: user.id,
                    persona_id,
                  },
                },
              });
              if (!userPersona) {
                send({
                  type: "error",
                  error: "You haven't selected this persona yet.",
                });
                stream.end();
                return;
              }

              // 3. Get chat cost
              const chatCost = await getChatCost();

              // 4. Reserve tokens
              const reserved = await reserveTokens(user.id, chatCost);
              if (!reserved) {
                send({
                  type: "error",
                  error: "Insufficient token balance.",
                });
                stream.end();
                return;
              }

              try {
                // 5. Save user message
                const userMsg = await prisma.message.create({
                  data: {
                    user_id: user.id,
                    persona_id,
                    role: "user",
                    content: message,
                  },
                });

                // Status: Read (Processing context)
                send({ type: "status", status: "read", timestamp: new Date() });

                // 6. Get full context
                console.time("Context Generation");
                const context = await getContext(user.id, persona_id);
                console.timeEnd("Context Generation");

                // 7. Build prompt
                const promptMessages = buildPrompt(context, message);

                // Status: Typing (Calling AI)
                send({
                  type: "status",
                  status: "typing",
                  timestamp: new Date(),
                });

                // 8. Send to GLM
                console.time("AI Generation (GLM)");
                const aiResponse = await chatCompletion(promptMessages);
                console.timeEnd("AI Generation (GLM)");

                // 9. Success path
                console.time("DB Writes");
                const aiMsg = await prisma.message.create({
                  data: {
                    user_id: user.id,
                    persona_id,
                    role: "ai",
                    content: aiResponse,
                  },
                });

                await commitDeduction(user.id, chatCost);
                const relationship = await updateIntimacy(
                  user.id,
                  persona_id,
                  1,
                );
                await trackUsage(user.id, chatCost);
                console.timeEnd("DB Writes");

                // Background tasks
                extractAndUpdateProfile(user.id, persona_id, message).catch(
                  (err) => console.error("[ProfileExtract] Error:", err),
                );
                pushSummaryJob(user.id, persona_id).catch((err) =>
                  console.error("[SummaryJob] Error:", err),
                );

                // Final Message
                send({
                  type: "message",
                  data: {
                    user_message: {
                      id: userMsg.id,
                      content: userMsg.content,
                      created_at: userMsg.created_at,
                    },
                    ai_message: {
                      id: aiMsg.id,
                      content: aiResponse,
                      created_at: aiMsg.created_at,
                    },
                    relationship: {
                      intimacy_level: relationship.intimacy_level,
                      status: relationship.status,
                    },
                    rate_limit: {
                      remaining: rateCheck.remaining,
                    },
                  },
                });
              } catch (error) {
                await rollbackTokens(user.id, chatCost);
                console.error("[Chat] Error:", error);
                send({
                  type: "error",
                  error:
                    error instanceof Error ? error.message : "Internal Error",
                });
              } finally {
                stream.end();
              }
            } catch (outerError) {
              console.error("[ChatStream] Outer Error:", outerError);
              stream.end();
            }
          })();

          return h.response(stream).type("application/x-ndjson");
        }

        // ─── Standard Response (Non-Streaming) ───

        // 1. Rate limit check
        const rateCheck = await checkRateLimit(user.id);
        if (!rateCheck.allowed) {
          throw Boom.tooManyRequests(
            `Rate limit exceeded. Try again in ${rateCheck.resetIn} seconds.`,
          );
        }

        // 2. Check user has selected this persona
        const userPersona = await prisma.userPersona.findUnique({
          where: {
            user_id_persona_id: {
              user_id: user.id,
              persona_id,
            },
          },
        });
        if (!userPersona) {
          throw Boom.badRequest(
            "You haven't selected this persona yet. Use POST /user/select-persona first.",
          );
        }

        // 3. Get chat cost
        const chatCost = await getChatCost();

        // 4. Reserve tokens
        const reserved = await reserveTokens(user.id, chatCost);
        if (!reserved) {
          throw Boom.paymentRequired(
            "Insufficient token balance. Please top up to continue chatting.",
          );
        }

        try {
          // 5. Save user message
          const userMsg = await prisma.message.create({
            data: {
              user_id: user.id,
              persona_id,
              role: "user",
              content: message,
            },
          });

          // 6. Get full context (persona, memories, recent chats)
          console.time("Context Generation");
          const context = await getContext(user.id, persona_id);
          console.timeEnd("Context Generation");

          // 7. Build prompt
          const promptMessages = buildPrompt(context, message);

          // 8. Send to GLM
          console.time("AI Generation (GLM)");
          const aiResponse = await chatCompletion(promptMessages);
          console.timeEnd("AI Generation (GLM)");

          // 9. Success path
          // Save AI response
          console.time("DB Writes");
          const aiMsg = await prisma.message.create({
            data: {
              user_id: user.id,
              persona_id,
              role: "ai",
              content: aiResponse,
            },
          });

          // Commit token deduction
          await commitDeduction(user.id, chatCost);

          // Update intimacy (+1 per message)
          const relationship = await updateIntimacy(user.id, persona_id, 1);

          // Track usage
          await trackUsage(user.id, chatCost);
          console.timeEnd("DB Writes");

          // Extract profile info from user message (async, non-blocking)
          extractAndUpdateProfile(user.id, persona_id, message).catch((err) =>
            console.error("[ProfileExtract] Error:", err),
          );

          // Push summary job (async, non-blocking)
          pushSummaryJob(user.id, persona_id).catch((err) =>
            console.error("[SummaryJob] Error:", err),
          );

          return h
            .response({
              success: true,
              data: {
                user_message: {
                  id: userMsg.id,
                  content: userMsg.content,
                  created_at: userMsg.created_at,
                },
                ai_message: {
                  id: aiMsg.id,
                  content: aiResponse,
                  created_at: aiMsg.created_at,
                },
                relationship: {
                  intimacy_level: relationship.intimacy_level,
                  status: relationship.status,
                },
                rate_limit: {
                  remaining: rateCheck.remaining,
                },
              },
            })
            .code(200);
        } catch (error) {
          // 10. Failure path: rollback tokens
          await rollbackTokens(user.id, chatCost);

          console.error("[Chat] Error:", error);

          if (error instanceof Error && error.message.includes("GLM")) {
            throw Boom.serverUnavailable(
              "AI service is temporarily unavailable. Your tokens have been refunded.",
            );
          }

          throw Boom.internal("Chat failed. Your tokens have been refunded.");
        }
      },
    });

    // ─── GET /chat/history ───────────────────────────
    server.route({
      method: "GET",
      path: "/chat/history",
      options: {
        validate: {
          headers: Joi.object({
            "x-wallet-address": Joi.string().required(),
          }).unknown(),
          query: Joi.object({
            persona_id: Joi.string().required(),
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(50),
          }),
        },
        tags: ["api", "chat"],
        description: "Get chat history with a persona",
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);
        const { persona_id, page, limit } = request.query as {
          persona_id: string;
          page: number;
          limit: number;
        };

        const skip = (page - 1) * limit;

        const [messages, total] = await Promise.all([
          prisma.message.findMany({
            where: {
              user_id: user.id,
              persona_id,
              deleted_at: null,
            },
            orderBy: { created_at: "desc" },
            skip,
            take: limit,
            select: {
              id: true,
              role: true,
              content: true,
              created_at: true,
            },
          }),
          prisma.message.count({
            where: {
              user_id: user.id,
              persona_id,
              deleted_at: null,
            },
          }),
        ]);

        return h
          .response({
            success: true,
            data: {
              messages: messages.reverse(), // Chronological order
              pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit),
              },
            },
          })
          .code(200);
      },
    });
  },
};
