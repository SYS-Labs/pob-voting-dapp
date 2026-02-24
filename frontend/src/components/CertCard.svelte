<script lang="ts">
  import type { Cert, CertStatus } from '~/interfaces';
  import { resolveCertStatus } from '~/utils/certNFT';

  interface Props {
    cert: Cert;
    teamMemberNames?: string[];
    svgContent?: string;
  }

  let { cert, teamMemberNames = [], svgContent }: Props = $props();

  const STATUS_CLASSES: Record<CertStatus, string> = {
    Minted: 'pob-pill--success',
    Pending: 'pob-pill--warning',
    Cancelled: 'pob-pill--failure',
    Requested: 'pob-pill--info',
  };

  const CERT_TYPE_LABELS: Record<string, string> = {
    participant: 'Participant',
    winner: 'Winner',
    organizer: 'Organizer',
    speaker: 'Speaker',
  };

  const PENDING_PERIOD = 48 * 60 * 60; // 48 hours in seconds

  let effectiveStatus: CertStatus = $derived(resolveCertStatus(cert));

  let countdownText: string = $derived.by(() => {
    if (effectiveStatus !== 'Pending') return '';

    const deadline = cert.requestTime + PENDING_PERIOD;
    const now = Math.floor(Date.now() / 1000);
    const remaining = deadline - now;

    if (remaining <= 0) return 'Finalizing...';

    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }
    return `${minutes}m remaining`;
  });

  let certTypeLabel: string = $derived(
    CERT_TYPE_LABELS[cert.certType] ?? cert.certType
  );
</script>

<div class="pob-fieldset space-y-3">
  <!-- Certificate Visual -->
  <div class="aspect-square w-full rounded-lg overflow-hidden border border-[var(--pob-primary)]/30">
    {#if svgContent}
      {@html svgContent}
    {:else}
      <div class="w-full h-full bg-gradient-to-br from-[var(--pob-primary)]/20 to-[var(--pob-primary)]/5 flex items-center justify-center">
        <div class="text-center space-y-2">
          <div class="text-4xl">📜</div>
          <div class="text-xs text-[var(--pob-text-muted)]">
            Iteration {cert.iteration}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Cert Info -->
  <div class="flex items-center justify-between">
    <span class="pob-pill pob-pill--active">
      {certTypeLabel}
    </span>
    <span class="text-sm text-[var(--pob-text-muted)]">
      #{cert.tokenId}
    </span>
  </div>

  <!-- Status -->
  <div class="flex items-center justify-between">
    <span class="pob-pill {STATUS_CLASSES[effectiveStatus]}">
      {effectiveStatus}
    </span>
    {#if effectiveStatus === 'Requested'}
      <span class="text-xs text-[var(--pob-text-muted)]">
        Awaiting approval
      </span>
    {:else if effectiveStatus === 'Pending' && countdownText}
      <span class="text-xs text-[var(--pob-text-muted)]">
        {countdownText}
      </span>
    {/if}
  </div>

  <!-- Team Members -->
  {#if teamMemberNames.length > 0}
    <div class="pt-2 border-t border-[var(--pob-border)]">
      <p class="text-xs text-[var(--pob-text-muted)] mb-1">Team</p>
      <div class="flex flex-wrap gap-1">
        {#each teamMemberNames as name (name)}
          <span class="text-xs text-[var(--pob-text-muted)] bg-white/5 rounded px-1.5 py-0.5">
            {name}
          </span>
        {/each}
      </div>
    </div>
  {/if}
</div>
