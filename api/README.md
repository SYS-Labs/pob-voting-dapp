# PoB Forum API

Backend services for the Proof-of-Builders Forum - X/Twitter thread indexing, AI-powered responses, and blockchain recording.

## Architecture

This backend consists of 3 microservices managed by PM2:

1. **Indexer** (`src/indexer/`) - Monitors registered X threads and indexes posts
2. **API Server** (`src/api/`) - HTTP API for frontend (port 4000)
3. **Workers** (`src/workers/`) - AI processing pipeline (7 workers)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in all required variables:

```bash
cp .env.example .env
nano .env
```

**Required variables:**
- `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (X OAuth 1.0a)
- `AI_API_KEY` (OpenAI API key)
- `PRIVATE_KEY` (Wallet for blockchain recording)
- `CONTRACT_ADDRESS`, `ADMIN_ADDRESS`

**Optional variables** (have defaults):
- `DB_PATH=./data/index.db`
- `POLL_INTERVAL=300000` (5 minutes)
- `WORKER_INTERVAL=60000` (1 minute)
- `API_PORT=4000`

### 3. Initialize Database

```bash
npm run db:init
```

This creates the SQLite database at `./data/index.db` with all required tables.

### 4. Build TypeScript

```bash
npm run build
```

## Development

Run services individually for development:

```bash
# Terminal 1: API server
npm run dev:api

# Terminal 2: Indexer
npm run dev:indexer

# Terminal 3: Workers
npm run dev:workers
```

## Production (PM2)

Start all services with PM2:

```bash
# Start all services
npm run pm2:start

# Check status
npm run pm2:status

# View logs
npm run pm2:logs

# Restart all
npm run pm2:restart

# Stop all
npm run pm2:stop
```

PM2 will manage 3 processes:
- `forum-indexer` - Polls X for new posts
- `forum-api` - HTTP server on port 4000
- `forum-workers` - AI processing pipeline

**Note**: PM2 automatically loads environment variables from `/sandbox/api/.env` file via the `env_file` property in `ecosystem.config.cjs`.

## API Endpoints

### Public Endpoints

- `GET /health` - Health check
- `GET /api/threads` - List indexed root threads
- `GET /api/threads/:conversationId` - Get thread detail with posts
- `GET /api/deployments` - List contract deployments
- `GET /api/admin/threads` - List monitored threads

### Admin Endpoints (require signature)

- `POST /api/admin/threads` - Register new thread for monitoring
- `PATCH /api/admin/threads/:id` - Update thread status (pause/resume)
- `POST /api/admin/threads/:id/deploy` - Deploy contract

## Worker Pipeline

The 7-worker AI pipeline processes posts automatically:

1. **KB Worker** - Indexes trusted posts into knowledge base
2. **Embedding Worker** - Generates OpenAI embeddings for semantic search
3. **Evaluation Worker** - AI decides if reply is needed (RESPOND/IGNORE/STOP)
4. **Reply Generation Worker** - AI generates reply (under 280 chars)
5. **Publication Worker** - Posts to X + records on blockchain
6. **TX Confirmation Worker** - Monitors transaction confirmations
7. **TX Retry Worker** - Retries failed/missing transactions

All workers run every `WORKER_INTERVAL` (default: 60 seconds).

## Database

SQLite database with 8 tables:

1. **posts** - All indexed X posts
2. **knowledge_base** - Trusted posts with embeddings
3. **eval_queue** - Posts awaiting AI evaluation
4. **reply_queue** - Posts needing responses
5. **pub_queue** - Posts to publish + blockchain status
6. **verification_records** - Blockchain verification records
7. **monitored_threads** - Admin-registered threads
8. **metadata** - Indexer state tracking

## Configuration Notes

- **No dotenv**: Environment variables are loaded via `tsx --env-file=.env` (per CLAUDE.md)
- **X Authentication**: OAuth 1.0a is recommended (tokens never expire)
- **AI Model**: Default is `gpt-4-turbo` (configurable via `AI_MODEL`)
- **Blockchain**: Default is Syscoin NEVM Testnet (Tanenbaum, chainId 5700)

## Troubleshooting

**Database locked errors:**
- Ensure only one instance of each service is running
- Check file permissions on `./data/index.db`

**X API rate limits:**
- Increase `POLL_INTERVAL` (default: 5 minutes)
- Check X API usage dashboard

**AI costs:**
- Reduce `BATCH_SIZE` (default: 10)
- Monitor OpenAI usage dashboard

**Workers not processing:**
- Check logs: `npm run pm2:logs forum-workers`
- Verify `AI_API_KEY` is valid
- Check `WORKER_INTERVAL` setting
