import { artUrl } from "../lib/api";
import { Mark } from "./Logo";

/** Deterministic warm gradient so untagged tracks still get a distinct tile. */
function gradientFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = 340 + (h % 40) - 20;          // maroon family
  const hue2 = 20 + ((h >> 8) % 30);         // toward brown/amber
  return `linear-gradient(135deg, hsl(${hue1} 45% 26%), hsl(${hue2} 40% 18%))`;
}

export function Art({ src, seed, alt = "", className = "", round = false, iconSize = 0.4 }: {
  src: string | null | undefined; seed: string; alt?: string; className?: string; round?: boolean; iconSize?: number;
}) {
  const url = artUrl(src);
  const shape = round ? "rounded-full" : "rounded-md";
  if (url) {
    return <img src={url} alt={alt} loading="lazy" decoding="async" className={`${shape} object-cover ${className}`} draggable={false} />;
  }
  return (
    <div className={`${shape} grid place-items-center overflow-hidden ${className}`} style={{ background: gradientFor(seed) }} aria-label={alt || "JYMusic artwork"}>
      <div className="flex flex-col items-center text-cream/75" style={{ width: `${Math.max(iconSize, 0.34) * 100}%` }}>
        <Mark className="h-auto w-full text-accent2" />
        <span className="mt-1 text-center text-[clamp(9px,1.4vw,18px)] font-extrabold leading-none">JYMusic</span>
      </div>
    </div>
  );
}
