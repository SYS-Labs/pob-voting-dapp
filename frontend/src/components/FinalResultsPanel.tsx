interface FinalResultsPanelProps {
  winner: { projectAddress: string | null; hasWinner: boolean };
  entityVotes: { devRel: string | null; daoHic: string | null; community: string | null };
  votingMode: number;
  projects: { id: number; address: string; metadata?: any }[];
  projectScores?: { addresses: string[]; scores: bigint[]; totalPossible: bigint } | null;
  getProjectLabel?: (address: string | null) => string | null;
  isOwner: boolean;
}

const FinalResultsPanel = ({
  winner,
  entityVotes,
  votingMode,
  projects,
  projectScores,
  getProjectLabel,
  isOwner,
}: FinalResultsPanelProps) => {
  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        border: '2px solid var(--pob-primary)',
        borderRadius: '0.5rem',
        backgroundColor: 'rgba(247, 147, 26, 0.05)',
      }}
    >
      <h4 className="text-sm font-semibold text-white mb-2">Final Results</h4>

      {winner.hasWinner && winner.projectAddress ? (
        <div className="space-y-3">
          {/* Winner Display */}
          <div className="space-y-1">
            {votingMode === 0 ? (
              // Consensus mode - show name with trophy and entity count
              <>
                <p className="text-lg font-bold text-[var(--pob-primary)]">
                  🏆{' '}
                  <span className="italic">
                    {getProjectLabel ? getProjectLabel(winner.projectAddress) ?? winner.projectAddress : winner.projectAddress}
                  </span>
                </p>
                {(() => {
                  let weight = 0;
                  if (entityVotes.devRel?.toLowerCase() === winner.projectAddress.toLowerCase()) weight++;
                  if (entityVotes.daoHic?.toLowerCase() === winner.projectAddress.toLowerCase()) weight++;
                  if (entityVotes.community?.toLowerCase() === winner.projectAddress.toLowerCase()) weight++;
                  const percentage = ((weight / 3) * 100).toFixed(2);

                  return (
                    <p className="text-sm text-[var(--pob-text-muted)]">
                      {weight}/3 entities ({percentage}%)
                    </p>
                  );
                })()}
              </>
            ) : (
              // Weighted mode - show name with trophy and progress bar (same format as runners-up)
              projectScores && (() => {
                const scoreIndex = projectScores.addresses.findIndex(
                  addr => addr.toLowerCase() === winner.projectAddress?.toLowerCase()
                );
                if (scoreIndex >= 0) {
                  const score = projectScores.scores[scoreIndex];
                  const percentage = Number((score * 10000n) / projectScores.totalPossible) / 100;
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-lg font-bold text-[var(--pob-primary)]">
                          🏆{' '}
                          <span className="italic">
                            {getProjectLabel ? getProjectLabel(winner.projectAddress) ?? winner.projectAddress : winner.projectAddress}
                          </span>
                        </p>
                        <p className="text-sm text-[var(--pob-text-muted)]">{percentage.toFixed(2)}%</p>
                      </div>
                      <div className="score-bar-container">
                        <div
                          className="score-bar-fill"
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                    </>
                  );
                }
                return (
                  <p className="text-lg font-bold text-[var(--pob-primary)]">
                    🏆{' '}
                    <span className="italic">
                      {getProjectLabel ? getProjectLabel(winner.projectAddress) ?? winner.projectAddress : winner.projectAddress}
                    </span>
                  </p>
                );
              })()
            )}
          </div>

          {/* Runners-up */}
          {projects.length > 1 && (
            <div className="space-y-2 border-t border-[var(--pob-border)]" style={{ paddingTop: '1rem' }}>
              <p className="text-sm font-semibold text-white" style={{ marginBottom: '0.25rem' }}>Runners-up:</p>
              <div className="space-y-2">
                {votingMode === 0 ? (
                  // Consensus mode - show other projects by entity count
                  projects
                    .filter(p => p.address.toLowerCase() !== winner.projectAddress?.toLowerCase())
                    .map(project => {
                      let weight = 0;
                      if (entityVotes.devRel?.toLowerCase() === project.address.toLowerCase()) weight++;
                      if (entityVotes.daoHic?.toLowerCase() === project.address.toLowerCase()) weight++;
                      if (entityVotes.community?.toLowerCase() === project.address.toLowerCase()) weight++;
                      const percentage = ((weight / 3) * 100).toFixed(2);
                      return { ...project, weight, percentage };
                    })
                    .sort((a, b) => b.weight - a.weight)
                    .map(project => (
                      <div key={project.address} className="text-xs">
                        <p className="text-white italic">
                          {getProjectLabel ? getProjectLabel(project.address) ?? `Project #${project.id}` : `Project #${project.id}`}
                        </p>
                        <p className="text-[var(--pob-text-muted)] ml-2">
                          {project.weight}/3 entities ({project.percentage}%)
                        </p>
                      </div>
                    ))
                ) : (
                  // Weighted mode - show other projects by score with progress bars
                  projectScores && projects
                    .filter(p => p.address.toLowerCase() !== winner.projectAddress?.toLowerCase())
                    .map(project => {
                      const scoreIndex = projectScores.addresses.findIndex(
                        addr => addr.toLowerCase() === project.address.toLowerCase()
                      );
                      const score = scoreIndex >= 0 ? projectScores.scores[scoreIndex] : 0n;
                      const percentage = Number((score * 10000n) / projectScores.totalPossible) / 100;
                      return { ...project, score, percentage };
                    })
                    .sort((a, b) => {
                      if (a.score > b.score) return -1;
                      if (a.score < b.score) return 1;
                      return 0;
                    })
                    .map(project => (
                      <div key={project.address} className="text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-white italic">
                            {getProjectLabel ? getProjectLabel(project.address) ?? `Project #${project.id}` : `Project #${project.id}`}
                          </p>
                          <p className="text-[var(--pob-text-muted)]">
                            {project.percentage.toFixed(2)}%
                          </p>
                        </div>
                        <div className="score-bar-container">
                          <div
                            className="score-bar-fill"
                            style={{ width: `${Math.min(project.percentage, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-yellow-400">
            No Winner
          </p>
          <p className="text-xs text-[var(--pob-text-muted)] mb-2">
            {votingMode === 0
              ? 'No project achieved 2-out-of-3 entity majority.'
              : 'No clear winner (tie or insufficient votes).'}
          </p>
          <div className="text-xs text-[var(--pob-text-muted)] space-y-1">
            <p className="font-semibold text-white">Participation:</p>
            {isOwner ? (
              // Owner: Show which entity voted for which project
              [
                { label: 'Community', address: entityVotes.community },
                { label: 'DAO HIC', address: entityVotes.daoHic },
                { label: 'DevRel', address: entityVotes.devRel },
              ]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map(({ label, address }) => (
                  <p key={label}>
                    • {label}:{' '}
                    {address ? (
                      <span className="italic">
                        {getProjectLabel ? getProjectLabel(address) ?? address : address}
                      </span>
                    ) : (
                      'Did not vote'
                    )}
                  </p>
                ))
            ) : (
              // Non-owner: Just list projects that received votes (without revealing which entity)
              Array.from(new Set([entityVotes.community, entityVotes.daoHic, entityVotes.devRel].filter(Boolean)))
                .map(address => (
                  <p key={address}>
                    • <span className="italic">
                      {getProjectLabel ? getProjectLabel(address!) ?? address : address}
                    </span>
                  </p>
                ))
            )}
          </div>
          {entityVotes.devRel && entityVotes.daoHic && entityVotes.community &&
           entityVotes.devRel !== entityVotes.daoHic &&
           entityVotes.daoHic !== entityVotes.community &&
           entityVotes.devRel !== entityVotes.community ? (
            <p className="text-xs text-[var(--pob-text-muted)] mt-2">
              Three-way tie — each entity voted differently
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default FinalResultsPanel;
