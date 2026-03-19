import React, { useState } from 'react';
import type { Wallet } from '@breeztech/breez-sdk-spark';
import { getWallet } from '../services/passkeyService';


interface UnlockPageProps {
  onUnlock: (wallet: Wallet) => void;
  onLogout: () => void;
}

const UnlockPage: React.FC<UnlockPageProps> = ({ onUnlock, onLogout }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const wallet = await getWallet();
      onUnlock(wallet);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        setError('No passkey found or authentication was cancelled.');
      } else {
        setError('Failed to authenticate. Please try again.');
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
              src="/assets/Glow_Logo.png"
              alt="Glow"
              className="w-36 h-36"
            />
            <h1 className="font-display text-2xl font-bold text-spark-text-primary">
              Welcome back
            </h1>
          </div>

          {/* Passkey button */}
          <div className="space-y-4">
            <button
              onClick={handleUnlock}
              disabled={isLoading}
              className="button w-full py-4 text-base tracking-wider flex items-center justify-center gap-2"
            >
              {isLoading ? 'Unlocking...' : 'Unlock'}
            </button>

            <p className={`text-sm text-center min-h-[2.5rem] flex items-center justify-center ${error ? 'text-spark-error' : 'text-transparent'}`}>
              {error ?? '\u00A0'}
            </p>
          </div>
        </div>
      </div>

      <div className="pb-8 flex justify-center">
        <button
          onClick={onLogout}
          className={`text-xs py-2 transition-colors ${error ? 'text-spark-text-muted hover:text-spark-text-secondary' : 'text-transparent pointer-events-none'}`}
          tabIndex={error ? 0 : -1}
          aria-hidden={!error}
        >
          Log out
        </button>
      </div>
    </div>
  );
};

export default UnlockPage;
