import type { ComponentProps, ReactNode } from "react";

/** The quiet, centred column every account page sits in. */
export function AuthShell({
  kicker,
  title,
  children,
  aside,
}: {
  kicker: string;
  title: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <p className="text-[11px] uppercase tracking-[0.28em] text-ink-muted">{kicker}</p>
        <h1 className="mt-4 font-display text-5xl leading-none tracking-tight sm:text-6xl">{title}</h1>
        {aside && <div className="mt-6 max-w-sm text-sm leading-relaxed text-ink-muted">{aside}</div>}
      </div>
      <div className="lg:col-span-6 lg:col-start-7">{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  className,
  ...input
}: ComponentProps<"input"> & { label: string; hint?: ReactNode }) {
  // The hint sits outside the label: it describes the field, it isn't part of its name.
  const hintId = hint && input.id ? `${input.id}-hint` : undefined;
  return (
    <div className={className}>
      <label className="block text-xs tracking-[0.04em] text-ink-muted">
        {label}
        <input
          {...input}
          aria-describedby={hintId}
          className="mt-1.5 block w-full rounded-[2px] border border-line bg-paper-raised px-3 py-2.5 text-base text-ink sm:text-sm"
        />
      </label>
      {hint && (
        <p id={hintId} aria-live="polite" className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="border-l-2 border-danger pl-3 text-sm text-danger">
      {children}
    </p>
  );
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="border-t border-ink pt-5">
      <p className="font-display text-2xl">{title}</p>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}
