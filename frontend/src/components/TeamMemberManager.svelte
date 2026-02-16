<script lang="ts">
  import { type Provider, type JsonRpcSigner } from 'ethers';
  import type { TeamMember } from '~/interfaces';
  import { getTeamMembers, proposeTeamMember } from '~/utils/teamMembers';
  import { formatAddress } from '~/utils';
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
          No approved team members with names set. Add and approve team members so they appear on the certificate.
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
      <ul class="space-y-2">
        {#each members as member (member.memberAddress)}
          <li class="flex items-center justify-between gap-2 rounded-lg border border-[var(--pob-border)] bg-white/5 px-3 py-2">
            <span class="text-sm text-[var(--pob-text)] truncate">
              {member.fullName || formatAddress(member.memberAddress)}
            </span>
            <span class="pob-pill {STATUS_CLASSES[member.status]} shrink-0">
              {member.status}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="space-y-1 pt-2 border-t border-[var(--pob-border)]">
      <label for="new-member-address" class="text-xs font-medium text-[var(--pob-text)]">
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
