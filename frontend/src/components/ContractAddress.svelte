<script lang="ts">
  import { formatContractAddress } from '~/utils';
  import { NETWORKS } from '~/constants/networks';

  interface Props {
    address: string;
    chainId: number;
    showShortOnMobile?: boolean;
  }

  let {
    address,
    chainId,
    showShortOnMobile = true,
  }: Props = $props();

  const network = $derived(NETWORKS[chainId]);
  const explorerUrl = $derived(network?.explorerUrl);
  const shortAddress = $derived(formatContractAddress(address));
</script>

{#if explorerUrl}
  <a
    href="{explorerUrl}/address/{address}"
    target="_blank"
    rel="noopener noreferrer"
    class="pob-mono text-xs text-[var(--pob-primary)] transition-colors underline decoration-transparent hover:decoration-inherit"
  >
    {#if showShortOnMobile}
      <span class="inline md:hidden">{shortAddress}</span>
      <span class="hidden md:inline">{address}</span>
    {:else}
      {address}
    {/if}
  </a>
{:else}
  <span class="pob-mono text-xs text-[var(--pob-primary)]">
    {#if showShortOnMobile}
      <span class="inline md:hidden">{shortAddress}</span>
      <span class="hidden md:inline">{address}</span>
    {:else}
      {address}
    {/if}
  </span>
{/if}
