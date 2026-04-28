<script lang="ts">
  import { Link } from 'svelte-routing';
  import { ROLE_LABELS, ROLE_COLORS } from '~/constants/roles';

  interface RoleStatuses {
    community: boolean;
    smt: boolean;
    dao_hic: boolean;
    project: boolean;
  }

  interface Props {
    roles: RoleStatuses;
    walletAddress: string | null;
    iterationNumber?: number;
  }

  let {
    roles,
    walletAddress,
    iterationNumber,
  }: Props = $props();
</script>

{#if roles.project}
  <section class="pob-pane pob-surface--quiet">
    <div class="pob-pane__heading">
      <div>
        <p class="pob-eyebrow pob-eyebrow--muted mb-1">Project role</p>
        <h3 class="pob-pane__title">Participant Panel</h3>
      </div>
      <span class="pob-pill {ROLE_COLORS.project}">{ROLE_LABELS.project}</span>
    </div>

    <div class="space-y-3">
      <p class="pob-status-block pob-surface--quiet text-sm text-[var(--pob-text-muted)]">
        You are registered as a project participant in this iteration. Your project will be evaluated by the jury.
      </p>

      {#if walletAddress && iterationNumber}
        <Link
          to="/iteration/{iterationNumber}/project/{walletAddress}"
          class="pob-button pob-button--outline w-full justify-center text-xs"
        >
          Manage my project
        </Link>
      {/if}
    </div>
  </section>
{/if}
