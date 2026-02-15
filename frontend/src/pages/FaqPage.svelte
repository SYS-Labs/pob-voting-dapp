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
                <li>Teams onboard at monthly in-person events, then continue through a competition cycle that typically lasts about 3 weeks</li>
                <li>Everything is open and verifiable</li>
                <li>Follow these phases: Register → Validate the idea → Build the solution → Get evaluated → Mature the product</li>
                <li>Grow alongside Syscoin's community</li>
              </ol>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">How do teams join the program?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Attend a monthly Syscoin in-person onboarding event (Phase 0), where each team registers a NEVM wallet following the provided instructions.
                Teams receive TSYS (test-token) gas to get started and may be eligible for a participation certificate during the competition.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">What are the phases?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <ul class="pob-markdown-list">
                <li><strong class="text-white">Phase 0:</strong> In-person registration</li>
                <li><strong class="text-white">Phase 1:</strong> Team idea validation</li>
                <li><strong class="text-white">Phase 2:</strong> Project build and progress sharing</li>
                <li><strong class="text-white">Phase 3:</strong> Evaluation via voting + product maturation</li>
              </ul>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">What do participating teams get?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                All participating teams build through a guided process with Syscoin and receive mentoring throughout the program.
                They also join the Syscoin Builders community, with access to a global Web3 network for professional development.
                Selected projects may also receive the same support track as winning teams, as determined by the Syscoin Foundation based on project potential and program priorities.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">What do winners get?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Winning teams are eligible for milestone-based hackathon rewards after voting is finalized.
                Rewards are generally structured as 30% at the award ceremony and 70% after milestone verification (typically around 3 weeks, but timelines may vary).
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
                Three entities vote: DAO HIC Committee (collective vote), Community (minting voting NFTs by locking a {tokenSymbol} deposit during the voting period),
                and SMT. All entities have equal weight (⅓ each), and all votes are recorded on-chain.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">How does voting work?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Each voting round lasts 48 hours. Community members lock a {tokenSymbol} deposit to mint a voting NFT during the active period.
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
                Each voting entity (DAO HIC, Community, SMT) has equal weight (⅓ each). The voting contract supports two modes:
              </p>
              <p class="mb-2">
                <strong class="text-white">Consensus Mode:</strong> Each entity votes for a single project. The project with votes from the most entities wins.
                With 3 entities, a project typically needs 2+ entities to win. Ties result in no winner.
              </p>
              <p>
                <strong class="text-white">Weighted Mode:</strong> Each entity's ⅓ weight is distributed proportionally across projects based on how that entity's voters split their votes.
                SMT allocates its full ⅓ to one project. DAO HIC and Community distribute their ⅓ proportionally (e.g., if 60% vote for Project A, it gets 60% of that entity's ⅓ weight).
                The project with the highest cumulative score wins. Ties result in no winner.
              </p>
            </div>
          </div>

          <hr class="border-[var(--pob-border)]" />

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">Can a vote be changed?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                Yes, all voters (DAO HIC, Community, and SMT) can change their vote during the active 48-hour voting period.
                Simply submit a new vote transaction for a different project, and the previous vote from that wallet will be updated.
                Once voting ends, votes become final and cannot be changed.
              </p>
            </div>
          </div>
        </div>

        <!-- Support Section -->
        <div class="space-y-6">
          <h3 class="text-lg font-semibold text-[var(--pob-primary)]">💬 Support</h3>

          <div class="space-y-3">
            <p class="font-semibold text-white text-base">Who can teams contact for help?</p>
            <div class="text-sm text-[var(--pob-text-muted)]">
              <p>
                For program support, teams should use the official
                <a
                  href="https://discord.org/invite/syscoin"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[var(--pob-primary)] transition-colors underline decoration-transparent hover:decoration-inherit"
                >Syscoin Discord support channel</a>.
                For disputes, the Syscoin Foundation has final authority to resolve them.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>
