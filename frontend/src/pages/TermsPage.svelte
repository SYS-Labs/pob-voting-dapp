<script lang="ts">
  const LAST_UPDATED = 'April 7, 2026';
  const SITE_URL = 'https://pob.syscoin.org';
  const CONTACT_URL = 'https://syscoin.org/contact';
  const CONTACT_EMAIL = 'legal@syscoin.org';
</script>

<div class="pob-stack legal-page" id="terms-page">
  <section class="pob-pane pob-pane--subtle">
    <div class="space-y-4">
      <div>
        <h2 class="pob-pane__title text-3xl">Terms of Service</h2>
        <p class="mt-1 text-sm text-[var(--pob-text-muted)]">For the Official Web Deployment</p>
        <p class="text-sm text-[var(--pob-text-muted)]">Last updated: {LAST_UPDATED}</p>
      </div>

      <div class="space-y-4 text-sm text-[var(--pob-text-muted)]">
        <div class="pob-status-block">
          <p class="text-sm text-[var(--pob-text-muted)]">Website: <a class="underline" href={SITE_URL} target="_blank" rel="noreferrer">{SITE_URL}</a></p>
          <p class="text-sm text-[var(--pob-text-muted)]">
            Operator contact:
            <a class="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
            <a class="underline" href={CONTACT_URL} target="_blank" rel="noreferrer">{CONTACT_URL}</a>
          </p>
          <p class="text-sm text-[var(--pob-text-muted)]">Operator: Stichting Syscoin, Netherlands</p>
        </div>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">1. Acceptance of These Terms</h3>
        <p>
          These Terms of Service (the "Terms") govern your access to and use of the official web deployment of the
          Proof-of-Builders portal at
          <a class="underline" href={SITE_URL} target="_blank" rel="noreferrer">{SITE_URL}</a>
          and any Stichting Syscoin-operated ancillary services expressly linked to it (collectively, the "Site").
        </p>
        <p>By accessing or using the Site, you agree to these Terms. If you do not agree, do not use the Site.</p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">2. Limited Scope of the Foundation's Role</h3>
        <p>
          The Site is an interface. Stichting Syscoin (the "Foundation") is the intended operator only for the official web deployment and any ancillary services it expressly identifies as its own.
        </p>
        <p>The Foundation does not own or control:</p>
        <ul class="pob-markdown-list">
          <li>your wallet;</li>
          <li>your private keys;</li>
          <li>the public blockchain network you use;</li>
          <li>third-party RPC endpoints;</li>
          <li>explorers;</li>
          <li>third-party hosting environments; or</li>
          <li>third-party interfaces or deployments.</li>
        </ul>
        <p>
          The software stack, smart contracts, and network infrastructure used by the Site may include open-source or
          third-party components maintained by persons not affiliated with the Foundation.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">3. Non-Custodial Service</h3>
        <p>
          The Site is non-custodial. The Foundation does not take possession of your private keys, seed phrase, or
          digital assets through ordinary use of the Site.
        </p>
        <p>You are solely responsible for:</p>
        <ul class="pob-markdown-list">
          <li>your wallet security;</li>
          <li>your credentials and seed phrase;</li>
          <li>reviewing transaction details before signing; and</li>
          <li>all consequences of transactions you authorize.</li>
        </ul>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">4. Public Blockchain Notice</h3>
        <div class="pob-status-block">
          <p class="text-sm text-[var(--pob-text-muted)]">
            If you sign and broadcast a transaction through the Site, the contents of that transaction may become public
            and permanent. By choosing to broadcast a transaction, you decide to publish the included data to a public
            blockchain.
          </p>
        </div>
        <p>You understand and accept that:</p>
        <ul class="pob-markdown-list">
          <li>blockchain transactions may be irreversible;</li>
          <li>network fees may be lost even if a transaction fails;</li>
          <li>public blockchain activity may be visible to others; and</li>
          <li>personal data included in a transaction may become publicly accessible for an indefinite period.</li>
        </ul>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">5. No Advice</h3>
        <p>
          The Site and any information made available through it are provided for general informational and technical
          interface purposes only.
        </p>
        <p>Nothing on the Site constitutes:</p>
        <ul class="pob-markdown-list">
          <li>legal advice;</li>
          <li>tax advice;</li>
          <li>investment advice;</li>
          <li>accounting advice;</li>
          <li>fiduciary advice; or</li>
          <li>an offer, solicitation, endorsement, or recommendation.</li>
        </ul>
        <p>You should obtain your own professional advice where appropriate.</p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">6. Eligibility and Authority</h3>
        <p>You may use the Site only if:</p>
        <ul class="pob-markdown-list">
          <li>you have legal capacity to agree to these Terms;</li>
          <li>your use complies with applicable law; and</li>
          <li>if you act for an entity, you have authority to bind that entity.</li>
        </ul>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">7. User Responsibilities</h3>
        <p>
          You are solely responsible for your use of the Site and for any content, message, metadata, or transaction you
          submit or cause to be submitted.
        </p>
        <p>You agree that you will not:</p>
        <ul class="pob-markdown-list">
          <li>submit unlawful, defamatory, infringing, fraudulent, or misleading content;</li>
          <li>submit special-category or highly sensitive personal data;</li>
          <li>submit another person's personal data without an appropriate lawful basis and any required permission;</li>
          <li>attempt to interfere with, disrupt, overload, scrape, probe, or attack the Site or its infrastructure;</li>
          <li>use the Site to violate applicable sanctions, anti-money-laundering laws, or other laws; or</li>
          <li>misrepresent your identity, affiliation, or authority.</li>
        </ul>
        <p>
          If the Site includes optional text fields, you should use pseudonymous or other non-personal identifiers unless
          personal data is strictly necessary and you have the right to publish it.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">8. Third-Party Services</h3>
        <p>
          Your use of the Site may depend on third-party services, including wallet software, public blockchains,
          validators, RPC providers, explorers, internet service providers, and hosting providers.
        </p>
        <p>
          Those services are outside the Foundation's control. The Foundation is not responsible for their acts,
          omissions, availability, security, fees, or terms.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">9. Open-Source and Experimental Technology</h3>
        <p>
          The Site may interact with open-source software, smart contracts, and public blockchain infrastructure that may
          contain bugs, vulnerabilities, delays, forks, or other unforeseen issues.
        </p>
        <p>
          You understand that blockchain-based systems are inherently experimental and may involve technical, legal, and
          economic risks.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">10. Availability, Suspension, and Changes to the Site</h3>
        <p>
          The Foundation may modify, suspend, restrict, or discontinue all or part of the Site at any time, including
          for maintenance, upgrades, security reasons, legal risk, or abuse prevention.
        </p>
        <p>
          The Foundation may also block, rate-limit, or restrict access where reasonably necessary to protect the Site,
          comply with law, or respond to misuse.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">11. No Warranty</h3>
        <p>To the maximum extent permitted by law, the Site is provided "as is" and "as available."</p>
        <p>
          The Foundation disclaims all warranties, whether express, implied, statutory, or otherwise, including implied
          warranties of merchantability, fitness for a particular purpose, title, non-infringement, availability,
          security, accuracy, and uninterrupted operation.
        </p>
        <p>The Foundation does not warrant that:</p>
        <ul class="pob-markdown-list">
          <li>the Site will always be available, secure, or error-free;</li>
          <li>any transaction will succeed, settle, or execute as expected;</li>
          <li>any content or blockchain data will be complete or accurate at all times; or</li>
          <li>the Site is suitable for your particular use case or legal position.</li>
        </ul>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">12. Limitation of Liability</h3>
        <p>
          Nothing in these Terms excludes or limits liability to the extent such exclusion or limitation is prohibited by
          applicable law.
        </p>
        <p>
          Subject to the sentence above, to the maximum extent permitted by law, the Foundation and its directors,
          officers, employees, volunteers, contractors, and contributors are not liable for any:
        </p>
        <ul class="pob-markdown-list">
          <li>indirect, incidental, consequential, special, exemplary, or punitive damages;</li>
          <li>loss of profits, revenue, business, opportunity, goodwill, or reputation;</li>
          <li>loss, corruption, or inaccessibility of data; or</li>
          <li>
            losses arising from third-party services, blockchain failures, forks, exploits, congestion, validator
            actions, wallet errors, user error, or unauthorized access to your wallet.
          </li>
        </ul>
        <p>
          Subject to mandatory law, the aggregate liability of the Foundation for all claims arising out of or relating
          to the Site does not exceed the greater of:
        </p>
        <ul class="pob-markdown-list">
          <li>EUR 100; or</li>
          <li>the total amount of fees, if any, paid by you directly to the Foundation for use of the Site during the 12 months preceding the event giving rise to the claim.</li>
        </ul>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">13. Indemnity</h3>
        <p>
          If you use the Site on behalf of a business, organization, or in a commercial capacity, you agree, to the
          maximum extent permitted by law, to defend, indemnify, and hold harmless the Foundation and its directors,
          officers, employees, volunteers, contractors, and contributors against claims, losses, liabilities, damages,
          and reasonable external legal costs arising out of:
        </p>
        <ul class="pob-markdown-list">
          <li>your unlawful use of the Site;</li>
          <li>your breach of these Terms; or</li>
          <li>your submission or publication of content or personal data in violation of applicable law or third-party rights.</li>
        </ul>
        <p>This clause does not apply to consumers to the extent prohibited by applicable law.</p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">14. Intellectual Property</h3>
        <p>
          The Foundation or its licensors retain all rights in the Site and its original content, branding, and
          materials, except for:
        </p>
        <ul class="pob-markdown-list">
          <li>open-source components made available under their applicable licenses; and</li>
          <li>third-party content or public blockchain data.</li>
        </ul>
        <p>No rights are granted except as strictly necessary to use the Site in accordance with these Terms.</p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">15. Privacy</h3>
        <p>
          Use of the Site is also subject to the <a class="underline" href="/privacy">Proof-of-Builders Privacy Notice</a>.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">16. Governing Law and Forum</h3>
        <p>These Terms are governed by the laws of the Netherlands.</p>
        <p>
          To the maximum extent permitted by law, the competent courts of the Netherlands have exclusive jurisdiction
          over disputes arising out of or relating to these Terms or the Site.
        </p>
        <p>
          If you are a consumer and mandatory law gives you the right to bring a claim in another competent forum or
          under other mandatory protections, nothing in this section limits those rights.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">17. Changes to These Terms</h3>
        <p>
          The Foundation may update these Terms from time to time. The updated version will be posted on the Site with a
          revised "Last updated" date. Continued use of the Site after the effective date of the updated Terms
          constitutes acceptance of the revised Terms, to the extent permitted by law.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">18. Contact</h3>
        <address class="not-italic text-sm text-[var(--pob-text-muted)]">
          Stichting Syscoin<br />
          <a class="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a><br />
          <a class="underline" href={CONTACT_URL} target="_blank" rel="noreferrer">{CONTACT_URL}</a>
        </address>
      </div>
    </div>
  </section>
</div>
