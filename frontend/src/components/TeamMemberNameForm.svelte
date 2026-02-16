<script lang="ts">
  import { type JsonRpcSigner } from 'ethers';
  import { setTeamMemberName } from '~/utils/teamMembers';
  import { runTransaction, pendingAction } from '~/stores/transactions';

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

  let canSubmit: boolean = $derived(
    fullName.trim().length > 0 && signer !== null && $pendingAction === null
  );

  async function handleSubmit() {
    if (!signer) return;

    const name = fullName.trim();
    if (!name) return;

    await runTransaction(
      'Set certificate name',
      () => setTeamMemberName(chainId, iteration, project, name, signer!),
      async () => { onNameSet(); }
    );
    fullName = '';
  }
</script>

<div class="pob-fieldset">
  <h3 class="text-sm font-semibold text-[var(--pob-text)] mb-3">Certificate Name</h3>

  {#if currentName}
    <div class="space-y-1">
      <p class="text-sm text-[var(--pob-text-muted)]">
        Your name for the certificate:
      </p>
      <p class="text-base text-[var(--pob-text)] font-medium">
        {currentName}
      </p>
    </div>
  {:else}
    <div class="space-y-4">
      <p class="text-sm text-[var(--pob-text-muted)]">
        Enter your full name as it will appear on the certificate.
      </p>

      <div class="space-y-1">
        <label for="member-name" class="text-xs font-medium text-[var(--pob-text)]">
          Full Name
        </label>
        <input
          id="member-name"
          type="text"
          class="pob-input"
          placeholder="Your full name"
          maxlength={64}
          bind:value={fullName}
          disabled={$pendingAction !== null}
        />
      </div>

      <button
        class="pob-button pob-button--full"
        disabled={!canSubmit}
        onclick={handleSubmit}
      >
        {#if $pendingAction === 'Set certificate name'}
          Setting Name...
        {:else}
          Set Name
        {/if}
      </button>
    </div>
  {/if}
</div>
