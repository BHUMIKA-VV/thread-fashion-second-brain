import type { Metadata } from "next";

import { Contact, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="29 October 2026">
      <section>
        <h2>What Thread is</h2>
        <p>
          Thread is a personal fashion archive, run by one person as a portfolio project. It is
          offered as it is, free, with no guarantee that it stays available or that nothing is
          ever lost. Keep your own copies of photographs that matter to you.
        </p>
      </section>
      <section>
        <h2>What you may upload</h2>
        <ul>
          <li>Photographs you took or have the right to use.</li>
          <li>Nothing illegal, nothing sexual, nothing hateful, and nothing showing other people without their consent.</li>
          <li>Nothing that harms the service, such as malware or automated bulk uploads.</li>
        </ul>
        <p>
          Each account can keep up to 200 pieces and 1 GB. Accounts that break these terms may be
          disabled, and their content removed, without notice.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          You keep the rights to what you upload. You let Thread store it and analyse it (colours,
          tags and visual similarity) only to run your archive. You can delete any piece, or your
          whole account, at any time.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          To report content or ask about your account, write to <Contact />.
        </p>
      </section>
    </LegalPage>
  );
}
