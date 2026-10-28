/**
 * Last-resort boundary around the whole tree. Without one, any throw in
 * a render or lifecycle unmounts the root and leaves a blank screen.
 *
 * Offers no action: restarting the app is the recovery. "Erase and start
 * over" deliberately is NOT offered here: a render bug must never be a
 * route to deleting an account.
 */

import React from 'react';
import { logger, LogCategory } from '../services/logger';
import { AlertCard } from './AlertCard';
import { CollapsibleCodeField } from './ui';
import i18n from 'i18next';

interface Props {
  children: React.ReactNode;
}

interface State {
  /** The caught error as `Name: message`; absent until something throws. */
  error?: string;
  /** The splash was still up, so the throw happened while Glow was starting. */
  atLaunch?: boolean;
  showDetails: boolean;
}

class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { showDetails: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: String(error), atLaunch: document.getElementById('splash') !== null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error(LogCategory.UI, 'Unhandled render error', {
      error: error.message,
      componentStack: info.componentStack ?? undefined,
    });
    // A throw during startup lands before anything calls hideSplash(), so
    // the splash would cover this screen. Removed directly: hideSplash()
    // waits on the passkey check, which can depend on what just failed.
    document.getElementById('splash')?.remove();
  }

  render() {
    if (this.state.error === undefined) return this.props.children;

    return (
      <div className="min-h-dvh w-full flex flex-col items-center justify-center gap-6 bg-spark-surface px-6 text-center">
        <img src="/assets/Glow_Logo.svg" alt="Glow" className="w-24 h-24 object-contain" />
        <h1 className="font-display text-xl font-bold text-spark-text-primary">
          {i18n.t('common:app.somethingWrong')}
        </h1>
        <AlertCard variant="error" title={this.state.atLaunch ? i18n.t('common:app.couldNotOpen') : i18n.t('common:app.stoppedWorking')} className="w-full max-w-sm text-left">
          <p className="text-sm">{i18n.t('common:app.unexpectedError')}</p>
          <CollapsibleCodeField
            label={i18n.t('common:labels.error')}
            value={this.state.error}
            isVisible={this.state.showDetails}
            onToggle={() => this.setState(s => ({ showDetails: !s.showDetails }))}
            copyable
          />
        </AlertCard>
      </div>
    );
  }
}

export default AppErrorBoundary;
