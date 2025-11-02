interface VotingProgressProps {
  voteCounts: { devRel: number; daoHic: number; community: number };
  daoHicVoters: string[];
  totalCommunityVoters: number;
  winner: { projectAddress: string | null; hasWinner: boolean };
  votingEnded: boolean;
  getProjectLabel: (address: string | null) => string | null;
}

const VotingProgress = ({
  voteCounts,
  daoHicVoters,
  totalCommunityVoters,
  winner,
  votingEnded,
  getProjectLabel,
}: VotingProgressProps) => {
  const communityCap =
    Number.isFinite(totalCommunityVoters) && totalCommunityVoters > 0 ? totalCommunityVoters.toString() : '∞';
  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <h3 className="pob-pane__title">Voting Progress</h3>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--pob-text-muted)]">DevRel</span>
          <span className="pob-mono text-base font-semibold text-white">{voteCounts.devRel}/1</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--pob-text-muted)]">DAO_HIC</span>
          <span className="pob-mono text-base font-semibold text-white">
            {voteCounts.daoHic}/{daoHicVoters.length}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--pob-text-muted)]">Community</span>
          <span className="pob-mono text-base font-semibold text-white">
            {voteCounts.community}/{communityCap}
          </span>
        </div>
        {votingEnded && winner.hasWinner ? (
          <div className="pob-fieldset space-y-2">
            <p className="text-sm font-semibold text-white">Winner</p>
            <p className="pob-mono text-lg text-[var(--pob-primary)]">
              {getProjectLabel(winner.projectAddress) ?? '—'}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default VotingProgress;
