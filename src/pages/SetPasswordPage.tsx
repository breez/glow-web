import React from 'react';
import PageLayout from '../components/layout/PageLayout';
import PasswordForm from '../components/PasswordForm';
import { AlertCard } from '../components/AlertCard';
import { PrimaryButton } from '../components/ui';
import { ShieldCheckIcon, LockIcon } from '../components/Icons';

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
                <ShieldCheckIcon className="text-spark-primary" size="xl" />
              ) : (
                <LockIcon className="text-spark-primary" size="xl" />
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
