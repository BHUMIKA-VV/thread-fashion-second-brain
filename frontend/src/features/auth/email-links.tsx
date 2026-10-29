"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { forgotPassword, PASSWORD_MAX, PASSWORD_MIN, resetPassword, verifyEmail } from "@/services/auth";

import { Field, FormError, Notice } from "./form-parts";
import { SESSION_KEY } from "./use-session";

/** Opened from the verification email: confirms the address once, automatically. */
export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: () => verifyEmail(token),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  });
  const started = useRef(false);

  useEffect(() => {
    // Exactly one attempt per visit: the link works once.
    if (token && !started.current) {
      started.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  if (!token) {
    return (
      <Notice title="This link is incomplete">
        <p>Open the link from your email again, or copy all of it into the address bar.</p>
      </Notice>
    );
  }
  if (verify.isError) {
    return (
      <Notice title="This link can't be used">
        <p>{verify.error instanceof ApiError ? verify.error.message : "Your email could not be confirmed."}</p>
        <p>Signed in already? Ask for a new link from your account page.</p>
        <ButtonLink href="/account" variant="secondary">
          Your account
        </ButtonLink>
      </Notice>
    );
  }
  if (verify.isSuccess) {
    return (
      <Notice title="Your email is confirmed">
        <p>You can add pieces to your archive now.</p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/upload">Add a piece</ButtonLink>
          <ButtonLink href="/login" variant="secondary">
            Sign in
          </ButtonLink>
        </div>
      </Notice>
    );
  }
  return <div role="status" aria-label="Confirming your email" className="h-40 animate-pulse bg-ink/[0.05]" />;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const ask = useMutation({ mutationFn: () => forgotPassword(email) });

  if (ask.isSuccess) {
    return (
      <Notice title="Check your email">
        <p>
          If <strong className="font-medium text-ink">{email}</strong> has a Thread account, a link to
          choose a new password is on its way. It works for one hour.
        </p>
      </Notice>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask.mutate();
  };
  return (
    <form onSubmit={submit} aria-label="Reset your password" className="space-y-5 border-t border-ink pt-6">
      <Field
        id="forgot-email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <FormError>
        {ask.isError && (ask.error instanceof ApiError ? ask.error.message : "The email could not be sent.")}
      </FormError>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button type="submit" disabled={ask.isPending}>
          {ask.isPending ? "Sending…" : "Email me a link"}
        </Button>
        <Link href="/login" className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}

export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const reset = useMutation({ mutationFn: () => resetPassword(token, password) });
  const mismatch = again.length > 0 && again !== password;

  if (reset.isSuccess) {
    return (
      <Notice title="Your password is changed">
        <p>You have been signed out everywhere. Sign in with the new password.</p>
        <ButtonLink href="/login">Sign in</ButtonLink>
      </Notice>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mismatch && password.length >= PASSWORD_MIN) reset.mutate();
  };
  return (
    <form onSubmit={submit} aria-label="Choose a new password" className="space-y-5 border-t border-ink pt-6">
      <Field
        id="reset-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={`At least ${PASSWORD_MIN} characters.`}
      />
      <Field
        id="reset-again"
        label="New password, again"
        type="password"
        autoComplete="new-password"
        required
        value={again}
        onChange={(e) => setAgain(e.target.value)}
        hint={mismatch ? "The two passwords differ." : undefined}
      />
      <FormError>
        {!token && "This link is incomplete. Open it from your email again."}
        {reset.isError && (reset.error instanceof ApiError ? reset.error.message : "The password could not be changed.")}
      </FormError>
      <Button type="submit" disabled={!token || reset.isPending || mismatch || password.length < PASSWORD_MIN}>
        {reset.isPending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
