import React from 'react';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { PrimaryButton, SecondaryButton } from '../components/ui';

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
              <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
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
