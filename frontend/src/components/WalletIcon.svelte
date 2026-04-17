<script lang="ts">
  interface Props {
    icon?: string | null;
    name?: string | null;
    size?: 'xs' | 'sm' | 'md';
  }

  let { icon = null, name = 'Wallet', size = 'md' }: Props = $props();

  function fallbackLabel(label: string | null): string {
    const parts = (label ?? 'Wallet').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'W';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
</script>

<span class="wallet-icon-frame wallet-icon-frame--{size}" aria-hidden="true">
  {#if icon}
    <img src={icon} alt="" class="wallet-icon wallet-icon--{size}" loading="lazy" />
  {:else}
    {fallbackLabel(name)}
  {/if}
</span>

<style>
  .wallet-icon-frame {
    flex: 0 0 var(--wallet-icon-frame-size);
    width: var(--wallet-icon-frame-size);
    height: var(--wallet-icon-frame-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--pob-border);
    border-radius: var(--pob-radius-mobile);
    background: rgba(255, 255, 255, 0.04);
    color: var(--pob-primary);
    font-weight: 700;
    line-height: 1;
    overflow: hidden;
  }

  .wallet-icon-frame--xs {
    --wallet-icon-frame-size: 1.25rem;
    --wallet-icon-image-size: 0.875rem;
    font-size: 0.5rem;
    border-radius: 0.375rem;
  }

  .wallet-icon-frame--sm {
    --wallet-icon-frame-size: 1.5rem;
    --wallet-icon-image-size: 1rem;
    font-size: 0.625rem;
    border-radius: 0.425rem;
  }

  .wallet-icon-frame--md {
    --wallet-icon-frame-size: 2.75rem;
    --wallet-icon-image-size: 1.75rem;
    font-size: 0.875rem;
  }

  .wallet-icon {
    width: var(--wallet-icon-image-size);
    height: var(--wallet-icon-image-size);
    max-width: var(--wallet-icon-image-size);
    max-height: var(--wallet-icon-image-size);
    display: block;
    object-fit: contain;
  }
</style>
