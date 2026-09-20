/**
 * The JYMusic mark: a tuning fork. Its tines are the Y, the handle curls into
 * the J, and the arcs are the tone leaving the fork — vibration becoming waves.
 * The mark stands in for the letters, so the wordmark is "((Y)) Music".
 */
const FORK = (
  <>
    <path d="M47 25 55 51a9 9 0 0 0 18 0l8-26" />
    <path d="M64 60v24c0 8-6 12-12 12" />
    <ellipse cx="49" cy="97" rx="12.5" ry="9" transform="rotate(-22 49 97)" fill="currentColor" stroke="none" />
  </>
);

export function Mark({ arcs = true, live = false, className = "h-8" }: { arcs?: boolean; live?: boolean; className?: string }) {
  return (
    <svg viewBox={arcs ? "12 14 104 100" : "30 16 68 92"} className={`${className} shrink-0 ${live ? "mark-live" : ""}`} aria-hidden="true"
      stroke="currentColor" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {FORK}
      {arcs && (
        <>
          <path className="arc arc-l arc-1" d="M35 24q-7 10 0 20" strokeWidth={6} opacity={0.85} />
          <path className="arc arc-l arc-2" d="M22 20q-11 14 0 28" strokeWidth={5} opacity={0.55} />
          <path className="arc arc-r arc-1" d="M93 24q7 10 0 20" strokeWidth={6} opacity={0.85} />
          <path className="arc arc-r arc-2" d="M106 20q11 14 0 28" strokeWidth={5} opacity={0.55} />
        </>
      )}
    </svg>
  );
}

/** "((Y)) Music" — the mark is the JY. */
export function Wordmark({ size = "md", live = false, className = "" }: { size?: "sm" | "md" | "lg"; live?: boolean; className?: string }) {
  const s = size === "lg" ? { mark: "h-14", text: "text-3xl" } : size === "sm" ? { mark: "h-8", text: "text-lg" } : { mark: "h-10", text: "text-xl" };
  return (
    <span className={`inline-flex items-center gap-1 text-cream ${className}`}>
      <Mark className={`${s.mark} text-accent2`} live={live} />
      <span className={`${s.text} font-extrabold tracking-tight`}>Music</span>
      <span className="sr-only">JYMusic</span>
    </span>
  );
}
