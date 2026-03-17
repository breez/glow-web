import React, { useState } from 'react';
import PasswordForm from '../components/PasswordForm';
import { ConfirmDialog } from '../components/ui';
import { unlockVault, VaultError } from '../services/vault';

interface UnlockPageProps {
  onUnlocked: (mnemonic: string) => void;
  onForgotPassword: () => void;
}

const UnlockPage: React.FC<UnlockPageProps> = ({ onUnlocked, onForgotPassword }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForgotDialog, setShowForgotDialog] = useState(false);

  const handleUnlock = async (password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const mnemonic = await unlockVault(password);
      onUnlocked(mnemonic);
    } catch (e) {
      if (e instanceof VaultError && e.code === 'wrong_password') {
        setError('Wrong password. Try again.');
      } else {
        setError('Failed to unlock wallet. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh h-dvh w-full flex flex-col bg-spark-surface relative">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-8">
          {/* Logo */}
          <div className="flex flex-col items-center gap-4">
            <img
              src="/glow-logo.svg"
              alt="Glow"
              className="w-16 h-16"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <h1 className="font-display text-2xl font-bold text-spark-text-primary">
              Welcome back
            </h1>
          </div>

          <PasswordForm
            mode="unlock"
            onSubmit={handleUnlock}
            isLoading={isLoading}
            error={error}
          />

          {/* Forgot password */}
          <div className="text-center">
            <button
              onClick={() => setShowForgotDialog(true)}
              className="text-spark-text-muted text-sm hover:text-spark-text-secondary transition-colors"
            >
              Forgot password?
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showForgotDialog}
        title="Forgot Password?"
        message="To regain access, you'll need your recovery phrase. This will create a new password and replace the existing one."
        confirmLabel="Enter Recovery Phrase"
        cancelLabel="Go Back"
        onConfirm={() => {
          setShowForgotDialog(false);
          onForgotPassword();
        }}
        onCancel={() => setShowForgotDialog(false)}
      />
    </div>
  );
};

export default UnlockPage;
