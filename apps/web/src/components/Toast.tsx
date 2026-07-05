import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export type Toast = {
  id: number;
  type: "success" | "error" | "info";
  title: string;
  body?: string;
};

type ToastInput = Omit<Toast, "id">;

const listeners = new Set<(t: Toast) => void>();
let counter = 0;

/** Fire a toast from anywhere (socket handlers, mutations, etc.). */
export function pushToast(input: ToastInput): void {
  const toast: Toast = { id: ++counter, ...input };
  listeners.forEach((fn) => fn(toast));
}

const icons = {
  success: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
  error: <AlertTriangle className="h-5 w-5 text-rose-400" />,
  info: <Info className="h-5 w-5 text-sky-400" />,
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (toast: Toast) => {
      setToasts((prev) => [...prev, toast]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 5000);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-full max-w-sm flex-col gap-3">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/10"
          >
            <div className="mt-0.5">{icons[toast.type]}</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-950">{toast.title}</p>
              {toast.body && <p className="mt-0.5 text-xs text-slate-500">{toast.body}</p>}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
