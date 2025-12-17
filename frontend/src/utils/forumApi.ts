/**
 * Forum API Client
 *
 * Client functions for communicating with the Forum backend API
 */

import type { ThreadSummary, ThreadPost, MonitoredThread } from '~/interfaces/forum';

const apiBase = import.meta.env.VITE_FORUM_API_BASE_URL || 'http://localhost:4000';

/**
 * Fetch all indexed threads
 */
export async function fetchThreads(): Promise<ThreadSummary[]> {
  const res = await fetch(`${apiBase}/api/threads`);
  if (!res.ok) {
    throw new Error(`Failed to fetch threads: ${res.statusText}`);
  }
  const data = await res.json();
  return data.threads || [];
}

/**
 * Fetch thread detail with all posts
 */
export async function fetchThreadDetail(conversationId: string): Promise<ThreadPost[]> {
  const res = await fetch(`${apiBase}/api/threads/${conversationId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch thread detail: ${res.statusText}`);
  }
  const data = await res.json();
  return data.posts || [];
}

/**
 * Fetch admin-managed monitored threads
 */
export async function fetchMonitoredThreads(): Promise<MonitoredThread[]> {
  const res = await fetch(`${apiBase}/api/admin/threads`);
  if (!res.ok) {
    throw new Error(`Failed to fetch monitored threads: ${res.statusText}`);
  }
  const data = await res.json();
  return data.threads || [];
}

/**
 * Register a new thread for monitoring (admin only)
 */
export async function registerThread(
  postId: string,
  signature: string,
  message: string
): Promise<MonitoredThread> {
  const res = await fetch(`${apiBase}/api/admin/threads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ postId, signature, message }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to register thread');
  }

  const data = await res.json();
  return data.thread;
}

/**
 * Update thread status (admin only)
 */
export async function updateThreadStatus(
  threadId: number,
  status: 'active' | 'paused' | 'archived',
  signature: string,
  message: string
): Promise<void> {
  const res = await fetch(`${apiBase}/api/admin/threads/${threadId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status, signature, message }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to update thread status');
  }
}
