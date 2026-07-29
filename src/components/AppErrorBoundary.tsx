/**
 * Last-resort boundary around the whole tree. Without one, any throw in
 * a render or lifecycle unmounts the root and leaves a blank screen: on
 * a native build there is no address bar and no reload, so the only way
 * out is force-quitting, and a throw sourced from persisted state
 * reproduces on every launch.
 *
 * Reload is the recovery action because the failures this catches are
 * transient render throws (a malformed third-party payload reaching a
 * parser mid-render). "Erase and start over" deliberately is NOT offered
 * here: a render bug must never be a route to deleting an account.
 */

import React from 'react';
import { logger, LogCategory } from '../services/logger';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error(LogCategory.UI, 'Unhandled render error', {
      error: error.message,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-dvh w-full flex flex-col items-center justify-center gap-6 bg-spark-surface px-6 text-center">
        <img src="/assets/Glow_Logo.svg" alt="Glow" className="w-24 h-24 object-contain" />
        <div className="space-y-2">
          <h1 className="font-display text-xl font-bold text-spark-text-primary">
            Something went wrong
          </h1>
          <p className="text-sm text-spark-text-secondary">
            Glow hit an unexpected error. Your funds are safe: reloading does not
            change anything stored on this device.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-6 py-3 rounded-xl bg-spark-primary font-display font-semibold text-white"
        >
          Reload Glow
        </button>
      </div>
    );
  }
}

export default AppErrorBoundary;
