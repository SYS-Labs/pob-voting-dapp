import ThreadPostItem from './ThreadPostItem.tsx'; // Import the new component
import type { ThreadPost } from '~/interfaces/forum';

interface ThreadDetailProps {
  posts: ThreadPost[];
  loading: boolean;
  explorerUrl: string;
  onBack: () => void;
}

const ThreadDetail = ({ posts, loading, explorerUrl, onBack }: ThreadDetailProps) => {
  // Removed formatDate and shortenHash functions

  if (loading) {
    return (
      <div className="thread-detail-loading">
        <button onClick={onBack} className="back-button">
          ← Back
        </button>
        <div className="spinner"></div>
        <p>Loading thread...</p>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="thread-detail-empty">
        <button onClick={onBack} className="back-button">
          ← Back
        </button>
        <p>No posts found</p>
      </div>
    );
  }

  return (
    <div className="thread-detail">
      <div className="thread-detail-header">
        <button onClick={onBack} className="back-button">
          ← Back to threads
        </button>
      </div>

      <div className="thread-posts">
        {posts.map((post, index) => (
          <ThreadPostItem
            key={post.id}
            post={post}
            index={index}
            explorerUrl={explorerUrl}
          />
        ))}
      </div>
    </div>
  );
};

export default ThreadDetail;
