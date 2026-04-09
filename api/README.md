# PoB API

Backend services for Proof-of-Builders iteration state, metadata, and migration support.

## Architecture

This backend consists of 3 microservices managed by PM2:

1. **Iteration indexer** (`src/index.ts`, `src/indexer/iteration-indexer.ts`) - Polls PoB contracts and caches iteration snapshots
2. **API Server** (`src/api/`) - HTTP API for frontend (port 4000)
3. **Metadata worker** (`src/workers/`) - Confirms metadata transactions and updates DB cache state

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
- `ADMIN_ADDRESS`

**Optional variables** (have defaults):
- `DB_PATH=./data/index.db`
- `POLL_INTERVAL=300000` (5 minutes)
- `WORKER_INTERVAL=60000` (1 minute)
- `API_PORT=4000`

Feature-specific optional variables:
- `PRIVATE_KEY` if metadata submission flows need a signing wallet
- `RPC_URL`, `CHAIN_ID`, `EXPLORER_URL` for custom chain targeting
- `AI_API_KEY` and X-related variables only for legacy forum/AI tooling that is no longer part of the migration runtime

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

# Terminal 2: Iteration indexer
npm run dev:indexer

# Terminal 3: Metadata worker
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
- `iteration-indexer` - Polls PoB contract state into SQLite caches
- `pob-api` - HTTP server on port 4000
- `metadata-workers` - Metadata confirmation worker runtime

**Note**: PM2 automatically loads environment variables from `/sandbox/api/.env` file via the `env_file` property in `ecosystem.config.cjs`.

## API Endpoints

### Public Endpoints

- `GET /health` - Health check
- `GET /api/deployments` - List contract deployments
- `GET /api/iterations` - List cached iteration snapshots
- `GET /api/iterations/:chainId/:iterationId` - Get one iteration snapshot
- `GET /api/iterations/:chainId/:iterationId/badges/:address` - Get per-round badge status for an address

Forum endpoints remain disabled in the migration runtime and return `410 Gone`.

### Admin Endpoints (require signature)

- `POST /api/deployments` - Create a tracked deployment record
- `POST /api/metadata/preview` - Preview metadata CID
- `POST /api/metadata/submit` - Submit validated metadata proof record

## Worker Runtime

The migration runtime keeps only the metadata confirmation worker active.

1. **Metadata confirmation worker** - Polls pending metadata tx hashes and marks them confirmed once the required confirmation threshold is reached

The worker runs every `WORKER_INTERVAL` (default: 60 seconds).

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
- **Blockchain**: Default target is Syscoin NEVM Mainnet (`57`); local rehearsal can use Hardhat (`31337`)

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
- Check logs: `npm run pm2:logs metadata-workers`
- Check `WORKER_INTERVAL` setting
