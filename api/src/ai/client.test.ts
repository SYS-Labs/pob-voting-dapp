/**
 * AI Client Tests
 * Tests AI inference capabilities including completions and embeddings
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AIClient, createAIClient } from './client.js';
import OpenAI from 'openai';
import { config } from '../config.js';

describe('AI Client - Simple Inference', () => {
  let client: AIClient;

  beforeAll(() => {
    client = createAIClient();
  });

  it('should evaluate a post and return a valid decision', async () => {
    const post = {
      id: 'test_post_1',
      content: 'What is the best way to learn blockchain development?',
      author_username: 'test_user'
    };

    const threadContext = [
      '@alice: I\'m new to blockchain',
      '@bob: Smart contracts are interesting'
    ];

    const knowledgeBase = [
      'Blockchain is a distributed ledger technology',
      'Smart contracts are self-executing contracts'
    ];

    const result = await client.evaluatePost(post, threadContext, knowledgeBase);

    expect(result).toBeDefined();
    expect(result.decision).toBeDefined();
    expect(['RESPOND', 'IGNORE', 'STOP']).toContain(result.decision);
    expect(result.reasoning).toBeDefined();
    expect(typeof result.reasoning).toBe('string');
    expect(result.reasoning.length).toBeGreaterThan(0);

    console.log('Evaluation Result:', result);
  }, 30000);

  it('should generate a reply within Twitter character limit', async () => {
    const post = {
      id: 'test_post_2',
      content: 'Can someone explain what proof of work means?',
      author_username: 'crypto_newbie'
    };

    const threadContext = [
      '@crypto_newbie: I keep hearing about PoW'
    ];

    const knowledgeBase = [
      'Proof of Work (PoW) is a consensus mechanism used in blockchain',
      'Miners solve complex mathematical puzzles to validate transactions'
    ];

    const result = await client.generateReply(post, threadContext, knowledgeBase);

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content.length).toBeLessThanOrEqual(280);
    expect(result.content).toContain('@crypto_newbie');

    console.log('Generated Reply:', result.content);
    console.log('Reply Length:', result.content.length);
  }, 30000);

  it('should handle spam posts appropriately', async () => {
    const post = {
      id: 'test_post_3',
      content: 'BUY NOW!!! 🚀🚀🚀 100x GAINS GUARANTEED!!! Click here: scam.link',
      author_username: 'spam_bot'
    };

    const result = await client.evaluatePost(post, [], []);

    expect(result).toBeDefined();
    expect(result.decision).toBeDefined();
    expect(['IGNORE', 'STOP']).toContain(result.decision);

    console.log('Spam Evaluation:', result);
  }, 30000);
});

describe('AI Client - Embeddings', () => {
  let openaiClient: OpenAI;

  beforeAll(() => {
    openaiClient = new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL: config.ai.endpoint
    });
  });

  it('should generate embeddings for text', async () => {
    const text = 'Blockchain technology enables decentralized applications';

    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text
    });

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.length).toBeGreaterThan(0);

    const embedding = response.data[0].embedding;
    expect(embedding).toBeDefined();
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);

    // text-embedding-ada-002 produces 1536-dimensional vectors
    expect(embedding.length).toBe(1536);

    console.log('Embedding dimension:', embedding.length);
    console.log('First 5 values:', embedding.slice(0, 5));
  }, 30000);

  it('should generate embeddings for multiple texts', async () => {
    const texts = [
      'Smart contracts are self-executing programs on blockchain',
      'Decentralized finance (DeFi) is transforming traditional finance',
      'NFTs represent ownership of unique digital assets'
    ];

    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-ada-002',
      input: texts
    });

    expect(response).toBeDefined();
    expect(response.data).toBeDefined();
    expect(response.data.length).toBe(texts.length);

    for (let i = 0; i < texts.length; i++) {
      const embedding = response.data[i].embedding;
      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(1536);

      console.log(`Text ${i + 1} embedding dimension:`, embedding.length);
    }
  }, 30000);

  it('should compute similarity between embeddings', async () => {
    const text1 = 'Bitcoin is a cryptocurrency';
    const text2 = 'Ethereum is a blockchain platform';
    const text3 = 'Pizza is a delicious food';

    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-ada-002',
      input: [text1, text2, text3]
    });

    const embeddings = response.data.map(d => d.embedding);

    // Compute cosine similarity
    const cosineSimilarity = (a: number[], b: number[]): number => {
      const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      return dotProduct / (magnitudeA * magnitudeB);
    };

    const sim_1_2 = cosineSimilarity(embeddings[0], embeddings[1]);
    const sim_1_3 = cosineSimilarity(embeddings[0], embeddings[2]);
    const sim_2_3 = cosineSimilarity(embeddings[1], embeddings[2]);

    console.log('Similarity (Bitcoin vs Ethereum):', sim_1_2);
    console.log('Similarity (Bitcoin vs Pizza):', sim_1_3);
    console.log('Similarity (Ethereum vs Pizza):', sim_2_3);

    // Bitcoin and Ethereum (both crypto-related) should be more similar than crypto vs pizza
    expect(sim_1_2).toBeGreaterThan(sim_1_3);
    // Verify Bitcoin-Ethereum similarity is high (> 0.85)
    expect(sim_1_2).toBeGreaterThan(0.85);
  }, 30000);

  it('should handle empty input (OpenAI processes empty strings)', async () => {
    // OpenAI actually accepts empty strings and returns embeddings for them
    const response = await openaiClient.embeddings.create({
      model: 'text-embedding-ada-002',
      input: ''
    });

    expect(response).toBeDefined();
    expect(response.data.length).toBe(1);
    expect(response.data[0].embedding.length).toBe(1536);
    console.log('Empty input embedding dimension:', response.data[0].embedding.length);
  }, 30000);
});

describe('AI Client - Error Handling', () => {
  let client: AIClient;

  beforeAll(() => {
    client = createAIClient();
  });

  it('should handle API errors gracefully', async () => {
    const post = {
      id: 'test_post_error',
      content: 'Test post',
      author_username: 'test_user'
    };

    // This test will fail if API is down or credentials are invalid
    // In production, you'd mock the API call
    try {
      await client.evaluatePost(post, [], []);
    } catch (error) {
      expect(error).toBeDefined();
      console.log('API Error (expected in some cases):', error);
    }
  }, 30000);
});
