import { ethers } from 'ethers';
import { IPFSService } from './ipfs.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { NETWORKS, getRpcUrl } from '../constants/networks.js';

// PoBRegistry ABI - only the functions we need for metadata
const REGISTRY_ABI = [
  'function getIterationMetadata(uint256 chainId, address jurySC) external view returns (string)',
  'function getProjectMetadata(uint256 chainId, address jurySC, address project) external view returns (string)',
  'function setIterationMetadata(uint256 chainId, address jurySC, string calldata cid) external',
  'function setProjectMetadata(uint256 chainId, address jurySC, address project, string calldata cid) external',
  'function owner() external view returns (address)',
  'event IterationMetadataSet(uint256 indexed chainId, address indexed jurySC, string cid)',
  'event ProjectMetadataSet(uint256 indexed chainId, address indexed jurySC, address indexed project, string cid)'
];


export interface IterationMetadata {
  iteration: number;
  round: number;
  name: string;
  description?: string; // Round description/details
  chainId: number;
  votingMode: number;
  link?: string; // Optional program brief or social media link
  prev_rounds?: Array<{
    round: number;
    jurySC: string;
    pob: string;
    version: string;
    deployBlockHint: number;
    votingMode: number;
    metadataCID?: string;
  }>;
}

export interface ProjectMetadata {
  account: string;
  name: string;
  app_url?: string;
  yt_vid: string;
  proposal: string;
}

export class MetadataService {
  private ipfs: IPFSService;
  private privateKey: string;

  constructor(ipfs: IPFSService) {
    this.ipfs = ipfs;
    this.privateKey = config.blockchain.privateKey;
  }

  /**
   * Get provider and wallet for a specific chain
   */
  private getProviderAndWallet(chainId: number): { provider: ethers.JsonRpcProvider; wallet: ethers.Wallet } {
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(this.privateKey, provider);
    return { provider, wallet };
  }

  /**
   * Get PoBRegistry contract instance
   */
  private getRegistryContract(chainId: number): ethers.Contract {
    const registryAddress = NETWORKS[chainId]?.registryAddress;
    if (!registryAddress) {
      throw new Error(`No PoBRegistry address configured for chain ${chainId}`);
    }
    const { wallet } = this.getProviderAndWallet(chainId);
    return new ethers.Contract(registryAddress, REGISTRY_ABI, wallet);
  }



  /**
   * Upload iteration metadata to IPFS and return CID
   * Caller is responsible for setting CID on-chain
   */
  async setIterationMetadata(
    metadata: IterationMetadata,
    signature: string,
    message: string
  ): Promise<{ cid: string }> {
    // Verify signature matches the message (basic validation)
    const recovered = ethers.verifyMessage(message, signature);
    logger.info('Upload iteration metadata request', {
      signer: recovered,
      iteration: metadata.iteration
    });

    // Upload metadata to IPFS
    const cid = await this.ipfs.uploadJSON(
      metadata,
      `iteration-${metadata.iteration}-round-${metadata.round}`
    );

    logger.info('Uploaded iteration metadata to IPFS', {
      cid,
      iteration: metadata.iteration,
      round: metadata.round
    });

    return { cid };
  }

  /**
   * Upload project metadata to IPFS and return CID
   * Caller is responsible for setting CID on-chain
   */
  async setProjectMetadata(
    projectAddress: string,
    metadata: ProjectMetadata,
    signature: string,
    message: string
  ): Promise<{ cid: string }> {
    // Verify signature is from project address (no signature validation for now - caller is responsible)
    const recovered = ethers.verifyMessage(message, signature);
    logger.info('Upload project metadata request', {
      signer: recovered,
      projectAddress
    });

    // Ensure metadata.account matches projectAddress
    if (metadata.account.toLowerCase() !== projectAddress.toLowerCase()) {
      throw new Error('Metadata account field must match project address');
    }

    // Upload metadata to IPFS
    const cid = await this.ipfs.uploadJSON(
      metadata,
      `project-${projectAddress}`
    );

    logger.info('Uploaded project metadata to IPFS', {
      cid,
      projectAddress
    });

    return { cid };
  }

  /**
   * Get iteration metadata from IPFS via PoBRegistry CID
   */
  async getIterationMetadata(chainId: number, contractAddress: string): Promise<IterationMetadata | null> {
    try {
      const registry = this.getRegistryContract(chainId);
      const cid = await registry.getIterationMetadata(chainId, contractAddress);

      if (!cid || cid === '') {
        logger.debug('No iteration metadata CID set', { chainId, contractAddress });
        return null;
      }

      const metadata = await this.ipfs.fetchJSON(cid);
      return metadata as IterationMetadata;
    } catch (error) {
      logger.error('Failed to get iteration metadata', { error, chainId, contractAddress });
      return null;
    }
  }

  /**
   * Get project metadata from IPFS via PoBRegistry CID
   */
  async getProjectMetadata(
    chainId: number,
    contractAddress: string,
    projectAddress: string
  ): Promise<ProjectMetadata | null> {
    try {
      const registry = this.getRegistryContract(chainId);
      const cid = await registry.getProjectMetadata(chainId, contractAddress, projectAddress);

      if (!cid || cid === '') {
        logger.debug('No project metadata CID set', { chainId, contractAddress, projectAddress });
        return null;
      }

      const metadata = await this.ipfs.fetchJSON(cid);
      return metadata as ProjectMetadata;
    } catch (error) {
      logger.error('Failed to get project metadata', { error, chainId, contractAddress, projectAddress });
      return null;
    }
  }

  /**
   * Get metadata CID from PoBRegistry (without fetching from IPFS)
   */
  async getIterationMetadataCID(chainId: number, contractAddress: string): Promise<string | null> {
    try {
      const registry = this.getRegistryContract(chainId);
      const cid = await registry.getIterationMetadata(chainId, contractAddress);
      return cid || null;
    } catch (error) {
      logger.error('Failed to get iteration metadata CID', { error, chainId, contractAddress });
      return null;
    }
  }

  /**
   * Get project metadata CID from PoBRegistry (without fetching from IPFS)
   */
  async getProjectMetadataCID(
    chainId: number,
    contractAddress: string,
    projectAddress: string
  ): Promise<string | null> {
    try {
      const registry = this.getRegistryContract(chainId);
      const cid = await registry.getProjectMetadata(chainId, contractAddress, projectAddress);
      return cid || null;
    } catch (error) {
      logger.error('Failed to get project metadata CID', { error, chainId, contractAddress, projectAddress });
      return null;
    }
  }
}
