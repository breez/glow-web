import React from 'react';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { KeyIcon } from '../components/Icons';

interface ForgotPasswordPageProps {
  onEnterRecoveryPhrase: () => void;
  onBack: () => void;
}

const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({
  onEnterRecoveryPhrase,
  onBack,
}) => {
  return (
    <PageLayout
      onBack={onBack}
      title="Forgot Password"
      footer={
        <div className="max-w-xl mx-auto space-y-3">
          <PrimaryButton className="w-full" onClick={onEnterRecoveryPhrase}>
            Enter Recovery Phrase
          </PrimaryButton>
          <SecondaryButton className="w-full" onClick={onBack}>
            Go Back
          </SecondaryButton>
        </div>
      }
    >
      <div className="max-w-xl mx-auto w-full flex flex-col min-h-full">
        <div className="mt-6 space-y-4 flex flex-col flex-1">
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
              <KeyIcon className="text-spark-primary" size="xl" />
            </div>
          </div>

          <div className="text-center mb-4">
            <h2 className="text-xl font-display font-bold text-spark-text-primary mb-2">
              Reset your password
            </h2>
            <p className="text-spark-text-secondary">
              To regain access, you'll need to enter your recovery phrase and set a new password.
            </p>
          </div>

          <AlertCard variant="warning" title="Important">
            <p className="text-spark-text-secondary text-sm">
              This will replace your existing password. If you remember your password, go back and try again.
            </p>
          </AlertCard>
        </div>
      </div>
    </PageLayout>
  );
};

export default ForgotPasswordPage;
