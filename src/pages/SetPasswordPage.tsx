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
  /** 'create' = new wallet setup, 'migrate' = legacy localStorage migration. */
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
  const Icon = isMigrate ? ShieldCheckIcon : LockIcon;
  const title = isMigrate ? 'Secure Glow' : 'Set Password';
  const heading = isMigrate ? 'Secure Glow' : 'Create a password';
  const subtitle = isMigrate
    ? 'Glow now encrypts your recovery phrase with a password. Set a password to continue.'
    : "You'll need this password each time you open Glow.";

  const footer = (
    <div className="max-w-xl mx-auto">
      <PrimaryButton type="submit" form={FORM_ID} disabled={isLoading} className="w-full">
        {isLoading ? 'Encrypting...' : 'Set Password'}
      </PrimaryButton>
    </div>
  );

  return (
    <PageLayout onBack={onBack} footer={footer} title={title} showHeader={!isMigrate}>
      <div className={`max-w-xl mx-auto w-full flex flex-col space-y-4 ${isMigrate ? 'justify-center min-h-full' : 'flex-1 mt-6'}`}>
        <div className="flex justify-center">
          <div className="size-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            <Icon className="text-spark-primary" size="xl" />
          </div>
        </div>

        <div className="text-center">
          <h2 className="text-xl font-display font-bold text-spark-text-primary mb-2">{heading}</h2>
          <p className="text-spark-text-secondary">{subtitle}</p>
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
    </PageLayout>
  );
};

export default SetPasswordPage;
