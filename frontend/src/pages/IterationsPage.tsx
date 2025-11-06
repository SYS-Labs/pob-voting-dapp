import type { Iteration, IterationStatus } from '~/interfaces';
import IterationSection from '~/components/IterationSection';

interface IterationsPageProps {
  filteredIterations: Iteration[];
  selectedIteration: number | null;
  iterationStatuses: { [iterationNumber: number]: IterationStatus };
  onSelectIteration: (iteration: number) => void;
  onNavigateToFaq: () => void;
}

const IterationsPage = ({ filteredIterations, selectedIteration, iterationStatuses, onSelectIteration, onNavigateToFaq }: IterationsPageProps) => {

  return (
    <div className="pob-stack" id="iterations">
      <section className="pob-pane">
        <div className="space-y-4">
          <div>
            <h2 className="pob-pane__title text-3xl">Welcome to Proof-of-Builders! 👋</h2>
            <p className="text-sm text-[var(--pob-primary)] mt-1">
              Bitcoin security meets scalable Web3 infrastructure through Syscoin's zkSYS
            </p>
          </div>
          <div className="space-y-3 text-sm text-[var(--pob-text-muted)]">
            <p>
              <strong className="text-white">What's this about?</strong> This is an ongoing program where you can build real projects
              on Syscoin (UTXO, NEVM, and zkSYS) and get recognized for it. Your participation, votes, and results are recorded on-chain,
              making the evaluation process transparent and verifiable. Think of it as building your portfolio while contributing
              to the ecosystem.
            </p>
            <p>
              <strong className="text-white">Why it exists:</strong> Part of Ledger Architects' zkSYS Global Developer Onboarding Campaign,
              with a special focus on Latin America. We're here to help you learn Web3, collaborate with others, and build cool stuff on
              Syscoin. It's a bridge between learning, getting community feedback, and growing the ecosystem together.
            </p>
            <button
              onClick={onNavigateToFaq}
              className="pob-button pob-button--compact mt-4"
            >
              Read the FAQ
            </button>
          </div>
        </div>
      </section>
      <IterationSection
        title="Program Iterations"
        iterations={filteredIterations}
        selectedIteration={selectedIteration}
        iterationStatuses={iterationStatuses}
        onSelectIteration={onSelectIteration}
      />
    </div>
  );
};

export default IterationsPage;
