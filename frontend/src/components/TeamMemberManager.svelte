<script lang="ts">
  import { type Provider, type JsonRpcSigner } from 'ethers';
  import type { TeamMember } from '~/interfaces';
  import { getTeamMembers, proposeTeamMember, removeTeamMember } from '~/utils/teamMembers';
  import { formatAddress, getExplorerAddressLink } from '~/utils';
  import { runTransaction, pendingAction } from '~/stores/transactions';

  interface Props {
    iteration: number;
    chainId: number;
    signer: JsonRpcSigner | null;
    walletAddress: string;
    provider: Provider | null;
    onTeamChange: () => void;
  }

  let {
    iteration,
    chainId,
    signer,
    walletAddress,
    provider,
    onTeamChange,
  }: Props = $props();

  let members: TeamMember[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let newMemberAddress = $state('');

  let hasApprovedAndNamed: boolean = $derived(
    members.some((m) => m.status === 'Approved' && m.fullName.length > 0)
  );

  const STATUS_CLASSES: Record<string, string> = {
    Proposed: 'pob-pill--warning',
    Approved: 'pob-pill--success',
    Rejected: 'pob-pill--failure',
  };

  async function loadMembers() {
    if (!provider) return;

    loading = true;
    error = '';

    try {
      members = await getTeamMembers(chainId, iteration, walletAddress, provider);
    } catch (err: any) {
      error = err?.message || 'Failed to load team members.';
    } finally {
      loading = false;
    }
  }

  async function handlePropose() {
    if (!signer) return;

    const address = newMemberAddress.trim();
    if (!address) return;

    await runTransaction(
      'Propose team member',
      () => proposeTeamMember(chainId, iteration, address, signer!),
      async () => {
        await loadMembers();
        onTeamChange();
      }
    );
    newMemberAddress = '';
  }

  async function handleRemove(memberAddress: string) {
    if (!signer) return;

    await runTransaction(
      'Remove team member',
      () => removeTeamMember(chainId, iteration, memberAddress, signer!),
      async () => {
        await loadMembers();
        onTeamChange();
      }
    );
  }

  $effect(() => {
    if (provider && walletAddress) {
      loadMembers();
    }
  });
</script>

<div class="pob-fieldset">
  <h3 class="text-sm font-semibold text-[var(--pob-text)] mb-3">Team Members</h3>

  <div class="space-y-4">
    {#if !hasApprovedAndNamed && !loading}
      <div class="pob-warning">
        <p class="text-xs">
          No approved team members with names set yet. Members can set their names once proposed; they appear on the certificate after owner approval.
        </p>
      </div>
    {/if}

    {#if loading}
      <p class="text-sm text-[var(--pob-text-muted)]">Loading team members...</p>
    {:else if error}
      <div class="pob-warning">
        <p class="text-xs">{error}</p>
      </div>
    {:else if members.length === 0}
      <p class="text-sm text-[var(--pob-text-muted)]">No team members yet.</p>
    {:else}
      <ul class="pob-admin-voter-list">
        {#each members as member (member.memberAddress)}
          <li class="pob-admin-voter">
            <div class="pob-admin-voter__info">
              <div>
                {#if member.fullName}
                  <div class="pob-admin-voter__brief" style="font-size: 0.95rem;">
                    {member.fullName}
                  </div>
                {/if}
                <div class="pob-admin-voter__label pob-mono">
                  {#if getExplorerAddressLink(chainId, member.memberAddress)}
                    <a href={getExplorerAddressLink(chainId, member.memberAddress)} target="_blank" rel="noopener noreferrer" class="text-[var(--pob-primary)] hover:underline">{formatAddress(member.memberAddress)}</a>
                  {:else}
                    {formatAddress(member.memberAddress)}
                  {/if}
                </div>
                {#if member.status === 'Proposed' && !member.fullName}
                  <div class="pob-form-hint">Member can set their name on the Certificates page. Owner approves at submission.</div>
                {:else if member.status === 'Proposed' && member.fullName}
                  <div class="pob-form-hint">Name set. Owner approves at submission.</div>
                {:else if member.status === 'Approved' && !member.fullName}
                  <div class="pob-form-hint">Approved — member must set their name on the Certificates page</div>
                {/if}
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5 shrink-0 items-center">
              <span class="pob-pill {STATUS_CLASSES[member.status]}">
                {member.status}
              </span>
              {#if member.status === 'Approved' && !member.fullName}
                <span class="pob-pill pob-pill--warning">No name</span>
              {/if}
              <button
                  class="pob-button pob-button--small pob-button--danger"
                  disabled={$pendingAction !== null || !signer}
                  onclick={() => handleRemove(member.memberAddress)}
                >
                  {#if $pendingAction === 'Remove team member'}
                    Removing...
                  {:else}
                    Remove
                  {/if}
                </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="pob-form-group pt-2 border-t border-[var(--pob-border)]">
      <label for="new-member-address" class="pob-form-label">
        Add Team Member
      </label>
      <div class="flex gap-2">
        <input
          id="new-member-address"
          type="text"
          class="pob-input flex-1"
          placeholder="0x..."
          bind:value={newMemberAddress}
          disabled={$pendingAction !== null}
        />
        <button
          class="pob-button shrink-0"
          disabled={$pendingAction !== null || !newMemberAddress.trim() || !signer}
          onclick={handlePropose}
        >
          {#if $pendingAction === 'Propose team member'}
            Proposing...
          {:else}
            Propose
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>
