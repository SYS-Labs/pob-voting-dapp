<script lang="ts">
  import Modal from './Modal.svelte';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
  }

  let { isOpen, onClose }: Props = $props();
</script>

<Modal {isOpen} {onClose} maxWidth="md">
  {#snippet children()}
    <div class="pob-pane space-y-4">
      <h2 class="text-xl font-bold text-white">Switch Network</h2>

      <p class="text-sm text-[var(--pob-text-muted)]">
        Please switch to one of the supported networks in your wallet:
      </p>

      <div class="space-y-2">
        <div class="pob-fieldset space-y-1">
          <p class="font-semibold text-white">NEVM Mainnet</p>
          <p class="pob-mono text-xs text-[var(--pob-text-muted)]">Chain ID: 57</p>
        </div>
        <div class="pob-fieldset space-y-1">
          <p class="font-semibold text-white">Local Hardhat Rehearsal</p>
          <p class="pob-mono text-xs text-[var(--pob-text-muted)]">Chain ID: 31337</p>
        </div>
      </div>

      <p class="text-xs text-[var(--pob-text-muted)]">
        Legacy testnet is not a post-migration runtime target.
      </p>

      <div class="pt-2">
        <button
          type="button"
          onclick={onClose}
          class="pob-button w-full justify-center"
        >
          Close
        </button>
      </div>
    </div>
  {/snippet}
</Modal>
