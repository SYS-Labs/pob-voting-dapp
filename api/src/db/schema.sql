-- PoB Onboarding Database Schema
-- SQLite database for indexing X conversations and managing queues

-- Posts table: All indexed X posts
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_username TEXT NOT NULL,
  author_display_name TEXT,
  content TEXT NOT NULL,
  content_hash TEXT,
  parent_id TEXT,
  conversation_id TEXT NOT NULL,
  depth INTEGER NOT NULL,
  timestamp DATETIME NOT NULL,
  likes INTEGER DEFAULT 0,
  retweets INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  is_trusted BOOLEAN NOT NULL DEFAULT 0,
  indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME,
  FOREIGN KEY (parent_id) REFERENCES posts(id)
);

CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_username);
CREATE INDEX IF NOT EXISTS idx_posts_conversation ON posts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id);
CREATE INDEX IF NOT EXISTS idx_posts_trusted ON posts(is_trusted);
CREATE INDEX IF NOT EXISTS idx_posts_processed ON posts(processed_at);

-- Knowledge base: Trusted posts for AI context
CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  UNIQUE(post_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_post ON knowledge_base(post_id);

-- Evaluation queue: Non-trusted posts awaiting AI evaluation
CREATE TABLE IF NOT EXISTS eval_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ai_decision TEXT,
  ai_reasoning TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evaluated_at DATETIME,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  UNIQUE(post_id)
);

CREATE INDEX IF NOT EXISTS idx_eval_status ON eval_queue(status);
CREATE INDEX IF NOT EXISTS idx_eval_post ON eval_queue(post_id);

-- Reply generation queue: Posts that need responses
CREATE TABLE IF NOT EXISTS reply_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reply_content TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_at DATETIME,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  UNIQUE(post_id)
);

CREATE INDEX IF NOT EXISTS idx_reply_status ON reply_queue(status);
CREATE INDEX IF NOT EXISTS idx_reply_post ON reply_queue(post_id);

-- Publication queue: Posts to publish + record on-chain
-- Status values: 'pending', 'published', 'tx_submitted', 'tx_confirmed', 'tx_final', 'failed'
CREATE TABLE IF NOT EXISTS pub_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_post_id TEXT NOT NULL,
  reply_post_id TEXT,
  seal_post_id TEXT,
  reply_content TEXT NOT NULL,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME,
  tx_hash TEXT,
  tx_sent_height INTEGER,
  tx_retry_count INTEGER DEFAULT 0,
  tx_confirmations INTEGER DEFAULT 0,
  recorded_at DATETIME,
  error_message TEXT,
  FOREIGN KEY (source_post_id) REFERENCES posts(id)
);

CREATE INDEX IF NOT EXISTS idx_pub_status ON pub_queue(status);
CREATE INDEX IF NOT EXISTS idx_pub_source ON pub_queue(source_post_id);
CREATE INDEX IF NOT EXISTS idx_pub_reply ON pub_queue(reply_post_id);
CREATE INDEX IF NOT EXISTS idx_pub_tx_hash ON pub_queue(tx_hash);

-- Blockchain verification records
CREATE TABLE IF NOT EXISTS verification_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number INTEGER,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified BOOLEAN DEFAULT 0,
  UNIQUE(post_id)
);

CREATE INDEX IF NOT EXISTS idx_verification_post ON verification_records(post_id);
CREATE INDEX IF NOT EXISTS idx_verification_tx ON verification_records(tx_hash);
CREATE INDEX IF NOT EXISTS idx_verification_verified ON verification_records(verified);

-- Monitored threads - X posts actively being indexed
CREATE TABLE IF NOT EXISTS monitored_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL UNIQUE,
  contract_address TEXT,
  registered_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  signature TEXT,
  message TEXT,
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monitored_threads_status ON monitored_threads(status);
CREATE INDEX IF NOT EXISTS idx_monitored_threads_contract ON monitored_threads(contract_address);
CREATE INDEX IF NOT EXISTS idx_monitored_threads_post ON monitored_threads(post_id);

-- Deployed contract instances
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_address TEXT NOT NULL,
  created_by TEXT NOT NULL,
  signature TEXT,
  message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_address ON deployments(contract_address);

-- PoB metadata history table (simplified tracking)
CREATE TABLE IF NOT EXISTS pob_metadata_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id INTEGER NOT NULL,
  contract_address TEXT,
  iteration_number INTEGER,
  project_address TEXT,
  cid TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  tx_sent_height INTEGER,
  confirmations INTEGER DEFAULT 0,
  confirmed BOOLEAN DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_confirmed ON pob_metadata_history(confirmed);
CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_project ON pob_metadata_history(chain_id, project_address, confirmed, created_at);
CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_iteration ON pob_metadata_history(chain_id, contract_address, confirmed, created_at);
CREATE INDEX IF NOT EXISTS idx_pob_metadata_history_cid ON pob_metadata_history(cid);

CREATE TABLE IF NOT EXISTS pob_ipfs_cache (
  cid TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pob_ipfs_cache_fetched ON pob_ipfs_cache(fetched_at);

-- Iteration snapshots - cached contract state for frontend
CREATE TABLE IF NOT EXISTS iteration_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  registry_address TEXT NOT NULL,
  pob_address TEXT NOT NULL,
  jury_address TEXT NOT NULL,
  deploy_block_hint INTEGER NOT NULL DEFAULT 0,  -- Block number hint for event queries (optimization)
  jury_state TEXT NOT NULL,  -- 'deployed' | 'activated' | 'active' | 'ended' | 'locked'
  start_time INTEGER,
  end_time INTEGER,
  voting_mode INTEGER NOT NULL DEFAULT 0,
  projects_locked INTEGER NOT NULL DEFAULT 0,
  contract_locked INTEGER NOT NULL DEFAULT 0,
  winner_address TEXT,
  has_winner INTEGER NOT NULL DEFAULT 0,
  devrel_vote TEXT,
  daohic_vote TEXT,
  community_vote TEXT,
  project_scores TEXT,  -- JSON: { addresses: [], scores: [], totalPossible: "" }
  devrel_count INTEGER NOT NULL DEFAULT 0,
  daohic_count INTEGER NOT NULL DEFAULT 0,
  community_count INTEGER NOT NULL DEFAULT 0,
  devrel_account TEXT,
  daohic_voters TEXT,  -- JSON array of addresses
  daohic_individual_votes TEXT,  -- JSON object: { voterAddress: projectAddress }
  projects TEXT,  -- JSON array of project objects
  last_block INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,
  UNIQUE(chain_id, iteration_id, round)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_chain_iter ON iteration_snapshots(chain_id, iteration_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_updated ON iteration_snapshots(last_updated_at);

-- Generic retry tracking - track failed operations to avoid retry storms
-- key format: "module:action:identifier" (e.g., "ipfs:fetch:bafkrei...", "tx:send:0x...")
-- Uses exponential backoff: 5min -> 30min -> 2h -> 24h (configurable per module)
CREATE TABLE IF NOT EXISTS retry_tracker (
  key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_attempt_at INTEGER NOT NULL,
  next_retry_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_retry_tracker_next ON retry_tracker(next_retry_at);
