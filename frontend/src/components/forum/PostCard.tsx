/**
 * PostCard Component
 *
 * Displays an individual post with metadata and blockchain status
 */

import type { ThreadPost } from '~/interfaces/forum';

interface PostCardProps {
  post: ThreadPost;
  explorerUrl: string;
}

const PostCard = ({ post, explorerUrl }: PostCardProps) => {
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTxStatusBadge = () => {
    if (!post.txHash) return null;

    let statusText = 'Pending';
    let statusClass = 'pob-pill--warning';

    if (post.txStatus === 'confirmed' || post.txStatus === 'tx_confirmed') {
      statusText = `Confirmed (${post.txConfirmations || 0})`;
      statusClass = '';
    } else if (post.txStatus === 'final' || post.txStatus === 'tx_final') {
      statusText = 'Final';
      statusClass = 'pob-pill--success';
    }

    return (
      <span className={`pob-pill pob-pill--small ${statusClass}`}>
        {statusText}
      </span>
    );
  };

  const xPostUrl = `https://x.com/${post.authorUsername}/status/${post.id}`;

  return (
    <div
      className={`pob-forum-post ${post.isTrusted ? 'pob-forum-post--trusted' : ''}`}
      style={{ marginLeft: `${post.depth * 0.75}rem` }}
    >
      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <span className="pob-pill pob-pill--small">@{post.authorUsername}</span>
        {post.isTrusted && (
          <span className="pob-pill pob-pill--small" style={{ background: 'var(--pob-primary)' }}>
            trusted
          </span>
        )}
        {getTxStatusBadge()}
        <span className="text-xs text-[var(--pob-text-dim)] ml-auto">
          {formatTimestamp(post.timestamp)}
        </span>
      </div>

      <p className="text-sm text-[var(--pob-text)] whitespace-pre-wrap mb-2">
        {post.content}
      </p>

      <div className="flex gap-4 text-xs text-[var(--pob-text-dim)]">
        {post.likes > 0 && <span>♥ {post.likes}</span>}
        {post.retweets > 0 && <span>↻ {post.retweets}</span>}
        {post.repliesCount > 0 && <span>💬 {post.repliesCount}</span>}

        <a
          href={xPostUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--pob-primary)] hover:underline ml-auto"
        >
          View on X →
        </a>

        {post.txHash && (
          <a
            href={`${explorerUrl}/tx/${post.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--pob-primary)] hover:underline"
          >
            Blockchain →
          </a>
        )}
      </div>
    </div>
  );
};

export default PostCard;
