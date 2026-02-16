<script lang="ts">
  import { type JsonRpcSigner } from 'ethers';
  import type { TeamMember } from '~/interfaces';
  import { approveTeamMember, rejectTeamMember } from '~/utils/teamMembers';
  import { formatAddress } from '~/utils';
  import { runTransaction, pendingAction } from '~/stores/transactions';

  interface PendingMember {
    iteration: number;
    project: string;
    member: TeamMember;
  }

  interface Props {
    pendingMembers: PendingMember[];
    chainId: number;
    signer: JsonRpcSigner | null;
    onAction: () => void;
  }

  let {
    pendingMembers,
    chainId,
    signer,
    onAction,
  }: Props = $props();

  function memberKey(item: PendingMember): string {
    return `${item.iteration}-${item.project}-${item.member.memberAddress}`;
  }

  async function handleApprove(item: PendingMember) {
    if (!signer) return;
    await runTransaction(
      'Approve team member',
      () => approveTeamMember(chainId, item.iteration, item.project, item.member.memberAddress, signer!),
      async () => { onAction(); }
    );
  }

  async function handleReject(item: PendingMember) {
    if (!signer) return;
    await runTransaction(
      'Reject team member',
      () => rejectTeamMember(chainId, item.iteration, item.project, item.member.memberAddress, signer!),
      async () => { onAction(); }
    );
  }
</script>

<section class="pob-pane">
  <div class="pob-pane__heading">
    <h3 class="pob-pane__title">Pending Team Members</h3>
    <span class="pob-pill pob-pill--admin">Admin</span>
  </div>

  {#if pendingMembers.length === 0}
    <p class="text-sm text-[var(--pob-text-muted)]">
      No pending team member proposals.
    </p>
  {:else}
    <ul class="space-y-2">
      {#each pendingMembers as item (memberKey(item))}
        <li class="rounded-lg border border-[var(--pob-border)] bg-white/5 px-3 py-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-xs text-[var(--pob-text-muted)]">
                Iteration {item.iteration}
              </span>
              <span class="text-sm text-[var(--pob-text)] truncate">
                Project: {formatAddress(item.project)}
              </span>
              <span class="text-sm text-white truncate">
                {item.member.fullName || formatAddress(item.member.memberAddress)}
              </span>
              {#if item.member.fullName}
                <span class="text-xs text-[var(--pob-text-muted)] truncate">
                  {formatAddress(item.member.memberAddress)}
                </span>
              {/if}
            </div>
            <div class="flex gap-2 shrink-0">
              <button
                type="button"
                class="pob-button pob-button--small"
                disabled={$pendingAction !== null || !signer}
                onclick={() => handleApprove(item)}
              >
                Approve
              </button>
              <button
                type="button"
                class="pob-button pob-button--outline pob-button--small"
                disabled={$pendingAction !== null || !signer}
                onclick={() => handleReject(item)}
              >
                Reject
              </button>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
