<script lang="ts">
  import { navigate } from 'svelte-routing';
  import ThreadList from '~/components/forum/ThreadList.svelte';
  import ThreadDetail from '~/components/forum/ThreadDetail.svelte';
  import AdminPanel from '~/components/forum/AdminPanel.svelte';
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

  interface Props {
    tweetId?: string;
    walletAddress: string | null;
  }

  let { tweetId, walletAddress }: Props = $props();

  let threads = $state<ThreadSummary[]>([]);
  let posts = $state<ThreadPost[]>([]);
  let monitoredThreads = $state<MonitoredThread[]>([]);
  let loadingThreads = $state(false);
  let loadingThreadDetail = $state(false);
  let error = $state<string | null>(null);

  // Check if connected wallet is admin
  const isAdminConnected = $derived(walletAddress?.toLowerCase() === configuredAdmin);

  // Load threads on mount
  $effect(() => {
    loadThreads();
    if (isAdminConnected) {
      loadMonitoredThreads();
    }
  });

  // Load thread detail when tweetId changes
  $effect(() => {
    if (tweetId) {
      loadThreadDetail(tweetId);
    } else {
      posts = [];
    }
  });

  async function loadThreads() {
    try {
      loadingThreads = true;
      const fetchedThreads = await fetchThreads();
      threads = fetchedThreads;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loadingThreads = false;
    }
  }

  async function loadThreadDetail(conversationId: string) {
    try {
      loadingThreadDetail = true;
      const fetchedPosts = await fetchThreadDetail(conversationId);
      posts = fetchedPosts;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      posts = [];
    } finally {
      loadingThreadDetail = false;
    }
  }

  async function loadMonitoredThreads() {
    try {
      const fetchedMonitoredThreads = await fetchMonitoredThreads();
      monitoredThreads = fetchedMonitoredThreads;
    } catch (err) {
      console.error('Failed to load monitored threads:', err);
    }
  }

  async function handleRegisterThread(postId: string, signature: string, message: string) {
    const thread = await registerThread(postId, signature, message);
    monitoredThreads = [...monitoredThreads, thread];
    await loadMonitoredThreads();
  }

  async function handleToggleStatus(
    _threadId: number,
    postId: string,
    currentStatus: string,
    signature: string,
    message: string
  ) {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    await updateThreadStatus(postId, newStatus as 'active' | 'paused' | 'archived', signature, message);
    await loadMonitoredThreads();
  }

  function shortenAddress(addr: string): string {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function handleSelectThread(conversationId: string) {
    navigate(`/forum/${conversationId}`);
  }

  function handleBack() {
    navigate('/forum');
  }
</script>

<div class="forum-container">
  <!-- Simple header -->
  <header class="forum-header">
    <h1>
      Forum{' '}
      {#if contractAddress}
        <a
          href={`${explorerUrl}/address/${contractAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          class="forum-contract-link"
        >
          ({shortenAddress(contractAddress)})
        </a>
      {/if}
    </h1>
  </header>

  <!-- Main content -->
  <main class="forum-main">
    {#if !tweetId}
      <!-- Thread list view -->
      <ThreadList
        {threads}
        loading={loadingThreads}
        onRefresh={loadThreads}
        onSelectThread={handleSelectThread}
      />
    {:else}
      <!-- Thread detail view -->
      <ThreadDetail
        {posts}
        loading={loadingThreadDetail}
        {explorerUrl}
        onBack={handleBack}
      />
    {/if}
  </main>

  <!-- Admin panel (conditional) -->
  {#if isAdminConnected}
    <AdminPanel
      {monitoredThreads}
      onRegisterThread={handleRegisterThread}
      onToggleStatus={handleToggleStatus}
      onRefresh={loadMonitoredThreads}
      {walletAddress}
      isAdminAddress={isAdminConnected}
    />
  {/if}

  <!-- Error toast -->
  {#if error}
    <div class="forum-error-toast">
      <span>⚠</span>
      <div>
        <p>{error}</p>
        <button onclick={() => error = null}>Dismiss</button>
      </div>
    </div>
  {/if}
</div>
