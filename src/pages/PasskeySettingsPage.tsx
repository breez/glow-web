import React from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import {
  ChevronRightIcon,
  PasskeyIcon,
  WalletIcon,
  TrashIcon,
} from '../components/Icons';

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
    </SlideInPage>
  );
};

export default PasskeySettingsPage;
