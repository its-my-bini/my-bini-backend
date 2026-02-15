# My Bini Backend

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI companion agent backend server with autonomous workers for the Monad blockchain. This backend powers an AI dating/companion app with blockchain-based token economy, real-time messaging, and autonomous engagement features.

## Tech Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| **Bun** | JavaScript runtime | >= 1.0 |
| **Hapi.js** | HTTP server framework | v21 |
| **Prisma** | PostgreSQL ORM | v6 |
| **BullMQ** | Redis-based queue | v5 |
| **IORedis** | Redis client | v5 |
| **Socket.io** | Real-time WebSocket | v4 |
| **Viem** | Ethereum/Monad blockchain interaction | v2 |
| **DeepSeek v3** | AI model via OpenAI-compatible API | v3 |
| **Luxon** | Timezone management | v3 |
| **Joi** | Schema validation | v18 |
| **Hapi Swagger** | API documentation | v17 |

## Project Structure

```
my-bini-backend/
├── src/
│   ├── server.ts              # Application entry point
│   ├── routes/
│   │   ├── auth.ts            # Wallet authentication
│   │   ├── chat.ts            # Chat messaging endpoints
│   │   ├── persona.ts         # AI persona management
│   │   └── token.ts           # Token balance & transactions
│   ├── services/
│   │   ├── ai.service.ts      # DeepSeek AI integration
│   │   ├── memory.service.ts  # Conversation memory management
│   │   ├── relationship.service.ts  # User-persona relationships
│   │   ├── token.service.ts   # Token economy logic
│   │   ├── socket.service.ts  # WebSocket event handlers
│   │   ├── engagement.worker.ts  # Autonomous proactive messaging
│   │   ├── summary.worker.ts  # Auto conversation summarization
│   │   └── cron.service.ts    # Scheduled job orchestration
│   └── db/
│       ├── prisma.ts          # Prisma client instance
│       └── redis.ts           # Redis client instance
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── seed.ts                # Database seeder
│   └── migrations/            # Database migration files
└── package.json
```

## Prerequisites

Before setting up the project, ensure you have:

- **Bun** >= 1.0 ([Installation guide](https://bun.sh))
- **PostgreSQL** >= 14
- **Redis** >= 6
- **Monad RPC URL** (testnet: `https://testnet-rpc.monad.xyz`)

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/its-my-bini/my-bini-backend.git
cd my-bini-backend
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
# Edit .env with your values
```

**Environment Variables:**

```env
DATABASE_URL="your_database_url"
GLM_API_KEY="your-api-key"
GLM_BASE_URL="https://ai.sumopod.com"
GLM_MODEL="deepseek-v3-2-251201"
REDIS_URL="redis://localhost:6379"
MONAD_RPC_URL="https://rpc.monad.xyz"
MONAD_TREASURY_ADDRESS="0x26f942e7c1D1F45c575649ed386C2fef68C06a8c"
SERVER_PORT=8000
```

### 4. Setup Database

```bash
# Generate Prisma client
bun run db:generate

# Run migrations
bun run db:migrate

# Seed database with personas
bun run db:seed
```

### 5. Run Development Server

```bash
bun run dev
```

The server will start at `http://localhost:8000` with API documentation available at `/documentation`.

### 6. Production

```bash
bun run start
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start development server with watch mode |
| `bun run start` | Start production server |
| `bun run build` | Build for production |
| `bun run db:migrate` | Run Prisma migrations |
| `bun run db:generate` | Generate Prisma client |
| `bun run db:seed` | Seed database with personas |
| `bun run db:studio` | Open Prisma Studio GUI |

## Database Schema

The application uses PostgreSQL with the following main models:

- **User** — Wallet-authenticated users with timezone preferences
- **Persona** — AI personalities with system prompts, traits, and backgrounds
- **UserPersona** — User-to-persona relationships (many-to-many)
- **Relationship** — Intimacy levels and relationship status tracking
- **Message** — Chat message history (user and AI)
- **Memory** — Three types:
  - `profile` — User profile information extracted from conversations
  - `relationship` — Relationship dynamics and milestones
  - `summary` — Auto-generated conversation summaries
- **Balance** — User token balances
- **Transaction** — Token transaction history (chat costs, deposits, rewards, withdrawals)
- **UsageLog** — Daily usage tracking (messages sent, tokens consumed)
- **AppConfig** — Application configuration key-value store

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/wallet-login` | Authenticate user via wallet address |
| GET | `/user/profile` | Get user profile and settings |
| GET | `/personas` | List all available AI personas |
| POST | `/user/select-persona` | Select/unlock a persona |
| POST | `/chat` | Send message (costs tokens) |
| GET | `/chat/history` | Retrieve chat history with pagination |
| GET | `/token/balance` | Get user token balance |
| POST | `/token/deposit` | Process MON token deposit from blockchain |
| POST | `/token/withdraw` | Withdraw tokens to wallet |
| POST | `/token/daily-reward` | Claim daily login reward |

API documentation is available at `/documentation` when the server is running.

## Autonomous Workers

The backend includes autonomous workers powered by BullMQ and Redis:

### Engagement Worker

Sends proactive messages from AI personas to maintain engagement:

- **Timing Windows:**
  - Morning: 7:00-9:00 AM
  - Lunch: 12:00-2:00 PM
  - Night: 9:00-11:00 PM
- **Features:**
  - Timezone-aware scheduling
  - Anti-spam protection (max 2 messages/day)
  - Redis-based deduplication
  - Context-aware messaging based on relationship history

### Summary Worker

Automatically summarizes conversations:

- Triggers when message count exceeds 75
- Generates concise summaries using DeepSeek AI
- Stores summaries in `Memory` table with type `summary`
- Helps maintain context in long conversations

### Cron Service

Orchestrates scheduled tasks:

- Runs hourly to trigger engagement routines
- Manages worker queues and job scheduling
- Ensures timezone-aware execution

## WebSocket Events

Real-time events via Socket.io:

| Event | Description |
|-------|-------------|
| `balance:update` | Token balance changed |
| `message:receive` | New message from AI persona |
| `notification` | General notifications (rewards, milestones) |
| `typing` | AI persona typing indicator |

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2026 My Bini
