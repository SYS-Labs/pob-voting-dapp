const FaqPage = () => {
  return (
    <div className="pob-stack" id="faq-page">
      <section id="faq" className="pob-pane pob-pane--subtle">
        <div className="pob-pane__heading">
          <h3 className="pob-pane__title">Program FAQ</h3>
        </div>
        <div className="space-y-4 text-sm text-[var(--pob-text-muted)]">
          <div>
            <p className="font-semibold text-white">How do I join the program?</p>
            <p>
              Attend a Syscoin in-person event (Phase 0) where you'll register your NEVM wallet and Telegram username.
              You'll receive an airdrop of gas and an accreditation NFT to get started.
            </p>
          </div>
          <div>
            <p className="font-semibold text-white">What are the phases?</p>
            <ul className="pob-markdown-list">
              <li><strong className="text-white">Phase 0:</strong> In-person registration</li>
              <li><strong className="text-white">Phase 1:</strong> Submit your idea (max 2 pages)</li>
              <li><strong className="text-white">Phase 2:</strong> Present your demo (video + live presentation)</li>
              <li><strong className="text-white">Phase 3:</strong> Community evaluation via voting + MVP development for winners</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-white">Who votes on projects?</p>
            <p>
              Three entities: DAO HIC Committee (collective vote), Community (mint voting tokens by locking SYS for 48h),
              and DevRel (individual vote). All votes are weighted equally and recorded on-chain.
            </p>
          </div>
          <div>
            <p className="font-semibold text-white">How does voting work?</p>
            <p>
              Voting lasts 48 hours. Community members lock SYS to mint voting tokens, which are released after voting ends.
              Results are determined automatically by smart contract. If there's no consensus, a new 48h round begins.
            </p>
          </div>
          <div>
            <p className="font-semibold text-white">What do winners get?</p>
            <p>
              Winners receive funding split into 30% at award ceremony and 70% upon completing deliverables (within 3 weeks).
              They also get technical support, mentorship, and visibility from Syscoin and its community.
            </p>
          </div>
          <div>
            <p className="font-semibold text-white">Can I change my vote?</p>
            <p>
              No, votes are final once submitted. Double-check your selection before confirming the transaction.
            </p>
          </div>
          <div>
            <p className="font-semibold text-white">Who can I contact for help?</p>
            <p>
              Reach out through official Syscoin channels (Telegram, Discord, X). For disputes, Syscoin Foundation
              has final authority to resolve them.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default FaqPage;
