/**
 * Thread builder using custom X API client
 * Recursively fetches reply trees from X using our custom implementation
 */

import { XApiClient, Tweet } from './x-api-client.js';
import { Post } from '../types/post.js';
import { RateLimiter, retryWithBackoff } from '../utils/rate-limiter.js';
import { logger } from '../utils/logger.js';

export interface ThreadBuilderConfig {
  maxReplyDepth: number;
  trustedUsers: string[];
  rateLimiter: RateLimiter;
}

export class CustomThreadBuilder {
  constructor(
    private client: XApiClient,
    private config: ThreadBuilderConfig
  ) {}

  /**
   * Build a complete reply tree starting from a post ID
   * Uses TweetDetail to fetch entire thread in one call
   */
  async buildReplyTree(
    postId: string,
    depth: number = 0
  ): Promise<Post[]> {
    logger.debug('Building reply tree', { postId, depth });

    try {
      // Rate limit before fetching
      await this.config.rateLimiter.waitIfNeeded();

      // Fetch the entire thread using TweetDetail (one API call!)
      const allTweets = await retryWithBackoff(() =>
        this.client.getTweetThread(postId)
      );

      if (allTweets.length === 0) {
        logger.warn('No tweets found in thread', { postId });
        return [];
      }

      // Build a map of tweet ID -> tweet for quick lookup
      const tweetMap = new Map<string, Tweet>();
      for (const tweet of allTweets) {
        tweetMap.set(tweet.id, tweet);
      }

      // Find the root tweet (the one we're querying for)
      const rootTweet = tweetMap.get(postId);
      if (!rootTweet) {
        logger.warn('Root tweet not found in response', { postId });
        return [];
      }

      // Build the tree structure recursively
      const allPosts: Post[] = [];
      this.buildTreeRecursive(rootTweet, tweetMap, 0, allPosts);

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
   * Recursively build tree structure from flat list of tweets
   */
  private buildTreeRecursive(
    tweet: Tweet,
    tweetMap: Map<string, Tweet>,
    depth: number,
    result: Post[]
  ): void {
    // Stop if we've exceeded max depth
    if (depth > this.config.maxReplyDepth) {
      return;
    }

    // Add current tweet to result
    const post = this.normalizePost(tweet, depth);
    result.push(post);

    // Find all direct replies to this tweet
    const replies = Array.from(tweetMap.values()).filter(
      t => t.inReplyToStatusId === tweet.id
    );

    // Recursively process each reply
    for (const reply of replies) {
      this.buildTreeRecursive(reply, tweetMap, depth + 1, result);
    }
  }

  /**
   * Normalize a tweet to internal Post format
   */
  private normalizePost(tweet: Tweet, depth: number): Post {
    // Determine if user is trusted
    const isTrusted = this.config.trustedUsers.includes(tweet.username?.toLowerCase() || '');

    const post: Post = {
      id: tweet.id || '',
      authorUsername: tweet.username || 'unknown',
      authorDisplayName: tweet.name || tweet.username || 'Unknown User',
      content: tweet.text || '',
      parentId: tweet.inReplyToStatusId || null,
      conversationId: tweet.conversationId || tweet.id || '',
      depth,
      timestamp: new Date(tweet.timestamp * 1000),  // Convert from seconds to milliseconds
      likes: tweet.likes || 0,
      retweets: tweet.retweets || 0,
      replies: tweet.replies || 0,
      mediaUrls: [],  // TODO: Extract media URLs when implemented
      isTrusted
    };

    logger.debug('Normalized post', {
      id: post.id,
      author: post.authorUsername,
      depth: post.depth,
      isTrusted: post.isTrusted
    });

    return post;
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
 * Create a custom thread builder instance
 */
export function createCustomThreadBuilder(
  client: XApiClient,
  config: ThreadBuilderConfig
): CustomThreadBuilder {
  return new CustomThreadBuilder(client, config);
}
