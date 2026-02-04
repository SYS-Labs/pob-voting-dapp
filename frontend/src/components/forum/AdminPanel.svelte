<script lang="ts">
  import type { MonitoredThread } from '~/interfaces/forum';

  interface Props {
    monitoredThreads: MonitoredThread[];
    onRegisterThread: (postId: string, signature: string, message: string) => Promise<void>;
    onToggleStatus: (
      threadId: number,
      postId: string,
      currentStatus: string,
      signature: string,
      message: string
    ) => Promise<void>;
    onRefresh: () => void;
    walletAddress: string | null;
    isAdminAddress: boolean;
  }

  let {
    monitoredThreads,
    onRegisterThread,
    onToggleStatus,
    onRefresh,
    walletAddress,
    isAdminAddress,
  }: Props = $props();

  let newPostId = $state('');
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function handleRegisterThread() {
    let postId = newPostId.trim();

    // Extract post ID from URL if user pasted a full URL
    const urlMatch = postId.match(/status\/(\d+)/);
    if (urlMatch) {
      postId = urlMatch[1];
    }

    if (!postId) {
      error = 'Please enter a post ID or URL';
      return;
    }

    if (!walletAddress || !isAdminAddress) {
      error = 'Must be admin to register threads';
      return;
    }

    if (typeof window === 'undefined' || !window.ethereum) {
      error = 'No wallet detected';
      return;
    }

    const message = `Register thread ${postId} at ${new Date().toISOString()}`;

    try {
      status = 'Requesting signature...';
      error = null;

      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      });

      status = 'Registering thread...';
      await onRegisterThread(postId, signature as string, message);

      status = '✅ Thread registered';
      newPostId = '';
      setTimeout(() => status = null, 3000);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      status = null;
    }
  }

  async function handleToggleStatus(thread: MonitoredThread) {
    if (!walletAddress || !isAdminAddress) {
      error = 'Must be admin to update threads';
      return;
    }

    if (typeof window === 'undefined' || !window.ethereum) {
      error = 'No wallet detected';
      return;
    }

    const newStatus = thread.status === 'active' ? 'paused' : 'active';
    const message = `Update thread ${thread.post_id} to ${newStatus} at ${new Date().toISOString()}`;

    try {
      error = null;

      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      });

      await onToggleStatus(thread.id, thread.post_id, thread.status, signature as string, message);
      status = `✅ Thread ${newStatus}`;
      setTimeout(() => status = null, 2000);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function shortenAddress(addr: string): string {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      handleRegisterThread();
    }
  }

  function getPillClass(threadStatus: string): string {
    if (threadStatus === 'active') return '';
    if (threadStatus === 'paused') return 'pob-pill--warning';
    return 'pob-pill--muted';
  }
</script>

<section class="pob-forum-admin">
  <div class="space-y-6">
    <div>
      <div class="flex items-center gap-2 mb-2">
        <h3 class="pob-pane__heading text-lg">Admin Panel</h3>
        {#if walletAddress}
          <span class={`pob-pill pob-pill--small ${isAdminAddress ? '' : 'pob-pill--danger'}`}>
            {isAdminAddress ? 'Admin' : 'Not Admin'}: {shortenAddress(walletAddress)}
          </span>
        {/if}
      </div>
      <p class="text-sm text-[var(--pob-text-muted)]">
        Register new X posts to index. The indexer will automatically poll these threads.
      </p>
    </div>

    <!-- Register new thread -->
    <div class="flex gap-2">
      <input
        type="text"
        class="pob-input flex-1"
        placeholder="X Post ID or URL"
        bind:value={newPostId}
        onkeydown={handleKeydown}
      />
      <button class="pob-button" onclick={handleRegisterThread}>
        Register Thread
      </button>
    </div>

    {#if status}
      <div class="text-sm text-[var(--pob-primary)]">{status}</div>
    {/if}

    {#if error}
      <div class="text-sm text-red-400">{error}</div>
    {/if}

    <!-- Monitored threads list -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h4 class="text-base font-medium">
          Registered Threads ({monitoredThreads.length})
        </h4>
        <button class="pob-button pob-button--outline pob-button--small" onclick={onRefresh}>
          Refresh
        </button>
      </div>

      {#if monitoredThreads.length === 0}
        <p class="text-sm text-[var(--pob-text-muted)]">
          No threads registered yet. Register one above.
        </p>
      {:else}
        <div class="space-y-2">
          {#each monitoredThreads as thread (thread.id)}
            <div class="pob-card flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-sm font-mono">{thread.post_id}</span>
                <span class={`pob-pill pob-pill--small ${getPillClass(thread.status)}`}>
                  {thread.status}
                </span>
              </div>
              {#if thread.status !== 'archived'}
                <button
                  class="pob-button pob-button--outline pob-button--small"
                  onclick={() => handleToggleStatus(thread)}
                >
                  {thread.status === 'active' ? 'Pause' : 'Resume'}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>
