import React from "react";

type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Unrecoverable frontend error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="min-h-screen bg-slate-50 dark:bg-neutral-950 flex items-center justify-center p-6">
        <div
          role="alert"
          className="w-full max-w-lg rounded-2xl border-2 border-black dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
        >
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            ExcaliDash could not continue
          </h1>
          <p className="mt-3 text-sm text-slate-600 dark:text-neutral-300">
            Reload the page to recover. Unsaved editor changes may still be available in another open tab.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl border-2 border-black bg-indigo-600 px-5 py-2.5 font-bold text-white"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="rounded-xl border-2 border-black bg-white px-5 py-2.5 font-bold text-slate-900 dark:bg-neutral-800 dark:text-white"
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </main>
    );
  }
}
