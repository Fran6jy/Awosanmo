export function Logo({ className = "h-11 w-11", rounded = "rounded-xl" }: { className?: string; rounded?: string }) {
  return (
    <span className={`awosanmo-mark grid shrink-0 place-items-center ${rounded} ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="h-[58%] w-[58%]" aria-hidden="true">
        <path d="M12 3.5 L20 20 L15.6 20 L12 11 L8.4 20 L4 20 Z" fill="currentColor" />
        <rect x="8.7" y="14.3" width="6.6" height="2.15" rx="1.05" fill="currentColor" fillOpacity="0.45" />
      </svg>
    </span>
  );
}
