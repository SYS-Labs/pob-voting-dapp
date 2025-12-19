/**
 * ThreadPostItem Component
 * Individual post item in a thread detail view
 */

import type { ThreadPost } from '~/interfaces/forum';
import { generateAvatarImage } from '~/utils/format';

interface ThreadPostItemProps {
  post: ThreadPost;
  index: number;
  explorerUrl: string;
}

const ThreadPostItem = ({ post, index, explorerUrl }: ThreadPostItemProps) => {
  const avatarImage = generateAvatarImage(post.authorUsername);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const shortenHash = (hash: string) => {
    if (!hash) return '';
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  };

  return (
    <div
      className={`post-item ${post.isTrusted ? 'post-trusted' : ''} ${index === 0 ? 'post-original' : ''}`}
      style={{ marginLeft: `${post.depth * 20}px` }}
    >
      <div className="post-avatar">
        <div className="avatar-placeholder" style={{ backgroundImage: `url("${avatarImage}")`, backgroundSize: 'cover' }}>
          {post.authorUsername.charAt(0).toUpperCase()}
        </div>
      </div>

      <div className="post-content-wrapper">
        <div className="post-header">
          <div className="post-author-info">
            <span className="post-author">@{post.authorUsername}</span>
            {post.authorDisplayName && (
              <span className="post-display-name">{post.authorDisplayName}</span>
            )}
            {post.isTrusted && <span className="post-badge trusted">✓ Trusted</span>}
          </div>
          <a
            href={`https://x.com/${post.authorUsername}/status/${post.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="post-date post-date-link"
          >
            {formatDate(post.timestamp)} ↗
          </a>
        </div>

        <div className="post-content">{post.content}</div>

        <div className="post-footer">
          <div className="post-stats">
            {post.likes > 0 && (
              <span className="post-stat">
                <span className="stat-icon">❤️</span> {post.likes}
              </span>
            )}
            {post.retweets > 0 && (
              <span className="post-stat">
                <span className="stat-icon">🔄</span> {post.retweets}
              </span>
            )}
            {post.repliesCount > 0 && (
              <span className="post-stat">
                <span className="stat-icon">💬</span> {post.repliesCount}
              </span>
            )}
          </div>

          {post.txHash && (
            <a
              href={`${explorerUrl}/tx/${post.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="post-tx-link"
              title={`View transaction: ${post.txHash}`}
            >
              📜 {shortenHash(post.txHash)}
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default ThreadPostItem;
