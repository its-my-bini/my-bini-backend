import { prisma } from "../db/prisma";
import { type MemoryType, Prisma } from "@prisma/client";

// ─── Types ───────────────────────────────────────────

export interface ChatContext {
  persona: {
    name: string;
    type: string;
    system_prompt: string;
    age: number;
    birthday: string;
    hobbies: string[];
    likes: string[];
    dislikes: string[];
    background: string;
  };
  userName: string | null;
  relationship: {
    intimacy_level: number;
    status: string;
  };
  profileMemory: Record<string, unknown> | null;
  relationshipMemory: Record<string, unknown> | null;
  summaryMemory: Record<string, unknown> | null;
  recentMessages: Array<{
    role: string;
    content: string;
  }>;
}

// ─── Get Full Context ────────────────────────────────

export async function getContext(
  userId: string,
  personaId: string,
): Promise<ChatContext> {
  // Fetch all in parallel
  const [persona, user, relationship, memories, recentMessages] =
    await Promise.all([
      prisma.persona.findUnique({ where: { id: personaId } }),
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.relationship.findUnique({
        where: {
          user_id_persona_id: { user_id: userId, persona_id: personaId },
        },
      }),
      prisma.memory.findMany({
        where: { user_id: userId, persona_id: personaId },
      }),
      prisma.message.findMany({
        where: {
          user_id: userId,
          persona_id: personaId,
          deleted_at: null,
        },
        orderBy: { created_at: "desc" },
        take: 15,
        select: { role: true, content: true },
      }),
    ]);

  if (!persona) {
    throw new Error("Persona not found");
  }

  const profileMemory = memories.find((m: any) => m.type === "profile");
  const relationshipMemory = memories.find(
    (m: any) => m.type === "relationship",
  );
  const summaryMemory = memories.find((m: any) => m.type === "summary");

  return {
    persona: {
      name: persona.name,
      type: persona.type,
      system_prompt: persona.system_prompt,
      age: persona.age,
      birthday: persona.birthday,
      hobbies: persona.hobbies,
      likes: persona.likes,
      dislikes: persona.dislikes,
      background: persona.background,
    },
    userName: user?.name ?? null,
    relationship: {
      intimacy_level: relationship?.intimacy_level ?? 0,
      status: relationship?.status ?? "stranger",
    },
    profileMemory:
      (profileMemory?.content_json as Record<string, unknown> | null) ?? null,
    relationshipMemory:
      (relationshipMemory?.content_json as Record<string, unknown> | null) ??
      null,
    summaryMemory:
      (summaryMemory?.content_json as Record<string, unknown> | null) ?? null,
    recentMessages: recentMessages.reverse(), // Chronological order
  };
}

// ─── Update Memory ───────────────────────────────────

export async function updateMemory(
  userId: string,
  personaId: string,
  type: MemoryType,
  data: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.memory.upsert({
    where: {
      user_id_persona_id_type: {
        user_id: userId,
        persona_id: personaId,
        type,
      },
    },
    create: {
      user_id: userId,
      persona_id: personaId,
      type,
      content_json: data,
    },
    update: {
      content_json: data,
    },
  });
}

// ─── Extract Profile Info from AI Response ───────────

export async function extractAndUpdateProfile(
  userId: string,
  personaId: string,
  userMessage: string,
): Promise<void> {
  // Simple extraction patterns for profile info
  const currentProfile = await prisma.memory.findUnique({
    where: {
      user_id_persona_id_type: {
        user_id: userId,
        persona_id: personaId,
        type: "profile",
      },
    },
  });

  const profile =
    (currentProfile?.content_json as Record<string, unknown>) ?? {};
  const lowerMsg = userMessage.toLowerCase();

  // Name detection
  const namePatterns = [
    /my name is (\w+)/i,
    /i'm (\w+)/i,
    /call me (\w+)/i,
    /i am (\w+)/i,
  ];
  for (const pat of namePatterns) {
    const match = lowerMsg.match(pat);
    if (match?.[1]) {
      profile.name = match[1];
      break;
    }
  }

  // Job detection
  const jobPatterns = [
    /i work as (?:a |an )?(.+?)(?:\.|,|$)/i,
    /i'm (?:a |an )?(.+?) (?:at|in|for)/i,
    /my job is (.+?)(?:\.|,|$)/i,
  ];
  for (const pat of jobPatterns) {
    const match = userMessage.match(pat);
    if (match?.[1]) {
      profile.job = match[1].trim();
      break;
    }
  }

  // Only update if we found something
  if (Object.keys(profile).length > 0) {
    await updateMemory(
      userId,
      personaId,
      "profile",
      profile as Prisma.InputJsonValue,
    );
  }
}
