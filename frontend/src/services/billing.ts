import { apiFetch } from "@/lib/api-client";
import type { PlanCatalogue } from "@/types/api";

/** The plans, with prices defined by the server. Public; nothing here can be bought yet. */
export const getPlans = () => apiFetch<PlanCatalogue>("/billing/plans");
