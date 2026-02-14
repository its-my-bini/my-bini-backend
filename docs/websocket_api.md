
# WebSocket API Documentation

The backend uses [Socket.IO](https://socket.io/) for real-time updates.

## Connection

-   **URL**: `http://localhost:8000` (Local) / `https://your-ngrok-url.ngrok-free.app` (Public)
-   **Path**: Default `/socket.io/`

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:8000");

socket.on("connect", () => {
  console.log("Connected:", socket.id);
});
```

## Client -> Server Events

### 1. Join Room
After connecting, the client **MUST** emit this event to identify the user and subscribe to private updates (balance, notifications).

-   **Event**: `join`
-   **Payload**: `walletAddress` (string)

```javascript
// Example
const walletAddress = "0x1234567890123456789012345678901234567890";
socket.emit("join", walletAddress);
```

### 2. Typing Indicator
Send this event when the user is typing a message to a persona.

-   **Event**: `typing`
-   **Payload**: `isTyping` (boolean)

```javascript
// User starts typing
socket.emit("typing", true);

// User stops typing
socket.emit("typing", false);
```

## Server -> Client Events

### 1. Balance Update
Triggered when the user's token balance changes (e.g., after deposit, withdrawal, or daily reward).

-   **Event**: `balance:update`
-   **Payload**:
    ```json
    {
      "balance": 100,
      "timestamp": "2023-10-27T10:00:00.000Z"
    }
    ```

### 2. Notification
System notifications for the user.

-   **Event**: `notification`
-   **Payload**:
    ```json
    {
      "title": "Daily Reward",
      "message": "You received 10 tokens!",
      "type": "success", // "info" | "success" | "warning" | "error"
      "timestamp": "2023-10-27T10:00:00.000Z"
    }
    ```

### 3. Incoming Message (Proactive/Chat)
Received when the AI sends a message (e.g., proactive daily check-in).

-   **Event**: `message:receive`
-   **Payload**:
    ```json
    {
      "id": "uuid-v4",
      "content": "Good morning! ☀️",
      "sender": "ai",
      "persona_id": "luna",
      "timestamp": "2023-10-27T08:00:00.000Z"
    }
    ```

### 4. Typing Indicator (Broadcast)
Received when another device (or potentially the AI agent in future updates) is typing.

-   **Event**: `typing`
-   **Payload**: `isTyping` (boolean)

## Usage Example (React)

```javascript
useEffect(() => {
  if (!socket) return;

  // Listen for balance updates
  socket.on("balance:update", (data) => {
    console.log("New Balance:", data.balance);
    setBalance(data.balance);
  });

  // Listen for notifications
  socket.on("notification", (data) => {
    toast[data.type](data.message);
  });

  return () => {
    socket.off("balance:update");
    socket.off("notification");
  };
}, [socket]);
```
