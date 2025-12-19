/**
 * ThreadItem Component
 * Individual thread item in the thread list
 */

import type { ThreadSummary } from '~/interfaces/forum';
import { generateAvatarImage } from '~/utils/format';

interface ThreadItemProps {
  thread: ThreadSummary;
  onSelectThread: (conversationId: string) => void;
}

const ThreadItem = ({ thread, onSelectThread }: ThreadItemProps) => {
  const avatarImage = generateAvatarImage(thread.authorUsername);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes}m`;
      }
      return `${hours}h`;
    } else if (days < 7) {
      return `${days}d`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const truncateContent = (content: string, maxLength: number = 120) => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  };

  return (
    <div
      className="thread-item"
      onClick={() => onSelectThread(thread.conversationId)}
    >
      <div className="thread-item-main">
        <div className="thread-item-avatar">
          <div className="avatar-placeholder" style={{ backgroundImage: `url("${avatarImage}")`, backgroundSize: 'cover' }}>
            {thread.authorUsername.charAt(0).toUpperCase()}
          </div>
        </div>

        <div className="thread-item-content">
          <div className="thread-item-title">
            {truncateContent(thread.content)}
          </div>
          <div className="thread-item-meta">
            <span className="thread-author">@{thread.authorUsername}</span>
            <span className="thread-separator">•</span>
            <a
              href={`https://x.com/${thread.authorUsername}/status/${thread.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="thread-date thread-date-link"
              onClick={(e) => e.stopPropagation()}
            >
              {formatDate(thread.timestamp)} ↗
            </a>
          </div>
        </div>

        <div className="thread-item-stats">
          {thread.repliesCount && thread.repliesCount > 0 && (
            <div className="thread-stat" title={`${thread.repliesCount} replies`}>
              <span className="stat-icon">💬</span>
              <span className="stat-value">{thread.repliesCount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThreadItem;
