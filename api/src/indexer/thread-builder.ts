/**
 * Thread builder - recursively fetches reply trees from X
 */

import { Scraper, SearchMode, Tweet } from 'agent-twitter-client';
import { Post } from '../types/post.js';
import { normalizePost } from './post-normalizer.js';
import { RateLimiter, retryWithBackoff } from '../utils/rate-limiter.js';
import { logger } from '../utils/logger.js';

export interface ThreadBuilderConfig {
  maxReplyDepth: number;
  trustedUsers: string[];
  rateLimiter: RateLimiter;
}

export class ThreadBuilder {
  constructor(
    private scraper: Scraper,
    private config: ThreadBuilderConfig
  ) {}

  /**
   * Build a complete reply tree starting from a post ID
   * Recursively fetches replies up to maxReplyDepth
   */
  async buildReplyTree(
    postId: string,
    depth: number = 0
  ): Promise<Post[]> {
    // Stop if we've reached max depth
    if (depth > this.config.maxReplyDepth) {
      logger.debug('Max reply depth reached', { postId, depth });
      return [];
    }

    logger.debug('Building reply tree', { postId, depth });

    try {
      // Rate limit before fetching
      await this.config.rateLimiter.waitIfNeeded();

      // Fetch the current post
      const tweet = await retryWithBackoff(() =>
        this.scraper.getTweet(postId)
      );

      if (!tweet) {
        logger.warn('Post not found', { postId });
        return [];
      }

      // Normalize the current post
      const post = normalizePost(tweet, depth, this.config.trustedUsers);
      const allPosts: Post[] = [post];

      // If we haven't reached max depth, fetch replies
      if (depth < this.config.maxReplyDepth) {
        const replies = await this.fetchReplies(tweet);

        // Recursively build trees for each reply
        for (const reply of replies) {
          if (reply.id) {
            const subTree = await this.buildReplyTree(reply.id, depth + 1);
            allPosts.push(...subTree);
          }
        }
      }

      logger.info('Built reply tree', {
        postId,
        depth,
        totalPosts: allPosts.length
      });

      return allPosts;
    } catch (error) {
      logger.error('Failed to build reply tree', {
        postId,
        depth,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return [];
    }
  }

  /**
   * Fetch direct replies to a tweet
   */
  private async fetchReplies(tweet: Tweet): Promise<Tweet[]> {
    if (!tweet.conversationId || !tweet.username) {
      logger.warn('Cannot fetch replies: missing conversation ID or username', {
        tweetId: tweet.id
      });
      return [];
    }

    try {
      // Rate limit before fetching
      await this.config.rateLimiter.waitIfNeeded();

      // Search for replies in the conversation
      const query = `conversation_id:${tweet.conversationId} to:${tweet.username}`;

      logger.debug('Fetching replies', {
        conversationId: tweet.conversationId,
        username: tweet.username
      });

      const searchResults = await retryWithBackoff(() =>
        this.scraper.fetchSearchTweets(query, 100, SearchMode.Latest)
      );

      // Filter results to get only direct replies to this tweet
      const directReplies = Array.from(searchResults.tweets || []).filter(
        reply => reply.inReplyToStatusId === tweet.id
      );

      logger.debug('Fetched replies', {
        tweetId: tweet.id,
        totalResults: searchResults.tweets?.length || 0,
        directReplies: directReplies.length
      });

      return directReplies;
    } catch (error) {
      logger.error('Failed to fetch replies', {
        tweetId: tweet.id,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return [];
    }
  }

  /**
   * Build reply trees for multiple posts in parallel (with rate limiting)
   */
  async buildMultipleReplyTrees(
    postIds: string[],
    depth: number = 0
  ): Promise<Post[]> {
    const allPosts: Post[] = [];

    // Process sequentially to respect rate limits
    for (const postId of postIds) {
      const posts = await this.buildReplyTree(postId, depth);
      allPosts.push(...posts);
    }

    return allPosts;
  }

  /**
   * Fetch only new replies since a given timestamp
   */
  async fetchNewReplies(
    postId: string,
    sinceTimestamp: Date
  ): Promise<Post[]> {
    const allPosts = await this.buildReplyTree(postId, 0);

    // Filter posts newer than the timestamp
    const newPosts = allPosts.filter(
      post => post.timestamp > sinceTimestamp
    );

    logger.info('Filtered new posts', {
      total: allPosts.length,
      new: newPosts.length,
      sinceTimestamp: sinceTimestamp.toISOString()
    });

    return newPosts;
  }
}

/**
 * Create a thread builder instance
 */
export function createThreadBuilder(
  scraper: Scraper,
  config: ThreadBuilderConfig
): ThreadBuilder {
  return new ThreadBuilder(scraper, config);
}
