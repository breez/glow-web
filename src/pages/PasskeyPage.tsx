import React, { useEffect, useState } from 'react';
import { Seed } from '@breeztech/breez-sdk-spark';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import LoadingSpinner from '../components/LoadingSpinner';
import PageLayout from '../components/layout/PageLayout';
import { AlertCard } from '../components/AlertCard';
import { UploadIcon, CheckIcon, FingerprintIcon } from '../components/Icons';
import { getWallet, listWalletNames, storeWalletName } from '@/services/passkeyService';
import { logger, LogCategory } from '@/services/logger';

interface PasskeyPageProps {
  onWalletRestored: (seed: Seed, walletName: string) => void;
  onBack: () => void;
}

const PasskeyPage: React.FC<PasskeyPageProps> = ({
  onWalletRestored,
  onBack,
}) => {
  const [hasAcknowledged, setHasAcknowledged] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletNames, setWalletNames] = useState<string[]>([]);
  const [selectedWalletName, setSelectedWalletName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualWalletName, setManualWalletName] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  // Fetch wallet names after acknowledgment
  useEffect(() => {
    if (!hasAcknowledged) return;
    const autoCreate = async () => {
      setIsConnecting(true);
      try {
        const w = await getWallet();
        storeWalletName(w.name).catch((e) =>
          logger.warn(LogCategory.AUTH, 'Failed to store wallet name', {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
        onWalletRestored(w.seed, w.name);
      } catch (e) {
        setError('Failed to set up wallet');
        logger.error(LogCategory.AUTH, 'Auto-create wallet failed', {
          error: e instanceof Error ? e.message : String(e),
        });
        setIsConnecting(false);
      }
    };

    const fetchWalletNames = async () => {
      setIsLoading(true);
      try {
        const names = await listWalletNames();
        setWalletNames(names);

        if (names.length === 0) {
          // No wallets — auto-create default
          setIsLoading(false);
          await autoCreate();
          return;
        }

        // Pre-select "Default" if present, otherwise first
        const defaultIdx = names.indexOf('Default');
        setSelectedWalletName(defaultIdx !== -1 ? names[defaultIdx] : names[0]);
      } catch (e) {
        setError('Failed to discover wallets');
        logger.error(LogCategory.AUTH, 'Failed to list wallet names', {
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchWalletNames();
  }, [hasAcknowledged, onWalletRestored]);

  const handleConnect = async () => {
    const manualName = manualWalletName.trim();
    const nameToUse = manualName || selectedWalletName;
    if (!nameToUse) return;

    setIsConnecting(true);
    setError(null);

    try {
      if (manualName) {
        storeWalletName(nameToUse).catch((e) =>
          logger.warn(LogCategory.AUTH, 'Failed to store wallet name', {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      const w = await getWallet(nameToUse);
      logger.info(LogCategory.AUTH, 'Passkey wallet derived');
      onWalletRestored(w.seed, w.name);
    } catch (e) {
      setError('Failed to connect');
      logger.error(LogCategory.AUTH, 'Passkey wallet restore failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      setIsConnecting(false);
    }
  };

  // Acknowledgment screen — shown before any passkey operations
  if (!hasAcknowledged) {
    const ackFooter = (
      <div className="max-w-xl mx-auto space-y-3">
        <PrimaryButton
          className="w-full"
          onClick={() => setHasAcknowledged(true)}
        >
          I understand
        </PrimaryButton>
        <SecondaryButton className="w-full" onClick={onBack}>
          Go Back
        </SecondaryButton>
      </div>
    );

    return (
      <PageLayout onBack={onBack} footer={ackFooter} title="Passkey">
        <div className="max-w-xl mx-auto w-full space-y-4">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
              <FingerprintIcon size="xl" className="text-spark-primary" />
            </div>
          </div>

          <p className="text-spark-text-secondary text-center mb-2">
            Your passkey is how you access your funds.
          </p>

          <AlertCard variant="warning" title="Don't Delete Your Passkey">
            <p className="text-spark-text-secondary text-sm">
              Deleting your passkey from your device, browser, or password manager may make your funds permanently inaccessible.
            </p>
          </AlertCard>
        </div>
      </PageLayout>
    );
  }

  if (isLoading) {
    return (
      <PageLayout onBack={onBack} footer={<div />} title="Passkey">
        <div className="flex flex-col items-center justify-center h-full">
          <LoadingSpinner text="Discovering wallets..." />
        </div>
      </PageLayout>
    );
  }

  if (isConnecting) {
    return (
      <PageLayout onBack={onBack} footer={<div />} title="Passkey">
        <div className="flex flex-col items-center justify-center h-full">
          <LoadingSpinner text="Connecting..." />
        </div>
      </PageLayout>
    );
  }

  // 1+ wallets — unified selection list + create option
  const canConnect = !!(manualWalletName.trim() || selectedWalletName);
  const footer = (
    <div className="max-w-xl mx-auto space-y-3">
      <PrimaryButton
        className="w-full"
        onClick={handleConnect}
        disabled={!canConnect}
      >
        Connect
      </PrimaryButton>
      <SecondaryButton className="w-full" onClick={onBack}>
        Go Back
      </SecondaryButton>
    </div>
  );

  return (
    <PageLayout onBack={onBack} footer={footer} title="Passkey">
      <div className="max-w-xl mx-auto w-full space-y-6">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-2xl bg-spark-primary/20 flex items-center justify-center">
            <UploadIcon size="xl" className="text-spark-primary" />
          </div>
        </div>

        <div className="text-center mb-4">
          <h2 className="text-xl font-display font-bold text-spark-text-primary mb-2">
            Select Wallet
          </h2>
        </div>

        <div className="space-y-2">
          {walletNames.map((name) => (
            <button
              key={name}
              onClick={() => {
                setSelectedWalletName(name);
                setManualWalletName('');
              }}
              className={`
                w-full p-4 rounded-2xl border text-left transition-all
                ${selectedWalletName === name && !manualWalletName.trim()
                  ? 'bg-spark-primary/10 border-spark-primary'
                  : 'bg-spark-dark border-spark-border hover:border-spark-border-light'
                }
              `}
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-medium text-spark-text-primary">
                  {name}
                </span>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${selectedWalletName === name && !manualWalletName.trim() ? 'bg-spark-primary' : 'bg-transparent'}`}>
                  {selectedWalletName === name && !manualWalletName.trim() && (
                    <CheckIcon size="sm" className="text-white" />
                  )}
                </div>
              </div>
            </button>
          ))}

          {/* Create new wallet */}
          {!showManualInput ? (
            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              className="w-full p-4 rounded-2xl border bg-spark-dark border-spark-border hover:border-spark-border-light text-left transition-all"
            >
              <span className="text-sm font-medium text-spark-text-secondary">
                Create a new wallet...
              </span>
            </button>
          ) : (
            <div
              className={`
                w-full p-4 rounded-2xl border transition-all
                ${manualWalletName.trim()
                  ? 'bg-spark-primary/10 border-spark-primary'
                  : 'bg-spark-dark border-spark-border'
                }
              `}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-spark-text-secondary">
                  Create a new wallet
                </span>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${manualWalletName.trim() ? 'bg-spark-primary' : 'bg-transparent'}`}>
                  {manualWalletName.trim() && (
                    <CheckIcon size="sm" className="text-white" />
                  )}
                </div>
              </div>
              <input
                type="text"
                value={manualWalletName}
                onChange={(e) => setManualWalletName(e.target.value)}
                placeholder="Wallet name"
                className="w-full bg-spark-surface border border-spark-border rounded-xl px-3 py-2 text-spark-text-primary placeholder:text-spark-text-muted focus:outline-none focus:ring-2 focus:ring-spark-primary/50 focus:border-spark-primary text-sm"
                autoFocus
              />
            </div>
          )}
        </div>

        {error && (
          <AlertCard variant="error" title={error}>
            <p className="text-spark-text-secondary text-sm">Please ensure your device supports passkeys and is the correct device</p>
          </AlertCard>
        )}
      </div>
    </PageLayout>
  );
};

export default PasskeyPage;
