"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  changePassword,
  deleteAccount,
  PASSWORD_MAX,
  PASSWORD_MIN,
  resendVerification,
  signOut,
  signOutEverywhere,
} from "@/services/auth";
import type { Me } from "@/types/api";

import { Field, FormError } from "./form-parts";
import { useResetForAccount, useSession } from "./use-session";

const message = (error: Error, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/** Shown inside an AuthGate, so the session is known. */
export function AccountSettings() {
  const me = useSession().data;
  if (!me) return null;
  return (
    <div className="space-y-14">
      <Section title="You">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-ink-muted">Name</dt>
          <dd>{me.display_name}</dd>
          <dt className="text-ink-muted">Email</dt>
          <dd className="break-all">{me.email ?? "Local development account"}</dd>
          <dt className="text-ink-muted">Status</dt>
          <dd>{me.is_owner ? "Owner of this Thread" : me.email_verified ? "Confirmed" : "Email not confirmed yet"}</dd>
        </dl>
        {!me.email_verified && <ResendVerification />}
        {me.is_owner && (
          <ButtonLink href="/accounts" variant="secondary" className="mt-6">
            Manage accounts
          </ButtonLink>
        )}
      </Section>
      {me.has_password && <ChangePassword />}
      <Sessions />
      {me.has_password && !me.is_owner && <DeleteAccount me={me} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${title}-title`} className="border-t border-ink pt-5">
      <h2 id={`${title}-title`} className="font-display text-2xl">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function ResendVerification() {
  const resend = useMutation({ mutationFn: resendVerification });
  return (
    <div className="mt-5 border-l-2 border-warning pl-4 text-sm">
      <p className="text-ink">Confirm your email address to start adding pieces.</p>
      {resend.isSuccess ? (
        <p role="status" className="mt-2 text-ink-muted">
          A new link is on its way. It works for 24 hours.
        </p>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => resend.mutate()} disabled={resend.isPending}>
          {resend.isPending ? "Sending…" : "Send the link again"}
        </Button>
      )}
      <FormError>{resend.isError && message(resend.error, "The email could not be sent.")}</FormError>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (next.length >= PASSWORD_MIN) change.mutate();
  };
  return (
    <Section title="Password">
      <form onSubmit={submit} aria-label="Change password" className="max-w-md space-y-5">
        <Field
          id="current-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          id="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint={`At least ${PASSWORD_MIN} characters. Other devices will be signed out.`}
        />
        <FormError>{change.isError && message(change.error, "The password could not be changed.")}</FormError>
        {change.isSuccess && (
          <p role="status" className="text-sm text-success">
            Password changed. Other devices have been signed out.
          </p>
        )}
        <Button type="submit" disabled={change.isPending || next.length < PASSWORD_MIN || !current}>
          {change.isPending ? "Saving…" : "Change password"}
        </Button>
      </form>
    </Section>
  );
}

function Sessions() {
  const router = useRouter();
  const resetForAccount = useResetForAccount();
  const done = () => {
    resetForAccount(null);
    router.push("/");
  };
  const out = useMutation({ mutationFn: signOut, onSuccess: done });
  const everywhere = useMutation({ mutationFn: signOutEverywhere, onSuccess: done });
  const error = out.error ?? everywhere.error;
  return (
    <Section title="Signing out">
      <p className="max-w-md text-sm text-ink-muted">
        Signed in on a shared or lost device? Signing out everywhere ends every session, including
        this one.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => out.mutate()} disabled={out.isPending}>
          Sign out
        </Button>
        <Button variant="secondary" onClick={() => everywhere.mutate()} disabled={everywhere.isPending}>
          Sign out everywhere
        </Button>
      </div>
      <FormError>{error && message(error, "You could not be signed out.")}</FormError>
    </Section>
  );
}

function DeleteAccount({ me }: { me: Me }) {
  const router = useRouter();
  const resetForAccount = useResetForAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const remove = useMutation({
    mutationFn: () => deleteAccount(password),
    onSuccess: () => {
      resetForAccount(null);
      router.push("/?deleted=1");
    },
  });
  const ready = confirmText.trim().toLowerCase() === "delete" && password.length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) remove.mutate();
  };
  return (
    <Section title="Delete account">
      <p className="max-w-md text-sm text-ink-muted">
        Deletes {me.email ? <strong className="font-medium text-ink">{me.email}</strong> : "this account"},
        every piece, collection and image in it, at once and for good. This can&apos;t be undone.
      </p>
      {!open ? (
        <Button variant="secondary" className="mt-5 text-danger" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      ) : (
        <form onSubmit={submit} aria-label="Delete account" className="mt-5 max-w-md space-y-5">
          <Field
            id="delete-password"
            label="Your password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            id="delete-confirm"
            label='Type "delete" to confirm'
            required
            autoComplete="off"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <FormError>{remove.isError && message(remove.error, "The account could not be deleted.")}</FormError>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" className="bg-danger hover:bg-danger/90" disabled={!ready || remove.isPending}>
              {remove.isPending ? "Deleting…" : "Delete everything"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
