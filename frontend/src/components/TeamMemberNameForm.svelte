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
  let confirmed = $state(false);
  $effect(() => { fullName = currentName; });

  let canSubmit: boolean = $derived(
    fullName.trim().length > 0 && signer !== null && $pendingAction === null && confirmed === true
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

  <div class="space-y-4">
    <label for="name-consent" class="name-consent-label">
      <input
        id="name-consent"
        type="checkbox"
        bind:checked={confirmed}
        disabled={$pendingAction !== null}
      />
      I understand my name will appear publicly on the certificate and will be recorded permanently on the blockchain, per the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
    </label>

    <div class="pob-form-group">
      <label for="member-name" class="pob-form-label">
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
        {currentName ? 'Updating Name...' : 'Setting Name...'}
      {:else}
        {currentName ? 'Update Name' : 'Set Name'}
      {/if}
    </button>
  </div>
</div>

<style>
.name-consent-label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--pob-text-muted);
  line-height: 1.4;
}
.name-consent-label input[type="checkbox"] {
  margin-top: 0.15rem;
  flex-shrink: 0;
  cursor: pointer;
  accent-color: var(--pob-primary, #6366f1);
}
.name-consent-label a {
  color: var(--pob-text);
  text-decoration: underline;
}
.name-consent-label a:hover {
  color: var(--pob-primary, #6366f1);
}
</style>
