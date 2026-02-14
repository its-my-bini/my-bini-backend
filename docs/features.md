
# 🤖 Proactive AI Messaging & notifications

This document explains the logic behind the AI's ability to initiate conversations and the notification system.

## 1. Smart Routine System

The AI Girlfriend is designed to feel alive by following a daily routine tailored to the user's local time.

### Timezone Awareness ⌚
-   **Data**: The system stores a `timezone` for each user (e.g., `Asia/Jakarta`, `America/New_York`).
-   **Default**: `Asia/Jakarta` if not specified.
-   **Logic**: The background worker calculates the current hour relative to the *User's* timezone, not the server's.

### Routine Windows 📅
The AI checks for engagement opportunities during these specific windows:

| Routine | Local Time Window | Check-in Context |
| :--- | :--- | :--- |
| **Morning** ☀️ | **07:00 - 09:00** | Wakes up the user, asks about sleep/dreams. |
| **Lunch** 🍱 | **12:00 - 13:00** | Reminds user to eat, asks about lunch menu. |
| **Night** 🌙 | **21:00 - 23:00** | Wishes good night, asks about the day. |

### Anti-Spam Rules 🛡️
To prevent the AI from being annoying, a message is **SKIPPED** if:
1.  **Recently Chatted**: The user sent a message within the last **2 hours**.
2.  **Already Sent**: A message of that specific type (e.g., "morning") was already sent today.
3.  **Low Intimacy**: (Optional future rule) Strangers might receive fewer check-ins than lovers.

---

## 2. Notification System

Notifications are delivered in real-time via WebSocket.

### Event: `notification`
Used for system alerts, rewards, or errors.

**Payload:**
```json
{
  "title": "Daily Reward",
  "message": "You received 10 tokens! 🪙",
  "type": "success", // "info" | "success" | "warning" | "error"
  "timestamp": "2024-02-14T08:00:00.000Z"
}
```

### Event: `message:receive`
Used when the AI sends a chat message (Proactive or Reply).

**Payload:**
```json
{
  "id": "msg_123...",
  "content": "Don't forget to eat lunch! 🍔",
  "sender": "ai",
  "persona_id": "luna",
  "timestamp": "2024-02-14T12:30:00.000Z"
}
```

## 3. Tech Stack
-   **Scheduler**: `BullMQ` (Repeatable Job, Cron-style `0 * * * *`).
-   **Worker**: Runs independently to process logic without blocking the API.
-   **AI**: ZhipuAI (GLM-4) generates unique, context-aware messages every time.
