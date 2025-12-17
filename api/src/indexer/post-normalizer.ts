/**
 * Post normalizer - converts X API tweet data to internal Post format
 */

import { Tweet } from 'agent-twitter-client';
import { Post } from '../types/post.js';
import { logger } from '../utils/logger.js';

/**
 * Normalize a tweet from X API to internal Post format
 */
export function normalizePost(
  tweet: Tweet,
  depth: number,
  trustedUsers: string[]
): Post {
  // Extract media URLs from tweet
  const mediaUrls = extractMediaUrls(tweet);

  // Determine if user is trusted
  const isTrusted = trustedUsers.includes(tweet.username?.toLowerCase() || '');

  const post: Post = {
    id: tweet.id || '',
    authorUsername: tweet.username || 'unknown',
    authorDisplayName: tweet.name || tweet.username || 'Unknown User',
    content: tweet.text || '',
    parentId: tweet.inReplyToStatusId || null,
    conversationId: tweet.conversationId || tweet.id || '',
    depth,
    timestamp: tweet.timestamp ? new Date(tweet.timestamp * 1000) : new Date(),
    likes: tweet.likes || 0,
    retweets: tweet.retweets || 0,
    replies: tweet.replies || 0,
    mediaUrls,
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
 * Extract media URLs from tweet
 */
function extractMediaUrls(tweet: Tweet): string[] {
  const urls: string[] = [];

  // Handle photos
  if (tweet.photos && Array.isArray(tweet.photos)) {
    for (const photo of tweet.photos) {
      if (photo.url) {
        urls.push(photo.url);
      }
    }
  }

  // Handle videos
  if (tweet.videos && Array.isArray(tweet.videos)) {
    for (const video of tweet.videos) {
      if (video.url) {
        urls.push(video.url);
      }
    }
  }

  // Handle URLs in text
  if (tweet.urls && Array.isArray(tweet.urls)) {
    for (const url of tweet.urls) {
      if (typeof url === 'string') {
        urls.push(url);
      }
    }
  }

  return urls;
}

/**
 * Validate that a post has required fields
 */
export function isValidPost(post: Post): boolean {
  if (!post.id || !post.authorUsername || !post.content) {
    logger.warn('Invalid post detected', {
      hasId: !!post.id,
      hasAuthor: !!post.authorUsername,
      hasContent: !!post.content
    });
    return false;
  }

  return true;
}

/**
 * Normalize multiple tweets
 */
export function normalizePosts(
  tweets: Tweet[],
  depth: number,
  trustedUsers: string[]
): Post[] {
  const posts: Post[] = [];

  for (const tweet of tweets) {
    try {
      const post = normalizePost(tweet, depth, trustedUsers);
      if (isValidPost(post)) {
        posts.push(post);
      }
    } catch (error) {
      logger.error('Failed to normalize tweet', {
        tweetId: tweet.id,
        error
      });
    }
  }

  logger.debug('Normalized posts batch', {
    input: tweets.length,
    output: posts.length
  });

  return posts;
}
