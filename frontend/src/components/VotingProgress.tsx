interface VotingProgressProps {
  voteCounts: { devRel: number; daoHic: number; community: number };
  daoHicVoters: string[];
  totalCommunityVoters: number;
}

const VotingProgress = ({
  voteCounts,
  daoHicVoters,
  totalCommunityVoters,
}: VotingProgressProps) => {
  const communityCap =
    Number.isFinite(totalCommunityVoters) && totalCommunityVoters > 0 ? totalCommunityVoters.toString() : '∞';
  const votingRows = [
    { label: 'Community', value: `${voteCounts.community}/${communityCap}` },
    { label: 'DAO HIC', value: `${voteCounts.daoHic}/${daoHicVoters.length}` },
    { label: 'DevRel', value: `${voteCounts.devRel}/1` },
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <section className="pob-pane">
      <div className="pob-pane__heading">
        <h3 className="pob-pane__title">Voting Progress</h3>
      </div>
      <div className="space-y-3">
        {votingRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-sm text-[var(--pob-text-muted)]">{row.label}</span>
            <span className="pob-mono text-base font-semibold text-white">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default VotingProgress;
