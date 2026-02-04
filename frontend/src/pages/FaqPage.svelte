<script lang="ts">
  import { NETWORKS } from '~/constants/networks';

  interface Props {
    chainId: number | null;
  }

  let { chainId }: Props = $props();

  const tokenSymbol = $derived((chainId !== null && NETWORKS[chainId]) ? NETWORKS[chainId].tokenSymbol : 'SYS/TSYS');
</script>

<div class="pob-stack" id="faq-page">
  <section id="faq" class="pob-pane">
    <div class="space-y-4">
      <div>
        <h2 class="pob-pane__title text-3xl">Frequently Asked Questions</h2>
        <p class="text-sm text-[var(--pob-primary)] mt-1">
          Everything you need to know about the Proof-of-Builders program
        </p>
      </div>
      <div class="space-y-8">
        <!-- Program Overview Section -->
        <div class="space-y-6">
          <h3 class="text-lg font-semibold text-[var(--pob-primary)]">📋 Program Overview</h3>

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">How it works:</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <ol class="pob-markdown-list">
                <li>Join anytime (no deadlines!)</li>
                <li>Everything is open and verifiable</li>
                <li>Follow these phases: Register → Share your idea → Build a demo → Get evaluated → Launch your MVP</li>
                <li>Grow alongside Syscoin's community</li>
              </ol>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">How do I join the program?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Attend a Syscoin in-person event (Phase 0) where you'll register your NEVM wallet and Telegram username.
                You'll receive an airdrop of gas and an accreditation NFT to get started.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">What are the phases?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <ul class="pob-markdown-list">
                <li><strong class="text-white">Phase 0:</strong> In-person registration</li>
                <li><strong class="text-white">Phase 1:</strong> Submit your idea (max 2 pages)</li>
                <li><strong class="text-white">Phase 2:</strong> Present your demo (video + live presentation)</li>
                <li><strong class="text-white">Phase 3:</strong> Community evaluation via voting + MVP development for winners</li>
              </ul>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">What do winners get?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Winners receive funding split into 30% at award ceremony and 70% upon completing deliverables (within 3 weeks).
                They also get technical support, mentorship, and visibility from Syscoin and its community.
              </p>
            </div>
          </div>
        </div>

        <!-- Participation & Voting Section -->
        <div class="space-y-6">
          <h3 class="text-lg font-semibold text-[var(--pob-primary)]">🗳️ Participation & Voting</h3>

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">Who votes on projects?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Three entities: DAO HIC Committee (collective vote), Community (mint voting NFTs by locking a {tokenSymbol} deposit during the voting period),
                and DevRel (individual vote). All entities have equal weight (⅓ each) and all votes are recorded on-chain.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">How does voting work?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Each voting round lasts 48 hours. Community members lock a {tokenSymbol} deposit to mint a voting NFT during the active voting period.
                After voting ends, they can claim their full deposit back. Results are determined automatically by the smart contract.
                If no winner is determined, a new 48-hour round begins.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">How are winners determined?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p class="mb-3">
                Each voting entity (DAO HIC, Community, DevRel) has equal weight (⅓ each). The voting contract supports two modes:
              </p>
              <p class="mb-2">
                <strong class="text-white">Consensus Mode:</strong> Each entity votes for a single project. The project with votes from the most entities wins.
                With 3 entities, a project typically needs 2+ entities to win. Ties result in no winner.
              </p>
              <p>
                <strong class="text-white">Weighted Mode:</strong> Each entity's ⅓ weight is distributed proportionally across projects based on how that entity's voters split their votes.
                DevRel gives their full ⅓ to one project (binary). DAO HIC and Community distribute their ⅓ proportionally (e.g., if 60% vote for Project A, it gets 60% of that entity's ⅓ weight).
                The project with the highest cumulative score wins. Ties result in no winner.
              </p>
              <p class="mt-3 text-xs opacity-75">
                If no winner is determined, a new 48-hour voting round begins.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">Can I change my vote?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Yes, all voters (DAO HIC, Community, and DevRel) can change their vote during the active 48-hour voting period.
                Simply submit a new vote transaction for a different project, and your previous vote will be updated.
                Once voting ends, votes become final and cannot be changed.
              </p>
            </div>
          </div>
        </div>

        <!-- Support Section -->
        <div class="space-y-6">
          <h3 class="text-lg font-semibold text-[var(--pob-primary)]">💬 Support</h3>

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">Who can I contact for help?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Reach out through official Syscoin channels (Telegram, Discord, X). For disputes, Syscoin Foundation
                has final authority to resolve them.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>
