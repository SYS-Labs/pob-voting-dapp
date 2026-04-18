<script lang="ts">
  import type { Snippet } from 'svelte';

  let { to = '', href = '', children } = $props<{ to?: string; href?: string; children?: Snippet }>();
</script>

<a href={to || href}>
  {@render children?.()}
</a>
