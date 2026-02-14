<script lang="ts">
  import { type JsonRpcSigner } from 'ethers';
  import { setTeamMemberName } from '~/utils/teamMembers';

  interface Props {
    iteration: number;
    project: string;
    chainId: number;
    signer: JsonRpcSigner | null;
    currentName: string;
    onNameSet: () => void;
  }

  let {
    iteration,
    project,
    chainId,
    signer,
    currentName,
    onNameSet,
  }: Props = $props();

  let fullName = $state('');
  let loading = $state(false);
  let error = $state('');

  let canSubmit: boolean = $derived(
    fullName.trim().length > 0 && signer !== null && !loading
  );

  async function handleSubmit() {
    if (!signer) {
      error = 'Please connect your wallet first.';
      return;
    }

    const name = fullName.trim();
    if (!name) {
      error = 'Please enter your full name.';
      return;
    }

    if (name.length > 64) {
      error = 'Name must be 64 characters or less.';
      return;
    }

    error = '';
    loading = true;

    try {
      await setTeamMemberName(chainId, iteration, project, name, signer);
      fullName = '';
      onNameSet();
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
    <h3 class="pob-pane__title">Certificate Name</h3>
  </div>

  {#if currentName}
    <div class="space-y-2">
      <p class="text-sm text-[var(--pob-text-muted)]">
        Your name for the certificate:
      </p>
      <p class="text-base text-[var(--pob-text-secondary)] font-medium">
        {currentName}
      </p>
    </div>
  {:else}
    <div class="space-y-3">
      <p class="text-sm text-[var(--pob-text-muted)]">
        Enter your full name as it will appear on the certificate.
      </p>

      <div class="space-y-2">
        <label for="member-name" class="text-sm text-[var(--pob-text-secondary)]">
          Full Name
        </label>
        <input
          id="member-name"
          type="text"
          class="pob-input"
          placeholder="Your full name"
          maxlength={64}
          bind:value={fullName}
          disabled={loading}
        />
      </div>

      <button
        class="pob-button w-full justify-center"
        disabled={!canSubmit}
        onclick={handleSubmit}
      >
        {#if loading}
          Setting Name...
        {:else}
          Set Name
        {/if}
      </button>

      {#if error}
        <p class="text-sm text-red-400">{error}</p>
      {/if}
    </div>
  {/if}
</div>
