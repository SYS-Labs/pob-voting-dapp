/**
 * Custom X (Twitter) API Client
 * Built from scratch - supports OAuth 1.0a, OAuth 2.0, and cookie-based authentication
 * Based on xAPI documentation and Twitter's internal GraphQL API
 *
 * RECOMMENDED SETUP:
 * - Reading: Cookies (X_READ_AUTH_METHOD=cookies) - most reliable
 * - Writing: OAuth 1.0a (X_WRITE_AUTH_METHOD=oauth1) - tokens never expire
 */

import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export interface XApiClientConfig {
  // OAuth 1.0a credentials (recommended - tokens never expire)
  oauth1ConsumerKey?: string;
  oauth1ConsumerSecret?: string;
  oauth1AccessToken?: string;
  oauth1AccessTokenSecret?: string;

  // OAuth 2.0 credentials
  oauth2AccessToken?: string;
  oauth2RefreshToken?: string;
  clientId?: string;
  clientSecret?: string;

  // Cookie-based credentials (legacy fallback)
  authToken?: string;      // X auth_token cookie
  ct0?: string;            // X ct0 cookie (CSRF token)
  bearerToken?: string;    // X OAuth2 bearer token (from X web app)
  allCookies?: string;     // All cookies from browser (optional, for full compatibility)
  tweetDetailQueryId?: string;  // GraphQL query ID for TweetDetail (optional, uses default if not provided)
}

export interface Tweet {
  id: string;
  text: string;
  username: string;
  name: string;
  userId: string;
  conversationId: string;
  inReplyToStatusId?: string;
  timestamp: number;  // UNIX timestamp in seconds (not milliseconds)
  likes: number;
  retweets: number;
  replies: number;
  views?: number;
  isRetweet: boolean;
  retweetedStatusId?: string;
  photos?: any[];  // For post-normalizer compatibility
  videos?: any[];  // For post-normalizer compatibility
  urls?: string[];  // For post-normalizer compatibility
}

/**
 * Custom X API client with OAuth 1.0a, OAuth 2.0, and cookie-based authentication
 */
export class XApiClient {
  private readonly baseUrl = 'https://x.com';
  private readonly apiBaseUrl = 'https://api.x.com';
  private readonly tweetDetailQueryId: string;
  private readonly useOAuth1: boolean;
  private readonly useOAuth2: boolean;

  // OAuth 1.0a properties
  private oauth1?: OAuth;
  private oauth1Token?: string;
  private oauth1TokenSecret?: string;

  // OAuth 2.0 properties
  private oauth2AccessToken?: string;
  private oauth2RefreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;

  // Cookie-based properties
  private bearerToken?: string;

  constructor(private config: XApiClientConfig) {
    // Determine which auth method to use (priority: OAuth 1.0a > OAuth 2.0 > Cookies)
    this.useOAuth1 = !!(
      config.oauth1ConsumerKey &&
      config.oauth1ConsumerSecret &&
      config.oauth1AccessToken &&
      config.oauth1AccessTokenSecret
    );

    this.useOAuth2 = !this.useOAuth1 && !!(
      config.oauth2AccessToken &&
      config.clientId &&
      config.clientSecret
    );

    if (this.useOAuth1) {
      logger.info('Using OAuth 1.0a authentication for reading tweets');
      this.oauth1 = new OAuth({
        consumer: {
          key: config.oauth1ConsumerKey!,
          secret: config.oauth1ConsumerSecret!,
        },
        signature_method: 'HMAC-SHA1',
        hash_function(base_string, key) {
          return crypto
            .createHmac('sha1', key)
            .update(base_string)
            .digest('base64');
        },
      });
      this.oauth1Token = config.oauth1AccessToken;
      this.oauth1TokenSecret = config.oauth1AccessTokenSecret;
    } else if (this.useOAuth2) {
      logger.info('Using OAuth 2.0 authentication for reading tweets');
      this.oauth2AccessToken = config.oauth2AccessToken;
      this.oauth2RefreshToken = config.oauth2RefreshToken;
      this.clientId = config.clientId;
      this.clientSecret = config.clientSecret;
    } else {
      logger.info('Using cookie-based authentication for reading tweets');
      this.bearerToken = config.bearerToken;
    }

    // Use provided query ID or default (for cookie-based GraphQL queries)
    this.tweetDetailQueryId = config.tweetDetailQueryId || '6QzqakNMdh_YzBAR9SYPkQ';
  }

