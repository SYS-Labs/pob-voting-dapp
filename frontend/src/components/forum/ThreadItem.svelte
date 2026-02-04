<script lang="ts">
  import type { ThreadSummary } from '~/interfaces/forum';
  import { generateAvatarImage } from '~/utils/format';

  interface Props {
    thread: ThreadSummary;
    onSelectThread: (conversationId: string) => void;
  }

  let { thread, onSelectThread }: Props = $props();

  const avatarImage = $derived(generateAvatarImage(thread.authorUsername));

  function formatDate(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes}m`;
      }
      return `${hours}h`;
    } else if (days < 7) {
      return `${days}d`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  }

  function truncateContent(content: string, maxLength: number = 120): string {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  }

  function handleClick() {
    onSelectThread(thread.conversationId);
  }

  function handleLinkClick(e: MouseEvent) {
    e.stopPropagation();
  }
</script>

<div
  class="thread-item"
  onclick={handleClick}
  onkeydown={(e) => e.key === 'Enter' && handleClick()}
  role="button"
  tabindex="0"
>
  <div class="thread-item-main">
    <div class="thread-item-avatar">
      <div
        class="avatar-placeholder"
        style="background-image: url('{avatarImage}'); background-size: cover;"
      >
        {thread.authorUsername.charAt(0).toUpperCase()}
      </div>
    </div>

    <div class="thread-item-content">
      <div class="thread-item-title">
        {truncateContent(thread.content)}
      </div>
      <div class="thread-item-meta">
        <span class="thread-author">@{thread.authorUsername}</span>
        <span class="thread-separator">-</span>
        <a
          href={`https://x.com/${thread.authorUsername}/status/${thread.id}`}
          target="_blank"
          rel="noopener noreferrer"
          class="thread-date thread-date-link"
          onclick={handleLinkClick}
        >
          {formatDate(thread.timestamp)} ↗
        </a>
      </div>
    </div>

    <div class="thread-item-stats">
      {#if thread.repliesCount && thread.repliesCount > 0}
        <div class="thread-stat" title={`${thread.repliesCount} replies`}>
          <span class="stat-icon">💬</span>
          <span class="stat-value">{thread.repliesCount}</span>
        </div>
      {/if}
    </div>
  </div>
</div>
