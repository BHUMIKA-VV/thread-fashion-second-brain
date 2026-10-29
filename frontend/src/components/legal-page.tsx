import type { ReactNode } from "react";

import { PAGE, PageHeader } from "@/components/page-header";

/** Where people write about their account, abuse reports and data requests. */
export function contactEmail(): string | null {
  const value = process.env.THREAD_CONTACT_EMAIL?.trim();
  return value ? value : null;
}

export function Contact() {
  const email = contactEmail();
  return email ? (
    <a href={`mailto:${email}`} className="text-ink underline underline-offset-4">
      {email}
    </a>
  ) : (
    <span>the contact address the owner of this Thread publishes</span>
  );
}

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className={PAGE}>
      <PageHeader kicker={`Last updated ${updated}`} title={title} />
      <div className="mt-10 max-w-2xl space-y-8 leading-relaxed text-ink [&_h2]:font-display [&_h2]:text-2xl [&_p]:mt-3 [&_p]:text-ink-muted [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-ink-muted">
        {children}
      </div>
    </div>
  );
}
