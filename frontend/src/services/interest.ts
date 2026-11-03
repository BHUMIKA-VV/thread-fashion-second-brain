import { apiFetch } from "@/lib/api-client";
import type { InterestKind, InterestRead, InterestRole, InterestSummary } from "@/types/api";

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export type InterestForm = {
  kind: InterestKind;
  role: InterestRole | null;
  name: string;
  email: string;
  message: string;
  consent: true;
  /** The hidden field people never see; anything in it marks a bot. */
  website: string;
};

export const registerInterest = (body: InterestForm) =>
  apiFetch<{ status: "received" }>("/interest", json("POST", body));

export const listInterest = () => apiFetch<InterestSummary>("/admin/interest", { cache: "no-store" });

export const setInterestContacted = (id: string, contacted: boolean) =>
  apiFetch<InterestRead>(`/admin/interest/${id}`, json("PATCH", { contacted }));

export const deleteInterest = (id: string) => apiFetch<void>(`/admin/interest/${id}`, json("DELETE"));

/** How each professional role reads in the form and in the owner's list. */
export const ROLE_LABELS: Record<InterestRole, string> = {
  stylist: "Stylist",
  designer: "Designer or label",
  boutique: "Boutique or shop",
  textile_researcher: "Textile researcher",
  collector: "Collector or reseller",
  student: "Student",
  other: "Something else",
};

export const MESSAGE_MAX = 1000;
