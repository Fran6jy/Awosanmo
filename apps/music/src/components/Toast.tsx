import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Toast = { id: number; text: string };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;

/** Spotify-style: a small pill that slides up above the player bar. */
export function pushToast(text: string) {
  const t = { id: ++seq, text };
  for (const l of listeners) l(t);
}

export function Toaster() {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    const l = (t: Toast) => setToast(t);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-cream shadow-glow">
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
