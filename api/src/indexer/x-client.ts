/**
 * X (Twitter) client wrapper with authentication
 */

import { Scraper } from 'agent-twitter-client';
import { readFileSync } from 'fs';
import { logger } from '../utils/logger.js';

export interface XClientConfig {
  username: string;
  password: string;
  email: string;
  twoFactorSecret?: string;
  cookiesJson?: string;
  cookiesPath?: string;
  authToken?: string;
  ct0?: string;
}

export class XClient {
  private scraper: Scraper | null = null;
  private isAuthenticated = false;

  constructor(private config: XClientConfig) {}

  /**
   * Initialize and authenticate the X client
   */
  async initialize(): Promise<Scraper> {
    if (this.scraper && this.isAuthenticated) {
      return this.scraper;
    }

    logger.info('Initializing X client', {
      username: this.config.username
    });

    const username = this.config.username;
    const password = this.config.password;
    const email = this.config.email;
    const twoFactorSecret = this.config.twoFactorSecret;
    let retries = 3; // Retry limit

    if (!username) {
      throw new Error('Twitter username not configured');
    }

    try {
      this.scraper = new Scraper({
        fetch: this.createInstrumentedFetch(),
        transform: {
          response: async (res: Response) => {
            logger.debug('X fetch response', {
              url: res.url,
              status: res.status,
              redirected: res.redirected
            });
            return res;
          }
        }
      });

      // Try to load cached cookies first
      const cachedCookies = this.loadCookies();
      if (cachedCookies.length > 0) {
        logger.info('Applying cached cookies', {
          cookiesProvided: cachedCookies.length
        });
        await this.scraper.setCookies(cachedCookies);
      }

      logger.info('Waiting for Twitter login');

      // Retry loop with login check (Eliza pattern)
      while (retries > 0) {
        try {
          // Check if already logged in with existing cookies
          if (await this.scraper.isLoggedIn()) {
            logger.info('Successfully logged in with cached cookies');
            this.isAuthenticated = true;
            break;
          } else {
            // Perform fresh login
            logger.info('No valid session; attempting username/password login');
            await this.scraper.login(username, password, email, twoFactorSecret);

            // Verify login succeeded
            if (await this.scraper.isLoggedIn()) {
              logger.info('Successfully logged in with credentials');
              this.isAuthenticated = true;

              // Cache the new cookies for future use
              const cookies = await this.scraper.getCookies();
              logger.info('Caching fresh cookies for future sessions');
              this.saveCookiesToEnv(cookies);
              break;
            }
          }
        } catch (error) {
          logger.error(`Login attempt failed: ${(error as Error).message}`);
        }

        retries--;
        logger.error(
          `Failed to login to Twitter. Retrying... (${retries} attempts left)`
        );

        if (retries === 0) {
          logger.error('Max retries reached. Exiting login process.');
          throw new Error('Twitter login failed after maximum retries.');
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      logger.info('X client authenticated successfully');
      return this.scraper;
    } catch (error) {
      logger.error('X client authentication failed', error);
      throw new Error('Failed to authenticate with X: ' + (error as Error).message);
    }
  }

  /**
   * Get the scraper instance (initialize if needed)
   */
  async getScraper(): Promise<Scraper> {
    if (!this.scraper || !this.isAuthenticated) {
      return await this.initialize();
    }
    return this.scraper;
  }

  /**
   * Check if client is authenticated
   */
  isReady(): boolean {
    return this.isAuthenticated && this.scraper !== null;
  }

  /**
   * Re-authenticate if session expires
   */
  async reAuthenticate(): Promise<void> {
    logger.warn('Re-authenticating X client');
    this.isAuthenticated = false;
    this.scraper = null;
    await this.initialize();
  }

  /**
   * Logout and cleanup
   */
  async logout(): Promise<void> {
    if (this.scraper && this.isAuthenticated) {
      try {
        await this.scraper.logout();
        logger.info('X client logged out');
      } catch (error) {
        logger.error('Error during logout', error);
      }
    }

    this.scraper = null;
    this.isAuthenticated = false;
  }

  /**
   * Load cookies from provided JSON or file path
   */
  private loadCookies(): (string)[] {
    const { cookiesJson, cookiesPath, authToken, ct0 } = this.config;
    let raw = cookiesJson;

    // If plain token values are provided, build cookies automatically
    if (!raw && (authToken || ct0)) {
      const cookies = [];
      if (authToken) {
        cookies.push({
          name: 'auth_token',
          value: authToken,
          domain: '.x.com',  // X.com (formerly Twitter)
          path: '/',
          secure: true,
          httpOnly: true
        });
      }
      if (ct0) {
        cookies.push({
          name: 'ct0',
          value: ct0,
          domain: '.x.com',  // X.com (formerly Twitter)
          path: '/',
          secure: true
        });
      }
      raw = JSON.stringify(cookies);
      logger.debug('Built cookies JSON from authToken/ct0');
    }

    if (!raw && cookiesPath) {
      try {
        raw = readFileSync(cookiesPath, 'utf-8');
        logger.debug('Read cookies JSON from file', { cookiesPath });
      } catch (error) {
        logger.warn('Failed to read cookies from path', { error, cookiesPath });
      }
    }

    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        logger.warn('Cookies JSON must be an array');
        return [];
      }

      const serialized = parsed.map(cookie => this.serializeCookie(cookie)).filter(Boolean) as string[];
      logger.debug('Parsed cookies from JSON', {
        cookieNames: parsed
          .map((c: any) => (typeof c === 'object' ? c.name : 'string-cookie'))
          .filter(Boolean)
      });
      return serialized;
    } catch (error) {
      logger.warn('Failed to parse cookies JSON', { error });
      return [];
    }
  }

