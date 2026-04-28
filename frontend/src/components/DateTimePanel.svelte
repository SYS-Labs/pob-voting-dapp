<script lang="ts">
  interface Props {
    endTime: number | null;
  }

  let { endTime }: Props = $props();
  let nowMs = $state(Date.now());

  function formatCountdown(targetUnixSeconds: number | null, currentMillis: number): string {
    if (!targetUnixSeconds) {
      return 'Countdown unavailable';
    }

    const remainingSeconds = Math.max(0, targetUnixSeconds - Math.floor(currentMillis / 1000));
    const days = Math.floor(remainingSeconds / 86400);
    const hours = String(Math.floor((remainingSeconds % 86400) / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((remainingSeconds % 3600) / 60)).padStart(2, '0');
    const seconds = String(remainingSeconds % 60).padStart(2, '0');

    return `${days} days, ${hours}:${minutes}:${seconds} left`;
  }

  $effect(() => {
    const interval = setInterval(() => {
      nowMs = Date.now();
    }, 1000);

    return () => clearInterval(interval);
  });
</script>

<section class="pob-pane pob-surface--quiet date-time-panel">
  <p class="pob-eyebrow pob-eyebrow--muted">Voting countdown</p>
  <p class="pob-mono date-time-panel__value">
    {formatCountdown(endTime, nowMs)}
  </p>
</section>

<style>
  .date-time-panel {
    display: grid;
    gap: 0.35rem;
  }

  .date-time-panel__value {
    color: var(--pob-text-muted);
    font-size: 0.9rem;
    line-height: 1.45;
    margin: 0;
  }
</style>
