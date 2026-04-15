<script lang="ts">
  import type { Badge } from '~/interfaces';
  import { ROLE_LABELS } from '~/constants/roles';

  interface Props {
    badge: Badge;
  }

  let { badge }: Props = $props();
</script>

<div class="badge-card pob-fieldset space-y-3">
  <span class="badge-card__stamp">
    {ROLE_LABELS[badge.role]}
  </span>

  <!-- NFT Image -->
  {#if badge.imageData}
    <img
      src={badge.imageData}
      alt={ROLE_LABELS[badge.role]}
      loading="lazy"
      class="badge-card__image aspect-square w-full object-cover rounded-lg"
    />
  {:else}
    <div class="badge-card__placeholder aspect-square w-full rounded-lg text-center space-y-2">
      <div class="text-4xl">🏅</div>
      <div class="text-xs text-[var(--pob-text-muted)]">
        Iteration {badge.iteration}{badge.round ? ` - Round #${badge.round}` : ''}
      </div>
    </div>
  {/if}

  <!-- Badge Info -->
  <div class="flex items-center justify-end">
    <span class="text-sm text-[var(--pob-text-muted)]">
      #{badge.tokenId}
    </span>
  </div>
</div>

<style>
  .badge-card {
    position: relative;
  }

  .badge-card__image {
    display: block;
  }

  .badge-card__placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.03);
  }

  .badge-card__stamp {
    position: absolute;
    top: 1.75rem;
    right: 1.75rem;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.78);
    border-radius: 6px;
    background: rgba(8, 8, 11, 0.18);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1;
    padding: 0.35rem 0.55rem;
    text-transform: uppercase;
    transform: rotate(6deg);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
    backdrop-filter: blur(2px);
    pointer-events: none;
  }
</style>
