"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { PASSWORD_MAX, PASSWORD_MIN, signUp } from "@/services/auth";

import { Field, FormError, Notice } from "./form-parts";

export function SignUpForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);

  const create = useMutation({ mutationFn: () => signUp({ email, password, display_name: name }) });
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password.length >= PASSWORD_MIN && agreed) create.mutate();
  };

  if (create.isSuccess) {
    return (
      <Notice title="Check your email">
        <p>
          We sent a link to <strong className="font-medium text-ink">{email}</strong>. Open it to confirm
          your address, then sign in. The link works for 24 hours.
        </p>
        <p>
          Nothing arrived? Check your spam folder. If the address already had an account, the email
          says so instead.
        </p>
        <p>
          <Link href="/login" className="text-ink underline underline-offset-4">
            Go to sign in
          </Link>
        </p>
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Create an account" className="space-y-5 border-t border-ink pt-6">
      <Field
        id="signup-name"
        label="Your name"
        autoComplete="name"
        required
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        id="signup-email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        id="signup-password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN}
        maxLength={PASSWORD_MAX}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={
          tooShort
            ? `${PASSWORD_MIN - password.length} more characters to go.`
            : `At least ${PASSWORD_MIN} characters. A few unrelated words make a strong one.`
        }
      />
      <label className="flex items-start gap-3 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-4 accent-ink"
          required
        />
        <span>
          I agree to the{" "}
          <Link href="/terms" className="text-ink underline underline-offset-4">
            terms
          </Link>{" "}
          and have read the{" "}
          <Link href="/privacy" className="text-ink underline underline-offset-4">
            privacy notice
          </Link>
          .
        </span>
      </label>
      <FormError>{create.isError && errorText(create.error)}</FormError>
      <Button type="submit" disabled={create.isPending || !agreed || password.length < PASSWORD_MIN}>
        {create.isPending ? "Creating…" : "Create account"}
      </Button>
      <p className="border-t border-line pt-5 text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}

function errorText(error: Error): string {
  if (error instanceof ApiError && error.code === "rate_limited") {
    return "Too many sign-ups from this network. Try again in an hour.";
  }
  if (error instanceof ApiError && error.code === "validation_error") {
    return "Check the email address and that the password has at least 12 characters.";
  }
  return error instanceof ApiError ? error.message : "The account could not be created.";
}
