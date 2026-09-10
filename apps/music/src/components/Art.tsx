import { Music2 } from "lucide-react";
import { artUrl } from "../lib/api";

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
    <div className={`${shape} grid place-items-center ${className}`} style={{ background: gradientFor(seed) }} aria-label={alt}>
      <Music2 className="text-cream/40" style={{ width: `${iconSize * 100}%`, height: `${iconSize * 100}%` }} />
    </div>
  );
}
