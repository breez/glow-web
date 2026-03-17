import React from 'react';
import PageLayout from '../components/layout/PageLayout';
import PasswordForm from '../components/PasswordForm';
import { AlertCard } from '../components/AlertCard';
import { PrimaryButton } from '../components/ui';

interface SetPasswordPageProps {
  onPasswordSet: (password: string) => void;
  onBack?: () => void;
  isLoading?: boolean;
  error?: string | null;
  /** 'create' (default) = new wallet setup, 'migrate' = legacy localStorage migration */
  mode?: 'create' | 'migrate';
}

const FORM_ID = 'set-password-form';

const SetPasswordPage: React.FC<SetPasswordPageProps> = ({
  onPasswordSet,
  onBack,
  isLoading = false,
  error = null,
  mode = 'create',
}) => {
  const isMigrate = mode === 'migrate';
  const footer = (
    <div className="max-w-xl mx-auto">
      <PrimaryButton
        type="submit"
        form={FORM_ID}
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? 'Encrypting...' : 'Set Password'}
      </PrimaryButton>
    </div>
  );

  return (
    <PageLayout onBack={onBack ?? (null as unknown as () => void)} footer={footer} title={isMigrate ? 'Secure Glow' : 'Set Password'} showHeader={!isMigrate}>
      <div className={`max-w-xl mx-auto w-full flex flex-col min-h-full ${isMigrate ? 'justify-center' : ''}`}>
        <div className={`${isMigrate ? '' : 'mt-6 '}space-y-4 flex flex-col ${isMigrate ? '' : 'flex-1'}`}>
          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
              {isMigrate ? (
                <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-spark-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </div>
          </div>

          <div className="text-center mb-4">
            <h2 className="text-xl font-display font-bold text-spark-text-primary mb-2">
              {isMigrate ? 'Secure Glow' : 'Create a password'}
            </h2>
            <p className="text-spark-text-secondary">
              {isMigrate
                ? 'Glow now encrypts your recovery phrase with a password. Set a password to continue.'
                : "You'll need this password each time you open Glow."}
            </p>
          </div>

          <AlertCard variant="warning" title="Important">
            <p className="text-spark-text-secondary text-sm">
              If you forget this password, you can only recover your funds using your recovery phrase. There is no password reset.
            </p>
          </AlertCard>

          <PasswordForm
            formId={FORM_ID}
            hideSubmit
            mode="setup"
            onSubmit={onPasswordSet}
            isLoading={isLoading}
            error={error}
          />

          <p className="text-xs text-spark-text-muted text-center">
            Use your password manager to generate a strong password
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

export default SetPasswordPage;
