import React, { useState } from 'react';
import PasswordForm from '../components/PasswordForm';
import { unlockVault, VaultError } from '../services/vault';

interface VaultUnlockPageProps {
  onUnlocked: (mnemonic: string) => void;
}

const VaultUnlockPage: React.FC<VaultUnlockPageProps> = ({ onUnlocked }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError('Failed to unlock Glow. Please try again.');
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
              src="/assets/Glow_Logo.svg"
              alt="Glow"
              className="w-36 h-36"
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

        </div>
      </div>
    </div>
  );
};

export default VaultUnlockPage;
