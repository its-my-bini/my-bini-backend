import type { ChatContext } from "../services/memory.service";

// ─── Types ───────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Build System Prompt ─────────────────────────────

function buildSystemPrompt(context: ChatContext): string {
  const {
    persona,
    relationship,
    profileMemory,
    relationshipMemory,
    summaryMemory,
  } = context;

  let systemPrompt = persona.system_prompt;

  // ─── Build Dynamic Profile ───
  const profileSection = [
    `\nPROFILE:`,
    `- Age: ${persona.age}`,
    `- Birthday: ${persona.birthday}`,
    `- Hobbies: ${persona.hobbies.join(", ")}`,
    `- Likes: ${persona.likes.join(", ")}`,
    `- Dislikes: ${persona.dislikes.join(", ")}`,
    `- Background: ${persona.background}`,
    `\n`,
  ].join("\n");

  // Insert profile after the first line (introduction)
  const firstLineEnd = systemPrompt.indexOf("\n");
  if (firstLineEnd !== -1) {
    systemPrompt =
      systemPrompt.slice(0, firstLineEnd) +
      `\n${profileSection}` +
      systemPrompt.slice(firstLineEnd);
  } else {
    systemPrompt += `\n${profileSection}`;
  }

  // Add relationship context
  systemPrompt += `\n\n--- RELATIONSHIP STATUS ---`;
  if (context.userName) {
    systemPrompt += `\nUser's Name: ${context.userName}`;
  }
  systemPrompt += `\nYour relationship with the user is: ${relationship.status} (intimacy: ${relationship.intimacy_level}/100)`;

  // Adapt behavior based on intimacy level
  if (relationship.status === "stranger") {
    systemPrompt += `\nYou just met this person. Be friendly but not too forward. Get to know them.`;
  } else if (relationship.status === "friend") {
    systemPrompt += `\nYou're friends now. Be warmer, remember things about them, and show genuine interest.`;
  } else if (relationship.status === "close") {
    systemPrompt += `\nYou're very close. Use more affectionate language, share personal thoughts, and be protective.`;
  } else if (relationship.status === "lover") {
    systemPrompt += `\nYou're deeply in love. Be romantic, sweet, and deeply caring. Use pet names naturally.`;
  }

  // Add profile memory
  if (profileMemory && Object.keys(profileMemory).length > 0) {
    systemPrompt += `\n\n--- WHAT YOU KNOW ABOUT THE USER ---`;
    for (const [key, value] of Object.entries(profileMemory)) {
      systemPrompt += `\n- ${key}: ${value}`;
    }
  }

  // Add relationship memory
  if (relationshipMemory && Object.keys(relationshipMemory).length > 0) {
    systemPrompt += `\n\n--- RELATIONSHIP MEMORIES ---`;
    for (const [key, value] of Object.entries(relationshipMemory)) {
      systemPrompt += `\n- ${key}: ${value}`;
    }
  }

  // Add conversation summary
  if (summaryMemory) {
    const summary = (summaryMemory as Record<string, unknown>).summary;
    if (summary) {
      systemPrompt += `\n\n--- PREVIOUS CONVERSATION SUMMARY ---`;
      systemPrompt += `\n${summary}`;
    }
  }

  // General instructions
  systemPrompt += `\n\n--- INSTRUCTIONS ---`;
  systemPrompt += `\n- Always respond in English`;
  systemPrompt += `\n- Stay in character at all times`;
  systemPrompt += `\n- Keep responses concise (1-3 paragraphs max)`;
  systemPrompt += `\n- React naturally to what the user says`;
  systemPrompt += `\n- Never break character or mention you are an AI`;
  systemPrompt += `\n- Use appropriate emojis occasionally`;

  return systemPrompt;
}

// ─── Build Full Prompt ───────────────────────────────

export function buildPrompt(
  context: ChatContext,
  userMessage: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // System prompt
  messages.push({
    role: "system",
    content: buildSystemPrompt(context),
  });

  // Recent messages for context
  for (const msg of context.recentMessages) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  // Current user message
  messages.push({
    role: "user",
    content: userMessage,
  });

  return messages;
}
