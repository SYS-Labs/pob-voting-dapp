<script lang="ts">
  import { Link } from 'svelte-routing';
  import type { ParticipantRole, Project } from '~/interfaces';
  import { formatAddress, getYouTubeEmbedUrl } from '~/utils';

  interface Props {
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
    iterationNumber?: number;
    isWinner?: boolean;
  }

  let {
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
    iterationNumber,
    isWinner = false,
  }: Props = $props();

  // Truncate text to a maximum length, adding ellipsis if truncated
  function truncateText(text: string | undefined, maxLength: number): string {
    if (!text) return '';
    // Strip markdown formatting for display
    const plainText = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/#{1,6}\s*/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n/g, ' ')
      .trim();
    if (plainText.length <= maxLength) return plainText;
    return plainText.slice(0, maxLength).trim() + '…';
  }

  const projectName = $derived(project.metadata?.name ?? `Project #${project.id}`);
  const embedUrl = $derived(getYouTubeEmbedUrl(project.metadata?.yt_vid ?? null));
  const truncatedDescription = $derived(truncateText(project.metadata?.description, 50));
  const projectPageUrl = $derived(iterationNumber ? `/iteration/${iterationNumber}/project/${project.address}` : null);

  function handleVote() {
    console.log('[ProjectCard] Vote button clicked for:', {
      projectName: project.metadata?.name ?? `Project #${project.id}`,
      projectId: project.id,
      projectAddress: project.address,
      votingRole,
    });
    if (votingRole === 'community') {
      const badge = communityBadges[0];
      onVote(project.address, badge?.tokenId);
    } else {
      onVote(project.address);
    }
  }

  function handleRemove() {
    onRemove(project);
  }
</script>

<div class="pob-fieldset projects-list__item space-y-3" class:projects-list__item--winner={isWinner}>
  <div class="space-y-2">
    {#if projectPageUrl}
      <Link to={projectPageUrl} class="project-card__title-link">
        <p class="text-lg font-semibold text-white project-card__title">
          {#if isWinner}<span class="project-card__winner-icon">🏆 </span>{/if}
          {projectName}
        </p>
      </Link>
    {:else}
      <p class="text-lg font-semibold text-white">
        {#if isWinner}<span class="project-card__winner-icon">🏆 </span>{/if}
        {projectName}
      </p>
    {/if}
    <p class="pob-mono text-xs text-[var(--pob-text-muted)]">
      {formatAddress(project.address)}
    </p>
    <!-- Truncated description with link to full page -->
    {#if truncatedDescription}
      <p class="text-sm text-[var(--pob-text-muted)]">
        {truncatedDescription}
        {#if project.metadata?.description && project.metadata.description.length > 50 && projectPageUrl}
          <Link to={projectPageUrl} class="project-card__read-more">
            {' '}Read more
          </Link>
        {/if}
      </p>
    {/if}
    {#if embedUrl}
      <div class="pob-video" style="margin-top: 1rem; margin-bottom: 1rem;">
        <iframe
          src={embedUrl}
          title="Project video for {projectName}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
    {/if}
    <div class="flex flex-wrap items-center gap-2 justify-between" style="margin-top: 1rem;">
      <div class="flex flex-wrap items-center gap-2">
        {#if projectPageUrl}
          <Link
            to={projectPageUrl}
            class="pob-button pob-button--outline pob-button--compact"
          >
            View details
          </Link>
        {/if}
        {#if project.metadata?.proposal}
          <a
            href={project.metadata.proposal}
            target="_blank"
            rel="noopener noreferrer"
            class="pob-button pob-button--compact"
          >
            Read full proposal
          </a>
        {/if}
        {#if isOwner && !projectsLocked}
          <button
            type="button"
            onclick={handleRemove}
            disabled={pendingAction !== null}
            class="pob-button pob-button--outline pob-button--compact"
          >
            Remove
          </button>
        {/if}
      </div>

      <!-- Vote button/status for voting entities only -->
      {#if votingRole !== null && !isOwner}
        {#if hasVotedForProject}
          <span class="pob-pill border border-[rgba(247,147,26,0.45)] bg-[rgba(247,147,26,0.12)] text-[var(--pob-primary)]">
            VOTED
          </span>
        {:else if canVote}
          <button
            type="button"
            onclick={handleVote}
            disabled={pendingAction !== null}
            class="pob-button pob-button--compact"
          >
            VOTE
          </button>
        {/if}
      {/if}
    </div>
  </div>
</div>
