/**
 * ThreadCard Component
 *
 * Displays a thread summary card in the thread list
 */

import type { ThreadSummary } from '~/interfaces/forum';

interface ThreadCardProps {
  thread: ThreadSummary;
  active: boolean;
  onClick: () => void;
}

const ThreadCard = ({ thread, active, onClick }: ThreadCardProps) => {
  const truncate = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div
      className={`pob-card pob-forum-thread-card ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <div className="flex gap-2 mb-2 flex-wrap">
        <span className="pob-pill pob-pill--small">@{thread.authorUsername}</span>
        {thread.isTrusted && (
          <span className="pob-pill pob-pill--small" style={{ background: 'var(--pob-primary)' }}>
            trusted
          </span>
        )}
        <span className="text-xs text-[var(--pob-text-dim)] ml-auto">
          {formatTimestamp(thread.timestamp)}
        </span>
      </div>
      <p className="text-sm text-[var(--pob-text-muted)]">
        {truncate(thread.content, 120)}
      </p>
      {thread.repliesCount !== undefined && thread.repliesCount > 0 && (
        <div className="text-xs text-[var(--pob-text-dim)] mt-2">
          {thread.repliesCount} {thread.repliesCount === 1 ? 'reply' : 'replies'}
        </div>
      )}
    </div>
  );
};

export default ThreadCard;
