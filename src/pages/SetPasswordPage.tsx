import React from 'react';
import PageLayout from '../components/layout/PageLayout';
import PasswordForm from '../components/PasswordForm';
import { AlertCard } from '../components/AlertCard';

interface SetPasswordPageProps {
  onPasswordSet: (password: string) => void;
  onBack: () => void;
  isLoading?: boolean;
  error?: string | null;
}

const SetPasswordPage: React.FC<SetPasswordPageProps> = ({
  onPasswordSet,
  onBack,
  isLoading = false,
  error = null,
}) => {
  return (
    <PageLayout onBack={onBack} footer={null} title="Set Password">
      <div className="max-w-xl mx-auto w-full space-y-6">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>

        <p className="text-spark-text-secondary text-center">
          Create a password to encrypt your wallet. You'll need this password each time you open Glow.
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
    </PageLayout>
  );
};

export default SetPasswordPage;
