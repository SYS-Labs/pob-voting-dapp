<script lang="ts">
  import type { Badge } from '~/interfaces';
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';

  interface Props {
    badge: Badge;
  }

  let { badge }: Props = $props();
</script>

<div class="pob-fieldset space-y-3">
  <!-- NFT Image Placeholder -->
  <div class="aspect-square w-full rounded-lg bg-gradient-to-br from-[var(--pob-primary)]/20 to-[var(--pob-primary)]/5 flex items-center justify-center border border-[var(--pob-primary)]/30">
    <div class="text-center space-y-2">
      <div class="text-4xl">🏅</div>
      <div class="text-xs text-[var(--pob-text-muted)]">
        Iteration {badge.iteration}{badge.round ? ` - Round #${badge.round}` : ''}
      </div>
    </div>
  </div>

  <!-- Badge Info: Role tag and ID -->
  <div class="flex items-center justify-between">
    <span class="pob-pill {ROLE_COLORS[badge.role]}">
      {ROLE_LABELS[badge.role]}
    </span>
    <span class="text-sm text-[var(--pob-text-muted)]">
      #{badge.tokenId}
    </span>
  </div>
</div>
