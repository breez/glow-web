import React from 'react';
import PageLayout from '../components/layout/PageLayout';
import PasswordForm from '../components/PasswordForm';
import { AlertCard } from '../components/AlertCard';

interface MigrationPageProps {
  onPasswordSet: (password: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

const MigrationPage: React.FC<MigrationPageProps> = ({
  onPasswordSet,
  isLoading = false,
  error = null,
}) => {
  return (
    <PageLayout onBack={null as unknown as () => void} footer={null} title="Secure Your Wallet" showHeader={false}>
      <div className="min-h-full flex items-center justify-center">
        <div className="max-w-xl w-full space-y-6">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
          </div>

          <h1 className="font-display text-2xl font-bold text-spark-text-primary text-center">
            Secure Your Wallet
          </h1>

          <p className="text-spark-text-secondary text-center">
            Glow now encrypts your wallet with a password. Set a password to continue.
          </p>

          <PasswordForm
            mode="setup"
            onSubmit={onPasswordSet}
            isLoading={isLoading}
            error={error}
          />

          <AlertCard variant="warning" title="Important">
            <p className="text-spark-text-secondary text-sm">
              If you forget this password, you can only recover your wallet using your recovery phrase. There is no password reset.
            </p>
          </AlertCard>
        </div>
      </div>
    </PageLayout>
  );
};

export default MigrationPage;
