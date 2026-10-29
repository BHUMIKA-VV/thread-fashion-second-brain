import type { Metadata } from "next";

import { Contact, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="29 October 2026">
      <section>
        <h2>What is stored</h2>
        <ul>
          <li>Your name, email address and a one-way hash of your password (never the password itself).</li>
          <li>The images you upload, and what Thread measures from them: palettes, tags and a numeric fingerprint used for visual similarity.</li>
          <li>Your notes, collections, and a record of your signed-in sessions (device type and when it was last used).</li>
        </ul>
      </section>
      <section>
        <h2>Who can see it</h2>
        <p>
          Your archive is private to your account. Other accounts can&apos;t see, search or find
          your pieces. The owner of this Thread can see account names, email addresses and how many
          pieces each account holds, to deal with abuse. No advertising, no tracking, and no
          analytics cookies; the only cookie is the one that keeps you signed in.
        </p>
      </section>
      <section>
        <h2>Who else handles it</h2>
        <p>
          Images are analysed on Thread&apos;s own server. Account emails are delivered by an email
          provider. Only the owner of this Thread can send a piece to Anthropic&apos;s Claude for
          deep analysis; your pieces are never sent.
        </p>
      </section>
      <section>
        <h2>Deleting your data</h2>
        <p>
          Deleting your account from your account page removes your account, every piece,
          collection and image file at once. For any other request, write to <Contact />.
        </p>
      </section>
    </LegalPage>
  );
}
