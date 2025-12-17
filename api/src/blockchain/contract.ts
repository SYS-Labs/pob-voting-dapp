/**
 * Blockchain contract service for recording posts on-chain
 */

import { ethers } from 'ethers';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Contract ABI for recording posts and responses
 */
const CONTRACT_ABI = [
  'function recordPost(string postId, bytes32 contentHash) public returns (bytes32)',
  'function recordResponse(string replyPostId, string sourcePostId, bytes32 contentHash) public',
  'function hasResponse(string sourcePostId) public view returns (bool)',
  'function getResponse(string sourcePostId) public view returns (string)',
  'event PostRecorded(string indexed postId, bytes32 contentHash, address indexed recorder, uint256 timestamp)',
  'event ResponseRecorded(string indexed sourcePostId, string indexed replyPostId, bytes32 contentHash, uint256 timestamp)'
];

export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract | null = null;

  constructor() {
    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl);

    // Initialize wallet
    this.wallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);

    // Only initialize contract if address is not placeholder
    if (config.blockchain.contractAddress !== '0x0000000000000000000000000000000000000000') {
      this.contract = new ethers.Contract(
        config.blockchain.contractAddress,
        CONTRACT_ABI,
        this.wallet
      );
    } else {
      logger.warn('Contract address is placeholder - blockchain recording disabled');
    }
  }

  /**
   * Record a post on the blockchain (LEGACY - waits for confirmation)
   * @param postId X post ID
   * @param contentHash SHA-256 hash of post content (with 0x prefix)
   * @returns Transaction hash
   */
  async recordPost(postId: string, contentHash: string): Promise<string> {
    if (!this.contract) {
      logger.warn('Blockchain recording skipped - no contract configured');
      // Return mock transaction hash
      return '0x' + '0'.repeat(64);
    }

    try {
      logger.debug('Recording post on blockchain', { postId, contentHash });

      // Call contract function
      const tx = await this.contract.recordPost(postId, contentHash);

      logger.debug('Transaction sent', {
        postId,
        txHash: tx.hash
      });

      // Wait for confirmation
      const receipt = await tx.wait();

      logger.info('Post recorded on blockchain', {
        postId,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      });

      return receipt.hash;
    } catch (error) {
      logger.error('Failed to record post on blockchain', {
        error,
        postId,
        contentHash
      });
      throw error;
    }
  }

  /**
   * Submit a transaction to record a post without waiting for confirmation
   * @param postId X post ID
   * @param contentHash SHA-256 hash of post content (with 0x prefix)
   * @returns Transaction hash
   */
  async submitRecordPost(postId: string, contentHash: string): Promise<string> {
    if (!this.contract) {
      logger.warn('Blockchain recording skipped - no contract configured');
      // Return mock transaction hash
      return '0x' + '0'.repeat(64);
    }

    try {
      logger.debug('Submitting post record transaction', { postId, contentHash });

      // Call contract function - DO NOT WAIT
      const tx = await this.contract.recordPost(postId, contentHash);

      logger.info('Transaction submitted (not waiting for confirmation)', {
        postId,
        txHash: tx.hash
      });

      return tx.hash;
    } catch (error) {
      logger.error('Failed to submit post record transaction', {
        error,
        postId,
        contentHash
      });
      throw error;
    }
  }

  /**
   * Get the number of confirmations for a transaction
   * @param txHash Transaction hash
   * @returns Number of confirmations, or null if tx not found
   */
  async getTransactionConfirmations(txHash: string): Promise<number | null> {
    try {
      const tx = await this.provider.getTransaction(txHash);

      if (!tx) {
        logger.debug('Transaction not found', { txHash });
        return null;
      }

      if (!tx.blockNumber) {
        // Transaction is pending
        return 0;
      }

      const currentBlock = await this.provider.getBlockNumber();
      const confirmations = currentBlock - tx.blockNumber + 1;

      return confirmations;
    } catch (error) {
      logger.error('Failed to get transaction confirmations', {
        error,
        txHash
      });
      return null;
    }
  }

  /**
   * Get current block height
   */
  async getCurrentBlockHeight(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  /**
   * Submit a transaction to record a response without waiting for confirmation
   * @param replyPostId X post ID of the reply
   * @param sourcePostId X post ID being replied to
   * @param contentHash SHA-256 hash of reply content (with 0x prefix)
   * @returns Transaction hash
   */
  async submitRecordResponse(
    replyPostId: string,
    sourcePostId: string,
    contentHash: string
  ): Promise<string> {
    if (!this.contract) {
      logger.warn('Blockchain recording skipped - no contract configured');
      // Return mock transaction hash
      return '0x' + '0'.repeat(64);
    }

    try {
      logger.debug('Submitting response record transaction', {
        replyPostId,
        sourcePostId,
        contentHash
      });

      // Call contract function - DO NOT WAIT
      const tx = await this.contract.recordResponse(replyPostId, sourcePostId, contentHash);

      logger.info('Response transaction submitted (not waiting for confirmation)', {
        replyPostId,
        sourcePostId,
        txHash: tx.hash
      });

      return tx.hash;
    } catch (error) {
      logger.error('Failed to submit response record transaction', {
        error,
        replyPostId,
        sourcePostId,
        contentHash
      });
      throw error;
    }
  }

  /**
   * Check if a source post has already received a response on-chain
   * @param sourcePostId X post ID to check
   * @returns True if the source post has a response recorded on-chain
   */
  async hasResponse(sourcePostId: string): Promise<boolean> {
    if (!this.contract) {
      return false;
    }

    try {
      return await this.contract.hasResponse(sourcePostId);
    } catch (error) {
      logger.error('Failed to check if post has response', {
        error,
        sourcePostId
      });
      return false;
    }
  }

  /**
   * Get the reply post ID for a source post
   * @param sourcePostId X post ID to look up
   * @returns Reply post ID (empty string if no response)
   */
  async getResponse(sourcePostId: string): Promise<string> {
    if (!this.contract) {
      return '';
    }

    try {
      return await this.contract.getResponse(sourcePostId);
    } catch (error) {
      logger.error('Failed to get response for post', {
        error,
        sourcePostId
      });
      return '';
    }
  }

  /**
   * Get wallet address
   */
  getAddress(): string {
    return this.wallet.address;
  }

  /**
   * Get current balance
   */
  async getBalance(): Promise<string> {
    const balance = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balance);
  }

  /**
   * Check if contract is configured
   */
  isConfigured(): boolean {
    return this.contract !== null;
  }
}

// Singleton instance
let blockchainService: BlockchainService | null = null;

export function createBlockchainService(): BlockchainService {
  if (!blockchainService) {
    blockchainService = new BlockchainService();
  }
  return blockchainService;
}
