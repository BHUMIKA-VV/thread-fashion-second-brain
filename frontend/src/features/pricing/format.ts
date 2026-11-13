/** Whole paise as rupees: 99900 → "₹999", 249950 → "₹2,499.50". */
export function formatPrice(paise: number): string {
  const fraction = paise % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(paise / 100);
}

/** Storage as the API words it: "250 MB", "1 GB". */
export function formatStorage(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Number(gb.toFixed(2))} GB` : `${Number((bytes / 1024 ** 2).toFixed(1))} MB`;
}

export function formatPeriod(days: number | null): string {
  return days === null ? "No payment" : `per ${days} days`;
}
