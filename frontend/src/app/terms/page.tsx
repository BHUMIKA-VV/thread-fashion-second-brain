import type { Metadata } from "next";
import Link from "next/link";

import { Contact, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms" };

const LINK = "text-ink underline underline-offset-4";

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="16 November 2026">
      <section>
        <h2>What Thread is</h2>
        <p>
          Thread is a personal fashion archive, run by one person as a portfolio project. It is
          offered as it is, with no guarantee that it stays available or that nothing is ever
          lost. Keep your own copies of photographs that matter to you.
        </p>
      </section>
      <section>
        <h2>Plans</h2>
        <p>
          The Free plan costs nothing. The Studio and Studio Pro plans give a larger archive; each
          plan&apos;s price and limits are on the{" "}
          <Link href="/pricing" className={LINK}>
            pricing page
          </Link>
          . Every plan includes the same features: plans differ only in how much your archive can
          hold.
        </p>
        <p>
          When a paid period ends, your account goes back to Free. Nothing you have added is
          deleted or hidden: if your archive holds more than Free allows, you can still view, edit,
          present and delete your pieces, and you can add more once there is room again.
        </p>
      </section>
      <section>
        <h2>Payments and refunds</h2>
        <p>
          Each payment buys one 30-day period, paid once. Nothing renews or charges you again
          unless you buy another period. A period that hasn&apos;t started yet can be cancelled
          from your billing page, and its payment is refunded in full. A period that has started
          isn&apos;t refunded through the site; if something went wrong with a payment, write to{" "}
          <Contact />. Razorpay processes refunds, and banks usually take a few working days.
        </p>
        <p>
          Payments are handled by Razorpay. While Thread is in its pilot, payments run in
          Razorpay&apos;s test mode and no real money is taken.
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
          Accounts that break these terms may be disabled, and their content removed, without
          notice.
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
          To report content or ask about your account or a payment, write to <Contact />.
        </p>
      </section>
    </LegalPage>
  );
}
