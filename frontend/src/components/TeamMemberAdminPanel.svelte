<script lang="ts">
  import { type JsonRpcSigner } from 'ethers';
  import type { TeamMember } from '~/interfaces';
  import { approveTeamMember, rejectTeamMember } from '~/utils/teamMembers';
  import { formatAddress } from '~/utils';

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

  let processingKey = $state<string | null>(null);
  let actionErrors = $state<Record<string, string>>({});

  function memberKey(item: PendingMember): string {
    return `${item.iteration}-${item.project}-${item.member.memberAddress}`;
  }

  async function handleApprove(item: PendingMember) {
    if (!signer) return;

    const key = memberKey(item);
    processingKey = key;
    actionErrors = { ...actionErrors, [key]: '' };

    try {
      await approveTeamMember(chainId, item.iteration, item.project, item.member.memberAddress, signer);
      // Clear any previous error for this key
      const { [key]: _, ...rest } = actionErrors;
      actionErrors = rest;
      onAction();
    } catch (err: any) {
      if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) {
        actionErrors = { ...actionErrors, [key]: 'Transaction was rejected.' };
      } else if (err?.reason) {
        actionErrors = { ...actionErrors, [key]: err.reason };
      } else {
        actionErrors = { ...actionErrors, [key]: 'Failed to approve team member.' };
      }
    } finally {
      processingKey = null;
    }
  }

  async function handleReject(item: PendingMember) {
    if (!signer) return;

    const key = memberKey(item);
    processingKey = key;
    actionErrors = { ...actionErrors, [key]: '' };

    try {
      await rejectTeamMember(chainId, item.iteration, item.project, item.member.memberAddress, signer);
      const { [key]: _, ...rest } = actionErrors;
      actionErrors = rest;
      onAction();
    } catch (err: any) {
      if (err?.code === 'ACTION_REJECTED' || err?.code === 4001) {
        actionErrors = { ...actionErrors, [key]: 'Transaction was rejected.' };
      } else if (err?.reason) {
        actionErrors = { ...actionErrors, [key]: err.reason };
      } else {
        actionErrors = { ...actionErrors, [key]: 'Failed to reject team member.' };
      }
    } finally {
      processingKey = null;
    }
  }
</script>

<section class="pob-pane">
  <div class="pob-pane__heading">
    <h3 class="pob-pane__title">Pending Team Members</h3>
    <span class="pob-pill pob-pill--admin">Admin</span>
  </div>

  {#if pendingMembers.length === 0}
    <p class="text-sm text-[var(--pob-text-muted)]" style="padding: 0.75rem 1.25rem;">
      No pending team member proposals.
    </p>
  {:else}
    <ul class="space-y-2" style="padding: 0.75rem 1.25rem;">
      {#each pendingMembers as item (memberKey(item))}
        {@const key = memberKey(item)}
        {@const isProcessing = processingKey === key}
        {@const errorMsg = actionErrors[key] || ''}
        <li class="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-xs text-[var(--pob-text-muted)]">
                Iteration {item.iteration}
              </span>
              <span class="text-sm text-[var(--pob-text-secondary)] truncate">
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
                disabled={processingKey !== null || !signer}
                onclick={() => handleApprove(item)}
              >
                {isProcessing ? 'Processing...' : 'Approve'}
              </button>
              <button
                type="button"
                class="pob-button pob-button--outline pob-button--small"
                disabled={processingKey !== null || !signer}
                onclick={() => handleReject(item)}
              >
                {isProcessing ? 'Processing...' : 'Reject'}
              </button>
            </div>
          </div>
          {#if errorMsg}
            <p class="text-sm text-red-400 mt-1">{errorMsg}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