  /**
   * Convert cookie object to a serialized string the scraper can ingest
   */
  private serializeCookie(cookie: unknown): string | null {
    if (typeof cookie === 'string') return cookie;
    if (typeof cookie !== 'object' || cookie === null) return null;

    const data = cookie as Record<string, unknown>;
    const name = data.name as string;
    const value = data.value as string;
    if (!name || !value) return null;

    const domain = (data.domain as string) || '.x.com';  // X.com (formerly Twitter)
    const path = (data.path as string) || '/';
    const secure = data.secure ? '; Secure' : '';
    const httpOnly = data.httpOnly ? '; HttpOnly' : '';

    return `${name}=${value}; Domain=${domain}; Path=${path}${secure}${httpOnly}`;
  }

  /**
   * Save cookies after successful login for future sessions
   * This method logs the cookies so they can be added to .env file
   */
  private saveCookiesToEnv(cookies: any[]): void {
    try {
      // Extract auth_token and ct0 from cookies
      const authToken = cookies.find(c => c.key === 'auth_token')?.value;
      const ct0 = cookies.find(c => c.key === 'ct0')?.value;

      if (authToken && ct0) {
        logger.info('='.repeat(80));
        logger.info('🔐 Fresh cookies obtained! Add these to your .env file:');
        logger.info('='.repeat(80));
        logger.info(`X_AUTH_TOKEN=${authToken}`);
        logger.info(`X_CT0=${ct0}`);
        logger.info('='.repeat(80));
        logger.info('These cookies will be valid for 30-90 days');
      }
    } catch (error) {
      logger.warn('Failed to extract cookies for .env', { error });
    }
  }

  /**
   * Wrap fetch to log network-level errors
   */
  private createInstrumentedFetch(): typeof fetch {
    return async (input: string | URL | Request, init?: RequestInit) => {
      try {
        return await fetch(input, init);
      } catch (error) {
        logger.error('Fetch to X failed', {
          url: typeof input === 'string' ? input : input.toString(),
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    };
  }
}

/**
 * Create an X client instance
 */
export function createXClient(config: XClientConfig): XClient {
  return new XClient(config);
}
