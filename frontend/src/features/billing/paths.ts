/**
 * The one page where Razorpay Checkout may run (next.config.ts relaxes the CSP there only).
 * Link to it with a plain <a>, never next/link: a page keeps the CSP of the document it was
 * loaded in, so a client-side navigation would carry the stricter policy along.
 */
export const CHECKOUT_PATH = "/account/billing";

export const isCheckoutPath = (path: string) => path === CHECKOUT_PATH || path.startsWith(`${CHECKOUT_PATH}?`);
