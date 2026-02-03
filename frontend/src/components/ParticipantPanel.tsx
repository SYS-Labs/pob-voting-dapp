import { Link, useParams } from 'react-router-dom';
import type { ParticipantRole, Badge } from '~/interfaces';
import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';
import { PoB_01ABI, PoB_02ABI } from '~/abis';

// Helper to select PoB ABI based on version
function getPoBContractABI(version: string | undefined) {
  if (version === '001' || version === '002') return PoB_01ABI;
  return PoB_02ABI; // Default to v02 for "003" and future versions
}

interface RoleStatuses {
  community: boolean;
  devrel: boolean;
  dao_hic: boolean;
  project: boolean;
}

interface ParticipantPanelProps {
  roles: RoleStatuses;
  projectsLocked: boolean;
  votingEnded: boolean;
  pendingAction: string | null;
  walletAddress: string | null;
  badges: Badge[];
  executeMint: (role: ParticipantRole) => void;
}

const ParticipantPanel = ({
  roles,
  projectsLocked,
  pendingAction,
  walletAddress,
  badges,
  executeMint
}: ParticipantPanelProps) => {
  const { iterationNumber } = useParams<{ iterationNumber: string }>();

  if (!roles.project) return null;

  // Check if project has minted a badge
  const projectBadge = badges.find((badge) => badge.role === 'project');

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <h3 className="pob-pane__title">Participant Panel</h3>
      </div>
      <div className="pob-fieldset space-y-3">
        <div className="flex items-center justify-between">
          <span className={`pob-pill ${ROLE_COLORS.project}`}>{ROLE_LABELS.project}</span>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-[var(--pob-text-muted)]">
            You are registered as a project participant in this iteration. Your project will be evaluated by the jury.
          </p>

          {/* View Project button */}
          {walletAddress && (
            <Link
              to={`/iteration/${iterationNumber}/project/${walletAddress}`}
              className="pob-button pob-button--outline w-full justify-center text-xs"
            >
              Manage my project
            </Link>
          )}

          {/* Mint button - only show if projects locked and no badge yet */}
          {!projectBadge && projectsLocked && (
            <button
              type="button"
              onClick={() => {
                void executeMint('project');
              }}
              className="pob-button w-full justify-center text-xs"
              disabled={pendingAction !== null || !walletAddress}
            >
              {pendingAction === 'Mint Project Badge' ? 'Minting…' : 'Mint project badge'}
            </button>
          )}
          {!projectBadge && !projectsLocked && (
            <p className="text-xs text-[var(--pob-text-muted)] italic">
              Badge minting available when voting starts
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

export default ParticipantPanel;
