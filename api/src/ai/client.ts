/**
 * AI API Client for OpenAI integration
 * Provides evaluation and reply generation using OpenAI models
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface EvaluationResult {
  decision: 'RESPOND' | 'IGNORE' | 'STOP';
  reasoning: string;
}

export interface ReplyResult {
  content: string;
}

export class AIClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.ai.apiKey,
      baseURL: config.ai.endpoint
    });
    this.model = config.ai.model;
  }

  /**
   * Evaluates whether a post warrants a response
   */
  async evaluatePost(
    post: { id: string; content: string; author_username: string; isTrusted?: boolean },
    threadContext: string[],
    knowledgeBase: string[]
  ): Promise<EvaluationResult> {
    try {
      const prompt = this.buildEvaluationPrompt(post, threadContext, knowledgeBase);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are an AI evaluator for a decentralized forum system. Your task is to decide if a post warrants a response.

Reply with JSON in this exact format:
{
  "decision": "RESPOND" | "IGNORE" | "STOP",
  "reasoning": "brief explanation"
}

RESPOND: Post asks a question related to the thread topic, makes a relevant point, or shows genuine interest in the discussion. Default to RESPOND for any on-topic engagement.
IGNORE: ONLY for spam, advertisements, completely off-topic content, or meaningless noise (e.g., "lol", "ok", "nice")
STOP: Post is offensive, hateful, or violates community guidelines

IMPORTANT GUIDELINES:
- **Trusted users** are domain experts contributing knowledge. They rarely need responses unless asking a direct question. Be selective - IGNORE most trusted user posts unless they explicitly ask a question.
- **Non-trusted users** are community members who may need help. RESPOND to their questions and engagement attempts. Questions are opportunities for engagement.
- Look for question marks, question words (what, how, why, when, where, who), or requests for information.
- Trusted users' posts are more likely statements/knowledge-sharing. Non-trusted users' posts are more likely questions/engagement-seeking.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      });

      const content = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(content) as EvaluationResult;

      logger.debug('AI evaluation complete', {
        postId: post.id,
        decision: result.decision
      });

      return result;
    } catch (error) {
      logger.error('AI evaluation failed', { error, postId: post.id });
      throw error;
    }
  }

  /**
   * Generates a reply to a post
   */
  async generateReply(
    post: { id: string; content: string; author_username: string },
    threadContext: string[],
    knowledgeBase: string[]
  ): Promise<ReplyResult> {
    try {
      const prompt = this.buildReplyPrompt(post, threadContext, knowledgeBase);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant for a decentralized forum. Generate concise, informative replies.

Rules:
- Keep replies under 280 characters (Twitter limit)
- **IMPORTANT: Respond in the SAME LANGUAGE as the user's post** (if they write in Spanish, respond in Spanish; if English, respond in English, etc.)
- Be respectful and professional
- Reference knowledge base when relevant
- Stay on topic with the thread context
- Use @${post.author_username} to address the person

Reply with JSON:
{
  "content": "your reply text here"
}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 150
      });

      const content = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(content) as ReplyResult;

      // Ensure reply fits Twitter's limit
      if (result.content.length > 280) {
        result.content = result.content.substring(0, 277) + '...';
      }

      logger.debug('AI reply generated', {
        postId: post.id,
        length: result.content.length
      });

      return result;
    } catch (error) {
      logger.error('AI reply generation failed', { error, postId: post.id });
      throw error;
    }
  }

  private buildEvaluationPrompt(
    post: { content: string; author_username: string; isTrusted?: boolean },
    threadContext: string[],
    knowledgeBase: string[]
  ): string {
    const userType = post.isTrusted ? 'TRUSTED (domain expert/contributor)' : 'NON-TRUSTED (community member)';
    let prompt = `Post from @${post.author_username} [${userType}]:\n"${post.content}"\n\n`;

    if (threadContext.length > 0) {
      prompt += `Thread context (recent messages):\n${threadContext.join('\n')}\n\n`;
    }

    if (knowledgeBase.length > 0) {
      prompt += `Knowledge base (relevant info):\n${knowledgeBase.slice(0, 5).join('\n')}\n\n`;
    }

    prompt += 'Should we respond to this post?';

    return prompt;
  }

  private buildReplyPrompt(
    post: { content: string; author_username: string },
    threadContext: string[],
    knowledgeBase: string[]
  ): string {
    let prompt = `Generate a helpful reply to this post from @${post.author_username}:\n"${post.content}"\n\n`;

    if (threadContext.length > 0) {
      prompt += `Thread context:\n${threadContext.join('\n')}\n\n`;
    }

    if (knowledgeBase.length > 0) {
      prompt += `Use this knowledge base:\n${knowledgeBase.slice(0, 5).join('\n')}\n\n`;
    }

    prompt += 'Generate a concise, helpful reply (under 280 chars).';

    return prompt;
  }
}

// Singleton instance
let aiClient: AIClient | null = null;

export function createAIClient(): AIClient {
  if (!aiClient) {
    aiClient = new AIClient();
  }
  return aiClient;
}
