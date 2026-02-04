<script lang="ts">
  import { markdownToHtml } from '~/utils';

  interface Props {
    content?: string | null;
  }

  let { content }: Props = $props();

  const html = $derived(content ? markdownToHtml(content) : '');
</script>

{#if content}
  <div class="pob-markdown">{@html html}</div>
{/if}
