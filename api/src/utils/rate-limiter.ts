/**
 * Rate limiter for X API requests
 *
 * X API rate limits vary by endpoint, but a general approach is to track
 * requests per 15-minute window and enforce limits with exponential backoff.
 */

import { logger } from './logger.js';

export class RateLimiter {
  private requestCount = 0;
  private resetTime: number;
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(
    maxRequests: number = 300,
    windowMs: number = 15 * 60 * 1000 // 15 minutes
  ) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.resetTime = Date.now() + windowMs;
  }

  /**
   * Wait if rate limit is reached, then increment request counter
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();

    // Reset counter if window has passed
    if (now > this.resetTime) {
      this.requestCount = 0;
      this.resetTime = now + this.windowMs;
      logger.debug('Rate limiter window reset');
    }

    // Check if we've hit the limit
    if (this.requestCount >= this.maxRequests) {
      const waitMs = this.resetTime - now;
      logger.warn('Rate limit reached, waiting', {
        waitMs,
        requestCount: this.requestCount,
        maxRequests: this.maxRequests
      });

      // Wait until window resets
      await this.sleep(waitMs);

      // Reset after waiting
      this.requestCount = 0;
      this.resetTime = Date.now() + this.windowMs;
    }

    this.requestCount++;
  }

  /**
   * Get current rate limit status
   */
  getStatus(): {
    requestCount: number;
    maxRequests: number;
    remaining: number;
    resetTime: Date;
  } {
    return {
      requestCount: this.requestCount,
      maxRequests: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - this.requestCount),
      resetTime: new Date(this.resetTime)
    };
  }

  /**
   * Reset the rate limiter manually
   */
  reset(): void {
    this.requestCount = 0;
    this.resetTime = Date.now() + this.windowMs;
    logger.info('Rate limiter manually reset');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Retry helper with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        logger.warn('Request failed, retrying with backoff', {
          attempt: attempt + 1,
          maxRetries,
          delayMs,
          error: lastError.message
        });
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Max retries reached');
}
