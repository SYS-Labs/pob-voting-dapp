/**
 * Tests for metadata database functions
 * Focus: IPFS cache functionality
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createMetadataDatabase } from '../../src/db/metadata.js';
import fs from 'fs';
import path from 'path';

describe('Metadata Database - IPFS Cache', () => {
  let db: Database.Database;
  let metadataDb: ReturnType<typeof createMetadataDatabase>;
  const testDbPath = path.join(process.cwd(), 'test-metadata.db');

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');

    // Create schema
    const schemaPath = path.join(process.cwd(), 'src/db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    metadataDb = createMetadataDatabase(db);
  });

  afterEach(() => {
    db.close();
    // Clean up test database file if it exists
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('cacheIPFSContent', () => {
    it('should cache IPFS content successfully', () => {
      const cid = 'QmTest123';
      const content = JSON.stringify({ name: 'Test Project', description: 'Test' });

      const result = metadataDb.cacheIPFSContent(cid, content);

      expect(result.cid).toBe(cid);
      expect(result.content).toBe(content);
      expect(result.content_type).toBe('application/json');
      expect(result.fetched_at).toBeGreaterThan(0);
    });

    it('should use custom content type when provided', () => {
      const cid = 'QmTest456';
      const content = 'plain text content';
      const contentType = 'text/plain';

      const result = metadataDb.cacheIPFSContent(cid, content, contentType);

      expect(result.content_type).toBe(contentType);
    });

    it('should handle duplicate CID gracefully (ON CONFLICT DO NOTHING)', () => {
      const cid = 'QmDuplicate';
      const content1 = JSON.stringify({ version: 1 });
      const content2 = JSON.stringify({ version: 2 });

      metadataDb.cacheIPFSContent(cid, content1);
      metadataDb.cacheIPFSContent(cid, content2); // Should not throw

      const cached = metadataDb.getCachedIPFSContent(cid);
      expect(cached).not.toBeNull();
      expect(cached!.content).toBe(content1); // Original content preserved
    });

    it('should cache large JSON content', () => {
      const cid = 'QmLargeContent';
      const largeObject = {
        projects: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Project ${i}`,
          description: 'A'.repeat(200)
        }))
      };
      const content = JSON.stringify(largeObject);

      const result = metadataDb.cacheIPFSContent(cid, content);

      expect(result.content.length).toBeGreaterThan(1000);
      expect(JSON.parse(result.content)).toEqual(largeObject);
    });

    it('should handle special characters in content', () => {
      const cid = 'QmSpecialChars';
      const content = JSON.stringify({
        text: 'Special chars: "quotes" \'apostrophes\' \n newlines \t tabs 🚀 emoji'
      });

      const result = metadataDb.cacheIPFSContent(cid, content);

      expect(result.content).toBe(content);
      expect(JSON.parse(result.content).text).toContain('🚀');
    });
  });

  describe('getCachedIPFSContent', () => {
    it('should retrieve cached content by CID', () => {
      const cid = 'QmRetrieve123';
      const content = JSON.stringify({ data: 'test' });

      metadataDb.cacheIPFSContent(cid, content);
      const cached = metadataDb.getCachedIPFSContent(cid);

      expect(cached).not.toBeNull();
      expect(cached!.cid).toBe(cid);
      expect(cached!.content).toBe(content);
      expect(cached!.content_type).toBe('application/json');
    });

    it('should return null for non-existent CID', () => {
      const cached = metadataDb.getCachedIPFSContent('QmNonExistent');

      expect(cached).toBeNull();
    });

    it('should retrieve content with correct timestamp', () => {
      const beforeTime = Date.now();
      const cid = 'QmTimestamp';

      metadataDb.cacheIPFSContent(cid, 'content');

      const afterTime = Date.now();
      const cached = metadataDb.getCachedIPFSContent(cid);

      expect(cached).not.toBeNull();
      expect(cached!.fetched_at).toBeGreaterThanOrEqual(beforeTime);
      expect(cached!.fetched_at).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('getBatchCachedIPFSContent', () => {
    it('should retrieve multiple cached items', () => {
      const cids = ['QmBatch1', 'QmBatch2', 'QmBatch3'];
      const contents = cids.map((_cid, i) => JSON.stringify({ index: i }));

      cids.forEach((cid, i) => {
        metadataDb.cacheIPFSContent(cid, contents[i]);
      });

      const cached = metadataDb.getBatchCachedIPFSContent(cids);

      expect(cached.size).toBe(3);
      cids.forEach((cid, i) => {
        expect(cached.has(cid)).toBe(true);
        expect(cached.get(cid)!.content).toBe(contents[i]);
      });
    });

    it('should return only found CIDs', () => {
      metadataDb.cacheIPFSContent('QmFound1', 'content1');
      metadataDb.cacheIPFSContent('QmFound2', 'content2');

      const cids = ['QmFound1', 'QmNotFound', 'QmFound2'];
      const cached = metadataDb.getBatchCachedIPFSContent(cids);

      expect(cached.size).toBe(2);
      expect(cached.has('QmFound1')).toBe(true);
      expect(cached.has('QmFound2')).toBe(true);
      expect(cached.has('QmNotFound')).toBe(false);
    });

    it('should return empty map for empty input array', () => {
      const cached = metadataDb.getBatchCachedIPFSContent([]);

      expect(cached.size).toBe(0);
    });

    it('should handle large batch requests', () => {
      const cids = Array.from({ length: 50 }, (_, i) => `QmBatch${i}`);

      cids.forEach((cid, i) => {
        metadataDb.cacheIPFSContent(cid, JSON.stringify({ index: i }));
      });

      const cached = metadataDb.getBatchCachedIPFSContent(cids);

      expect(cached.size).toBe(50);
      cids.forEach(cid => {
        expect(cached.has(cid)).toBe(true);
      });
    });

    it('should return empty map when no CIDs match', () => {
      const cached = metadataDb.getBatchCachedIPFSContent(['QmNone1', 'QmNone2']);

      expect(cached.size).toBe(0);
    });

    it('should handle duplicate CIDs in request', () => {
      metadataDb.cacheIPFSContent('QmDupe', 'content');

      const cached = metadataDb.getBatchCachedIPFSContent(['QmDupe', 'QmDupe', 'QmDupe']);

      expect(cached.size).toBe(1);
      expect(cached.get('QmDupe')!.content).toBe('content');
    });
  });

  describe('deleteCachedIPFSContent', () => {
    it('should delete cached content by CID', () => {
      const cid = 'QmDelete123';

      metadataDb.cacheIPFSContent(cid, 'to be deleted');
      expect(metadataDb.getCachedIPFSContent(cid)).not.toBeNull();

      metadataDb.deleteCachedIPFSContent(cid);

      const cached = metadataDb.getCachedIPFSContent(cid);
      expect(cached).toBeNull();
    });

    it('should not throw when deleting non-existent CID', () => {
      expect(() => {
        metadataDb.deleteCachedIPFSContent('QmNonExistent');
      }).not.toThrow();
    });

    it('should only delete specified CID', () => {
      metadataDb.cacheIPFSContent('QmKeep1', 'keep');
      metadataDb.cacheIPFSContent('QmDelete', 'delete');
      metadataDb.cacheIPFSContent('QmKeep2', 'keep');

      metadataDb.deleteCachedIPFSContent('QmDelete');

      expect(metadataDb.getCachedIPFSContent('QmKeep1')).not.toBeNull();
      expect(metadataDb.getCachedIPFSContent('QmDelete')).toBeNull();
      expect(metadataDb.getCachedIPFSContent('QmKeep2')).not.toBeNull();
    });
  });

  describe('Integration with metadata updates', () => {
    it('should work alongside metadata update tracking', () => {
      const cid1 = 'QmOldCID';
      const cid2 = 'QmNewCID';

      // Cache old content
      metadataDb.cacheIPFSContent(cid1, JSON.stringify({ version: 1 }));

      // Create metadata update
      metadataDb.createUpdate({
        chainId: 5700,
        iterationNumber: 1,
        projectAddress: '0x1234567890123456789012345678901234567890',
        oldCid: cid1,
        newCid: cid2,
        txHash: '0xabcd',
        txSentHeight: 100
      });

      // Cache new content
      metadataDb.cacheIPFSContent(cid2, JSON.stringify({ version: 2 }));

      // Both should be cached
      expect(metadataDb.getCachedIPFSContent(cid1)).not.toBeNull();
      expect(metadataDb.getCachedIPFSContent(cid2)).not.toBeNull();

      // Delete old CID (simulating unpinning)
      metadataDb.deleteCachedIPFSContent(cid1);

      expect(metadataDb.getCachedIPFSContent(cid1)).toBeNull();
      expect(metadataDb.getCachedIPFSContent(cid2)).not.toBeNull();
    });

    it('should cache content for multiple projects', () => {
      const projects = [
        { addr: '0x1111111111111111111111111111111111111111', cid: 'QmProj1' },
        { addr: '0x2222222222222222222222222222222222222222', cid: 'QmProj2' },
        { addr: '0x3333333333333333333333333333333333333333', cid: 'QmProj3' }
      ];

      projects.forEach(({ addr, cid }) => {
        metadataDb.cacheIPFSContent(cid, JSON.stringify({ address: addr }));
      });

      const cids = projects.map(p => p.cid);
      const cached = metadataDb.getBatchCachedIPFSContent(cids);

      expect(cached.size).toBe(3);
      projects.forEach(({ addr, cid }) => {
        const content = JSON.parse(cached.get(cid)!.content);
        expect(content.address).toBe(addr);
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty string content', () => {
      const cid = 'QmEmpty';

      const result = metadataDb.cacheIPFSContent(cid, '');

      expect(result.content).toBe('');
      const cached = metadataDb.getCachedIPFSContent(cid);
      expect(cached!.content).toBe('');
    });

    it('should handle very long CID strings', () => {
      const cid = 'Qm' + 'a'.repeat(98); // 100 chars total

      metadataDb.cacheIPFSContent(cid, 'content');

      const cached = metadataDb.getCachedIPFSContent(cid);
      expect(cached!.cid).toBe(cid);
    });

    it('should handle malformed JSON in content (stores as string)', () => {
      const cid = 'QmMalformed';
      const malformed = '{ invalid json }';

      metadataDb.cacheIPFSContent(cid, malformed);

      const cached = metadataDb.getCachedIPFSContent(cid);
      expect(cached!.content).toBe(malformed);
      // Note: Validation happens at API layer, not DB layer
    });

    it('should maintain data integrity across multiple operations', () => {
      const operations = [
        { cid: 'QmOp1', content: 'content1' },
        { cid: 'QmOp2', content: 'content2' },
        { cid: 'QmOp3', content: 'content3' }
      ];

      // Cache all
      operations.forEach(op => metadataDb.cacheIPFSContent(op.cid, op.content));

      // Delete one
      metadataDb.deleteCachedIPFSContent('QmOp2');

      // Verify
      expect(metadataDb.getCachedIPFSContent('QmOp1')!.content).toBe('content1');
      expect(metadataDb.getCachedIPFSContent('QmOp2')).toBeNull();
      expect(metadataDb.getCachedIPFSContent('QmOp3')!.content).toBe('content3');
    });
  });

  describe('Performance characteristics', () => {
    it('should handle rapid sequential caching', () => {
      const count = 100;
      const start = Date.now();

      for (let i = 0; i < count; i++) {
        metadataDb.cacheIPFSContent(`QmPerf${i}`, JSON.stringify({ index: i }));
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should retrieve batch efficiently', () => {
      const count = 50;
      const cids = Array.from({ length: count }, (_, i) => `QmBatchPerf${i}`);

      cids.forEach((cid, i) => {
        metadataDb.cacheIPFSContent(cid, JSON.stringify({ index: i }));
      });

      const start = Date.now();
      const cached = metadataDb.getBatchCachedIPFSContent(cids);
      const duration = Date.now() - start;

      expect(cached.size).toBe(count);
      expect(duration).toBeLessThan(100); // Should be very fast
    });
  });
});
