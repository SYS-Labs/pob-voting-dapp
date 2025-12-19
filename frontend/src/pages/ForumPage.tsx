/**
 * ForumPage Component
 *
 * Minimalist forum with thread list and detail views
 * Routes:
 * - /forum - Thread list (sorted by recent activity)
 * - /forum/:tweetId - Thread detail
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ThreadList from '~/components/forum/ThreadList';
import ThreadDetail from '~/components/forum/ThreadDetail';
import AdminPanel from '~/components/forum/AdminPanel';
import {
  fetchThreads,
  fetchThreadDetail,
  fetchMonitoredThreads,
  registerThread,
  updateThreadStatus,
} from '~/utils/forumApi';
import type { ThreadSummary, ThreadPost, MonitoredThread } from '~/interfaces/forum';

// Get environment variables
const configuredAdmin = (import.meta.env.VITE_FORUM_ADMIN_ADDRESS || '').toLowerCase();
const contractAddress = import.meta.env.VITE_FORUM_CONTRACT_ADDRESS || '';
const explorerUrl = import.meta.env.VITE_FORUM_EXPLORER_URL || 'https://explorer.tanenbaum.io';

interface ForumPageProps {
  walletAddress: string | null;
}

const ForumPage = ({ walletAddress }: ForumPageProps) => {
  const { tweetId } = useParams<{ tweetId: string }>();
  const navigate = useNavigate();

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [posts, setPosts] = useState<ThreadPost[]>([]);
  const [monitoredThreads, setMonitoredThreads] = useState<MonitoredThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingThreadDetail, setLoadingThreadDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if connected wallet is admin
  const isAdminConnected = walletAddress?.toLowerCase() === configuredAdmin;

  // Load threads on mount
  useEffect(() => {
    void loadThreads();
    if (isAdminConnected) {
      void loadMonitoredThreads();
    }
  }, [isAdminConnected]);

  // Load thread detail when tweetId changes
  useEffect(() => {
    if (tweetId) {
      void loadThreadDetail(tweetId);
    } else {
      setPosts([]);
    }
  }, [tweetId]);

  async function loadThreads() {
    try {
      setLoadingThreads(true);
      const fetchedThreads = await fetchThreads();
      setThreads(fetchedThreads);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingThreads(false);
    }
  }

  async function loadThreadDetail(conversationId: string) {
    try {
      setLoadingThreadDetail(true);
      const fetchedPosts = await fetchThreadDetail(conversationId);
      setPosts(fetchedPosts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPosts([]);
    } finally {
      setLoadingThreadDetail(false);
    }
  }

  async function loadMonitoredThreads() {
    try {
      const fetchedMonitoredThreads = await fetchMonitoredThreads();
      setMonitoredThreads(fetchedMonitoredThreads);
    } catch (err) {
      console.error('Failed to load monitored threads:', err);
    }
  }

  async function handleRegisterThread(postId: string, signature: string, message: string) {
    const thread = await registerThread(postId, signature, message);
    setMonitoredThreads((prev) => [...prev, thread]);
    await loadMonitoredThreads();
  }

  async function handleToggleStatus(
    threadId: number,
    _postId: string,
    currentStatus: string,
    signature: string,
    message: string
  ) {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    await updateThreadStatus(threadId, newStatus as 'active' | 'paused' | 'archived', signature, message);
    await loadMonitoredThreads();
  }

  const shortenAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="forum-container">
      {/* Simple header */}
      <header className="forum-header">
        <h1>
          Forum{' '}
          {contractAddress && (
            <a
              href={`${explorerUrl}/address/${contractAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="forum-contract-link"
            >
              ({shortenAddress(contractAddress)})
            </a>
          )}
        </h1>
      </header>

      {/* Main content */}
      <main className="forum-main">
        {!tweetId ? (
          // Thread list view
          <ThreadList
            threads={threads}
            loading={loadingThreads}
            onRefresh={loadThreads}
            onSelectThread={(conversationId) => navigate(`/forum/${conversationId}`)}
          />
        ) : (
          // Thread detail view
          <ThreadDetail
            posts={posts}
            loading={loadingThreadDetail}
            explorerUrl={explorerUrl}
            onBack={() => navigate('/forum')}
          />
        )}
      </main>

      {/* Admin panel (conditional) */}
      {isAdminConnected && (
        <AdminPanel
          monitoredThreads={monitoredThreads}
          onRegisterThread={handleRegisterThread}
          onToggleStatus={handleToggleStatus}
          onRefresh={loadMonitoredThreads}
          walletAddress={walletAddress}
          isAdminAddress={isAdminConnected}
        />
      )}

      {/* Error toast */}
      {error && (
        <div className="forum-error-toast">
          <span>⚠</span>
          <div>
            <p>{error}</p>
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ForumPage;
