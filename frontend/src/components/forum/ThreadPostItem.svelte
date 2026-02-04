<script lang="ts">
  import type { ThreadPost } from '~/interfaces/forum';
  import { generateAvatarImage } from '~/utils/format';

  interface Props {
    post: ThreadPost;
    index: number;
    explorerUrl: string;
  }

  let { post, index, explorerUrl }: Props = $props();

  const avatarImage = $derived(generateAvatarImage(post.authorUsername));

  function formatDate(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function shortenHash(hash: string): string {
    if (!hash) return '';
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
  }

  const postClass = $derived.by(() => {
    let classes = 'post-item';
    if (post.isTrusted) classes += ' post-trusted';
    if (index === 0) classes += ' post-original';
    return classes;
  });
</script>

<div
  class={postClass}
  style="margin-left: {post.depth * 20}px;"
>
  <div class="post-avatar">
    <div
      class="avatar-placeholder"
      style="background-image: url('{avatarImage}'); background-size: cover;"
    >
      {post.authorUsername.charAt(0).toUpperCase()}
    </div>
  </div>

  <div class="post-content-wrapper">
    <div class="post-header">
      <div class="post-author-info">
        <span class="post-author">@{post.authorUsername}</span>
        {#if post.authorDisplayName}
          <span class="post-display-name">{post.authorDisplayName}</span>
        {/if}
        {#if post.isTrusted}
          <span class="post-badge trusted">✓ Trusted</span>
        {/if}
      </div>
      <a
        href={`https://x.com/${post.authorUsername}/status/${post.id}`}
        target="_blank"
        rel="noopener noreferrer"
        class="post-date post-date-link"
      >
        {formatDate(post.timestamp)} ↗
      </a>
    </div>

    <div class="post-content">{post.content}</div>

    <div class="post-footer">
      <div class="post-stats">
        {#if post.likes > 0}
          <span class="post-stat">
            <span class="stat-icon">❤️</span> {post.likes}
          </span>
        {/if}
        {#if post.retweets > 0}
          <span class="post-stat">
            <span class="stat-icon">🔄</span> {post.retweets}
          </span>
        {/if}
        {#if post.repliesCount > 0}
          <span class="post-stat">
            <span class="stat-icon">💬</span> {post.repliesCount}
          </span>
        {/if}
      </div>

      {#if post.txHash}
        <a
          href={`${explorerUrl}/tx/${post.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          class="post-tx-link"
          title={`View transaction: ${post.txHash}`}
        >
          {shortenHash(post.txHash)}
        </a>
      {/if}
    </div>
  </div>
</div>
