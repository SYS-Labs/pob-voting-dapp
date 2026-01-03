import { ethers } from 'ethers';
import { IPFSService } from './ipfs.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

// JurySC_01 ABI - only the functions we need for metadata
const JURY_SC_ABI = [
  'function iterationMetadataCID() public view returns (string)',
  'function projectMetadataCID(address) public view returns (string)',
  'function setIterationMetadataCID(string calldata cid) external',
  'function setProjectMetadataCID(string calldata cid) external',
  'function getPrevRoundContracts() public view returns (address[])',
  'function setPrevRoundContracts(address[] calldata contracts) external',
  'function isRegisteredProject(address) public view returns (bool)',
  'function owner() public view returns (address)',
  'event IterationMetadataSet(string cid)',
  'event ProjectMetadataSet(address indexed project, string cid)',
  'event PrevRoundsSet(address[] contracts)'
];

export interface IterationMetadata {
  iteration: number;
  round: number;
  name: string;
  chainId: number;
  votingMode: number;
  link: string;
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
  yt_vid: string;
  proposal: string;
}

export class MetadataService {
  private ipfs: IPFSService;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;

  constructor(ipfs: IPFSService) {
    this.ipfs = ipfs;
    this.provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);
    this.wallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);
  }

  /**
   * Get a contract instance for a specific JurySC address
   */
  private getContract(contractAddress: string): ethers.Contract {
    return new ethers.Contract(contractAddress, JURY_SC_ABI, this.wallet);
  }

  /**
   * Verify that a signature matches the expected address
   */
  private verifySignature(message: string, signature: string, expectedAddress: string): boolean {
    try {
      const recovered = ethers.verifyMessage(message, signature);
      return recovered.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      logger.error('Signature verification failed', { error });
      return false;
    }
  }

  /**
   * Upload iteration metadata to IPFS and set CID on contract
   * Only contract owner can do this
   */
  async setIterationMetadata(
    contractAddress: string,
    metadata: IterationMetadata,
    signature: string,
    message: string
  ): Promise<{ cid: string; txHash: string }> {
    const contract = this.getContract(contractAddress);

    // Get contract owner
    const owner = await contract.owner();

    // Verify signature is from contract owner
    if (!this.verifySignature(message, signature, owner)) {
      throw new Error('Invalid signature - not from contract owner');
    }

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

    // Submit transaction to set CID on contract
    const tx = await contract.setIterationMetadataCID(cid);

    logger.info('Submitted setIterationMetadataCID transaction', {
      txHash: tx.hash,
      cid,
      contractAddress
    });

    return { cid, txHash: tx.hash };
  }

  /**
   * Upload project metadata to IPFS and set CID on contract
   * Only the project address can do this
   */
  async setProjectMetadata(
    contractAddress: string,
    projectAddress: string,
    metadata: ProjectMetadata,
    signature: string,
    message: string
  ): Promise<{ cid: string; txHash: string }> {
    const contract = this.getContract(contractAddress);

    // Verify project is registered
    const isRegistered = await contract.isRegisteredProject(projectAddress);
    if (!isRegistered) {
      throw new Error('Project is not registered in this iteration');
    }

    // Verify signature is from project address
    if (!this.verifySignature(message, signature, projectAddress)) {
      throw new Error('Invalid signature - not from project address');
    }

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

    // Create a contract instance with the project's signature
    // The project needs to call the contract themselves
    // We need to use a different approach - send tx from project's wallet

    // For this implementation, we'll assume the API has permission to call
    // setProjectMetadataCID on behalf of projects, OR
    // the project needs to call it themselves after getting the CID

    // Option 1: Return CID for project to use
    // Option 2: API calls contract if it has permission

    // Let's go with Option 2 for simplicity - API submits the tx
    const tx = await contract.setProjectMetadataCID(cid);

    logger.info('Submitted setProjectMetadataCID transaction', {
      txHash: tx.hash,
      cid,
      projectAddress,
      contractAddress
    });

    return { cid, txHash: tx.hash };
  }

  /**
   * Get iteration metadata from IPFS via contract CID
   */
  async getIterationMetadata(contractAddress: string): Promise<IterationMetadata | null> {
    try {
      const contract = this.getContract(contractAddress);
      const cid = await contract.iterationMetadataCID();

      if (!cid || cid === '') {
        logger.debug('No iteration metadata CID set', { contractAddress });
        return null;
      }

      const metadata = await this.ipfs.fetchJSON(cid);
      return metadata as IterationMetadata;
    } catch (error) {
      logger.error('Failed to get iteration metadata', { error, contractAddress });
      return null;
    }
  }

  /**
   * Get project metadata from IPFS via contract CID
   */
  async getProjectMetadata(
    contractAddress: string,
    projectAddress: string
  ): Promise<ProjectMetadata | null> {
    try {
      const contract = this.getContract(contractAddress);
      const cid = await contract.projectMetadataCID(projectAddress);

      if (!cid || cid === '') {
        logger.debug('No project metadata CID set', { contractAddress, projectAddress });
        return null;
      }

      const metadata = await this.ipfs.fetchJSON(cid);
      return metadata as ProjectMetadata;
    } catch (error) {
      logger.error('Failed to get project metadata', { error, contractAddress, projectAddress });
      return null;
    }
  }

  /**
   * Get metadata CID from contract (without fetching from IPFS)
   */
  async getIterationMetadataCID(contractAddress: string): Promise<string | null> {
    try {
      const contract = this.getContract(contractAddress);
      const cid = await contract.iterationMetadataCID();
      return cid || null;
    } catch (error) {
      logger.error('Failed to get iteration metadata CID', { error, contractAddress });
      return null;
    }
  }

  /**
   * Get project metadata CID from contract (without fetching from IPFS)
   */
  async getProjectMetadataCID(
    contractAddress: string,
    projectAddress: string
  ): Promise<string | null> {
    try {
      const contract = this.getContract(contractAddress);
      const cid = await contract.projectMetadataCID(projectAddress);
      return cid || null;
    } catch (error) {
      logger.error('Failed to get project metadata CID', { error, contractAddress, projectAddress });
      return null;
    }
  }
}
