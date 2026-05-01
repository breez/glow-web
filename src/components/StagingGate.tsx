import React, { useState, useEffect } from 'react';
import { DialogContainer, DialogCard, FormInput, PrimaryButton, FormError } from './ui';
import { hideSplash } from '../main';
import { LockIcon } from './Icons';

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

  // Read the persisted auth flag synchronously during initial render so we
  // never paint a checking spinner — sessionStorage is sync-available and the
  // value is stable for the session.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() =>
    !!stagingPassword && sessionStorage.getItem(STAGING_AUTH_KEY) === 'true'
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Hide the splash so the password prompt (or app) becomes visible.
  useEffect(() => {
    if (stagingPassword && !isAuthenticated) {
      void hideSplash();
    }
  }, [stagingPassword, isAuthenticated]);

  // If no password configured, render children immediately (production mode)
  if (!stagingPassword) {
    return <>{children}</>;
  }

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
                <LockIcon size="xl" className="text-spark-warning" />
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
              type="submit"
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
