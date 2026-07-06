// Awosanmo brand mark: a geometric "A" that doubles as an upward stream/peak,
// on the indigo→violet gradient. Ownable, unlike a generic cloud glyph.
export function Logo({ className = "h-11 w-11", rounded = "rounded-xl" }: { className?: string; rounded?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center bg-gradient-to-br from-accent to-violet shadow-glow ${rounded} ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="h-[58%] w-[58%]" aria-hidden="true">
        {/* Peak / "A" apex */}
        <path d="M12 3.5 L20 20 L15.6 20 L12 11 L8.4 20 L4 20 Z" fill="#fff" fillOpacity="0.96" />
        {/* Crossbar */}
        <rect x="8.7" y="14.3" width="6.6" height="2.15" rx="1.05" fill="#fff" fillOpacity="0.55" />
      </svg>
    </span>
  );
}
