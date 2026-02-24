import { create, IPFSHTTPClient, CID } from 'ipfs-http-client';
import { logger } from '../utils/logger.js';

/**
 * Canonicalize JSON by sorting keys recursively
 * This ensures deterministic serialization (same object = same CID)
 */
function canonicalJSON(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSON).join(',') + ']';
  }

  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => `"${key}":${canonicalJSON(obj[key])}`);
  return '{' + pairs.join(',') + '}';
}

export class IPFSService {
  private client: IPFSHTTPClient;
  private fallbackClient: IPFSHTTPClient | null;

  constructor() {
    // Parse primary IPFS API URL
    const apiUrl = process.env.IPFS_API_URL || 'http://localhost:5001';
    this.client = this.createClient(apiUrl);

    // Parse fallback IPFS API URL (optional)
    const fallbackApiUrl = process.env.IPFS_FALLBACK_API_URL;
    this.fallbackClient = fallbackApiUrl ? this.createClient(fallbackApiUrl) : null;
  }

  /**
   * Create IPFS client from URL
   */
  private createClient(url: string): IPFSHTTPClient {
    const parsed = new URL(url);
    return create({
      host: parsed.hostname,
      port: parseInt(parsed.port || (parsed.protocol === 'https:' ? '443' : '80')),
      protocol: parsed.protocol.replace(':', '') as 'http' | 'https'
    });
  }

  /**
   * Preview CID without uploading (only-hash mode)
   * Uses canonical JSON (sorted keys) for deterministic CIDs
   */
  async previewCID(data: any): Promise<string> {
    try {
      const content = canonicalJSON(data);

      const result = await this.client.add(content, {
        onlyHash: true,  // Don't upload, just compute CID
        cidVersion: 1,
        wrapWithDirectory: false
      });

      logger.info('Previewed CID (no upload)', {
        cid: result.cid.toString(),
        size: result.size
      });

      return result.cid.toString();
    } catch (error) {
      logger.error('Failed to preview CID', { error });
      throw error;
    }
  }

  /**
   * Upload JSON object to IPFS
   * Uses canonical JSON (sorted keys) for deterministic, verifiable content-addressing
   */
  async uploadJSON(data: any, name?: string): Promise<string> {
    try {
      // Use canonical JSON (sorted keys recursively) for deterministic CIDs
      // This ensures clients can verify the CID by hashing what they receive
      const content = canonicalJSON(data);

      const result = await this.client.add(content, {
        pin: true,
        cidVersion: 1,
        wrapWithDirectory: false
      });

      logger.info('Uploaded to IPFS (Canonical JSON)', {
        cid: result.cid.toString(),
        name,
        size: result.size
      });

      return result.cid.toString();
    } catch (error) {
      logger.error('Failed to upload to IPFS', { error, name });
      throw error;
    }
  }

  /**
   * Fetch JSON from IPFS
   * Tries primary server, then fallback server if configured
   */
  async fetchJSON(cid: string): Promise<any> {
    const parsedCID = CID.parse(cid);

    // Try primary IPFS server
    try {
      const result = await this.client.cat(parsedCID);
      const data = JSON.parse(Buffer.concat(await this.asyncIteratorToArray(result)).toString());

      logger.info('Fetched from IPFS (primary)', { cid });
      return data;
    } catch (primaryError) {
      logger.warn('Primary IPFS server failed', { cid, error: primaryError });

      // Try fallback server if configured
      if (this.fallbackClient) {
        try {
          const result = await this.fallbackClient.cat(parsedCID);
          const data = JSON.parse(Buffer.concat(await this.asyncIteratorToArray(result)).toString());

          logger.info('Fetched from IPFS (fallback)', { cid });
          return data;
        } catch (fallbackError) {
          logger.error('Fallback IPFS server failed', { cid, error: fallbackError });
          throw new Error(`Failed to fetch CID ${cid} from both primary and fallback IPFS servers`);
        }
      }

      // No fallback configured, throw original error
      logger.error('Failed to fetch from IPFS (no fallback configured)', { cid, error: primaryError });
      throw primaryError;
    }
  }

  /**
   * Convert async iterator to array (helper for cat API)
   */
  private async asyncIteratorToArray<T>(iterator: AsyncIterable<T>): Promise<T[]> {
    const result: T[] = [];
    for await (const item of iterator) {
      result.push(item);
    }
    return result;
  }

  /**
   * Preview CID for raw bytes without uploading (only-hash mode)
   */
  async previewBytesCID(data: Buffer): Promise<string> {
    try {
      const result = await this.client.add(data, {
        onlyHash: true,
        cidVersion: 1,
        wrapWithDirectory: false
      });
      return result.cid.toString();
    } catch (error) {
      logger.error('Failed to preview bytes CID', { error });
      throw error;
    }
  }

  /**
   * Upload raw bytes to IPFS (used for SVG templates)
   */
  async uploadBytes(data: Buffer, name?: string): Promise<string> {
    try {
      const result = await this.client.add(data, {
        pin: true,
        cidVersion: 1,
        wrapWithDirectory: false
      });

      logger.info('Uploaded bytes to IPFS', {
        cid: result.cid.toString(),
        name,
        size: result.size
      });

      return result.cid.toString();
    } catch (error) {
      logger.error('Failed to upload bytes to IPFS', { error, name });
      throw error;
    }
  }

  /**
   * Unpin old CID (called after tx confirmation)
   */
  async unpin(cid: string): Promise<void> {
    try {
      await this.client.pin.rm(CID.parse(cid));
      logger.info('Unpinned CID from IPFS node', { cid });
    } catch (error) {
      logger.error('Failed to unpin CID', { cid, error });
      throw error;
    }
  }

  /**
   * Check if CID is pinned
   */
  async isPinned(cid: string): Promise<boolean> {
    try {
      const parsedCID = CID.parse(cid);
      for await (const _pin of this.client.pin.ls({ paths: [parsedCID] })) {
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to check pin status', { cid, error });
      return false;
    }
  }

  /**
   * Get IPFS node info
   */
  async getNodeInfo(): Promise<any> {
    try {
      const id = await this.client.id();
      return {
        id: id.id.toString(),
        agentVersion: id.agentVersion,
        protocolVersion: id.protocolVersion,
        addresses: id.addresses.map(addr => addr.toString())
      };
    } catch (error) {
      logger.error('Failed to get node info', { error });
      throw error;
    }
  }

  /**
   * Get stats for a CID
   */
  async getStats(cid: string): Promise<{ size: number; blocks: number }> {
    try {
      const stats = await this.client.object.stat(CID.parse(cid));
      return {
        size: stats.CumulativeSize,
        blocks: stats.NumLinks + 1
      };
    } catch (error) {
      logger.error('Failed to get CID stats', { cid, error });
      throw error;
    }
  }
}
