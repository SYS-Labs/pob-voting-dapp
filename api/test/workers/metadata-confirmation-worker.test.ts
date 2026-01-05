/**
 * Tests for MetadataConfirmationWorker
 *
 * Test coverage:
 * - Confirmation flow with different confirmation counts
 * - Error handling and edge cases
 * - Regression checks for table usage
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Set up minimal environment variables before imports
process.env.AI_API_KEY = 'test-key';
process.env.PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
process.env.CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000';

// Mock modules - must be done before importing the worker
const mockGetTransactionConfirmations = jest.fn<() => Promise<number | null>>();

// Mock blockchain service factory
jest.unstable_mockModule('../../src/blockchain/contract.js', () => ({
  createBlockchainService: jest.fn(() => ({
    getTransactionConfirmations: mockGetTransactionConfirmations
  }))
}));

// Now import after mocks are set up
const { MetadataConfirmationWorker } = await import('../../src/queues/metadata-confirmation-worker.js');
const { createMetadataDatabase } = await import('../../src/db/metadata.js');

describe('MetadataConfirmationWorker', () => {
  let db: Database.Database;
  let metadataDb: ReturnType<typeof createMetadataDatabase>;
  let worker: InstanceType<typeof MetadataConfirmationWorker>;

  beforeEach(async () => {
    // Clear all mocks first
    jest.clearAllMocks();

    // Create in-memory database
    db = new Database(':memory:');

    // Load schema
    const schemaPath = path.join(process.cwd(), 'src/db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    metadataDb = createMetadataDatabase(db);

    // Create worker instance (this will use the mocked services)
    worker = new MetadataConfirmationWorker(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('Confirmation Flow', () => {
    it('should update confirmations when count < 10 and not mark as confirmed', async () => {
      // Create pending update
      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject',
        cid: 'QmNewCID',
        txHash: '0xtx1',
        txSentHeight: 100
      });

      // Mock confirmations = 5 (less than required 10)
      mockGetTransactionConfirmations.mockResolvedValue(5);

      await worker.process();

      const update = metadataDb.getUpdateByTxHash('0xtx1');
      expect(update).not.toBeNull();
      expect(update!.confirmations).toBe(5);
      expect(update!.confirmed).toBe(0); // SQLite stores boolean as integer
    });

    it('should mark confirmed when confirmations >= 10', async () => {
      // Create pending update
      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject',
        cid: 'QmNewCID',
        txHash: '0xtx2',
        txSentHeight: 100
      });

      // Mock confirmations = 10
      mockGetTransactionConfirmations.mockResolvedValue(10);

      await worker.process();

      const update = metadataDb.getUpdateByTxHash('0xtx2');
      expect(update).not.toBeNull();
      expect(update!.confirmations).toBe(10);
      expect(update!.confirmed).toBe(1); // SQLite stores boolean as integer
    });

    it('should handle confirmations = null (tx not found) without crashing', async () => {
      // Create pending update
      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject',
        cid: 'QmNewCID',
        txHash: '0xtxNotFound',
        txSentHeight: 100
      });

      // Mock tx not found
      mockGetTransactionConfirmations.mockResolvedValue(null);

      // Should not throw
      await expect(worker.process()).resolves.not.toThrow();

      // Update should remain unchanged
      const update = metadataDb.getUpdateByTxHash('0xtxNotFound');
      expect(update).not.toBeNull();
      expect(update!.confirmations).toBe(0);
      expect(update!.confirmed).toBe(0); // SQLite stores boolean as integer
    });

    it('should update timestamp when updating confirmations', async () => {
      const beforeTime = Date.now();

      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject',
        cid: 'QmNewCID',
        txHash: '0xtx4',
        txSentHeight: 100
      });

      mockGetTransactionConfirmations.mockResolvedValue(7);

      await worker.process();

      const afterTime = Date.now();
      const update = metadataDb.getUpdateByTxHash('0xtx4');
      expect(update).not.toBeNull();
      expect(update!.updated_at).toBeGreaterThanOrEqual(beforeTime);
      expect(update!.updated_at).toBeLessThanOrEqual(afterTime);
    });

    it('should process multiple pending updates in sequence', async () => {
      // Create three pending updates
      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject1',
        cid: 'QmNew1',
        txHash: '0xtx1',
        txSentHeight: 100
      });

      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject2',
        cid: 'QmNew2',
        txHash: '0xtx2',
        txSentHeight: 101
      });

      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject3',
        cid: 'QmNew3',
        txHash: '0xtx3',
        txSentHeight: 102
      });

      // Mock different confirmation counts
      mockGetTransactionConfirmations
        .mockResolvedValueOnce(5)   // tx1: not confirmed yet
        .mockResolvedValueOnce(10)  // tx2: confirmed
        .mockResolvedValueOnce(15); // tx3: confirmed

      await worker.process();

      // Verify all updates processed
      expect(mockGetTransactionConfirmations).toHaveBeenCalledTimes(3);

      const update1 = metadataDb.getUpdateByTxHash('0xtx1');
      expect(update1!.confirmations).toBe(5);
      expect(update1!.confirmed).toBe(0); // SQLite stores boolean as integer

      const update2 = metadataDb.getUpdateByTxHash('0xtx2');
      expect(update2!.confirmations).toBe(10);
      expect(update2!.confirmed).toBe(1); // SQLite stores boolean as integer

      const update3 = metadataDb.getUpdateByTxHash('0xtx3');
      expect(update3!.confirmations).toBe(15);
      expect(update3!.confirmed).toBe(1); // SQLite stores boolean as integer
    });
  });

  describe('Error Handling', () => {
    it('should continue processing other updates if one fails', async () => {
      // Create two updates
      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject1',
        cid: 'QmNew1',
        txHash: '0xtxFails',
        txSentHeight: 100
      });

      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject2',
        cid: 'QmNew2',
        txHash: '0xtxSucceeds',
        txSentHeight: 101
      });

      // First call throws, second succeeds
      mockGetTransactionConfirmations
        .mockRejectedValueOnce(new Error('RPC timeout'))
        .mockResolvedValueOnce(10);

      // Should not throw
      await expect(worker.process()).resolves.not.toThrow();

      // Second update should still be processed
      const update2 = metadataDb.getUpdateByTxHash('0xtxSucceeds');
      expect(update2!.confirmations).toBe(10);
      expect(update2!.confirmed).toBe(1); // SQLite stores boolean as integer
    });

    it('should handle empty pending updates gracefully', async () => {
      // No pending updates
      await expect(worker.process()).resolves.not.toThrow();
      expect(mockGetTransactionConfirmations).not.toHaveBeenCalled();
    });
  });

  describe('Regression: Table Usage', () => {
    it('should use pob_metadata_history table', async () => {
      // Create update
      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject',
        cid: 'QmNew',
        txHash: '0xtxRegression',
        txSentHeight: 100
      });

      mockGetTransactionConfirmations.mockResolvedValue(10);

      await worker.process();

      // Verify data in pob_metadata_history
      const update = db.prepare('SELECT * FROM pob_metadata_history WHERE tx_hash = ?')
        .get('0xtxRegression');
      expect(update).toBeDefined();

      // Verify no legacy tables exist or are used
      const legacyCheck = () => {
        try {
          db.prepare('SELECT * FROM metadata_updates LIMIT 1').all();
          return true;
        } catch {
          return false;
        }
      };

      expect(legacyCheck()).toBe(false); // Legacy table should not exist
    });

    it('should set timestamps correctly on confirmation', async () => {
      const beforeTime = Date.now();

      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: '0xproject',
        cid: 'QmNew',
        txHash: '0xtxTimestamp',
        txSentHeight: 100
      });

      // Advance time slightly
      await new Promise(resolve => setTimeout(resolve, 10));

      mockGetTransactionConfirmations.mockResolvedValue(10);

      await worker.process();

      const afterTime = Date.now();
      const update = metadataDb.getUpdateByTxHash('0xtxTimestamp');

      expect(update).not.toBeNull();
      expect(update!.created_at).toBeGreaterThanOrEqual(beforeTime);
      expect(update!.updated_at).toBeGreaterThanOrEqual(update!.created_at);
      expect(update!.updated_at).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Edge Cases', () => {
    it('should handle iteration updates (null project_address)', async () => {
      metadataDb.createUpdate({
        chainId: 5700,
        contractAddress: '0xcontract',
        iterationNumber: 1,
        projectAddress: null, // Iteration-level metadata
        cid: 'QmNewIteration',
        txHash: '0xtxIteration',
        txSentHeight: 100
      });

      mockGetTransactionConfirmations.mockResolvedValue(10);

      await worker.process();

      const update = metadataDb.getUpdateByTxHash('0xtxIteration');
      expect(update!.confirmed).toBe(1); // SQLite stores boolean as integer
    });

    it('should process up to limit of pending updates', async () => {
      // Create 150 pending updates (more than default limit of 100)
      for (let i = 0; i < 150; i++) {
        metadataDb.createUpdate({
          chainId: 5700,
          contractAddress: '0xcontract',
          iterationNumber: 1,
          projectAddress: `0xproject${i}`,
          cid: `QmNew${i}`,
          txHash: `0xtx${i}`,
          txSentHeight: 100 + i
        });
      }

      mockGetTransactionConfirmations.mockResolvedValue(5);

      await worker.process();

      // Should process exactly 100 (the limit)
      expect(mockGetTransactionConfirmations).toHaveBeenCalledTimes(100);
    });
  });
});
