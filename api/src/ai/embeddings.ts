/**
 * Embedding service for semantic search
 * Uses OpenAI embeddings to enable knowledge base similarity search
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface EmbeddingVector {
  embedding: number[];
  text: string;
}

export interface KnowledgeBaseEntry {
  id: number;
  post_id: string;
  content: string;
  embedding: number[] | null;
  similarity?: number;
}

export class EmbeddingService {
  private client: OpenAI;
  private model = 'text-embedding-ada-002';

  constructor() {
    this.client = new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL: config.ai.endpoint
    });
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text
      });

      return response.data[0].embedding;
    } catch (error) {
      logger.error('Failed to generate embedding', { error, text: text.substring(0, 50) });
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts
      });

      return response.data.map(d => d.embedding);
    } catch (error) {
      logger.error('Failed to generate embeddings', { error, count: texts.length });
      throw error;
    }
  }

  /**
   * Compute cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Search knowledge base using semantic similarity
   * Returns top N most similar entries
   */
  async searchKnowledgeBase(
    query: string,
    knowledgeBase: KnowledgeBaseEntry[],
    topK: number = 5
  ): Promise<KnowledgeBaseEntry[]> {
    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Filter entries that have embeddings
    const entriesWithEmbeddings = knowledgeBase.filter(entry => entry.embedding !== null);

    if (entriesWithEmbeddings.length === 0) {
      logger.warn('No knowledge base entries have embeddings');
      return [];
    }

    // Compute similarity scores
    const scoredEntries = entriesWithEmbeddings.map(entry => ({
      ...entry,
      similarity: this.cosineSimilarity(queryEmbedding, entry.embedding!)
    }));

    // Sort by similarity (highest first) and take top K
    scoredEntries.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

    const topEntries = scoredEntries.slice(0, topK);

    logger.debug('Knowledge base search complete', {
      query: query.substring(0, 50),
      totalEntries: knowledgeBase.length,
      topK,
      topSimilarity: topEntries[0]?.similarity || 0
    });

    return topEntries;
  }

  /**
   * Search and return only the content strings (for backward compatibility)
   */
  async searchKnowledgeBaseContent(
    query: string,
    knowledgeBase: KnowledgeBaseEntry[],
    topK: number = 5,
    minSimilarity: number = 0.7
  ): Promise<string[]> {
    const results = await this.searchKnowledgeBase(query, knowledgeBase, topK);

    // Filter by minimum similarity threshold
    const filtered = results.filter(entry => (entry.similarity || 0) >= minSimilarity);

    return filtered.map(entry => entry.content);
  }
}

// Singleton instance
let embeddingService: EmbeddingService | null = null;

export function createEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
}
