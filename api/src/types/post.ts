/**
 * Post types for X (Twitter) data
 */

export interface Post {
  id: string;                    // X post ID
  authorUsername: string;        // @username
  authorDisplayName: string;     // Display name
  content: string;               // Tweet text
  parentId: string | null;       // Parent post ID (null for root)
  conversationId: string;        // Thread ID
  depth: number;                 // 0 = root, 1-3 = replies
  timestamp: Date;               // Post timestamp
  likes: number;
  retweets: number;
  replies: number;
  mediaUrls: string[];
  isTrusted: boolean;           // From config trusted users
}

export interface PostRecord {
  id: string;
  author_username: string;
  author_display_name: string;
  content: string;
  content_hash: string | null;
  parent_id: string | null;
  conversation_id: string;
  depth: number;
  timestamp: string;            // ISO string
  likes: number;
  retweets: number;
  replies_count: number;
  is_trusted: boolean;
  indexed_at: string;           // ISO string
  processed_at: string | null;  // ISO string or null
}

export function postToRecord(post: Post): Omit<PostRecord, 'content_hash' | 'indexed_at' | 'processed_at'> {
  return {
    id: post.id,
    author_username: post.authorUsername,
    author_display_name: post.authorDisplayName,
    content: post.content,
    parent_id: post.parentId,
    conversation_id: post.conversationId,
    depth: post.depth,
    timestamp: post.timestamp.toISOString(),
    likes: post.likes,
    retweets: post.retweets,
    replies_count: post.replies,
    is_trusted: post.isTrusted
  };
}

