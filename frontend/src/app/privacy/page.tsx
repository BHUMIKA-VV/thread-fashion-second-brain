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
          pieces each account holds, to deal with abuse. No advertising, no tracking of you across
          pages or sites, and no analytics cookies; the only cookie is the one that keeps you signed in.
        </p>
      </section>
      <section>
        <h2>If you try a photo</h2>
        <p>
          The playground at /try sends the photo you choose to Thread&apos;s server once, to measure
          its colours and compare it with the public demo. It is handled in memory and discarded
          when the answer is sent: it is not saved to storage or the database, not logged, not
          used to train anything and not shown to anyone. No account is needed. The swatch card
          you can download is drawn by your own browser. Your network address is held briefly in
          memory to limit how many photos can be sent, and is not stored.
        </p>
      </section>
      <section>
        <h2>Counting visits</h2>
        <p>
          A few public pages (the home page, the demo, the playground, how it works, the studio
          pilot and sign-up) add one to a daily total when they are opened, so the owner can see
          which pages people find and roughly where from. The playground also adds one when a
          visit analyses a photo; nothing about the photo is part of the count.
        </p>
        <ul>
          <li>What is kept is only the day, the page, and a broad source such as &ldquo;search&rdquo;, &ldquo;Instagram&rdquo; or a tag in the link you followed. Never your IP address, browser, device, the full page you came from, or anything that could tell one visitor from another. (Your IP address is held briefly in the server&apos;s memory to stop floods of counts, and is not stored.)</li>
          <li>No cookie or browser storage is used for it, and it is not shared with anyone or any analytics service.</li>
          <li>If your browser sends Global Privacy Control or Do Not Track, nothing is counted.</li>
        </ul>
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
