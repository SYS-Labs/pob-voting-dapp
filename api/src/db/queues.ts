/**
 * Database queries for worker queues
 */

import Database from 'better-sqlite3';
import { PostRecord } from '../types/post.js';

export interface KnowledgeBaseRecord {
  id: number;
  post_id: string;
  content: string;
  embedding: string | null;
  indexed_at: string;
}

export interface EvalQueueRecord {
  id: number;
  post_id: string;
  status: string;
  ai_decision: string | null;
  ai_reasoning: string | null;
  created_at: string;
  evaluated_at: string | null;
}

export interface ReplyQueueRecord {
  id: number;
  post_id: string;
  status: string;
  reply_content: string | null;
  created_at: string;
  generated_at: string | null;
}

export interface PubQueueRecord {
  id: number;
  source_post_id: string;
  reply_post_id: string | null;
  seal_post_id: string | null;
  reply_content: string;
  content_hash: string | null;
  status: string;
  created_at: string;
  published_at: string | null;
  tx_hash: string | null;
  tx_sent_height: number | null;
  tx_retry_count: number;
  tx_confirmations: number;
  recorded_at: string | null;
  error_message: string | null;
}

export function createQueueDatabase(db: Database.Database) {
  return {
    // ========== Knowledge Base ==========

    getUnprocessedTrustedPosts(limit: number = 10): PostRecord[] {
      return db.prepare(`
        SELECT * FROM posts
        WHERE is_trusted = 1
          AND processed_at IS NULL
        ORDER BY timestamp ASC
        LIMIT ?
      `).all(limit) as PostRecord[];
    },

    addToKnowledgeBase(postId: string, content: string): void {
      db.prepare(`
        INSERT OR IGNORE INTO knowledge_base (post_id, content)
        VALUES (?, ?)
      `).run(postId, content);
    },

    updateKnowledgeBaseEmbedding(postId: string, embedding: number[]): void {
      db.prepare(`
        UPDATE knowledge_base
        SET embedding = ?
        WHERE post_id = ?
      `).run(JSON.stringify(embedding), postId);
    },

    getKnowledgeBaseEntriesWithoutEmbeddings(limit: number = 10): Array<{
      id: number;
      post_id: string;
      content: string;
    }> {
      return db.prepare(`
        SELECT id, post_id, content
        FROM knowledge_base
        WHERE embedding IS NULL
        ORDER BY indexed_at ASC
        LIMIT ?
      `).all(limit) as Array<{ id: number; post_id: string; content: string }>;
    },

    markPostProcessed(postId: string): void {
      db.prepare(`
        UPDATE posts
        SET processed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(postId);
    },

    getKnowledgeBase(limit: number = 50): string[] {
      const records = db.prepare(`
        SELECT content FROM knowledge_base
        ORDER BY indexed_at DESC
        LIMIT ?
      `).all(limit) as { content: string }[];

      return records.map(r => r.content);
    },

    getKnowledgeBaseWithEmbeddings(limit: number = 100): Array<{
      id: number;
      post_id: string;
      content: string;
      embedding: number[] | null;
    }> {
      const records = db.prepare(`
        SELECT id, post_id, content, embedding
        FROM knowledge_base
        WHERE embedding IS NOT NULL
        ORDER BY indexed_at DESC
        LIMIT ?
      `).all(limit) as KnowledgeBaseRecord[];

      // Parse JSON embeddings
      return records.map(r => ({
        id: r.id,
        post_id: r.post_id,
        content: r.content,
        embedding: r.embedding ? JSON.parse(r.embedding) : null
      }));
    },

    // ========== Evaluation Queue ==========

    getUnprocessedNonTrustedPosts(limit: number = 10): PostRecord[] {
      return db.prepare(`
        SELECT * FROM posts
        WHERE is_trusted = 0
          AND processed_at IS NULL
        ORDER BY timestamp ASC
        LIMIT ?
      `).all(limit) as PostRecord[];
    },

    addToEvalQueue(postId: string): number {
      const result = db.prepare(`
        INSERT OR IGNORE INTO eval_queue (post_id)
        VALUES (?)
      `).run(postId);

      return result.lastInsertRowid as number;
    },

    updateEvalResult(
      postId: string,
      decision: string,
      reasoning: string
    ): void {
      db.prepare(`
        UPDATE eval_queue
        SET ai_decision = ?,
            ai_reasoning = ?,
            evaluated_at = CURRENT_TIMESTAMP,
            status = 'completed'
        WHERE post_id = ?
      `).run(decision, reasoning, postId);
    },

    getPendingEvalItems(limit: number = 10): EvalQueueRecord[] {
      return db.prepare(`
        SELECT * FROM eval_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit) as EvalQueueRecord[];
    },

    // ========== Reply Queue ==========

    addToReplyQueue(postId: string): number {
      const result = db.prepare(`
        INSERT OR IGNORE INTO reply_queue (post_id)
        VALUES (?)
      `).run(postId);

      return result.lastInsertRowid as number;
    },

    updateReplyStatus(postId: string, status: string): void {
      db.prepare(`
        UPDATE reply_queue
        SET status = ?
        WHERE post_id = ?
      `).run(status, postId);
    },

    updateReplyContent(postId: string, content: string): void {
      db.prepare(`
        UPDATE reply_queue
        SET reply_content = ?,
            generated_at = CURRENT_TIMESTAMP,
            status = 'completed'
        WHERE post_id = ?
      `).run(content, postId);
    },

    getPendingReplies(limit: number = 10): ReplyQueueRecord[] {
      return db.prepare(`
        SELECT * FROM reply_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit) as ReplyQueueRecord[];
    },

    // ========== Publication Queue ==========

    addToPubQueue(sourcePostId: string, replyContent: string): number {
      const result = db.prepare(`
        INSERT INTO pub_queue (source_post_id, reply_content)
        VALUES (?, ?)
      `).run(sourcePostId, replyContent);

      return result.lastInsertRowid as number;
    },

    updatePubStatus(id: number, status: string): void {
      db.prepare(`
        UPDATE pub_queue
        SET status = ?
        WHERE id = ?
      `).run(status, id);
    },

    updatePubPublished(
      id: number,
      replyPostId: string,
      contentHash: string
    ): void {
      db.prepare(`
        UPDATE pub_queue
        SET reply_post_id = ?,
            content_hash = ?,
            published_at = CURRENT_TIMESTAMP,
            status = 'published'
        WHERE id = ?
      `).run(replyPostId, contentHash, id);
    },

    updatePubRecorded(id: number, txHash: string): void {
      db.prepare(`
        UPDATE pub_queue
        SET tx_hash = ?,
            recorded_at = CURRENT_TIMESTAMP,
            status = 'recorded'
        WHERE id = ?
      `).run(txHash, id);
    },

    updatePubTxSubmitted(id: number, txHash: string, sentHeight: number, contentHash?: string): void {
      if (contentHash) {
        db.prepare(`
          UPDATE pub_queue
          SET tx_hash = ?,
              tx_sent_height = ?,
              content_hash = ?,
              status = 'tx_submitted'
          WHERE id = ?
        `).run(txHash, sentHeight, contentHash, id);
      } else {
        db.prepare(`
          UPDATE pub_queue
          SET tx_hash = ?,
              tx_sent_height = ?,
              status = 'tx_submitted'
          WHERE id = ?
        `).run(txHash, sentHeight, id);
      }
    },

    updatePubTxConfirmations(id: number, confirmations: number): void {
      db.prepare(`
        UPDATE pub_queue
        SET tx_confirmations = ?,
            status = CASE
              WHEN ? >= 10 THEN 'tx_final'
              WHEN ? >= 1 THEN 'tx_confirmed'
              ELSE status
            END
        WHERE id = ?
      `).run(confirmations, confirmations, confirmations, id);
    },

    updatePubTxFinal(id: number): void {
      db.prepare(`
        UPDATE pub_queue
        SET status = 'tx_final',
            recorded_at = CURRENT_TIMESTAMP,
            tx_confirmations = 10
        WHERE id = ?
      `).run(id);
    },

    updatePubTxRetry(id: number, txHash: string, sentHeight: number): void {
      db.prepare(`
        UPDATE pub_queue
        SET tx_hash = ?,
            tx_sent_height = ?,
            tx_retry_count = tx_retry_count + 1,
            status = 'tx_submitted'
        WHERE id = ?
      `).run(txHash, sentHeight, id);
    },

    updatePubFailed(id: number, errorMessage: string): void {
      db.prepare(`
        UPDATE pub_queue
        SET status = 'failed',
            error_message = ?
        WHERE id = ?
      `).run(errorMessage, id);
    },

    updateSealPostId(txHash: string, sealPostId: string): void {
      db.prepare(`
        UPDATE pub_queue
        SET seal_post_id = ?
        WHERE tx_hash = ?
      `).run(sealPostId, txHash);
    },

    isSealPost(postId: string): boolean {
      const result = db.prepare(`
        SELECT 1
        FROM pub_queue
        WHERE seal_post_id = ?
        LIMIT 1
      `).get(postId);
      return !!result;
    },

    getPendingPublications(limit: number = 10): PubQueueRecord[] {
      return db.prepare(`
        SELECT * FROM pub_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit) as PubQueueRecord[];
    },

    getPublishedPendingTx(limit: number = 10): PubQueueRecord[] {
      return db.prepare(`
        SELECT * FROM pub_queue
        WHERE status = 'published'
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit) as PubQueueRecord[];
    },

    getTxSubmittedPendingXPost(limit: number = 10): PubQueueRecord[] {
      return db.prepare(`
        SELECT * FROM pub_queue
        WHERE status = 'tx_submitted'
          AND tx_hash IS NOT NULL
          AND reply_post_id IS NULL
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit) as PubQueueRecord[];
    },

    getPendingTxConfirmations(limit: number = 100): PubQueueRecord[] {
      return db.prepare(`
        SELECT * FROM pub_queue
        WHERE status IN ('tx_submitted', 'tx_confirmed')
        ORDER BY created_at ASC
        LIMIT ?
      `).all(limit) as PubQueueRecord[];
    },

    getTxNeedingRetry(currentHeight: number, limit: number = 10): PubQueueRecord[] {
      return db.prepare(`
        SELECT * FROM pub_queue
        WHERE status = 'tx_submitted'
          AND tx_sent_height IS NOT NULL
          AND tx_sent_height + 5 <= ?
          AND tx_retry_count < 5
        ORDER BY created_at ASC
        LIMIT ?
      `).all(currentHeight, limit) as PubQueueRecord[];
    },

    addVerificationRecord(
      postId: string,
      contentHash: string,
      txHash: string
    ): void {
      db.prepare(`
        INSERT INTO verification_records (post_id, content_hash, tx_hash)
        VALUES (?, ?, ?)
      `).run(postId, contentHash, txHash);
    },

    // ========== Helper Queries ==========

    getPost(postId: string): PostRecord | null {
      return db.prepare(`
        SELECT * FROM posts WHERE id = ?
      `).get(postId) as PostRecord | undefined || null;
    },

    getThreadContext(postId: string, limit: number = 5): string[] {
      // Get the conversation_id first
      const post = this.getPost(postId);
      if (!post) return [];

      const posts = db.prepare(`
        SELECT author_username, content
        FROM posts
        WHERE conversation_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(post.conversation_id, limit) as { author_username: string; content: string }[];

      return posts.map(p => `@${p.author_username}: ${p.content}`);
    }
  };
}

export type QueueDatabase = ReturnType<typeof createQueueDatabase>;
