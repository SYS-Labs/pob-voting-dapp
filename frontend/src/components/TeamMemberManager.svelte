<script lang="ts">
  import { type Provider, type JsonRpcSigner } from 'ethers';
  import type { TeamMember } from '~/interfaces';
  import { getTeamMembers, proposeTeamMember } from '~/utils/teamMembers';
  import { formatAddress } from '~/utils';

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
  let proposing = $state(false);
  let proposeError = $state('');

  let hasApprovedAndNamed: boolean = $derived(
    members.some((m) => m.status === 'Approved' && m.fullName.length > 0)
  );

  const STATUS_CLASSES: Record<string, string> = {
    Proposed: 'border border-yellow-500/40 bg-yellow-500/10 text-yellow-400',
    Approved: 'border border-green-500/40 bg-green-500/10 text-green-400',
    Rejected: 'border border-red-500/40 bg-red-500/10 text-red-400',
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
    if (!signer) {
      proposeError = 'Please connect your wallet first.';
      return;
    }

    const address = newMemberAddress.trim();
    if (!address) {
      proposeError = 'Please enter a valid address.';
      return;
    }

    proposeError = '';
    proposing = true;

    try {
      await proposeTeamMember(chainId, iteration, address, signer);
      newMemberAddress = '';
      await loadMembers();
      onTeamChange();
    } catch (err: any) {
      if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) {
        proposeError = 'Transaction was rejected.';
      } else if (err?.reason) {
        proposeError = err.reason;
      } else {
        proposeError = 'Failed to propose team member.';
      }
    } finally {
      proposing = false;
    }
  }

  $effect(() => {
    if (provider && walletAddress) {
      loadMembers();
    }
  });
</script>

<div class="pob-pane">
  <div class="pob-pane__heading">
    <h3 class="pob-pane__title">Team Members</h3>
  </div>

  <div class="space-y-4">
    {#if !hasApprovedAndNamed && !loading}
      <div class="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
        <p class="text-sm text-yellow-400">
          No approved team members with names set. Add and approve team members so they appear on the certificate.
        </p>
      </div>
    {/if}

    {#if loading}
      <p class="text-sm text-[var(--pob-text-muted)]">Loading team members...</p>
    {:else if error}
      <p class="text-sm text-red-400">{error}</p>
    {:else if members.length === 0}
      <p class="text-sm text-[var(--pob-text-muted)]">No team members yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each members as member (member.memberAddress)}
          <li class="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <span class="text-sm text-[var(--pob-text-secondary)] truncate">
              {member.fullName || formatAddress(member.memberAddress)}
            </span>
            <span class="pob-pill {STATUS_CLASSES[member.status]} shrink-0">
              {member.status}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="space-y-2 pt-2 border-t border-white/10">
      <label for="new-member-address" class="text-sm text-[var(--pob-text-secondary)]">
        Add Team Member
      </label>
      <div class="flex gap-2">
        <input
          id="new-member-address"
          type="text"
          class="pob-input flex-1"
          placeholder="0x..."
          bind:value={newMemberAddress}
          disabled={proposing}
        />
        <button
          class="pob-button shrink-0"
          disabled={proposing || !newMemberAddress.trim() || !signer}
          onclick={handlePropose}
        >
          {#if proposing}
            Proposing...
          {:else}
            Propose
          {/if}
        </button>
      </div>
      {#if proposeError}
        <p class="text-sm text-red-400">{proposeError}</p>
      {/if}
    </div>
  </div>
</div>
