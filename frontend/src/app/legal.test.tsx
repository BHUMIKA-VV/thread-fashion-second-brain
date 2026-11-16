import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

// The legal pages describe how billing works today, and promise nothing it doesn't do.

describe("Terms", () => {
  it("sets out plans, the refund policy and test mode", () => {
    render(<TermsPage />);
    const main = document.body;
    expect(main).toHaveTextContent("Each payment buys one 30-day period, paid once. Nothing renews or charges you again unless you buy another period.");
    expect(main).toHaveTextContent("A period that hasn't started yet can be cancelled from your billing page, and its payment is refunded in full.");
    expect(main).toHaveTextContent("A period that has started isn't refunded through the site");
    expect(main).toHaveTextContent("payments run in Razorpay's test mode and no real money is taken");
    expect(main).toHaveTextContent("Nothing you have added is deleted or hidden");
    expect(screen.getByRole("link", { name: "pricing page" })).toHaveAttribute("href", "/pricing");
    // No longer promised: a free service, or one fixed limit for every account.
    expect(main).not.toHaveTextContent(/offered as it is, free|100 pieces and 250 MB/);
    expect(main).not.toHaveTextContent(/compliant|certified|guarantee(d)? refund/i);
  });
});

describe("Privacy", () => {
  it("says what Razorpay handles, what Thread keeps, and that payment records outlive an account", () => {
    render(<PrivacyPage />);
    const main = document.body;
    expect(screen.getByRole("heading", { name: "If you buy a plan" })).toBeInTheDocument();
    expect(main).toHaveTextContent("Card, UPI and bank details are entered in Razorpay's checkout and go to Razorpay, never to Thread");
    expect(main).toHaveTextContent("Never card numbers, UPI IDs, bank details, or your phone number.");
    expect(main).toHaveTextContent("these payment records are kept as a record of money taken, but no longer linked to you");
    expect(main).toHaveTextContent("The owner can also see each account's plan and payments");
    expect(main).toHaveTextContent("Payment records are the one exception");
    expect(main).not.toHaveTextContent(/compliant|certified|PCI/i);
  });
});
