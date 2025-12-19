/**
 * ThreadList Component
 *
 * Minimalist thread list showing conversations sorted by recent activity
 * Discourse-inspired design
 */

import ThreadItem from './ThreadItem.tsx'; // Import the new component
import type { ThreadSummary } from '~/interfaces/forum';

interface ThreadListProps {
  threads: ThreadSummary[];
  loading: boolean;
  onRefresh: () => void;
  onSelectThread: (conversationId: string) => void;
}

const ThreadList = ({ threads, loading, onRefresh, onSelectThread }: ThreadListProps) => {
  // Removed formatDate and truncateContent functions

  if (loading) {
    return (
      <div className="thread-list-loading">
        <div className="spinner"></div>
        <p>Loading threads...</p>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="thread-list-empty">
        <p>No threads found</p>
        <button onClick={onRefresh} className="refresh-button">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="thread-list">
      <div className="thread-list-header">
        <h2>Latest Threads</h2>
        <button onClick={onRefresh} className="refresh-button" title="Refresh">
          ↻
        </button>
      </div>

      <div className="thread-list-items">
        {threads.map((thread) => (
          <ThreadItem
            key={thread.conversationId}
            thread={thread}
            onSelectThread={onSelectThread}
          />
        ))}
      </div>
    </div>
  );
};

export default ThreadList;
