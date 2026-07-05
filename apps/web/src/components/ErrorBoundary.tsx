import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Catches render/lifecycle errors anywhere in the tree so a single failing
 * component shows a recoverable message instead of a blank white page.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in the console for debugging; never swallow silently.
    console.error("Awosanmo UI crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="grid min-h-screen place-items-center bg-ink px-4 text-slate-200">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900/70 p-6 backdrop-blur-xl">
            <p className="font-mono text-sm text-rose-400">SOMETHING BROKE</p>
            <h1 className="mt-2 text-2xl font-bold">The interface hit an error</h1>
            <p className="mt-3 text-sm text-slate-400">
              Try reloading. If it keeps happening, the message below helps with debugging.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-black/40 p-3 text-xs text-rose-300">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => location.reload()}
              className="mt-5 h-11 rounded-xl bg-stream px-5 font-bold text-white transition hover:bg-emerald-300"
            >
              Reload
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
