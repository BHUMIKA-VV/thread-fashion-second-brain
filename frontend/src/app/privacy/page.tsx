import type { Metadata } from "next";

import { Contact, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="3 November 2026">
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
        <h2>If you register interest</h2>
        <p>
          The early access and studio pilot form keeps what you type: whether it is for your own
          wardrobe or your studio, what you do, your name if you give it, your email address, your
          message, and when you agreed to be contacted. Nothing is kept unless you tick that box.
        </p>
        <ul>
          <li>It is used only to write to you about what you asked for: once when sign-up opens, or about the studio pilot.</li>
          <li>Only the owner of this Thread can see it. It is never shared, sold or added to a mailing list.</li>
          <li>It is deleted when you ask, and automatically a year after you last sent the form.</li>
          <li>It is not an account, and registering again updates what you sent instead of adding a copy.</li>
        </ul>
      </section>
      <section>
        <h2>Deleting your data</h2>
        <p>
          Deleting your account from your account page removes your account, every piece,
          collection and image file at once. To have an interest registration deleted, or for any
          other request, write to <Contact />.
        </p>
      </section>
    </LegalPage>
  );
}
