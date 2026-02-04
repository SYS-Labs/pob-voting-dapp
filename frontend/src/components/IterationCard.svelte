<script lang="ts">
  import { Link } from 'svelte-routing';
  import type { Iteration, IterationMetadata } from '~/interfaces';
  import { metadataAPI } from '~/utils/metadata-api';

  interface Props {
    iteration: Iteration;
    isActive: boolean;
    statusBadge?: { label: string; color: string } | null;
    onSelect?: () => void;
    onAddRound?: () => void;
    disableLink?: boolean;
  }

  let {
    iteration,
    isActive,
    statusBadge = null,
    onSelect,
    onAddRound,
    disableLink = false,
  }: Props = $props();

  let metadata = $state<IterationMetadata | null>(null);

  // Load iteration metadata
  $effect(() => {
    if (!iteration.jurySC) return;

    const loadMetadata = async () => {
      try {
        const data = await metadataAPI.getIterationMetadata(
          iteration.chainId,
          iteration.jurySC
        );
        metadata = data;
      } catch (error) {
        // Silently fail - fallback to iteration.name
      }
    };

    loadMetadata();
  });

  function handleSelect() {
    if (onSelect) onSelect();
  }

  function handleAddRound(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (onAddRound) onAddRound();
  }
</script>

{#if disableLink}
  <div
    class="pob-pane pob-pane--subtle flex flex-col justify-between transition"
    class:shadow-[0_0_22px_rgba(247,147,26,0.35)]={isActive}
    style="border-color: {isActive ? 'var(--pob-primary)' : 'rgba(247, 147, 26, 0.4)'};"
  >
    <div class="space-y-3">
      <div class="pob-pane__heading">
        <h2 class="pob-pane__title text-lg">{metadata?.name || iteration.name}</h2>
      </div>
      <p class="text-xs uppercase tracking-[0.18em] text-[var(--pob-text-muted)]">
        Iteration #{iteration.iteration}{iteration.round ? ` - Round #${iteration.round}` : ''}
      </p>
      {#if !iteration.round}
        <p class="text-xs text-[var(--pob-text-muted)]">
          Round not registered yet.
        </p>
      {/if}
    </div>
    <div class="mt-4 flex items-center justify-between">
      {#if onAddRound}
        <button
          type="button"
          onclick={handleAddRound}
          class="pob-button pob-button--compact"
        >
          Add round
        </button>
      {:else}
        <span></span>
      {/if}
      {#if statusBadge}
        <span class={statusBadge.color}>{statusBadge.label}</span>
      {/if}
    </div>
  </div>
{:else}
  <Link
    to="/iteration/{iteration.iteration}"
    class="pob-pane pob-pane--subtle flex flex-col justify-between transition block no-underline {isActive ? 'shadow-[0_0_22px_rgba(247,147,26,0.35)]' : ''}"
    style="border-color: {isActive ? 'var(--pob-primary)' : 'rgba(247, 147, 26, 0.4)'};"
    onclick={handleSelect}
  >
    <div class="space-y-3">
      <div class="pob-pane__heading">
        <h2 class="pob-pane__title text-lg">{metadata?.name || iteration.name}</h2>
      </div>
      <p class="text-xs uppercase tracking-[0.18em] text-[var(--pob-text-muted)]">
        Iteration #{iteration.iteration}{iteration.round ? ` - Round #${iteration.round}` : ''}
      </p>
      {#if !iteration.round}
        <p class="text-xs text-[var(--pob-text-muted)]">
          Round not registered yet.
        </p>
      {/if}
    </div>
    <div class="mt-4 flex items-center justify-between">
      {#if onAddRound}
        <button
          type="button"
          onclick={handleAddRound}
          class="pob-button pob-button--compact"
        >
          Add round
        </button>
      {:else}
        <span></span>
      {/if}
      {#if statusBadge}
        <span class={statusBadge.color}>{statusBadge.label}</span>
      {/if}
    </div>
  </Link>
{/if}
