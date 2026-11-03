"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormError, Notice } from "@/features/auth/form-parts";
import { ApiError } from "@/lib/api-client";
import { MESSAGE_MAX, registerInterest, ROLE_LABELS } from "@/services/interest";
import type { InterestKind, InterestRole } from "@/types/api";

const CONTROL = "mt-1.5 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2.5 text-base text-ink sm:text-sm";

const KINDS: { kind: InterestKind; label: string; hint: string }[] = [
  { kind: "studio", label: "My studio, label or boutique", hint: "A demo call, then the studio pilot" },
  { kind: "wardrobe", label: "My own wardrobe", hint: "Hear when sign-up opens" },
];

/**
 * Early access and the studio pilot, one form. ?for=wardrobe starts on the wardrobe choice
 * (the link from a closed sign-up). Nothing is sent without the consent box; the hidden
 * "website" field is for bots only.
 */
export function InterestForm() {
  const params = useSearchParams();
  const [kind, setKind] = useState<InterestKind>(params.get("for") === "wardrobe" ? "wardrobe" : "studio");
  const [role, setRole] = useState<InterestRole | "">("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");

  const studio = kind === "studio";
  const send = useMutation({
    mutationFn: () =>
      registerInterest({ kind, role: studio && role ? role : null, name, email, message, consent: true, website }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (consent && (!studio || role)) send.mutate();
  };

  if (send.isSuccess) {
    return (
      <Notice title="Thank you">
        <p>
          {studio
            ? "We'll write to you, usually within a few days, to find a time for a 20-minute demo call."
            : "We'll write to you once when sign-up opens, and not otherwise."}{" "}
          It goes to <strong className="font-medium text-ink">{email}</strong>.
        </p>
        <p>
          Your details are kept only for this and never shared. Ask to have them deleted at any time; see the{" "}
          <Link href="/privacy" className="text-ink underline underline-offset-4">
            privacy notice
          </Link>
          .
        </p>
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Register interest" className="space-y-5 border-t border-ink pt-6">
      <fieldset>
        <legend className="text-xs tracking-[0.04em] text-ink-muted">I&apos;m interested for</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {KINDS.map((option) => (
            <label
              key={option.kind}
              className="flex cursor-pointer items-start gap-3 rounded-[2px] border border-line bg-paper-raised p-3 text-sm has-[:checked]:border-ink"
            >
              <input
                type="radio"
                name="interest-kind"
                value={option.kind}
                checked={kind === option.kind}
                onChange={() => setKind(option.kind)}
                className="mt-0.5 size-4 accent-ink"
              />
              <span>
                <span className="block text-ink">{option.label}</span>
                <span className="block text-xs text-ink-muted">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {studio && (
        <label className="block text-xs tracking-[0.04em] text-ink-muted">
          What you do
          <select required value={role} onChange={(e) => setRole(e.target.value as InterestRole)} className={CONTROL}>
            <option value="" disabled>
              Choose one
            </option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}

      <Field id="interest-name" label="Your name (optional)" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <Field
        id="interest-email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <div>
        <label className="block text-xs tracking-[0.04em] text-ink-muted">
          {studio ? "How do you keep track of fabrics and pieces today? (optional)" : "Anything you'd like us to know (optional)"}
          <textarea
            rows={4}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-describedby="interest-message-count"
            className={CONTROL}
          />
        </label>
        <p id="interest-message-count" className="mt-1.5 text-xs text-ink-muted">
          {message.length} of {MESSAGE_MAX} characters. Please don&apos;t include anyone else&apos;s details.
        </p>
      </div>

      {/* For bots only: people never see or reach this field. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      <label className="flex items-start gap-3 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 size-4 accent-ink"
          required
        />
        <span>
          You may email me about {studio ? "a demo call and the studio pilot" : "early access"}. I have read the{" "}
          <Link href="/privacy" className="text-ink underline underline-offset-4">
            privacy notice
          </Link>
          .
        </span>
      </label>
      <FormError>{send.isError && errorText(send.error)}</FormError>
      <Button type="submit" disabled={send.isPending || !consent || (studio && !role)}>
        {send.isPending ? "Sending…" : studio ? "Request a demo call" : "Tell me when sign-up opens"}
      </Button>
    </form>
  );
}

function errorText(error: Error): string {
  if (error instanceof ApiError && error.code === "rate_limited") {
    return "Too many attempts from this network. Try again in an hour.";
  }
  if (error instanceof ApiError && error.code === "validation_error") {
    return "Check the email address, and keep the message under 1,000 characters.";
  }
  return error instanceof ApiError ? error.message : "That didn't go through. Please try again.";
}
