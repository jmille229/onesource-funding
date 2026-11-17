import { Component, type ReactNode } from 'react';
import { reportClientError } from '../lib/telemetry';

/** A crash in one screen shows a way out instead of a blank page, and is reported. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportClientError(error.message, error.stack, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="card p-6 max-w-sm text-center space-y-3">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-600">We’ve been told about it. Reloading usually gets you going again.</p>
          <button className="btn-primary w-full" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
