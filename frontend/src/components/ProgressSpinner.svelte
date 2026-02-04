<script lang="ts">
  interface Props {
    size?: number;
    rotationDuration?: number;
    className?: string;
    progress?: number;
  }

  let {
    size = 48,
    rotationDuration = 2,
    className = '',
    progress = undefined,
  }: Props = $props();

  const radius = $derived((size / 48) * 20);
  const strokeWidth = $derived((size / 48) * 4);
  const center = $derived(size / 2);
  const circumference = $derived(2 * Math.PI * radius);
  const progressOffset = $derived(
    progress !== undefined
      ? circumference * (1 - progress / 100)
      : circumference * 0.25
  );
</script>

<div
  class="tx-spinner {className}"
  style="--rotation-duration: {rotationDuration}s;"
>
  <svg
    width={size}
    height={size}
    viewBox="0 0 {size} {size}"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style="transform: rotate(-90deg);"
  >
    <circle
      cx={center}
      cy={center}
      r={radius}
      stroke="rgba(247, 147, 26, 0.2)"
      stroke-width={strokeWidth}
    />
    <circle
      cx={center}
      cy={center}
      r={radius}
      stroke="rgb(247, 147, 26)"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-dasharray={circumference}
      stroke-dashoffset={progressOffset}
      class={progress === undefined ? 'tx-spinner__circle' : ''}
    />
  </svg>
</div>
