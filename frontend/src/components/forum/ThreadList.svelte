<script lang="ts">
  import ThreadItem from './ThreadItem.svelte';
  import type { ThreadSummary } from '~/interfaces/forum';

  interface Props {
    threads: ThreadSummary[];
    loading: boolean;
    onRefresh: () => void;
    onSelectThread: (conversationId: string) => void;
  }

  let { threads, loading, onRefresh, onSelectThread }: Props = $props();
</script>

{#if loading}
  <div class="thread-list-loading">
    <div class="spinner"></div>
    <p>Loading threads...</p>
  </div>
{:else if threads.length === 0}
  <div class="thread-list-empty">
    <p>No threads found</p>
    <button onclick={onRefresh} class="refresh-button">
      Refresh
    </button>
  </div>
{:else}
  <div class="thread-list">
    <div class="thread-list-header">
      <h2>Latest Threads</h2>
      <button onclick={onRefresh} class="refresh-button" title="Refresh">
        ↻
      </button>
    </div>

    <div class="thread-list-items">
      {#each threads as thread (thread.conversationId)}
        <ThreadItem {thread} {onSelectThread} />
      {/each}
    </div>
  </div>
{/if}
