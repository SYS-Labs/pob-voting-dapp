import type { ParticipantRole, Project } from '~/interfaces';
import MarkdownRenderer from './MarkdownRenderer';
import { formatAddress, getYouTubeEmbedUrl } from '~/utils';

interface ProjectCardProps {
  project: Project;
  votingRole: ParticipantRole | null;
  hasVotedForProject: boolean;
  canVote: boolean;
  isOwner: boolean;
  projectsLocked: boolean;
  pendingAction: string | null;
  onVote: (projectAddress: string, tokenId?: string) => void;
  onRemove: (project: Project) => void;
  communityBadges?: Array<{ tokenId: string; hasVoted: boolean }>;
}

const ProjectCard = ({
  project,
  votingRole,
  hasVotedForProject,
  canVote,
  isOwner,
  projectsLocked,
  pendingAction,
  onVote,
  onRemove,
  communityBadges = [],
}: ProjectCardProps) => {
  const projectName = project.metadata?.name ?? `Project #${project.id}`;
  const embedUrl = getYouTubeEmbedUrl(project.metadata?.yt_vid ?? null);

  return (
    <div className="pob-fieldset projects-list__item space-y-3">
      <div className="space-y-2">
        <p className="text-lg font-semibold text-white">{projectName}</p>
        <p className="pob-mono text-xs text-[var(--pob-text-muted)]">
          {formatAddress(project.address)}
        </p>
        <MarkdownRenderer content={project.metadata?.description} />
        {embedUrl ? (
          <div className="pob-video" style={{ marginTop: '1rem', marginBottom: '1rem' }}>
            <iframe
              src={embedUrl}
              title={`Project video for ${projectName}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 justify-between" style={{ marginTop: '1rem' }}>
          <div className="flex flex-wrap items-center gap-2">
            {project.metadata?.proposal ? (
              <a
                href={project.metadata.proposal}
                target="_blank"
                rel="noopener noreferrer"
                className="pob-button pob-button--compact"
              >
                Read full proposal
              </a>
            ) : null}
            {isOwner && !projectsLocked ? (
              <button
                type="button"
                onClick={() => onRemove(project)}
                disabled={pendingAction !== null}
                className="pob-button pob-button--outline pob-button--compact"
              >
                Remove
              </button>
            ) : null}
          </div>

          {/* Vote button/status for voting entities only */}
          {votingRole !== null && !isOwner ? (
            hasVotedForProject ? (
              <span className="pob-pill border border-[rgba(247,147,26,0.45)] bg-[rgba(247,147,26,0.12)] text-[var(--pob-primary)]">
                VOTED
              </span>
            ) : canVote ? (
              <button
                type="button"
                onClick={() => {
                  console.log('[ProjectCard] Vote button clicked for:', {
                    projectName: project.metadata?.name ?? `Project #${project.id}`,
                    projectId: project.id,
                    projectAddress: project.address,
                    votingRole,
                  });
                  if (votingRole === 'community') {
                    // Community voters have exactly one badge per iteration (enforced by contract)
                    // Use first badge for both initial vote and vote changes
                    const badge = communityBadges[0];
                    if (badge) {
                      onVote(project.address, badge.tokenId);
                    }
                  } else {
                    onVote(project.address);
                  }
                }}
                disabled={pendingAction !== null}
                className="pob-button pob-button--compact"
              >
                VOTE
              </button>
            ) : null
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ProjectCard;
