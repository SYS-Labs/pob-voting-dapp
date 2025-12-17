/**
 * X (Twitter) poster service for publishing replies
 *
 * RECOMMENDED: Use OAuth 1.0a authentication (X_WRITE_AUTH_METHOD=oauth1)
 * - Tokens never expire
 * - More reliable than OAuth 2.0
 * - Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET in .env
 */

import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export interface PostResult {
  postId: string;
}

/**
 * X Poster Service with OAuth 1.0a and OAuth 2.0 authentication
 */
export class XPoster {
  private baseUrl = 'https://api.twitter.com';
  private useOAuth1: boolean;

  // OAuth 1.0a properties
  private oauth1?: OAuth;
  private oauth1Token?: string;
  private oauth1TokenSecret?: string;

  // OAuth 2.0 properties
  private clientId: string = '';
  private clientSecret: string = '';
  private accessToken: string = '';
  private refreshToken: string = '';

  constructor() {
    const authMethod = process.env.X_WRITE_AUTH_METHOD || process.env.X_AUTH_METHOD || 'oauth1';

    if (authMethod === 'oauth1') {
      // Use OAuth 1.0a (recommended)
      const apiKey = process.env.X_API_KEY || '';
      const apiSecret = process.env.X_API_SECRET || '';
      this.oauth1Token = process.env.X_ACCESS_TOKEN || '';
      this.oauth1TokenSecret = process.env.X_ACCESS_TOKEN_SECRET || '';

      if (apiKey && apiSecret && this.oauth1Token && this.oauth1TokenSecret) {
        this.oauth1 = new OAuth({
          consumer: {
            key: apiKey,
            secret: apiSecret,
          },
          signature_method: 'HMAC-SHA1',
          hash_function(base_string, key) {
            return crypto
              .createHmac('sha1', key)
              .update(base_string)
              .digest('base64');
          },
        });
        this.useOAuth1 = true;
        logger.info('X OAuth 1.0a configured successfully');
      } else {
        this.useOAuth1 = false;
        logger.warn('X OAuth 1.0a credentials not configured - posting will fail');
      }
    } else {
      // Use OAuth 2.0 (legacy)
      this.useOAuth1 = false;
      this.clientId = process.env.X_CLIENT_ID || '';
      this.clientSecret = process.env.X_CLIENT_SECRET || '';
      this.accessToken = process.env.X_OAUTH2_ACCESS_TOKEN || '';
      this.refreshToken = process.env.X_OAUTH2_REFRESH_TOKEN || '';

      if (this.accessToken) {
        logger.info('X OAuth 2.0 configured successfully');
      } else {
        logger.warn('X OAuth 2.0 access token not configured - posting will fail');
      }
    }
  }

  /**
   * Post a reply to an X post
   * @param replyToId The post ID to reply to
   * @param content The reply content
   * @returns The new post ID
   */
  async postReply(replyToId: string, content: string): Promise<string> {
    if (this.useOAuth1) {
      return this.postReplyOAuth1(replyToId, content);
    } else {
      return this.postReplyOAuth2(replyToId, content);
    }
  }

  /**
   * Post a reply using OAuth 1.0a
   */
  private async postReplyOAuth1(replyToId: string, content: string): Promise<string> {
    if (!this.oauth1 || !this.oauth1Token || !this.oauth1TokenSecret) {
      throw new Error('OAuth 1.0a not configured - cannot post to X');
    }

    try {
      logger.debug('Posting reply to X with OAuth 1.0a', { replyToId, length: content.length });

      const url = `${this.baseUrl}/2/tweets`;
      const requestData = {
        url,
        method: 'POST',
      };

      const token = {
        key: this.oauth1Token,
        secret: this.oauth1TokenSecret,
      };

      const authHeader = this.oauth1.toHeader(this.oauth1.authorize(requestData, token));

      const body = JSON.stringify({
        text: content,
        reply: {
          in_reply_to_tweet_id: replyToId
        }
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...authHeader,
          'Content-Type': 'application/json',
        },
        body
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`X API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as { data?: { id?: string } };
      const newPostId = data?.data?.id;

      if (!newPostId) {
        throw new Error('No post ID returned from X API');
      }

      logger.info('Reply posted to X', {
        replyToId,
        newPostId,
        length: content.length
      });

      return newPostId;
    } catch (error) {
      const errorDetails = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { raw: String(error) };

      logger.error('Failed to post reply to X', {
        error: errorDetails,
        replyToId,
        content: content.substring(0, 50) + '...'
      });
      throw error;
    }
  }

  /**
   * Post a reply using OAuth 2.0
   */
  private async postReplyOAuth2(replyToId: string, content: string): Promise<string> {
    if (!this.accessToken) {
      throw new Error('OAuth 2.0 access token not configured - cannot post to X');
    }

    try {
      logger.debug('Posting reply to X with OAuth 2.0', { replyToId, length: content.length });

      const url = `${this.baseUrl}/2/tweets`;
      const body = JSON.stringify({
        text: content,
        reply: {
          in_reply_to_tweet_id: replyToId
        }
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body
      });

      // If token expired and we have refresh token, try to refresh
      if (response.status === 401 && this.refreshToken) {
        logger.info('Access token expired, refreshing...');
        await this.refreshAccessToken();
        // Retry with new token
        return this.postReplyOAuth2(replyToId, content);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`X API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as { data?: { id?: string } };
      const newPostId = data?.data?.id;

      if (!newPostId) {
        throw new Error('No post ID returned from X API');
      }

      logger.info('Reply posted to X', {
        replyToId,
        newPostId,
        length: content.length
      });

      return newPostId;
    } catch (error) {
      const errorDetails = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { raw: String(error) };

      logger.error('Failed to post reply to X', {
        error: errorDetails,
        replyToId,
        content: content.substring(0, 50) + '...'
      });
      throw error;
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Cannot refresh token - missing credentials');
    }

    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
      };

      this.accessToken = data.access_token;
      if (data.refresh_token) {
        this.refreshToken = data.refresh_token;
      }

      logger.info('Access token refreshed successfully');
      logger.warn('Update .env with new tokens', {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken
      });
    } catch (error) {
      logger.error('Failed to refresh access token', error);
      throw error;
    }
  }

  /**
   * Check if poster is configured
   */
  isConfigured(): boolean {
    if (this.useOAuth1) {
      return !!(this.oauth1 && this.oauth1Token && this.oauth1TokenSecret);
    } else {
      return !!this.accessToken;
    }
  }
}

// Singleton instance
let xPoster: XPoster | null = null;

export function createXPoster(): XPoster {
  if (!xPoster) {
    xPoster = new XPoster();
  }
  return xPoster;
}
