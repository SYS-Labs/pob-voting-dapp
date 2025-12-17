/**
 * ThreadListPanel Component
 *
 * Displays the list of indexed threads in a sidebar panel
 */

import type { ThreadSummary } from '~/interfaces/forum';
import ThreadCard from './ThreadCard';

interface ThreadListPanelProps {
  threads: ThreadSummary[];
  selectedConversation: string | null;
  onSelectThread: (conversationId: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

const ThreadListPanel = ({
  threads,
  selectedConversation,
  onSelectThread,
  loading,
  onRefresh,
}: ThreadListPanelProps) => {
  return (
    <section className="pob-pane">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="pob-pane__heading text-lg">Threads</h3>
          <button
            className="pob-button pob-button--outline pob-button--small"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loading && threads.length === 0 ? (
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
              Loading threads...
            </p>
          </div>
        ) : threads.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-[var(--pob-text-muted)] mb-2">
              No threads indexed yet.
            </p>
            <p className="text-xs text-[var(--pob-text-dim)]">
              Threads will appear here once the indexer starts monitoring X posts.
            </p>
          </div>
        ) : (
          <div className="pob-forum-thread-list">
            {threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                active={thread.conversationId === selectedConversation}
                onClick={() => onSelectThread(thread.conversationId)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default ThreadListPanel;
