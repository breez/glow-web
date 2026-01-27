import React, { useState, useEffect } from 'react';
import { DialogContainer, DialogCard, FormInput, PrimaryButton, FormError } from './ui';
import { hideSplash } from '../main';

const STAGING_AUTH_KEY = 'staging_authenticated';

interface StagingGateProps {
  children: React.ReactNode;
}

/**
 * Password gate for staging environments.
 * Only renders children if:
 * - VITE_STAGING_PASSWORD is not set (production), OR
 * - User has entered the correct password (stored in sessionStorage)
 */
const StagingGate: React.FC<StagingGateProps> = ({ children }) => {
  const stagingPassword = import.meta.env.VITE_STAGING_PASSWORD;

  // If no password configured, render children immediately (production mode)
  if (!stagingPassword) {
    return <>{children}</>;
  }

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // Check sessionStorage on mount and hide splash since StagingGate blocks App content
  useEffect(() => {
    const authenticated = sessionStorage.getItem(STAGING_AUTH_KEY) === 'true';
    setIsAuthenticated(authenticated);
    setIsChecking(false);
    // Hide the splash screen so the password prompt (or app) is visible
    if (!authenticated) {
      hideSplash();
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password === stagingPassword) {
      sessionStorage.setItem(STAGING_AUTH_KEY, 'true');
      setIsAuthenticated(true);
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

  // Still checking sessionStorage
  if (isChecking) {
    return (
      <div className="min-h-screen bg-spark-void flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-spark-border border-t-spark-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated - render app
  if (isAuthenticated) {
    return <>{children}</>;
  }

  // Show password prompt
  return (
    <div className="min-h-screen bg-spark-void">
      <DialogContainer>
        <DialogCard maxWidth="sm">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-spark-warning/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-spark-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="font-display text-xl font-bold text-spark-text-primary">
                Staging Environment
              </h2>
              <p className="text-sm text-spark-text-muted mt-2">
                This is a development build. Enter the password to continue.
              </p>
            </div>

            <div>
              <FormInput
                id="staging-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
              />
              <FormError error={error} />
            </div>

            <PrimaryButton
              onClick={() => {}}
              disabled={!password}
              className="w-full"
            >
              Continue
            </PrimaryButton>
          </form>
        </DialogCard>
      </DialogContainer>
    </div>
  );
};

export default StagingGate;
