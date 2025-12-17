/**
 * ThreadDetailPanel Component
 *
 * Displays the selected thread with all posts in a nested tree structure
 */

import type { ThreadPost } from '~/interfaces/forum';
import PostCard from './PostCard';

interface ThreadDetailPanelProps {
  posts: ThreadPost[];
  loading: boolean;
  explorerUrl: string;
}

const ThreadDetailPanel = ({ posts, loading, explorerUrl }: ThreadDetailPanelProps) => {
  return (
    <section className="pob-pane">
      <div className="space-y-4">
        <h3 className="pob-pane__heading text-lg">Thread Detail</h3>

        {loading && posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="tx-spinner mb-4">
              <svg
                width="48"
                height="48"
                viewBox="0 0 48 48"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="rgba(247, 147, 26, 0.2)"
                  strokeWidth="4"
                />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="rgb(247, 147, 26)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray="125.6"
                  strokeDashoffset="31.4"
                  className="tx-spinner__circle"
                />
              </svg>
            </div>
            <p className="text-sm text-[var(--pob-text-muted)]">
              Loading thread...
            </p>
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--pob-text-muted)]">
              Select a thread to view details.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} explorerUrl={explorerUrl} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default ThreadDetailPanel;
