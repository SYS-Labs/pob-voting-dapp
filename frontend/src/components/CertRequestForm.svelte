<script lang="ts">
  import { Contract, type JsonRpcSigner } from 'ethers';
  import { getCertNFTContract } from '~/utils/certNFT';

  interface Props {
    iteration: number;
    certType: string;
    chainId: number;
    signer: JsonRpcSigner | null;
    onRequestComplete: () => void;
    isProject?: boolean;
    hasNamedTeamMembers?: boolean;
  }

  let {
    iteration,
    certType,
    chainId,
    signer,
    onRequestComplete,
    isProject = false,
    hasNamedTeamMembers = true,
  }: Props = $props();

  let infoCID = $state('');
  let loading = $state(false);
  let error = $state('');

  let teamMemberBlocked: boolean = $derived(isProject && !hasNamedTeamMembers);

  let canSubmit: boolean = $derived(
    infoCID.trim().length > 0 && signer !== null && !loading && !teamMemberBlocked
  );

  async function handleSubmit() {
    if (!signer) {
      error = 'Please connect your wallet first.';
      return;
    }

    const cid = infoCID.trim();
    if (!cid) {
      error = 'Please enter a valid IPFS CID.';
      return;
    }

    error = '';
    loading = true;

    try {
      const certNFT = getCertNFTContract(chainId, signer);
      if (!certNFT) {
        error = 'CertNFT contract not available on this network.';
        loading = false;
        return;
      }

      const tx = await certNFT.requestCert(iteration, cid);
      await tx.wait();

      infoCID = '';
      onRequestComplete();
    } catch (err: any) {
      if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) {
        error = 'Transaction was rejected.';
      } else if (err?.reason) {
        error = err.reason;
      } else {
        error = 'Transaction failed. Please try again.';
      }
    } finally {
      loading = false;
    }
  }
</script>

<div class="pob-pane">
  <div class="pob-pane__heading">
    <h3 class="pob-pane__title">Request Certificate</h3>
  </div>

  <div class="space-y-3">
    <p class="text-sm text-[var(--pob-text-muted)]">
      You are eligible as: <strong>{certType}</strong>
    </p>

    <div class="space-y-2">
      <label for="info-cid" class="text-sm text-[var(--pob-text-secondary)]">
        Participant Info CID
      </label>
      <input
        id="info-cid"
        type="text"
        class="pob-input"
        placeholder="QmYour...IPFS...CID"
        bind:value={infoCID}
        disabled={loading}
      />
      <p class="text-xs text-[var(--pob-text-muted)]">
        IPFS CID of your participant info JSON
      </p>
    </div>

    {#if teamMemberBlocked}
      <div class="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
        <p class="text-sm text-yellow-400">
          You must add at least one team member who has been approved and filled in their name before requesting a certificate.
        </p>
      </div>
    {/if}

    <button
      class="pob-button w-full justify-center"
      disabled={!canSubmit}
      onclick={handleSubmit}
    >
      {#if loading}
        Requesting...
      {:else}
        Request Certificate
      {/if}
    </button>

    {#if error}
      <p class="text-sm text-red-400">{error}</p>
    {/if}
  </div>
</div>
