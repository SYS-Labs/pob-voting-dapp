import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
import { NETWORKS } from '~/constants/networks';

interface RoleStatuses {
  community: boolean;
  devrel: boolean;
  dao_hic: boolean;
  project: boolean;
}

interface ToolboxCardProps {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  walletAddress?: string | null;
  chainId?: number | null;
  isOwner?: boolean;
  roles?: RoleStatuses;
  devRelVote?: string | null;
  daoHicVote?: string | null;
  communityVoted?: boolean;
  hasBadge?: boolean;
  getProjectLabel?: (address: string | null) => string | null;
  onOpenDisconnect?: () => void;
  onConnect?: () => void;
  pendingAction?: string | null;
}

const ToolboxCard = ({
  onToggleSidebar,
  walletAddress,
  chainId,
  isOwner,
  roles,
  onOpenDisconnect,
  onConnect,
  pendingAction,
}: ToolboxCardProps) => {
  const getNetworkLabel = (chainId: number | null | undefined): string => {
    if (!chainId) return 'No Network';
    return NETWORKS[chainId]?.name || `Chain ${chainId}`;
  };
  // Determine user's primary role
  const getPrimaryRole = () => {
    if (isOwner) return { label: 'Owner', color: 'pob-pill--admin', key: 'owner' };
    if (!roles) return null;
    if (roles.devrel) return { label: ROLE_LABELS.devrel, color: ROLE_COLORS.devrel, key: 'devrel' };
    if (roles.dao_hic) return { label: ROLE_LABELS.dao_hic, color: ROLE_COLORS.dao_hic, key: 'dao_hic' };
    if (roles.project) return { label: ROLE_LABELS.project, color: ROLE_COLORS.project, key: 'project' };
    // Show Community role tag when wallet is connected (default role)
    if (walletAddress) return { label: ROLE_LABELS.community, color: ROLE_COLORS.community, key: 'community' };
    return null;
  };

  const role = getPrimaryRole();

  return (
    <section
      className="pob-pane cursor-pointer"
      style={{
        position: 'fixed',
        bottom: '0',
        left: '0',
        right: '0',
        width: '100%',
        zIndex: '50',
        margin: '0',
        borderRadius: '0',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        paddingBottom: '0.75rem',
      }}
      onClick={onToggleSidebar}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleSidebar();
        }
      }}
    >
      <div className="pob-pane__heading mb-0">
        <div className="flex items-center gap-2 flex-1 overflow-hidden">
          {role && (
            <span className={`pob-pill ${role.color}`}>
              {role.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {walletAddress ? (
            onOpenDisconnect && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDisconnect();
                }}
                disabled={pendingAction !== null}
                className="pob-button pob-button--header pob-button--header-wallet pob-button--outline"
              >
                <span className="pob-mono">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </span>
                <span style={{ height: '0.75rem', width: '1px', background: 'rgba(247,147,26,0.3)' }} />
                <span style={{ color: 'var(--pob-primary)' }}>
                  {getNetworkLabel(chainId)}
                </span>
              </button>
            )
          ) : (
            onConnect && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onConnect();
                }}
                className="pob-button pob-button--header"
              >
                Connect Wallet
              </button>
            )
          )}
        </div>
      </div>
    </section>
  );
};

export default ToolboxCard;
