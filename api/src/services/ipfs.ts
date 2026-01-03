import { create, IPFSHTTPClient, CID } from 'ipfs-http-client';
import { logger } from '../utils/logger.js';

export class IPFSService {
  private client: IPFSHTTPClient;
  private fallbackClient: IPFSHTTPClient | null;
  private useDAG: boolean;

  constructor() {
    // Parse primary IPFS API URL
    const apiUrl = process.env.IPFS_API_URL || 'http://localhost:5001';
    this.client = this.createClient(apiUrl);

    // Parse fallback IPFS API URL (optional)
    const fallbackApiUrl = process.env.IPFS_FALLBACK_API_URL;
    this.fallbackClient = fallbackApiUrl ? this.createClient(fallbackApiUrl) : null;

    // Use DAG API for JSON objects (recommended)
    this.useDAG = process.env.IPFS_USE_DAG !== 'false'; // Default true
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
   * Upload JSON object to IPFS using DAG API
   * More efficient and semantically correct for structured data
   */
  async uploadJSON(data: any, name?: string): Promise<string> {
    try {
      if (this.useDAG) {
        // Use DAG API - stores JSON as IPLD block
        const cid = await this.client.dag.put(data, {
          storeCodec: 'dag-cbor', // Binary encoding (more efficient than dag-json)
          hashAlg: 'sha2-256',
          pin: true
        });

        const cidString = cid.toString();

        logger.info('Uploaded to IPFS (DAG)', {
          cid: cidString,
          name,
          codec: 'dag-cbor'
        });

        return cidString;
      } else {
        // Fallback: Use file API (stringify JSON)
        const content = JSON.stringify(data);

        const result = await this.client.add(content, {
          pin: true,
          cidVersion: 1,
          wrapWithDirectory: false
        });

        logger.info('Uploaded to IPFS (File)', {
          cid: result.cid.toString(),
          name,
          size: result.size
        });

        return result.cid.toString();
      }
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
      const result = this.useDAG
        ? await this.client.dag.get(parsedCID)
        : await this.client.cat(parsedCID);

      const data = this.useDAG ? result.value : JSON.parse(Buffer.concat(await this.asyncIteratorToArray(result)).toString());

      logger.info('Fetched from IPFS (primary)', { cid, useDAG: this.useDAG });
      return data;
    } catch (primaryError) {
      logger.warn('Primary IPFS server failed', { cid, error: primaryError });

      // Try fallback server if configured
      if (this.fallbackClient) {
        try {
          const result = this.useDAG
            ? await this.fallbackClient.dag.get(parsedCID)
            : await this.fallbackClient.cat(parsedCID);

          const data = this.useDAG ? result.value : JSON.parse(Buffer.concat(await this.asyncIteratorToArray(result)).toString());

          logger.info('Fetched from IPFS (fallback)', { cid, useDAG: this.useDAG });
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
