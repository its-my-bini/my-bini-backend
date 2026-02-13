import type { Plugin, Request, ResponseToolkit } from "@hapi/hapi";
import Boom from "@hapi/boom";
import Joi from "joi";
import { prisma } from "../db/prisma";
import { getAuthUser } from "./auth";

// ─── Persona Plugin ──────────────────────────────────

export const personaRoutes: Plugin<void> = {
  name: "persona-routes",
  version: "1.0.0",
  register: async (server) => {
    // GET /personas
    server.route({
      method: "GET",
      path: "/personas",
      options: {
        tags: ["api", "persona"],
        description: "List all available personas",
        response: {
          schema: Joi.object({
            success: Joi.boolean(),
            personas: Joi.array().items(
              Joi.object({
                id: Joi.string(),
                name: Joi.string(),
                type: Joi.string(),
                description: Joi.string(),
                age: Joi.number(),
                birthday: Joi.string(),
                hobbies: Joi.array().items(Joi.string()),
                likes: Joi.array().items(Joi.string()),
                dislikes: Joi.array().items(Joi.string()),
                background: Joi.string(),
              }),
            ),
          }).label("PersonasListResponse"),
        },
      },
      handler: async (_request: Request, h: ResponseToolkit) => {
        const personas = await prisma.persona.findMany({
          select: {
            id: true,
            name: true,
            type: true,
            description: true,
            age: true,
            birthday: true,
            hobbies: true,
            likes: true,
            dislikes: true,
            background: true,
          },
        });

        return h
          .response({
            success: true,
            personas,
          })
          .code(200);
      },
    });

    // POST /user/select-persona
    server.route({
      method: "POST",
      path: "/user/select-persona",
      options: {
        validate: {
          headers: Joi.object({
            "x-wallet-address": Joi.string().required(),
          }).unknown(),
          payload: Joi.object({
            persona_id: Joi.string().required(),
          }),
        },
        tags: ["api", "persona"],
        description: "Select a persona to chat with",
        response: {
          schema: Joi.object({
            success: Joi.boolean(),
            message: Joi.string(),
            persona: Joi.object({
              id: Joi.string(),
              name: Joi.string(),
              type: Joi.string(),
              description: Joi.string(),
              age: Joi.number(),
              birthday: Joi.string(),
              hobbies: Joi.array().items(Joi.string()),
              likes: Joi.array().items(Joi.string()),
              dislikes: Joi.array().items(Joi.string()),
              background: Joi.string(),
            }),
          }).label("SelectPersonaResponse"),
        },
      },
      handler: async (request: Request, h: ResponseToolkit) => {
        const user = await getAuthUser(request);
        const { persona_id } = request.payload as { persona_id: string };

        // Check persona exists
        const persona = await prisma.persona.findUnique({
          where: { id: persona_id },
        });
        if (!persona) {
          throw Boom.notFound("Persona not found");
        }

        // Create user-persona mapping (idempotent)
        await prisma.userPersona.upsert({
          where: {
            user_id_persona_id: {
              user_id: user.id,
              persona_id,
            },
          },
          create: {
            user_id: user.id,
            persona_id,
          },
          update: {},
        });

        // Create relationship if not exists
        await prisma.relationship.upsert({
          where: {
            user_id_persona_id: {
              user_id: user.id,
              persona_id,
            },
          },
          create: {
            user_id: user.id,
            persona_id,
            intimacy_level: 0,
            status: "stranger",
          },
          update: {},
        });

        return h
          .response({
            success: true,
            message: `You are now connected with ${persona.name}!`,
            persona: {
              id: persona.id,
              name: persona.name,
              type: persona.type,
              description: persona.description,
              age: persona.age,
              birthday: persona.birthday,
              hobbies: persona.hobbies,
              likes: persona.likes,
              dislikes: persona.dislikes,
              background: persona.background,
            },
          })
          .code(200);
      },
    });
  },
};
