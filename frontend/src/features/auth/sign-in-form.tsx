"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { safeNext, signIn } from "@/services/auth";

import { Field, FormError } from "./form-parts";
import { useResetForAccount } from "./use-session";

export function SignInForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const resetForAccount = useResetForAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => signIn({ email, password }),
    onSuccess: (me) => {
      resetForAccount(me);
      router.push(next);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <form onSubmit={submit} aria-label="Sign in" className="space-y-5 border-t border-ink pt-6">
      <Field
        id="login-email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        id="login-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <FormError>{login.isError && errorText(login.error)}</FormError>
      <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
        <Link href="/forgot-password" className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          Forgot your password?
        </Link>
      </div>
      <p className="border-t border-line pt-5 text-sm text-ink-muted">
        New to Thread?{" "}
        <Link href="/signup" className="text-ink underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </form>
  );
}

function errorText(error: Error): string {
  if (error instanceof ApiError && error.code === "rate_limited") {
    return "Too many attempts. Wait a few minutes, then try again.";
  }
  return error instanceof ApiError ? error.message : "You could not be signed in.";
}
