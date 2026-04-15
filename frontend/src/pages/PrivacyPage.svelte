<script lang="ts">
  const LAST_UPDATED = 'April 8, 2026';
  const SITE_URL = 'https://pob.syscoin.org';
  const CONTACT_URL = 'https://syscoin.org/contact';
  const CONTACT_EMAIL = 'legal@syscoin.org';
</script>

<div class="pob-stack legal-page" id="privacy-page">
  <section class="pob-pane pob-pane--subtle">
    <div class="space-y-4">
      <div>
        <h2 class="pob-pane__title text-3xl">Privacy Notice</h2>
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
          <p class="text-sm text-[var(--pob-text-muted)]">Controller details: Stichting Syscoin, Netherlands</p>
        </div>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">1. Scope of This Privacy Notice</h3>
        <p>
          This Privacy Notice applies only to the official web deployment of the Proof-of-Builders portal available at
          <a class="underline" href={SITE_URL} target="_blank" rel="noreferrer">{SITE_URL}</a>
          (the "Site") and to any ancillary services expressly identified by Stichting Syscoin (the "Foundation"),
          such as the Site's web hosting, support channels, and any Foundation-operated API, indexing, or caching layer.
        </p>
        <p>This Privacy Notice does not apply to:</p>
        <ul class="pob-markdown-list">
          <li>public blockchain networks;</li>
          <li>third-party wallet providers;</li>
          <li>third-party RPC providers;</li>
          <li>blockchain explorers;</li>
          <li>third-party hosting environments not operated by the Foundation; or</li>
          <li>other websites, interfaces, or deployments operated by other persons.</li>
        </ul>
        <p>Those third parties operate under their own terms and privacy policies.</p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">2. Important Blockchain Notice</h3>
        <div class="pob-status-block">
          <p class="text-sm text-[var(--pob-text-muted)]">
            The Site is a non-custodial interface that may enable you to prepare, sign, and broadcast transactions to
            public blockchain networks.
          </p>
        </div>
        <p>
          Public blockchains are transparent by design. If you choose to include data in a blockchain transaction, that
          data may become publicly visible and may remain accessible indefinitely. The Foundation does not control the
          underlying blockchain and generally cannot modify, erase, or block data once it has been confirmed on-chain.
        </p>
        <p>
          The Foundation does not require you to use your real name. Where possible, you should use a pseudonym, wallet
          address, team name, or other non-personal identifier instead of personal data.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">3. Categories of Data We May Process</h3>

        <h4 class="text-base font-semibold text-[var(--pob-text)]">A. Data You Choose to Submit Through the Site</h4>
        <p>Depending on how you use the Site, this may include:</p>
        <ul class="pob-markdown-list">
          <li>wallet address;</li>
          <li>transaction details you choose to submit;</li>
          <li>optional text fields or metadata you choose to enter; and</li>
          <li>support messages you send to us.</li>
        </ul>
        <p>
          If the Site contains any optional free-text field, do not enter personal data unless you intentionally want it
          to become public and you have a lawful basis to publish it.
        </p>

        <h4 class="text-base font-semibold text-[var(--pob-text)]">B. Public Blockchain Data</h4>
        <p>The Site may display data that already exists on a public blockchain, such as:</p>
        <ul class="pob-markdown-list">
          <li>wallet addresses;</li>
          <li>transaction hashes;</li>
          <li>timestamps;</li>
          <li>contract interactions; and</li>
          <li>publicly visible program, certificate, or team-member fields.</li>
        </ul>

        <h4 class="text-base font-semibold text-[var(--pob-text)]">C. Technical and Service Data</h4>
        <p>
          When you access the Site or Foundation-operated ancillary services, the Foundation and its service providers may
          process technical data such as:
        </p>
        <ul class="pob-markdown-list">
          <li>IP address;</li>
          <li>date and time of requests;</li>
          <li>browser type and user-agent;</li>
          <li>device or network diagnostics;</li>
          <li>server logs; and</li>
          <li>basic request metadata needed for security, availability, and abuse prevention.</li>
        </ul>

        <h4 class="text-base font-semibold text-[var(--pob-text)]">D. API, Indexer, and Cache Data</h4>
        <p>
          If the Foundation operates an API, indexer, cache, or similar service for the Site, that service may process
          and temporarily store copies of public blockchain data to improve performance, searchability, and reliability.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">4. Purposes of Processing</h3>
        <p>We may process personal data only as needed to:</p>
        <ul class="pob-markdown-list">
          <li>provide and maintain the Site and any Foundation-operated ancillary services;</li>
          <li>display and retrieve public blockchain data through the Site;</li>
          <li>operate security, anti-abuse, monitoring, and troubleshooting functions;</li>
          <li>respond to support requests and service communications;</li>
          <li>comply with applicable law, lawful requests, or enforcement obligations; and</li>
          <li>protect the rights, security, and integrity of the Foundation, the Site, users, and the public.</li>
        </ul>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">5. Legal Bases</h3>
        <p>Where the GDPR applies, the Foundation may rely on one or more of the following legal bases:</p>
        <ul class="pob-markdown-list">
          <li>legitimate interests, such as operating, securing, maintaining, and defending the Site and related services;</li>
          <li>performance of a contract or taking steps at your request before entering into a contract, where applicable;</li>
          <li>compliance with legal obligations; and</li>
          <li>consent, where the Foundation specifically requests consent for an optional feature.</li>
        </ul>
        <p>
          Where you choose to place content into a blockchain transaction through the Site, you acknowledge that you are
          independently deciding to publish that data to a public network. If that content contains personal data, you
          are responsible for ensuring you have an appropriate legal basis to disclose it.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">6. Recipients and Categories of Recipients</h3>
        <p>The Foundation may share or make data available to:</p>
        <ul class="pob-markdown-list">
          <li>hosting providers;</li>
          <li>infrastructure and security providers;</li>
          <li>analytics, logging, and uptime providers, if used;</li>
          <li>professional advisers where necessary;</li>
          <li>competent authorities, where required by law; and</li>
          <li>the public, where data is published on a public blockchain or displayed from public blockchain sources.</li>
        </ul>
        <p>
          If public blockchain data is indexed or cached by the Foundation's services, that data may also be made
          available to users of the Site or API.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">7. International Transfers</h3>
        <p>
          Because public blockchain networks are global, data included in blockchain transactions may be replicated and
          accessed worldwide, including outside the European Economic Area.
        </p>
        <p>
          In addition, some service providers used for Site infrastructure may process data outside the EEA. Where
          required, the Foundation will use an appropriate transfer mechanism under applicable law.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">8. Retention</h3>
        <p>
          The Foundation retains off-chain data only for as long as reasonably necessary for the purposes described in
          this Notice, including security, reliability, support, and legal compliance.
        </p>
        <p>Indicative retention periods:</p>
        <ul class="pob-markdown-list">
          <li>server and security logs: for as long as reasonably necessary for security, abuse prevention, troubleshooting, and legal compliance;</li>
          <li>support communications: for as long as reasonably necessary to respond to and close the request, and afterward as needed for recordkeeping and legal compliance; and</li>
          <li>API, indexer, and cache records: for as long as reasonably necessary for performance, integrity, and service continuity.</li>
        </ul>
        <p>
          Data published on a public blockchain may remain publicly accessible indefinitely and generally cannot be
          deleted or altered by the Foundation.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">9. Your Rights</h3>
        <p>Subject to applicable law, you may have the right to request:</p>
        <ul class="pob-markdown-list">
          <li>access to personal data;</li>
          <li>rectification;</li>
          <li>erasure;</li>
          <li>restriction of processing;</li>
          <li>objection;</li>
          <li>data portability; and</li>
          <li>withdrawal of consent, where processing is based on consent.</li>
        </ul>
        <p>
          These rights may be limited in practice where the relevant data has been published to a public blockchain or
          where the Foundation is not the party controlling the relevant infrastructure.
        </p>
        <p>
          You also have the right to lodge a complaint with the Dutch Data Protection Authority (Autoriteit
          Persoonsgegevens).
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">10. On-Chain Data and Off-Chain Display</h3>
        <p>
          Where feasible and appropriate, the Foundation may remove or limit the off-chain display of certain data
          through the Site or Foundation-operated API, cache, or indexer. However, the Foundation cannot erase or alter
          records stored on a public blockchain.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">11. Security</h3>
        <p>
          The Foundation takes reasonable technical and organizational measures appropriate to the risks of the services
          it operates. However, no internet-based service can be guaranteed to be completely secure, and the Foundation
          does not guarantee uninterrupted or error-free operation of the Site or any public blockchain.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">12. Children</h3>
        <p>The Site is not intended for children under the age of 18. Do not submit personal data through the Site if you are under 18.</p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">13. Changes to This Privacy Notice</h3>
        <p>
          The Foundation may update this Privacy Notice from time to time. The updated version will be posted on the Site
          with a revised "Last updated" date.
        </p>

        <h3 class="text-lg font-semibold text-[var(--pob-text)]">14. Contact</h3>
        <address class="not-italic text-sm text-[var(--pob-text-muted)]">
          Stichting Syscoin<br />
          <a class="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a><br />
          <a class="underline" href={CONTACT_URL} target="_blank" rel="noreferrer">{CONTACT_URL}</a>
        </address>
      </div>
    </div>
  </section>
</div>
