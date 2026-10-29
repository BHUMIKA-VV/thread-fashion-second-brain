import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OwnerDeepAnalysis } from "@/features/deep-analysis/owner-deep-analysis";
import { safeNext } from "@/services/auth";
import { apiErrorResponse, routeFetch } from "@/test/fetch-router";
import { router, setUrl } from "@/test/navigation-mock";
import { renderWithQuery } from "@/test/render";
import type { Me } from "@/types/api";
import { AuthGate } from "./auth-gate";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";
import { VerifiedOnly } from "./verified-only";

vi.mock("next/navigation", async () => (await import("@/test/navigation-mock")).navigationMock);

const me = (overrides: Partial<Me> = {}): Me => ({
  id: "u1",
  display_name: "Ada Lovelace",
  email: "ada@example.com",
  email_verified: true,
  is_owner: false,
  has_password: true,
  ...overrides,
});

beforeEach(() => setUrl("/gallery"));

describe("safeNext", () => {
  it.each([
    ["/items/1", "/items/1"],
    [null, "/gallery"],
    ["https://evil.example", "/gallery"],
    ["//evil.example", "/gallery"],
    ["/\\evil.example", "/gallery"],
    ["javascript:alert(1)", "/gallery"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("AuthGate", () => {
  it("invites a signed-out visitor to sign in and come back", async () => {
    setUrl("/collections");
    routeFetch({ "GET /api/auth/session": () => Response.json(null) });
    renderWithQuery(
      <AuthGate what="your collections">
        <p>private</p>
      </AuthGate>,
    );

    expect(await screen.findByText("Sign in to see your collections")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fcollections");
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup");
    expect(screen.queryByText("private")).not.toBeInTheDocument();
  });

  it("shows the page to a signed-in visitor", async () => {
    routeFetch({ "GET /api/auth/session": () => Response.json(me()) });
    renderWithQuery(
      <AuthGate>
        <p>private</p>
      </AuthGate>,
    );
    expect(await screen.findByText("private")).toBeInTheDocument();
  });
});

describe("SignInForm", () => {
  it("signs in and goes to the page that asked for it", async () => {
    setUrl("/login?next=/items/42");
    const fetchMock = routeFetch({ "POST /api/auth/login": () => Response.json(me()) });
    renderWithQuery(<SignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/items/42"));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ email: "ada@example.com", password: "correct horse battery" });
  });

  it("never follows an off-site next", async () => {
    setUrl("/login?next=//evil.example");
    routeFetch({ "POST /api/auth/login": () => Response.json(me()) });
    renderWithQuery(<SignInForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith("/gallery"));
  });

  it("explains a wrong password and a rate limit", async () => {
    let calls = 0;
    routeFetch({
      "POST /api/auth/login": () =>
        calls++ === 0
          ? apiErrorResponse(401, "invalid_credentials", "Email or password is incorrect.")
          : apiErrorResponse(429, "rate_limited", "Too many attempts. Try again later."),
    });
    renderWithQuery(<SignInForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Wait a few minutes/)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("SignUpForm", () => {
  it("needs a 12-character password and the terms before it sends anything", () => {
    const fetchMock = routeFetch({});
    renderWithQuery(<SignUpForm />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });

    expect(screen.getByText("7 more characters to go.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long enough password" } });
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled(); // terms not ticked
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the visitor to check their email", async () => {
    const fetchMock = routeFetch({ "POST /api/auth/signup": () => Response.json({ status: "check_email" }, { status: 202 }) });
    renderWithQuery(<SignUpForm />);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long enough password" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "ada@example.com",
      password: "long enough password",
      display_name: "Ada",
    });
  });
});

describe("VerifiedOnly", () => {
  it("holds uploads until the email is confirmed and offers the link again", async () => {
    routeFetch({
      "GET /api/auth/session": () => Response.json(me({ email_verified: false })),
      "POST /api/auth/resend-verification": () => Response.json({ status: "check_email" }, { status: 202 }),
    });
    renderWithQuery(
      <VerifiedOnly>
        <p>upload panel</p>
      </VerifiedOnly>,
    );
    expect(await screen.findByText("Confirm your email to add pieces")).toBeInTheDocument();
    expect(screen.queryByText("upload panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(await screen.findByText(/A new link is on its way/)).toBeInTheDocument();
  });
});

describe("OwnerDeepAnalysis", () => {
  it("tells other accounts what it is without offering to run it", async () => {
    const fetchMock = routeFetch({ "GET /api/auth/session": () => Response.json(me()) });
    renderWithQuery(<OwnerDeepAnalysis itemId="i1" />);

    expect(await screen.findByText(/available to the owner of this Thread/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deep analyze/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(["/api/auth/session"]);
  });
});
