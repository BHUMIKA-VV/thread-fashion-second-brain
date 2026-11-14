const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });
const shortFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long" });

/** "13 December 2026". */
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

/** "13 December", for buttons. */
export const formatDay = (iso: string) => shortFormat.format(new Date(iso));

/** A period bought now starts later than now only when another one is running. */
export const startsLater = (iso: string, now = Date.now()) => new Date(iso).getTime() - now > 60_000;
