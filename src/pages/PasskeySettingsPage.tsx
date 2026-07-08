import React, { useState } from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import {
  ChevronRightIcon,
  PasskeyIcon,
  WalletIcon,
  TrashIcon,
} from '../components/Icons';
import { LEGACY_RP_ID, SHARED_RP_ID } from '../services/passkeyPrfProvider';
import { getPasskeyRpId, setPasskeyRpId } from '../services/passkeyService';

interface PasskeySettingsPageProps {
  onBack: () => void;
  onOpenPasskey: () => void;
  onOpenLabels: () => void;
  onOpenLocalState: () => void;
}

const PasskeySettingsPage: React.FC<PasskeySettingsPageProps> = ({
  onBack,
  onOpenPasskey,
  onOpenLabels,
  onOpenLocalState,
}) => {
  const items: Array<{
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
  }> = [
    {
      icon: <PasskeyIcon size="md" className="text-spark-primary" />,
      title: 'Passkey',
      description: 'View passkey status and how to manage it on this device.',
      onClick: onOpenPasskey,
    },
    {
      icon: <WalletIcon size="md" className="text-spark-primary" />,
      title: 'Labels',
      description: 'Manage the labels associated with your passkey.',
      onClick: onOpenLabels,
    },
    {
      icon: <TrashIcon size="md" className="text-spark-primary" />,
      title: 'Local State',
      description: 'Reset locally stored passkey state on this device.',
      onClick: onOpenLocalState,
    },
  ];

  // Dev-only RP-ID switch: only meaningful when a distinct shared RP ID is
  // configured. Lets a tester sign in under the legacy vs shared RP ID to
  // exercise the passkey-RP migration path.
  const isDevMode = localStorage.getItem('spark-dev-mode') === 'true';
  const sharedRpConfigured = !!SHARED_RP_ID && SHARED_RP_ID !== LEGACY_RP_ID;
  const [activeRpId, setActiveRpId] = useState<string>(getPasskeyRpId() ?? LEGACY_RP_ID);
  const rpIdOptions = [
    { label: 'Legacy', value: LEGACY_RP_ID },
    { label: 'Shared', value: SHARED_RP_ID ?? LEGACY_RP_ID },
  ];

  return (
    <SlideInPage title="Passkey & Labels" closeStyle="back" onClose={onBack} slideFrom="right">
      <div className="p-4 space-y-2">
        {items.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={item.onClick}
            className="w-full flex items-start gap-3 p-4 bg-spark-dark border border-spark-border rounded-2xl text-left hover:border-spark-border-light hover:bg-white/5 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-spark-primary/10 flex items-center justify-center shrink-0">
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-spark-text-primary">
                {item.title}
              </div>
              <p className="text-sm text-spark-text-muted mt-0.5">
                {item.description}
              </p>
            </div>
            <div className="self-center text-spark-text-muted">
              <ChevronRightIcon size="md" />
            </div>
          </button>
        ))}
      </div>

      {isDevMode && sharedRpConfigured && (
        <div className="p-4 pt-0">
          <div className="p-4 bg-spark-dark border border-spark-border rounded-2xl space-y-3">
            <div className="font-display font-semibold text-spark-text-primary">
              Passkey RP ID <span className="text-spark-primary">(dev)</span>
            </div>
            <p className="text-sm text-spark-text-muted">
              Which Relying Party ID this device signs in under. Switching re-derives a
              different wallet on the next sign-in, so only change it to test migration.
            </p>
            <div className="flex gap-2">
              {rpIdOptions.map((opt) => {
                const selected = activeRpId === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => { setPasskeyRpId(opt.value); setActiveRpId(opt.value); }}
                    className={`flex-1 px-3 py-2 rounded-xl text-sm border transition-colors ${
                      selected
                        ? 'border-spark-primary bg-spark-primary/10 text-spark-text-primary'
                        : 'border-spark-border text-spark-text-muted hover:border-spark-border-light'
                    }`}
                  >
                    {opt.label}
                    <span className="block text-[11px] opacity-60 truncate">{opt.value}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </SlideInPage>
  );
};

export default PasskeySettingsPage;
