/**
 * Database queries for post operations
 */

import Database from 'better-sqlite3';
import { Post, PostRecord, postToRecord } from '../types/post.js';
import { logger } from '../utils/logger.js';

export class PostDatabase {
  constructor(private db: Database.Database) {}

  /**
   * Store a post in the database
   */
  storePost(post: Post): void {
    const record = postToRecord(post);

    // Check 1: Is this a seal post?
    const sealCheck = this.db.prepare(`
      SELECT 1 FROM pub_queue WHERE seal_post_id = ?
    `).get(post.id);

    if (sealCheck) {
      logger.debug('Skipped seal post', { id: post.id });
      return;
    }

    // Check 2: Does post already exist?
    const existsCheck = this.db.prepare(`
      SELECT 1 FROM posts WHERE id = ?
    `).get(post.id);

    if (existsCheck) {
      logger.debug('Post already exists, updating', { id: post.id });
      // Fall through to INSERT OR REPLACE to update
    }

    // Insert or replace the post
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO posts (
        id, author_username, author_display_name, content,
        parent_id, conversation_id, depth, timestamp,
        likes, retweets, replies_count, is_trusted, indexed_at
      ) VALUES (
        @id, @author_username, @author_display_name, @content,
        @parent_id, @conversation_id, @depth, @timestamp,
        @likes, @retweets, @replies_count, @is_trusted, datetime('now')
      )
    `);

    stmt.run({
      ...record,
      is_trusted: record.is_trusted ? 1 : 0
    });

    logger.debug('Stored post', {
      id: post.id,
      author: post.authorUsername,
      isTrusted: post.isTrusted
    });
  }

  /**
   * Store multiple posts in a transaction
   */
  storePosts(posts: Post[]): void {
    const insertMany = this.db.transaction((posts: Post[]) => {
      for (const post of posts) {
        this.storePost(post);
      }
    });

    insertMany(posts);
    logger.info('Stored posts in batch', { count: posts.length });
  }

  /**
   * Check if a post exists
   */
  postExists(postId: string): boolean {
    const stmt = this.db.prepare('SELECT id FROM posts WHERE id = ?');
    const result = stmt.get(postId);
    return !!result;
  }

  /**
   * Get posts by IDs
   */
  getPostsByIds(postIds: string[]): PostRecord[] {
    if (postIds.length === 0) return [];

    const placeholders = postIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM posts
      WHERE id IN (${placeholders})
    `);

    return stmt.all(...postIds) as PostRecord[];
  }

  /**
   * Get all posts in a conversation
   */
  getConversationPosts(conversationId: string): PostRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM posts
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(conversationId) as PostRecord[];
  }

  /**
   * Get unprocessed posts (for queue workers)
   */
  getUnprocessedPosts(limit: number = 100): PostRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM posts
      WHERE processed_at IS NULL
      ORDER BY timestamp ASC
      LIMIT ?
    `);
    return stmt.all(limit) as PostRecord[];
  }

  /**
   * Mark a post as processed
   */
  markPostProcessed(postId: string): void {
    const stmt = this.db.prepare(`
      UPDATE posts
      SET processed_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(postId);
  }

  /**
   * Get trusted posts not yet in knowledge base
   */
  getTrustedPostsForKB(): PostRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM posts
      WHERE is_trusted = 1
      AND id NOT IN (SELECT post_id FROM knowledge_base)
      ORDER BY timestamp DESC
    `);
    return stmt.all() as PostRecord[];
  }

  /**
   * Get non-trusted posts not yet in eval queue
   */
  getNonTrustedPostsForEval(): PostRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM posts
      WHERE is_trusted = 0
      AND processed_at IS NULL
      AND id NOT IN (SELECT post_id FROM eval_queue)
      ORDER BY timestamp DESC
    `);
    return stmt.all() as PostRecord[];
  }

  /**
   * Get database statistics
   */
  getStats(): {
    totalPosts: number;
    trustedPosts: number;
    unprocessedPosts: number;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM posts')
      .get() as { count: number };

    const trusted = this.db.prepare('SELECT COUNT(*) as count FROM posts WHERE is_trusted = 1')
      .get() as { count: number };

    const unprocessed = this.db.prepare('SELECT COUNT(*) as count FROM posts WHERE processed_at IS NULL')
      .get() as { count: number };

    return {
      totalPosts: total.count,
      trustedPosts: trusted.count,
      unprocessedPosts: unprocessed.count
    };
  }

  /**
   * Get root-level posts (depth 0) ordered by most recent activity
   * (most recent post in the conversation)
   */
  getRootPosts(limit: number = 50): PostRecord[] {
    const stmt = this.db.prepare(
      `SELECT p.*,
              (SELECT MAX(timestamp) FROM posts WHERE conversation_id = p.conversation_id) as last_activity,
              (SELECT COUNT(*) - 1 FROM posts WHERE conversation_id = p.conversation_id) as replies_count
       FROM posts p
       WHERE p.depth = 0
       ORDER BY last_activity DESC
       LIMIT ?`
    );
    return stmt.all(limit) as PostRecord[];
  }

  /**
   * Get a full thread by conversation ID in proper threaded order
   */
  getThread(conversationId: string): Array<PostRecord & {
    tx_hash?: string | null;
    tx_confirmations?: number | null;
    tx_status?: string | null;
  }> {
    const stmt = this.db.prepare(
      `WITH RECURSIVE thread_tree AS (
         -- Start with root posts
         SELECT *, id as sort_path, 0 as level
         FROM posts
         WHERE conversation_id = ? AND parent_id IS NULL

         UNION ALL

         -- Recursively get replies
         SELECT p.*,
                t.sort_path || '/' || p.id as sort_path,
                t.level + 1 as level
         FROM posts p
         INNER JOIN thread_tree t ON p.parent_id = t.id
         WHERE p.conversation_id = ?
       )
       SELECT
         tt.*,
         pq.tx_hash,
         pq.tx_confirmations,
         pq.status as tx_status
       FROM thread_tree tt
       LEFT JOIN pub_queue pq ON tt.id = pq.reply_post_id
       ORDER BY tt.sort_path ASC`
    );
    return stmt.all(conversationId, conversationId) as Array<PostRecord & {
      tx_hash?: string | null;
      tx_confirmations?: number | null;
      tx_status?: string | null;
    }>;
  }
}

export function createPostDatabase(db: Database.Database): PostDatabase {
  return new PostDatabase(db);
}
