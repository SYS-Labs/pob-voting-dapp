/**
 * Embedding Service Tests
 * Tests semantic search and knowledge base retrieval
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService, createEmbeddingService } from './embeddings.js';

describe('Embedding Service - Semantic Search', () => {
  let service: EmbeddingService;

  beforeAll(() => {
    service = createEmbeddingService();
  });

  it('should generate embedding for text', async () => {
    const text = 'Blockchain enables decentralized applications';
    const embedding = await service.generateEmbedding(text);

    expect(embedding).toBeDefined();
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBe(1536);
    expect(typeof embedding[0]).toBe('number');

    console.log('Generated embedding dimension:', embedding.length);
  }, 30000);

  it('should generate embeddings for multiple texts', async () => {
    const texts = [
      'Smart contracts are self-executing programs',
      'Proof of Work is a consensus mechanism',
      'NFTs represent digital ownership'
    ];

    const embeddings = await service.generateEmbeddings(texts);

    expect(embeddings).toBeDefined();
    expect(embeddings.length).toBe(3);
    embeddings.forEach(emb => {
      expect(emb.length).toBe(1536);
    });

    console.log('Generated', embeddings.length, 'embeddings');
  }, 30000);

  it('should compute cosine similarity correctly', () => {
    const vec1 = [1, 0, 0];
    const vec2 = [0, 1, 0];
    const vec3 = [1, 0, 0];

    const sim_1_2 = service.cosineSimilarity(vec1, vec2);
    const sim_1_3 = service.cosineSimilarity(vec1, vec3);

    expect(sim_1_2).toBe(0); // Perpendicular vectors
    expect(sim_1_3).toBe(1); // Identical vectors

    console.log('Similarity (perpendicular):', sim_1_2);
    console.log('Similarity (identical):', sim_1_3);
  });

  it('should perform semantic search on knowledge base', async () => {
    // Create mock knowledge base with embeddings
    const kbEntries = [
      {
        id: 1,
        post_id: 'post_1',
        content: 'Bitcoin is a decentralized cryptocurrency using blockchain technology',
        embedding: await service.generateEmbedding('Bitcoin is a decentralized cryptocurrency using blockchain technology')
      },
      {
        id: 2,
        post_id: 'post_2',
        content: 'Smart contracts enable programmable transactions on Ethereum',
        embedding: await service.generateEmbedding('Smart contracts enable programmable transactions on Ethereum')
      },
      {
        id: 3,
        post_id: 'post_3',
        content: 'Pizza is a delicious Italian food with cheese and toppings',
        embedding: await service.generateEmbedding('Pizza is a delicious Italian food with cheese and toppings')
      },
      {
        id: 4,
        post_id: 'post_4',
        content: 'Proof of Stake is an energy-efficient consensus mechanism',
        embedding: await service.generateEmbedding('Proof of Stake is an energy-efficient consensus mechanism')
      }
    ];

    const query = 'How does cryptocurrency consensus work?';
    const results = await service.searchKnowledgeBase(query, kbEntries, 3);

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);

    // Results should be sorted by similarity
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity!).toBeGreaterThanOrEqual(results[i + 1].similarity!);
    }

    // Pizza should not be in top results for crypto query
    const pizzaInResults = results.some(r => r.content.includes('Pizza'));
    expect(pizzaInResults).toBe(false);

    console.log('Top results for crypto query:');
    results.forEach((r, i) => {
      console.log(`${i + 1}. [${r.similarity?.toFixed(3)}] ${r.content.substring(0, 50)}...`);
    });
  }, 60000);

  it('should filter by minimum similarity threshold', async () => {
    const kbEntries = [
      {
        id: 1,
        post_id: 'post_1',
        content: 'Blockchain technology powers cryptocurrencies',
        embedding: await service.generateEmbedding('Blockchain technology powers cryptocurrencies')
      },
      {
        id: 2,
        post_id: 'post_2',
        content: 'Cats are fluffy animals that meow',
        embedding: await service.generateEmbedding('Cats are fluffy animals that meow')
      }
    ];

    const query = 'What is blockchain?';

    // High threshold - should only return blockchain entry
    const results = await service.searchKnowledgeBaseContent(query, kbEntries, 5, 0.8);

    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);

    // Should not include cats
    results.forEach(content => {
      expect(content.toLowerCase()).not.toContain('cat');
    });

    console.log('Filtered results (min similarity 0.8):', results);
  }, 60000);

  it('should handle empty knowledge base gracefully', async () => {
    const query = 'Test query';
    const results = await service.searchKnowledgeBase(query, [], 5);

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  }, 30000);

  it('should handle knowledge base without embeddings', async () => {
    const kbEntries = [
      {
        id: 1,
        post_id: 'post_1',
        content: 'Some content',
        embedding: null
      }
    ];

    const query = 'Test query';
    const results = await service.searchKnowledgeBase(query, kbEntries, 5);

    expect(results).toBeDefined();
    expect(results.length).toBe(0);
  }, 30000);
});
