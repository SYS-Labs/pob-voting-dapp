/**
 * MetadataAPI - Client for interacting with the IPFS metadata API
 *
 * This utility provides methods to fetch and update project/iteration metadata
 * stored on IPFS through the API backend.
 */

import type { IterationMetadata, ProjectMetadata } from '~/interfaces';

export interface SetProjectMetadataRequest {
  chainId: number;
  iterationNumber: number;
  projectAddress: string;
  metadata: ProjectMetadata;
  signature: string;
}

export interface SetProjectMetadataResponse {
  success: boolean;
  cid: string;
  txHash: string;
}

export interface SetIterationMetadataRequest {
  chainId: number;
  iterationNumber: number;
  contractAddress: string;
  metadata: IterationMetadata;
  signature: string;
}

export interface SetIterationMetadataResponse {
  success: boolean;
  cid: string;
  txHash: string;
}

export interface GetProjectMetadataResponse {
  success: boolean;
  metadata: ProjectMetadata | null;
  cid: string | null;
}

export interface GetIterationMetadataResponse {
  success: boolean;
  metadata: IterationMetadata | null;
  cid: string | null;
}

export class MetadataAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Fetch project metadata from IPFS via API
   *
   * @param chainId - Chain ID (e.g., 5700 for testnet, 57 for mainnet)
   * @param contractAddress - JurySC contract address
   * @param projectAddress - Project address
   * @returns Project metadata or null if not found
   */
  async getProjectMetadata(
    chainId: number,
    contractAddress: string,
    projectAddress: string
  ): Promise<ProjectMetadata | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/metadata/project/${chainId}/${contractAddress}/${projectAddress}`
      );

      if (!response.ok) {
        console.error(`Failed to fetch project metadata: ${response.status} ${response.statusText}`);
        return null;
      }

      const data: GetProjectMetadataResponse = await response.json();
      return data.success ? data.metadata : null;
    } catch (error) {
      console.error('Error fetching project metadata:', error);
      return null;
    }
  }

  /**
   * Fetch iteration metadata from IPFS via API
   *
   * @param chainId - Chain ID (e.g., 5700 for testnet, 57 for mainnet)
   * @param contractAddress - JurySC contract address
   * @returns Iteration metadata or null if not found
   */
  async getIterationMetadata(
    chainId: number,
    contractAddress: string
  ): Promise<IterationMetadata | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/metadata/iteration/${chainId}/${contractAddress}`
      );

      if (!response.ok) {
        console.error(`Failed to fetch iteration metadata: ${response.status} ${response.statusText}`);
        return null;
      }

      const data: GetIterationMetadataResponse = await response.json();
      return data.success ? data.metadata : null;
    } catch (error) {
      console.error('Error fetching iteration metadata:', error);
      return null;
    }
  }

  /**
   * Set project metadata by uploading to IPFS and updating on-chain CID
   *
   * Requires wallet signature to prove project ownership
   *
   * @param chainId - Chain ID
   * @param contractAddress - JurySC contract address
   * @param projectAddress - Project address
   * @param metadata - Project metadata to upload
   * @param signature - Wallet signature
   * @param message - Message that was signed
   * @returns CID and transaction hash
   * @throws Error if API request fails
   */
  async setProjectMetadata(
    chainId: number,
    contractAddress: string,
    projectAddress: string,
    metadata: ProjectMetadata,
    signature: string,
    message: string
  ): Promise<{ cid: string; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/metadata/project`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chainId,
        contractAddress,
        projectAddress,
        metadata,
        signature,
        message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set project metadata: ${response.status} - ${errorText}`);
    }

    const data: SetProjectMetadataResponse = await response.json();

    if (!data.success) {
      throw new Error('API returned success=false');
    }

    return { cid: data.cid, txHash: data.txHash };
  }

  /**
   * Set iteration metadata by uploading to IPFS and updating on-chain CID
   *
   * Requires admin signature (contract owner only)
   *
   * @param request - Iteration metadata update request with signature
   * @returns CID and transaction hash
   * @throws Error if API request fails
   */
  async setIterationMetadata(
    request: SetIterationMetadataRequest
  ): Promise<{ cid: string; txHash: string }> {
    const response = await fetch(`${this.baseUrl}/metadata/iteration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set iteration metadata: ${response.status} - ${errorText}`);
    }

    const data: SetIterationMetadataResponse = await response.json();

    if (!data.success) {
      throw new Error('API returned success=false');
    }

    return { cid: data.cid, txHash: data.txHash };
  }

  /**
   * Batch fetch project metadata for multiple projects
   *
   * @param chainId - Chain ID
   * @param contractAddress - JurySC contract address
   * @param projectAddresses - Array of project addresses
   * @returns Map of address -> metadata (null if not found)
   */
  async batchGetProjectMetadata(
    chainId: number,
    contractAddress: string,
    projectAddresses: string[]
  ): Promise<Map<string, ProjectMetadata | null>> {
    const results = new Map<string, ProjectMetadata | null>();

    // Fetch all projects in parallel
    await Promise.all(
      projectAddresses.map(async (address) => {
        const metadata = await this.getProjectMetadata(chainId, contractAddress, address);
        results.set(address.toLowerCase(), metadata);
      })
    );

    return results;
  }

  /**
   * Batch fetch metadata by CIDs (generic IPFS content)
   *
   * This is a generic endpoint that fetches IPFS content for any CIDs.
   * The API caches the content locally since IPFS is immutable.
   * Returns only the CIDs that were found (empty object means not found).
   *
   * @param cids - Array of IPFS CIDs to fetch
   * @returns Record of CID -> parsed JSON data (only includes found CIDs)
   */
  async batchGetByCIDs(cids: string[]): Promise<Record<string, any>> {
    if (cids.length === 0) {
      return {};
    }

    const response = await fetch(`${this.baseUrl}/metadata/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cids }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to batch fetch metadata: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error('API returned success=false');
    }

    return data.metadata || {};
  }

  /**
   * Get metadata update status by transaction hash
   *
   * @param txHash - Transaction hash
   * @returns Confirmation status and count
   * @throws Error if API request fails
   */
  async getMetadataUpdateStatus(
    txHash: string
  ): Promise<{ confirmations: number; confirmed: boolean }> {
    const response = await fetch(`${this.baseUrl}/metadata/status/${txHash}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Transaction not found');
      }
      const errorText = await response.text();
      throw new Error(`Failed to get metadata status: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error('API returned success=false');
    }

    return {
      confirmations: data.confirmations,
      confirmed: data.confirmed,
    };
  }
}

// Export singleton instance
export const metadataAPI = new MetadataAPI();
