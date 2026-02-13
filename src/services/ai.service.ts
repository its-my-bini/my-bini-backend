// ─── GLM AI Service (OpenAI-compatible) ──────────────

const GLM_API_KEY = process.env.GLM_API_KEY || "";
const GLM_BASE_URL = process.env.GLM_BASE_URL || "https://ai.sumopod.com";
const GLM_MODEL = process.env.GLM_MODEL || "deepseek-v3-2-251201";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GLMResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Chat Completion ─────────────────────────────────

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  if (!GLM_API_KEY || GLM_API_KEY === "your-zhipuai-api-key") {
    throw new Error("GLM_API_KEY is not configured. Set it in your .env file.");
  }

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(`${GLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: GLM_MODEL,
          messages,
          temperature: 0.85,
          top_p: 0.9,
          max_tokens: 512,
        }),
      });

      if (response.status === 429) {
        console.warn(
          `[GLM] Rate limit exceeded. Retrying in ${2 ** attempt}s...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 2000 * 2 ** attempt),
        );
        attempt++;
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[GLM] API Error:", response.status, errorText);
        throw new Error(`GLM API error: ${response.status}`);
      }

      const data = (await response.json()) as GLMResponse;

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from GLM");
      }

      return content;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      console.warn(
        `[GLM] Request failed. Retrying... (${attempt + 1}/${maxRetries})`,
      );
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }

  throw new Error("Max retries exceeded for GLM API");
}

// ─── Summarize Conversation ──────────────────────────

export async function summarizeConversation(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const formattedChat = messages
    .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
    .join("\n");

  const summaryMessages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a conversation summarizer. Summarize the following conversation between a user and their AI girlfriend. Focus on:
1. Key topics discussed
2. Important personal information shared by the user
3. Emotional moments or relationship milestones
4. Any promises or plans made
Be concise but capture all important details. Write in third person.`,
    },
    {
      role: "user",
      content: `Summarize this conversation:\n\n${formattedChat}`,
    },
  ];

  return chatCompletion(summaryMessages);
}
