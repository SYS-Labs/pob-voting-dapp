<script lang="ts">
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
  import { NETWORKS } from '~/constants/networks';

  interface RoleStatuses {
    community: boolean;
    smt: boolean;
    dao_hic: boolean;
    project: boolean;
  }

  interface Props {
    sidebarVisible: boolean;
    onToggleSidebar: () => void;
    walletAddress?: string | null;
    chainId?: number | null;
    isOwner?: boolean;
    roles?: RoleStatuses;
    daoHicVote?: string | null;
    communityVoted?: boolean;
    hasBadge?: boolean;
    getProjectLabel?: (address: string | null) => string | null;
    onOpenDisconnect?: () => void;
    onConnect?: () => void;
    pendingAction?: string | null;
  }

  let {
    onToggleSidebar,
    walletAddress,
    chainId,
    isOwner,
    roles,
    onOpenDisconnect,
    onConnect,
    pendingAction,
  }: Props = $props();

  function getNetworkLabel(chainId: number | null | undefined): string {
    if (!chainId) return 'No Network';
    return NETWORKS[chainId]?.name || `Chain ${chainId}`;
  }

  function getPrimaryRole() {
    if (isOwner) return { label: 'Owner', color: 'pob-pill--admin', key: 'owner' };
    if (!roles) return null;
    if (roles.smt) return { label: ROLE_LABELS.smt, color: ROLE_COLORS.smt, key: 'smt' };
    if (roles.dao_hic) return { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic, key: 'dao_hic' };
    if (roles.project) return { label: ROLE_LABELS.project, color: ROLE_COLORS.project, key: 'project' };
    if (walletAddress) return { label: ROLE_LABELS.community, color: ROLE_COLORS.community, key: 'community' };
    return null;
  }

  const role = $derived(getPrimaryRole());

  function handleClick() {
    onToggleSidebar();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleSidebar();
    }
  }

  function handleDisconnectClick(e: MouseEvent) {
    e.stopPropagation();
    if (onOpenDisconnect) onOpenDisconnect();
  }

  function handleConnectClick(e: MouseEvent) {
    e.stopPropagation();
    if (onConnect) onConnect();
  }
</script>

<section
  class="pob-pane cursor-pointer"
  style="position: fixed; bottom: 0; left: 0; right: 0; width: 100%; z-index: 50; margin: 0; border-radius: 0; border-left: none; border-right: none; border-bottom: none; padding-bottom: 0.75rem;"
  onclick={handleClick}
  role="button"
  tabindex="0"
  onkeydown={handleKeydown}
>
  <div class="pob-pane__heading mb-0">
    <div class="flex items-center gap-2 flex-1 overflow-hidden">
      {#if role}
        <span class="pob-pill {role.color}">
          {role.label}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      {#if walletAddress}
        {#if onOpenDisconnect}
          <button
            type="button"
            onclick={handleDisconnectClick}
            disabled={pendingAction !== null}
            class="pob-button pob-button--header pob-button--header-wallet pob-button--outline"
          >
            <span class="pob-mono">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </span>
            <span style="height: 0.75rem; width: 1px; background: rgba(247,147,26,0.3);"></span>
            <span style="color: var(--pob-primary);">
              {getNetworkLabel(chainId)}
            </span>
          </button>
        {/if}
      {:else if onConnect}
        <button
          type="button"
          onclick={handleConnectClick}
          class="pob-button pob-button--header"
        >
          Connect Wallet
        </button>
      {/if}
    </div>
  </div>
</section>
