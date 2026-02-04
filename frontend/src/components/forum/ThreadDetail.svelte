<script lang="ts">
  import ThreadPostItem from './ThreadPostItem.svelte';
  import type { ThreadPost } from '~/interfaces/forum';

  interface Props {
    posts: ThreadPost[];
    loading: boolean;
    explorerUrl: string;
    onBack: () => void;
  }

  let { posts, loading, explorerUrl, onBack }: Props = $props();
</script>

{#if loading}
  <div class="thread-detail-loading">
    <button onclick={onBack} class="back-button">
      ← Back
    </button>
    <div class="spinner"></div>
    <p>Loading thread...</p>
  </div>
{:else if posts.length === 0}
  <div class="thread-detail-empty">
    <button onclick={onBack} class="back-button">
      ← Back
    </button>
    <p>No posts found</p>
  </div>
{:else}
  <div class="thread-detail">
    <div class="thread-detail-header">
      <button onclick={onBack} class="back-button">
        ← Back to threads
      </button>
    </div>

    <div class="thread-posts">
      {#each posts as post, index (post.id)}
        <ThreadPostItem {post} {index} {explorerUrl} />
      {/each}
    </div>
  </div>
{/if}
