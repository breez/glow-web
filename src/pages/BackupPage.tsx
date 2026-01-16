import React, { useEffect, useState } from 'react';
import { Transition } from '@headlessui/react';
import { Alert, PrimaryButton } from '@/components/ui';
import { useWallet } from '@/contexts/WalletContext';

interface BackupPageProps {
  onBack: () => void;
}

const BackupPage: React.FC<BackupPageProps> = ({ onBack }) => {
  const wallet = useWallet();
  const [isOpen, setIsOpen] = useState(true);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    setMnemonic(wallet.getSavedMnemonic());
  }, [wallet]);

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(onBack, 220);
  };

  const handleCopy = async () => {
    if (!mnemonic) return;
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Failed to copy mnemonic:', e);
    }
  };

  const words = mnemonic ? mnemonic.split(' ') : [];

  return (
    <div className="absolute inset-0 z-50 overflow-hidden">
      <Transition show={isOpen} appear as="div" className="absolute inset-0">
        <Transition.Child
          as="div"
          enter="transform transition ease-out duration-300"
          enterFrom="translate-x-[-100%]"
          enterTo="translate-x-0"
          leave="transform transition ease-in duration-200"
          leaveFrom="translate-x-0"
          leaveTo="translate-x-[-100%]"
          className="absolute inset-0"
        >
          <div className="flex flex-col h-full bg-spark-surface">
            {/* Header */}
            <div className="relative px-4 py-4 border-b border-spark-border">
              <h1 className="text-center font-display text-lg font-semibold text-spark-text-primary">Backup</h1>
              <button
                onClick={handleClose}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-spark-text-muted hover:text-spark-text-primary rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-xl mx-auto w-full p-4 space-y-6">
                {/* Warning alert */}
                <Alert type="warning">
                  Your recovery phrase grants full access to your funds. Keep it offline and never share it with anyone.
                </Alert>

                {/* Reveal toggle */}
                {!isRevealed && mnemonic && (
                  <button
                    onClick={() => setIsRevealed(true)}
                    className="w-full bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center gap-4 hover:border-spark-border-light transition-colors"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-spark-amber/20 flex items-center justify-center">
                      <svg className="w-8 h-8 text-spark-amber" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </div>
                    <span className="font-display font-semibold text-spark-text-primary">Tap to reveal phrase</span>
                    <span className="text-sm text-spark-text-muted">Make sure no one is watching</span>
                  </button>
                )}

                {/* Mnemonic display */}
                {isRevealed && mnemonic && (
                  <div className="bg-spark-dark border border-spark-border rounded-2xl p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-spark-text-secondary">Recovery Phrase</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setIsRevealed(false)}
                          className="px-3 py-1.5 text-sm font-medium text-spark-text-muted hover:text-spark-text-primary border border-spark-border rounded-lg hover:bg-white/5 transition-colors"
                        >
                          Hide
                        </button>
                        <button
                          onClick={handleCopy}
                          className={`
                            px-3 py-1.5 text-sm font-medium rounded-lg transition-all
                            ${copied 
                              ? 'bg-spark-success/20 text-spark-success border border-spark-success/30' 
                              : 'bg-spark-amber text-black hover:bg-spark-amber-light'
                            }
                          `}
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {words.map((word, index) => (
                        <div 
                          key={index} 
                          className="flex items-center gap-2 bg-spark-surface rounded-lg px-3 py-2"
                        >
                          <span className="text-spark-text-muted text-xs font-mono w-5 text-right">
                            {index + 1}.
                          </span>
                          <span className="text-spark-text-primary font-mono text-sm font-medium">
                            {word}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No mnemonic state */}
                {!mnemonic && (
                  <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-spark-error/20 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-spark-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="font-display font-semibold text-spark-text-primary mb-2">No Backup Found</h3>
                    <p className="text-spark-text-muted text-sm">
                      Could not find a recovery phrase for this wallet.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-spark-border">
              <PrimaryButton className="w-full" onClick={handleClose}>
                Done
              </PrimaryButton>
            </div>
          </div>
        </Transition.Child>
      </Transition>
    </div>
  );
};

export default BackupPage;
