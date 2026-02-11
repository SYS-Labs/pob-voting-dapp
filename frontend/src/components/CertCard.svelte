<script lang="ts">
  import type { Cert, CertStatus } from '~/interfaces';
  import { resolveCertStatus } from '~/utils/certNFT';

  interface Props {
    cert: Cert;
  }

  let { cert }: Props = $props();

  const STATUS_COLORS: Record<CertStatus, string> = {
    Minted: 'border border-green-500/40 bg-green-500/10 text-green-400',
    Pending: 'border border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
    Cancelled: 'border border-red-500/40 bg-red-500/10 text-red-400',
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

<div class="space-y-3">
  <!-- Certificate Visual -->
  <div class="aspect-square w-full rounded-lg bg-gradient-to-br from-[var(--pob-orange)]/20 to-[var(--pob-orange)]/5 flex items-center justify-center border border-[var(--pob-orange)]/30">
    <div class="text-center space-y-2">
      <div class="text-4xl">📜</div>
      <div class="text-xs text-[var(--pob-text-muted)]">
        Iteration {cert.iteration}
      </div>
    </div>
  </div>

  <!-- Cert Info -->
  <div class="flex items-center justify-between mt-3">
    <span class="pob-pill border border-[rgba(247,147,26,0.45)] bg-[rgba(247,147,26,0.12)] text-[var(--pob-primary)]">
      {certTypeLabel}
    </span>
    <span class="text-sm text-[var(--pob-text-muted)]">
      #{cert.tokenId}
    </span>
  </div>

  <!-- Status -->
  <div class="flex items-center justify-between">
    <span class="pob-pill {STATUS_COLORS[effectiveStatus]}">
      {effectiveStatus}
    </span>
    {#if effectiveStatus === 'Pending' && countdownText}
      <span class="text-xs text-[var(--pob-text-muted)]">
        {countdownText}
      </span>
    {/if}
  </div>
</div>
