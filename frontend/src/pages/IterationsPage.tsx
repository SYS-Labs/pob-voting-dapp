import type { Iteration, IterationStatus } from '~/interfaces';
import IterationSection from '~/components/IterationSection';

interface IterationsPageProps {
  filteredIterations: Iteration[];
  selectedIteration: number | null;
  iterationStatuses: { [iterationNumber: number]: IterationStatus };
  onSelectIteration: (iteration: number) => void;
}

const IterationsPage = ({ filteredIterations, selectedIteration, iterationStatuses, onSelectIteration }: IterationsPageProps) => {

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
              on Syscoin (UTXO, NEVM, and zkSYS) and get recognized for it. Every idea, demo, or MVP you share leaves a public footprint
              on the blockchain, making your progress transparent and verifiable. Think of it as building your portfolio while contributing
              to the ecosystem.
            </p>
            <p>
              <strong className="text-white">Why it exists:</strong> Part of Ledger Architects' zkSYS Global Developer Onboarding Campaign,
              with a special focus on Latin America. We're here to help you learn Web3, collaborate with others, and build cool stuff on
              Syscoin. It's a bridge between learning, getting community feedback, and growing the ecosystem together.
            </p>
            <p>
              <strong className="text-white">How it works:</strong> Join anytime (no deadlines!) • Everything is open and verifiable •
              Follow these phases: Register → Share your idea → Build a demo → Get evaluated → Launch your MVP • Grow alongside
              Syscoin's community.
            </p>
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
