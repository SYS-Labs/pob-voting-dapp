<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Iteration, IterationStatus } from '~/interfaces';
  import IterationCard from './IterationCard.svelte';

  interface Props {
    title: string;
    iterations: Iteration[];
    selectedIteration: number | null;
    iterationStatuses: { [iterationNumber: number]: IterationStatus };
    onSelectIteration: (iteration: number) => void;
    onAddRound?: (iteration: Iteration) => void;
    headerAction?: Snippet;
    emptyMessage?: string;
  }

  let {
    title,
    iterations,
    selectedIteration,
    iterationStatuses,
    onSelectIteration,
    onAddRound,
    headerAction,
    emptyMessage,
  }: Props = $props();

  function getStatusBadge(status: IterationStatus | undefined) {
    const effectiveStatus = status ?? 'upcoming';
    switch (effectiveStatus) {
      case 'active':
        return { label: 'Active', color: 'pob-pill pob-pill--active' };
      case 'ended':
        return { label: 'Ended', color: 'pob-pill pob-pill--ended' };
      case 'upcoming':
      default:
        return { label: 'Upcoming', color: 'pob-pill pob-pill--upcoming' };
    }
  }
</script>

<section class="pob-pane">
  <div class="pob-pane__heading">
    <h3 class="pob-pane__title">{title}</h3>
    <div class="flex items-center gap-3">
      <span class="pob-pane__meta">
        {iterations.length} iteration{iterations.length !== 1 ? 's' : ''}
      </span>
      {#if headerAction}
        {@render headerAction()}
      {/if}
    </div>
  </div>
  {#if iterations.length === 0}
    <div class="pob-info">
      <p class="text-sm text-[var(--pob-text-muted)]">
        {emptyMessage ?? 'No iterations registered yet.'}
      </p>
    </div>
  {:else}
    <div class="pob-pane__grid md:grid-cols-2 xl:grid-cols-3">
      {#each iterations as iteration (iteration.iteration)}
        {@const isSelected = iteration.iteration === selectedIteration}
        {@const status = iterationStatuses[iteration.iteration]}
        {@const statusBadge = getStatusBadge(status)}
        {@const needsFirstRound = !iteration.round || !iteration.jurySC || !iteration.pob}
        <IterationCard
          {iteration}
          isActive={isSelected}
          {statusBadge}
          onSelect={!needsFirstRound ? () => onSelectIteration(iteration.iteration) : undefined}
          onAddRound={onAddRound ? () => onAddRound(iteration) : undefined}
          disableLink={needsFirstRound}
        />
      {/each}
    </div>
  {/if}
</section>
