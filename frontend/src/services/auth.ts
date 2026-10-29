import { apiFetch } from "@/lib/api-client";
import type { AccountRead, Me } from "@/types/api";

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** The signed-in account, or null. Never throws for "signed out". */
export const getSession = () => apiFetch<Me | null>("/auth/session", { cache: "no-store" });

export const signUp = (body: { email: string; password: string; display_name: string }) =>
  apiFetch<{ status: string }>("/auth/signup", json("POST", body));

export const signIn = (body: { email: string; password: string }) =>
  apiFetch<Me>("/auth/login", json("POST", body));

export const signOut = () => apiFetch<void>("/auth/logout", json("POST"));

export const signOutEverywhere = () => apiFetch<void>("/auth/logout-everywhere", json("POST"));

export const verifyEmail = (token: string) => apiFetch<void>("/auth/verify-email", json("POST", { token }));

export const resendVerification = () =>
  apiFetch<{ status: string }>("/auth/resend-verification", json("POST"));

export const forgotPassword = (email: string) =>
  apiFetch<{ status: string }>("/auth/forgot-password", json("POST", { email }));

export const resetPassword = (token: string, password: string) =>
  apiFetch<void>("/auth/reset-password", json("POST", { token, password }));

export const changePassword = (current_password: string, new_password: string) =>
  apiFetch<void>("/auth/change-password", json("POST", { current_password, new_password }));

export const deleteAccount = (password: string) =>
  apiFetch<void>("/auth/delete-account", json("POST", { password }));

export const listAccounts = () => apiFetch<AccountRead[]>("/admin/accounts", { cache: "no-store" });

export const setAccountDisabled = (id: string, disabled: boolean) =>
  apiFetch<AccountRead>(`/admin/accounts/${id}/${disabled ? "disable" : "enable"}`, json("POST"));

/** Password rules, mirrored from the API so forms can explain them before submitting. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Only same-site paths are followed after sign-in (no "//evil.example" or "https://…"). */
export function safeNext(next: string | null | undefined, fallback = "/gallery"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
