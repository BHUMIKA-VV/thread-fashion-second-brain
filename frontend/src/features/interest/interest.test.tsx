import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignUpForm } from "@/features/auth/sign-up-form";
import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { setUrl } from "@/test/navigation-mock";
import { renderWithQuery } from "@/test/render";
import type { InterestSummary, Me } from "@/types/api";
import { InterestAdmin } from "./interest-admin";
import { InterestForm } from "./interest-form";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);

beforeEach(() => setUrl("/pilot"));

const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("InterestForm", () => {
  it("sends a studio registration with its role, and only after consent", async () => {
    const fetch = routeFetch({ "POST /api/interest": () => Response.json({ status: "received" }, { status: 202 }) });
    renderWithQuery(<InterestForm />);

    expect(screen.getByRole("radio", { name: /My studio, label or boutique/ })).toBeChecked();
    fill(/What you do/, "boutique");
    fill("Email", "asha@example.com");
    fill(/How do you keep track/, "Saree boutique");
    const submit = screen.getByRole("button", { name: "Request a demo call" });
    expect(submit).toBeDisabled(); // no consent yet
    fireEvent.click(screen.getByRole("checkbox", { name: /You may email me about a demo call and the studio pilot/ }));
    fireEvent.click(submit);

    expect(await screen.findByText("Thank you")).toBeInTheDocument();
    expect(screen.getByText(/to find a time for a 20-minute demo call/)).toBeInTheDocument();
    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({
      kind: "studio",
      role: "boutique",
      name: "",
      email: "asha@example.com",
      message: "Saree boutique",
      consent: true,
      website: "",
    });
  });

  it("starts on the wardrobe choice from a closed sign-up, and asks no role", async () => {
    setUrl("/pilot?for=wardrobe");
    const fetch = routeFetch({ "POST /api/interest": () => Response.json({ status: "received" }, { status: 202 }) });
    renderWithQuery(<InterestForm />);

    expect(screen.getByRole("radio", { name: /My own wardrobe/ })).toBeChecked();
    expect(screen.queryByLabelText(/What you do/)).not.toBeInTheDocument();
    fill("Email", "ravi@example.com");
    fireEvent.click(screen.getByRole("checkbox", { name: /early access/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tell me when sign-up opens" }));

    expect(await screen.findByText(/once when sign-up opens/)).toBeInTheDocument();
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({ kind: "wardrobe", role: null });
  });

  it("keeps the hidden bot field out of reach and explains a rate limit", async () => {
    routeFetch({ "POST /api/interest": () => apiErrorResponse(429, "rate_limited", "Too many attempts.") });
    const { container } = renderWithQuery(<InterestForm />);

    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest("[aria-hidden]")).not.toBeNull();

    fill(/What you do/, "stylist");
    fill("Email", "a@example.com");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Request a demo call" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts from this network");
  });
});

describe("SignUpForm when sign-up is closed", () => {
  it("offers early access instead of a dead end", async () => {
    setUrl("/signup");
    routeFetch({ "POST /api/auth/signup": () => apiErrorResponse(403, "signup_closed", "Sign-up is closed for now.") });
    renderWithQuery(<SignUpForm />);
    fill("Your name", "Ravi");
    fill("Email", "ravi@example.com");
    fill("Password", "a long enough password");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Leave your email" })).toHaveAttribute("href", "/pilot?for=wardrobe");
  });
});

const owner: Me = {
  id: "o",
  display_name: "Owner",
  email: "owner@example.com",
  email_verified: true,
  is_owner: true,
  has_password: true,
};

const summary: InterestSummary = {
  interest: [
    {
      id: "i1",
      kind: "studio",
      role: "boutique",
      name: "Asha",
      email: "asha@example.com",
      message: "Saree boutique",
      created_at: "2026-11-03T10:00:00Z",
      updated_at: "2026-11-03T10:00:00Z",
      contacted_at: null,
    },
    {
      id: "i2",
      kind: "wardrobe",
      role: null,
      name: null,
      email: "ravi@example.com",
      message: null,
      created_at: "2026-11-02T10:00:00Z",
      updated_at: "2026-11-02T10:00:00Z",
      contacted_at: null,
    },
  ],
  wardrobe: 1,
  studio: 1,
  studio_by_role: { boutique: 1 },
  accounts: 4,
  verified_accounts: 3,
};

describe("InterestAdmin", () => {
  it("shows nothing to an account that isn't the owner", async () => {
    routeFetch({ "GET /api/auth/session": () => Response.json({ ...owner, is_owner: false }) });
    const { container } = renderWithQuery(<InterestAdmin />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("counts wardrobe and studio interest apart, and deletes only after confirming", async () => {
    const fetch = routeFetch({
      "GET /api/auth/session": () => Response.json(owner),
      "GET /api/admin/interest": () => Response.json(summary),
      "PATCH /api/admin/interest/i1": () => Response.json({ ...summary.interest[0], contacted_at: "2026-11-03T12:00:00Z" }),
      "DELETE /api/admin/interest/i2": () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<InterestAdmin />);

    expect(await screen.findByText("Wardrobe accounts")).toBeInTheDocument();
    expect(screen.getByText("3 confirmed")).toBeInTheDocument();
    expect(screen.getByText("1 boutique or shop")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "asha@example.com" })).toHaveAttribute("href", "mailto:asha@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Mark Asha (asha@example.com) as contacted" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete ravi@example.com" }));
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm deleting ravi@example.com" }));

    await vi.waitFor(() => {
      const methods = fetch.mock.calls.map(([, init]) => init?.method);
      expect(methods).toContain("PATCH");
      expect(methods).toContain("DELETE");
    });
  });
});
