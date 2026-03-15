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

<div style="font-family: monospace; font-size: 14px; color: var(--pob-text-muted); padding: 0.75rem 0;">
  {formatCountdown(endTime, nowMs)}
</div>
