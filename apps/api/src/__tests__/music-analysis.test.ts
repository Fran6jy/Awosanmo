import { describe, expect, it } from "vitest";
import { analyse } from "../modules/music/analysis.js";

const SR = 11_025;

/** Deterministic noise in -0.5..0.5. (A float LCG loses precision in JS and quietly turns periodic.) */
function xorshift(seed: number) {
  let x = seed | 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 4294967296) - 0.5; };
}

/** A click track at `bpm` over noise: a decaying burst on every beat, optional sustained bass. */
function clicks(bpm: number, seconds: number, opts: { noise?: number; level?: number; bright?: boolean } = {}): Int16Array {
  const n = SR * seconds;
  const out = new Int16Array(n);
  const period = Math.round((60 / bpm) * SR);
  const level = opts.level ?? 0.5;
  const rnd = xorshift(7);
  for (let i = 0; i < n; i += 1) {
    const t = i % period;
    const burst = t < SR * 0.05 ? Math.exp(-t / (SR * 0.01)) : 0;
    // Low tone under the click (kick-like) or a bright tone, plus a little noise.
    const tone = opts.bright ? Math.sin((2 * Math.PI * 3000 * i) / SR) * 0.15 : Math.sin((2 * Math.PI * 80 * i) / SR) * 0.15;
    const v = burst * level + tone * burst * 2 + (opts.noise ?? 0.01) * rnd();
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

describe("audio analysis", () => {
  it("refuses very short or silent input", () => {
    expect(analyse(new Int16Array(SR * 5))).toBeNull();
    expect(analyse(new Int16Array(SR * 40))).toBeNull();
  });

  it("finds the tempo of a click track", () => {
    for (const bpm of [92, 120, 140]) {
      const f = analyse(clicks(bpm, 40, { noise: 0.002 }))!;
      expect(Math.abs(f.tempo - bpm)).toBeLessThanOrEqual(4); // lag resolution at 43 fps is ~3 BPM around 140
      expect(f.dance).toBeGreaterThan(0.3);
    }
  });

  it("orders energy and brightness sensibly", () => {
    const loud = analyse(clicks(120, 40, { level: 0.9, noise: 0.2 }))!;
    const quiet = analyse(clicks(120, 40, { level: 0.2, noise: 0.005 }))!;
    expect(loud.energy).toBeGreaterThan(quiet.energy);
    expect(loud.loudness).toBeGreaterThan(quiet.loudness);
    // Sustained tones: a 3 kHz tone crosses zero far more often than a 100 Hz one.
    const tone = (hz: number) => { const n = SR * 30; const o = new Int16Array(n); for (let i = 0; i < n; i += 1) o[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / SR) * 8000); return o; };
    expect(analyse(tone(3000))!.brightness).toBeGreaterThan(analyse(tone(100))!.brightness + 0.3);
  });

  it("gives an irregular signal a low dance score", () => {
    const n = SR * 40; const out = new Int16Array(n);
    const rnd = xorshift(3);
    for (let i = 0; i < n; i += 1) out[i] = Math.round(rnd() * 12000);
    const f = analyse(out)!;
    expect(f.dance).toBeLessThan(0.25);
  });
});