  /**
   * Get a single tweet by ID (routes to appropriate auth method)
   */
  async getTweet(tweetId: string, username?: string): Promise<Tweet | null> {
    if (this.useOAuth1) {
      return this.getTweetOAuth1(tweetId);
    } else if (this.useOAuth2) {
      return this.getTweetOAuth2(tweetId);
    } else {
      return this.getTweetCookies(tweetId, username);
    }
  }

  /**
   * Get entire tweet thread (routes to appropriate auth method)
   */
  async getTweetThread(tweetId: string, username?: string): Promise<Tweet[]> {
    if (this.useOAuth1) {
      return this.getTweetThreadOAuth1(tweetId);
    } else if (this.useOAuth2) {
      return this.getTweetThreadOAuth2(tweetId);
    } else {
      return this.getTweetThreadCookies(tweetId, username);
    }
  }

  /**
   * OAuth 1.0a: Get a single tweet by ID using X API v2
   */
  private async getTweetOAuth1(tweetId: string): Promise<Tweet | null> {
    if (!this.oauth1 || !this.oauth1Token || !this.oauth1TokenSecret) {
      throw new Error('OAuth 1.0a not configured');
    }

    try {
      logger.info('Fetching tweet with OAuth 1.0a', { tweetId });

      const url = `${this.apiBaseUrl}/2/tweets/${tweetId}?tweet.fields=created_at,conversation_id,public_metrics,author_id,entities,referenced_tweets,in_reply_to_user_id&expansions=author_id,referenced_tweets.id&user.fields=username,name`;

      const requestData = {
        url,
        method: 'GET',
      };

      const token = {
        key: this.oauth1Token,
        secret: this.oauth1TokenSecret,
      };

      const authHeader = this.oauth1.toHeader(this.oauth1.authorize(requestData, token));

      const response = await fetch(url, {
        method: 'GET',
        headers: authHeader as any,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`X API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as any;

      if (!data.data) {
        logger.warn('Tweet not found', { tweetId });
        return null;
      }

      return this.parseTwitterAPIv2Tweet(data.data, data.includes);
    } catch (error) {
      logger.error('Failed to fetch tweet with OAuth 1.0a', {
        tweetId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * OAuth 1.0a: Get entire tweet thread
   */
  private async getTweetThreadOAuth1(tweetId: string): Promise<Tweet[]> {
    if (!this.oauth1 || !this.oauth1Token || !this.oauth1TokenSecret) {
      throw new Error('OAuth 1.0a not configured');
    }

    try {
      logger.info('Fetching tweet thread with OAuth 1.0a', { tweetId });

      // First get the main tweet
      const mainTweet = await this.getTweetOAuth1(tweetId);
      if (!mainTweet) {
        return [];
      }

      // Get conversation tweets using search
      const conversationId = mainTweet.conversationId;
      const url = `${this.apiBaseUrl}/2/tweets/search/recent?query=conversation_id:${conversationId}&tweet.fields=created_at,conversation_id,public_metrics,author_id,entities,referenced_tweets,in_reply_to_user_id&expansions=author_id&user.fields=username,name&max_results=100`;

      const requestData = {
        url,
        method: 'GET',
      };

      const token = {
        key: this.oauth1Token,
        secret: this.oauth1TokenSecret,
      };

      const authHeader = this.oauth1.toHeader(this.oauth1.authorize(requestData, token));

      const response = await fetch(url, {
        method: 'GET',
        headers: authHeader as any,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('Failed to fetch conversation tweets', {
          status: response.status,
          error: errorText,
        });
        return [mainTweet];
      }

      const data = await response.json() as any;
      const tweets: Tweet[] = [mainTweet];

      if (data.data && Array.isArray(data.data)) {
        for (const tweetData of data.data) {
          if (tweetData.id !== tweetId) {
            const tweet = this.parseTwitterAPIv2Tweet(tweetData, data.includes);
            if (tweet) {
              tweets.push(tweet);
            }
          }
        }
      }

      logger.info('Fetched tweet thread', { tweetId, count: tweets.length });
      return tweets;
    } catch (error) {
      logger.error('Failed to fetch tweet thread with OAuth 1.0a', {
        tweetId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Parse Twitter API v2 tweet data into our Tweet format
   */
  private parseTwitterAPIv2Tweet(tweetData: any, includes?: any): Tweet | null {
    const users = includes?.users || [];
    const author = users.find((u: any) => u.id === tweetData.author_id);

    if (!author) {
      logger.warn('Author not found in response', { tweetId: tweetData.id });
      return null;
    }

    // Find if this is a reply
    const inReplyToStatusId = tweetData.referenced_tweets?.find(
      (ref: any) => ref.type === 'replied_to'
    )?.id;

    const tweet: Tweet = {
      id: tweetData.id,
      text: tweetData.text || '',
      username: author.username || '',
      name: author.name || author.username || '',
      userId: author.id || '',
      conversationId: tweetData.conversation_id || tweetData.id,
      inReplyToStatusId,
      timestamp: tweetData.created_at
        ? Math.floor(new Date(tweetData.created_at).getTime() / 1000)
        : 0,
      likes: tweetData.public_metrics?.like_count || 0,
      retweets: tweetData.public_metrics?.retweet_count || 0,
      replies: tweetData.public_metrics?.reply_count || 0,
      views: tweetData.public_metrics?.impression_count,
      isRetweet: tweetData.referenced_tweets?.some((ref: any) => ref.type === 'retweeted') || false,
      retweetedStatusId: tweetData.referenced_tweets?.find((ref: any) => ref.type === 'retweeted')?.id,
    };

    return tweet;
  }

  /**
   * OAuth 2.0: Get a single tweet by ID using X API v2
   */
  private async getTweetOAuth2(tweetId: string): Promise<Tweet | null> {
    try {
      logger.info('Fetching tweet with OAuth 2.0', { tweetId });

      const url = `${this.apiBaseUrl}/2/tweets/${tweetId}?tweet.fields=created_at,conversation_id,public_metrics,author_id,entities,referenced_tweets&expansions=author_id,referenced_tweets.id&user.fields=username,name`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.oauth2AccessToken}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle token expiration
      if (response.status === 401 && this.oauth2RefreshToken) {
        logger.info('OAuth 2.0 token expired, refreshing...');
        await this.refreshOAuth2Token();
        // Retry with new token
        return this.getTweetOAuth2(tweetId);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`X API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as any;

      if (!data.data) {
        logger.warn('Tweet not found', { tweetId });
        return null;
      }

      const tweetData = data.data;
      const includes = data.includes || {};
      const users = includes.users || [];
      const author = users.find((u: any) => u.id === tweetData.author_id);

      if (!author) {
        logger.warn('Author not found in response', { tweetId });
        return null;
      }

      const tweet: Tweet = {
        id: tweetData.id,
        text: tweetData.text,
        username: author.username,
        name: author.name,
        userId: tweetData.author_id,
        conversationId: tweetData.conversation_id,
        inReplyToStatusId: tweetData.referenced_tweets?.find((rt: any) => rt.type === 'replied_to')?.id,
        timestamp: Math.floor(new Date(tweetData.created_at).getTime() / 1000),
        likes: tweetData.public_metrics?.like_count || 0,
        retweets: tweetData.public_metrics?.retweet_count || 0,
        replies: tweetData.public_metrics?.reply_count || 0,
        isRetweet: !!tweetData.referenced_tweets?.find((rt: any) => rt.type === 'retweeted'),
        retweetedStatusId: tweetData.referenced_tweets?.find((rt: any) => rt.type === 'retweeted')?.id,
      };

      logger.info('Tweet fetched successfully with OAuth 2.0', {
        tweetId,
        username: tweet.username,
      });

      return tweet;
    } catch (error) {
      logger.error('Failed to fetch tweet with OAuth 2.0', { tweetId, error });
      throw error;
    }
  }

  /**
   * OAuth 2.0: Get tweet thread using conversation search
   */
  private async getTweetThreadOAuth2(tweetId: string): Promise<Tweet[]> {
    try {
      logger.info('Fetching tweet thread with OAuth 2.0', { tweetId });

      // First, get the focal tweet to get its conversation_id
      const focalTweet = await this.getTweetOAuth2(tweetId);
      if (!focalTweet) {
        logger.warn('Focal tweet not found', { tweetId });
        return [];
      }

      const conversationId = focalTweet.conversationId;

      // Search for all tweets in the conversation
      const url = `${this.apiBaseUrl}/2/tweets/search/recent?query=conversation_id:${conversationId}&tweet.fields=created_at,conversation_id,public_metrics,author_id,entities,referenced_tweets&expansions=author_id,referenced_tweets.id&user.fields=username,name&max_results=100`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.oauth2AccessToken}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle token expiration
      if (response.status === 401 && this.oauth2RefreshToken) {
        logger.info('OAuth 2.0 token expired, refreshing...');
        await this.refreshOAuth2Token();
        // Retry with new token
        return this.getTweetThreadOAuth2(tweetId);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`X API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as any;
      const tweets: Tweet[] = [];

      if (!data.data || data.data.length === 0) {
        logger.warn('No tweets found in conversation', { conversationId });
        return [focalTweet]; // Return at least the focal tweet
      }

      const includes = data.includes || {};
      const users = includes.users || [];

      for (const tweetData of data.data) {
        const author = users.find((u: any) => u.id === tweetData.author_id);
        if (!author) continue;

        const tweet: Tweet = {
          id: tweetData.id,
          text: tweetData.text,
          username: author.username,
          name: author.name,
          userId: tweetData.author_id,
          conversationId: tweetData.conversation_id,
          inReplyToStatusId: tweetData.referenced_tweets?.find((rt: any) => rt.type === 'replied_to')?.id,
          timestamp: Math.floor(new Date(tweetData.created_at).getTime() / 1000),
          likes: tweetData.public_metrics?.like_count || 0,
          retweets: tweetData.public_metrics?.retweet_count || 0,
          replies: tweetData.public_metrics?.reply_count || 0,
          isRetweet: !!tweetData.referenced_tweets?.find((rt: any) => rt.type === 'retweeted'),
          retweetedStatusId: tweetData.referenced_tweets?.find((rt: any) => rt.type === 'retweeted')?.id,
        };

        tweets.push(tweet);
      }

      logger.info('Tweet thread fetched successfully with OAuth 2.0', {
        conversationId,
        totalTweets: tweets.length,
      });

      return tweets;
    } catch (error) {
      logger.error('Failed to fetch tweet thread with OAuth 2.0', { tweetId, error });
      throw error;
    }
  }

  /**
   * Refresh OAuth 2.0 access token
   */
  private async refreshOAuth2Token(): Promise<void> {
    if (!this.oauth2RefreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Cannot refresh OAuth 2.0 token - missing credentials');
    }

    try {
      logger.debug('Attempting OAuth 2.0 token refresh', {
        refreshTokenLength: this.oauth2RefreshToken.length,
        refreshTokenPrefix: this.oauth2RefreshToken.substring(0, 10) + '...',
        clientIdLength: this.clientId.length,
        hasClientSecret: !!this.clientSecret
      });

      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await fetch('https://api.x.com/2/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.oauth2RefreshToken,
          client_id: this.clientId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Token refresh request failed', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });

        if (response.status === 400 && errorText.includes('invalid')) {
          throw new Error(
            `Token refresh failed: Refresh token is invalid or expired.\n` +
            `Please run: npm run get-oauth2-tokens\n` +
            `Then update .env with the new tokens.`
          );
        }

        throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
      };

      this.oauth2AccessToken = data.access_token;
      if (data.refresh_token) {
        this.oauth2RefreshToken = data.refresh_token;
      }

      logger.info('OAuth 2.0 access token refreshed successfully');
      logger.warn('Update .env with new tokens', {
        accessToken: this.oauth2AccessToken,
        refreshToken: this.oauth2RefreshToken,
      });
    } catch (error) {
      logger.error('Failed to refresh OAuth 2.0 access token', error);
      throw error;
    }
  }

  /**
   * Get headers for authenticated requests (matching working curl)
   * Only used for cookie-based authentication
   */
  private getHeaders(referer?: string): Record<string, string> {
    if (!this.config.authToken || !this.config.ct0 || !this.bearerToken) {
      throw new Error('Cookie-based authentication not configured');
    }

    // Use all cookies if provided, otherwise just auth_token and ct0
    const cookieString = this.config.allCookies ||
      `auth_token=${this.config.authToken}; ct0=${this.config.ct0}`;

    const headers: Record<string, string> = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.8',
      'authorization': `Bearer ${this.bearerToken}`,
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      'pragma': 'no-cache',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'x-csrf-token': this.config.ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
    };

    // Add cookie header
    headers['cookie'] = cookieString;

    // Add referer if provided
    if (referer) {
      headers['referer'] = referer;
    }

    return headers;
  }

  /**
   * Make authenticated request to X API
   */
  private async request<T>(
    url: string,
    method: string = 'GET',
    body?: any,
    referer?: string
  ): Promise<T> {
    const headers = this.getHeaders(referer);

    logger.debug('X API request', {
      url,
      method,
      headers: Object.keys(headers)
    });

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('X API request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      throw new Error(`X API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as T;
  }

  /**
   * Cookie-based: Get a single tweet by ID
   * Uses TweetDetail GraphQL endpoint (matches working curl)
   */
  private async getTweetCookies(tweetId: string, username?: string): Promise<Tweet | null> {
    try {
      logger.info('Fetching tweet', { tweetId });

      // Use TweetDetail endpoint (from working curl)
      const variables = {
        focalTweetId: tweetId,
        referrer: 'tweet',
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
      };

      const features = {
        rweb_video_screen_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: false,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: true,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
      };

      const fieldToggles = {
        withArticleRichContentState: true,
        withArticlePlainText: false,
        withGrokAnalyze: false,
        withDisallowedReplyControls: false,
      };

      const url = `${this.baseUrl}/i/api/graphql/${this.tweetDetailQueryId}/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

      const referer = username ?
        `https://x.com/${username}/status/${tweetId}` :
        `https://x.com/i/status/${tweetId}`;

      const response: any = await this.request(url, 'GET', undefined, referer);

      // Parse TweetDetail response (different structure than TweetResultByRestId)
      const instructions = response?.data?.threaded_conversation_with_injections_v2?.instructions || [];

      let tweetResult: any = null;
      for (const instruction of instructions) {
        if (instruction.type === 'TimelineAddEntries') {
          for (const entry of instruction.entries || []) {
            if (entry.entryId === `tweet-${tweetId}`) {
              tweetResult = entry.content?.itemContent?.tweet_results?.result;
              break;
            }
          }
        }
        if (tweetResult) break;
      }

      if (!tweetResult || tweetResult.__typename === 'TweetUnavailable') {
        logger.warn('Tweet not found or unavailable', { tweetId });
        return null;
      }

      const legacy = tweetResult.legacy;
      const userCore = tweetResult.core?.user_results?.result?.core;

      if (!legacy) {
        logger.warn('Missing legacy data', { tweetId });
        return null;
      }

      if (!userCore) {
        logger.warn('Missing user data', { tweetId });
        return null;
      }

      const tweet: Tweet = {
        id: tweetResult.rest_id || tweetId,
        text: legacy.full_text,
        username: userCore.screen_name,
        name: userCore.name,
        userId: tweetResult.core?.user_results?.result?.rest_id || 'unknown',
        conversationId: legacy.conversation_id_str,
        inReplyToStatusId: legacy.in_reply_to_status_id_str,
        timestamp: Math.floor(new Date(legacy.created_at).getTime() / 1000),  // Convert to seconds
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        views: tweetResult.views?.count ? parseInt(tweetResult.views.count) : undefined,
        isRetweet: !!legacy.retweeted_status_id_str,
        retweetedStatusId: legacy.retweeted_status_id_str,
      };

      logger.info('Tweet fetched successfully', {
        tweetId,
        username: tweet.username,
        hasReply: !!tweet.inReplyToStatusId
      });

      return tweet;
    } catch (error) {
      logger.error('Failed to fetch tweet', { tweetId, error });
      throw error;
    }
  }

  /**
   * Cookie-based: Get entire tweet thread using TweetDetail endpoint
   * Returns all tweets in the conversation (not just the focal tweet)
   */
  private async getTweetThreadCookies(tweetId: string, username?: string): Promise<Tweet[]> {
    try {
      logger.info('Fetching tweet thread', { tweetId });

      // Use TweetDetail endpoint (same as getTweet but extract all tweets)
      const variables = {
        focalTweetId: tweetId,
        referrer: 'tweet',
        with_rux_injections: false,
        rankingMode: 'Relevance',
        includePromotedContent: true,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
      };

      const features = {
        rweb_video_screen_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: false,
        rweb_tipjar_consumption_enabled: true,
        verified_phone_label_enabled: false,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        articles_preview_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        tweet_awards_web_tipping_enabled: false,
        responsive_web_grok_show_grok_translated_post: false,
        responsive_web_grok_analysis_button_from_backend: true,
        creator_subscriptions_quote_tweet_preview_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: false,
        responsive_web_enhance_cards_enabled: false,
      };

      const fieldToggles = {
        withArticleRichContentState: true,
        withArticlePlainText: false,
        withGrokAnalyze: false,
        withDisallowedReplyControls: false,
      };

      const url = `${this.baseUrl}/i/api/graphql/${this.tweetDetailQueryId}/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

      const referer = username ?
        `https://x.com/${username}/status/${tweetId}` :
        `https://x.com/i/status/${tweetId}`;

      const response: any = await this.request(url, 'GET', undefined, referer);

      // Parse all tweets from TweetDetail response
      const tweets: Tweet[] = [];
      const instructions = response?.data?.threaded_conversation_with_injections_v2?.instructions || [];

      for (const instruction of instructions) {
        if (instruction.type === 'TimelineAddEntries') {
          for (const entry of instruction.entries || []) {
            // Extract tweet from different entry types
            let tweetResult: any = null;

            if (entry.content?.entryType === 'TimelineTimelineItem') {
              // Single tweet item
              tweetResult = entry.content.itemContent?.tweet_results?.result;
            } else if (entry.content?.entryType === 'TimelineTimelineModule') {
              // Module with multiple items (conversation thread)
              for (const item of entry.content.items || []) {
                const itemResult = item.item?.itemContent?.tweet_results?.result;
                if (itemResult && itemResult.legacy) {
                  const tweet = this.parseTweetResult(itemResult);
                  if (tweet) tweets.push(tweet);
                }
              }
              continue;
            }

            if (tweetResult && tweetResult.legacy) {
              const tweet = this.parseTweetResult(tweetResult);
              if (tweet) tweets.push(tweet);
            }
          }
        }
      }

      logger.info('Tweet thread fetched successfully', {
        tweetId,
        totalTweets: tweets.length
      });

      return tweets;
    } catch (error) {
      logger.error('Failed to fetch tweet thread', { tweetId, error });
      throw error;
    }
  }

  /**
   * Parse a tweet result object into a Tweet
   * Extracted to avoid duplication
   */
  private parseTweetResult(tweetResult: any): Tweet | null {
    if (!tweetResult || tweetResult.__typename === 'TweetUnavailable') {
      return null;
    }

    const legacy = tweetResult.legacy;
    const userCore = tweetResult.core?.user_results?.result?.core;

    if (!legacy || !userCore) {
      return null;
    }

    return {
      id: tweetResult.rest_id,
      text: legacy.full_text,
      username: userCore.screen_name,
      name: userCore.name,
      userId: tweetResult.core?.user_results?.result?.rest_id || 'unknown',
      conversationId: legacy.conversation_id_str,
      inReplyToStatusId: legacy.in_reply_to_status_id_str,
      timestamp: Math.floor(new Date(legacy.created_at).getTime() / 1000),
      likes: legacy.favorite_count || 0,
      retweets: legacy.retweet_count || 0,
      replies: legacy.reply_count || 0,
      views: tweetResult.views?.count ? parseInt(tweetResult.views.count) : undefined,
      isRetweet: !!legacy.retweeted_status_id_str,
      retweetedStatusId: legacy.retweeted_status_id_str,
    };
  }

  /**
   * Verify credentials (check if logged in)
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      logger.info('Verifying credentials');

      const url = 'https://api.x.com/1.1/account/verify_credentials.json';
      await this.request(url);

      logger.info('Credentials verified successfully');
      return true;
    } catch (error) {
      logger.error('Credential verification failed', { error });
      return false;
    }
  }
}

/**
 * Create X API client from environment variables
 * Uses X_READ_AUTH_METHOD for authentication (separate from writing)
 */
export function createXApiClient(): XApiClient {
  const authMethod = process.env.X_READ_AUTH_METHOD || process.env.X_AUTH_METHOD || 'cookies';

  if (authMethod === 'oauth1') {
    // OAuth 1.0a authentication (recommended)
    const oauth1ConsumerKey = process.env.X_API_KEY;
    const oauth1ConsumerSecret = process.env.X_API_SECRET;
    const oauth1AccessToken = process.env.X_ACCESS_TOKEN;
    const oauth1AccessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

    if (!oauth1ConsumerKey || !oauth1ConsumerSecret || !oauth1AccessToken || !oauth1AccessTokenSecret) {
      throw new Error('Missing OAuth 1.0a credentials (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET)');
    }

    logger.info('Creating X API client with OAuth 1.0a authentication');

    return new XApiClient({
      oauth1ConsumerKey,
      oauth1ConsumerSecret,
      oauth1AccessToken,
      oauth1AccessTokenSecret,
    });
  } else if (authMethod === 'oauth2') {
    // OAuth 2.0 authentication
    const oauth2AccessToken = process.env.X_OAUTH2_ACCESS_TOKEN;
    const oauth2RefreshToken = process.env.X_OAUTH2_REFRESH_TOKEN;
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;

    if (!oauth2AccessToken || !clientId || !clientSecret) {
      throw new Error('Missing OAuth 2.0 credentials (X_OAUTH2_ACCESS_TOKEN, X_CLIENT_ID, X_CLIENT_SECRET)');
    }

    // Warn if refresh token is missing or looks like a placeholder
    if (!oauth2RefreshToken) {
      logger.warn('X_OAUTH2_REFRESH_TOKEN is not set - token refresh will fail');
      logger.warn('Run: npm run get-oauth2-tokens to get fresh tokens');
    } else if (oauth2RefreshToken.includes('YOUR_') || oauth2RefreshToken.includes('HERE')) {
      logger.warn('X_OAUTH2_REFRESH_TOKEN appears to be a placeholder - token refresh will fail');
      logger.warn('Run: npm run get-oauth2-tokens to get fresh tokens');
    } else {
      logger.debug('OAuth 2.0 refresh token loaded', {
        refreshTokenLength: oauth2RefreshToken.length,
        refreshTokenPrefix: oauth2RefreshToken.substring(0, 10) + '...'
      });
    }

    logger.info('Creating X API client with OAuth 2.0 authentication');

    return new XApiClient({
      oauth2AccessToken,
      oauth2RefreshToken,
      clientId,
      clientSecret,
    });
  } else {
    // Cookie-based authentication (legacy)
    const authToken = process.env.X_AUTH_TOKEN;
    const ct0 = process.env.X_CT0;
    const bearerToken = process.env.X_BEARER_TOKEN;

    if (!authToken || !ct0) {
      throw new Error('Missing X_AUTH_TOKEN or X_CT0 environment variables');
    }

    if (!bearerToken) {
      throw new Error('Missing X_BEARER_TOKEN environment variable');
    }

    logger.info('Creating X API client with cookie-based authentication');

    // Optional: Read TweetDetail query ID from env (use default if not provided)
    const tweetDetailQueryId = process.env.X_GRAPHQL_TWEET_DETAIL_ID;

    return new XApiClient({
      authToken,
      ct0,
      bearerToken,
      tweetDetailQueryId,
    });
  }
}
