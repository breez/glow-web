import React, { useCallback, useEffect, useRef, useState } from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import { AlertCard } from '../components/AlertCard';
import LoadingSpinner from '../components/LoadingSpinner';
import { ConfirmDialog, PrimaryButton, SecondaryButton, FormInput } from '../components/ui';
import { CheckIcon, PlusIcon, WalletIcon } from '../components/Icons';
import { listLabels, saveLabel, getLabelLastUsed } from '../services/passkeyService';
import { useToast } from '@/contexts/ToastContext';
import { logger, LogCategory } from '@/services/logger';

interface LabelsPageProps {
  onBack: () => void;
  /** Reconnect with `label`. Throws on PRF cancel or connect failure. */
  onSwitchLabel: (label: string) => Promise<void>;
}

const PASSKEY_LABEL_KEY = 'passkeyLabel';

const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const ONE_WEEK = 7 * ONE_DAY;

/**
 * Render a "last used" timestamp as a coarse relative string. Buckets
 * fall back to an absolute date once the gap exceeds a week, since at
 * that point a relative count stops being scannable.
 */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < ONE_MINUTE) return 'just now';
  if (diff < ONE_HOUR) {
    const mins = Math.floor(diff / ONE_MINUTE);
    return mins === 1 ? '1 min ago' : `${mins} min ago`;
  }
  if (diff < ONE_DAY) {
    const hrs = Math.floor(diff / ONE_HOUR);
    return hrs === 1 ? '1 hr ago' : `${hrs} hr ago`;
  }
  if (diff < ONE_WEEK) {
    const days = Math.floor(diff / ONE_DAY);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  return new Date(ts).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const LabelsPage: React.FC<LabelsPageProps> = ({ onBack, onSwitchLabel }) => {
  const { showToast } = useToast();
  const [labels, setLabels] = useState<string[]>([]);
  // Snapshot last-used once when labels resolve so renders don't re-read
  // localStorage. A switch made while this page is open won't surface its
  // own freshly-stamped timestamp until reopen.
  const [lastUsedMap, setLastUsedMap] = useState<Record<string, number | undefined>>({});
  const [activeLabel] = useState<string | null>(() => localStorage.getItem(PASSKEY_LABEL_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  const cancelledRef = useRef(false);

  // Async IIFE: setStates fire post-await to satisfy
  // react-hooks/set-state-in-effect.
  const loadLabels = useCallback(() => {
    void (async () => {
      let found: string[] | null = null;
      let errorMsg: string | null = null;
      try {
        found = await listLabels();
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
        logger.warn(LogCategory.AUTH, 'Failed to load labels for management page', {
          error: errorMsg,
        });
      }
      if (cancelledRef.current) return;
      if (errorMsg !== null) {
        setLoadError(errorMsg);
        setIsLoading(false);
        return;
      }
      setLoadError(null);
      // Match PasskeyPage display order: oldest -> newest
      const ordered = [...(found ?? [])].reverse();
      setLabels(ordered);
      // Build the last-used map in the same tick as the label set so the
      // first render that paints the rows already has stable timestamps.
      const map: Record<string, number | undefined> = {};
      for (const label of ordered) {
        map[label] = getLabelLastUsed(label);
      }
      setLastUsedMap(map);
      setIsLoading(false);
    })();
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    loadLabels();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadLabels]);

  const handleRetry = () => {
    setIsLoading(true);
    setLoadError(null);
    loadLabels();
  };

  const trimmed = newLabel.trim();
  const isDuplicate = trimmed
    ? labels.some((l) => l.toLowerCase() === trimmed.toLowerCase())
    : false;
  const canSave = !!trimmed && !isDuplicate && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await saveLabel(trimmed);
      setLabels((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
      setNewLabel('');
      setShowAddForm(false);
      showToast('success', 'Label added', `"${trimmed}" is now available on this passkey.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(LogCategory.AUTH, 'Failed to save label', { error: msg });
      showToast('error', "Couldn't add label", msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmSwitch = async () => {
    const target = pendingSwitch;
    if (!target) return;
    setPendingSwitch(null);
    setIsSwitching(true);
    try {
      await onSwitchLabel(target);
      // Parent navigates to wallet on success; nothing more to do here.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(LogCategory.AUTH, 'Label switch failed', { error: msg });
      showToast('error', "Couldn't switch label", msg);
      setIsSwitching(false);
    }
  };

  const footer = !isLoading && loadError ? (
    <PrimaryButton className="w-full" onClick={handleRetry}>
      Try Again
    </PrimaryButton>
  ) : undefined;

  return (
    <SlideInPage title="Labels" closeStyle="back" onClose={onBack} slideFrom="right" footer={footer}>
      <div className="p-4 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          )}

          {!isLoading && loadError && (
            <AlertCard variant="error" title="Couldn't load labels">
              <p className="text-spark-text-secondary text-sm wrap-break-word">
                {loadError}
              </p>
            </AlertCard>
          )}

          {!isLoading && !loadError && labels.length === 0 && (
            <div className="bg-spark-dark border border-spark-border rounded-2xl p-8 flex flex-col items-center text-center">
              <WalletIcon
                size="xl"
                className="w-14 h-14 text-spark-text-muted opacity-30 mb-4"
              />
              <div className="font-display font-semibold text-spark-text-primary mb-1">
                No labels yet
              </div>
              <p className="text-spark-text-muted text-sm">
                Add a label to organize multiple wallets under this passkey.
              </p>
            </div>
          )}

          {!isLoading && !loadError && (
            <>
              <div className="space-y-2">
                {labels.map((label) => {
                  const isActive = label === activeLabel;
                  const cardClasses = `flex items-center gap-3 p-4 rounded-2xl border w-full text-left transition-colors ${
                    isActive
                      ? 'bg-spark-primary/10 border-spark-primary'
                      : 'bg-spark-dark border-spark-border hover:border-spark-border-light hover:bg-white/5'
                  } ${isSwitching ? 'opacity-50 pointer-events-none' : ''}`;

                  const lastUsedTs = lastUsedMap[label];
                  const subtitle = isActive
                    ? 'Currently signed in'
                    : lastUsedTs !== undefined
                      ? `Last used ${formatRelative(lastUsedTs)}`
                      : 'Tap to switch';

                  const inner = (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-spark-primary/10 flex items-center justify-center shrink-0">
                        <WalletIcon size="md" className="text-spark-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-semibold text-spark-text-primary truncate">
                          {label}
                        </div>
                        <div className="text-xs text-spark-text-muted">
                          {subtitle}
                        </div>
                      </div>
                      {isActive && (
                        <div className="w-6 h-6 rounded-full bg-spark-primary flex items-center justify-center shrink-0">
                          <CheckIcon size="sm" className="text-white" />
                        </div>
                      )}
                    </>
                  );

                  // Active row is non-interactive; non-active rows open
                  // the switch confirm.
                  return isActive ? (
                    <div key={label} className={cardClasses}>{inner}</div>
                  ) : (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setPendingSwitch(label)}
                      disabled={isSwitching}
                      className={cardClasses}
                    >
                      {inner}
                    </button>
                  );
                })}
              </div>

              {/* Add new label */}
              {!showAddForm ? (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  disabled={isSwitching}
                  className={`w-full flex items-center justify-center gap-2 p-4 bg-spark-dark border border-spark-border rounded-2xl text-spark-text-secondary hover:text-spark-text-primary hover:border-spark-border-light transition-colors ${isSwitching ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <PlusIcon size="sm" />
                  <span className="font-display font-medium">Add new label</span>
                </button>
              ) : (
                <div className="bg-spark-dark border border-spark-primary rounded-2xl p-4 space-y-3">
                  <div className="font-display font-semibold text-spark-text-primary">
                    New label name
                  </div>
                  <FormInput
                    id="new-label"
                    type="text"
                    value={newLabel}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^[a-zA-Z0-9 ]*$/.test(val) && val.length <= 24) {
                        setNewLabel(val);
                      }
                    }}
                    placeholder="e.g. Savings"
                    autoFocus
                    disabled={isSaving}
                  />
                  {isDuplicate && (
                    <p className="text-spark-error text-xs">
                      A label with this name already exists.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <SecondaryButton
                      className="flex-1"
                      onClick={() => {
                        setNewLabel('');
                        setShowAddForm(false);
                      }}
                      disabled={isSaving}
                    >
                      Cancel
                    </SecondaryButton>
                    <PrimaryButton
                      className="flex-1"
                      onClick={handleSave}
                      disabled={!canSave}
                    >
                      {isSaving ? 'Saving…' : 'Save'}
                    </PrimaryButton>
                  </div>
                </div>
              )}
            </>
          )}
      </div>

      <ConfirmDialog
        isOpen={pendingSwitch !== null}
        title="Switch label?"
        message={
          pendingSwitch
            ? `Glow will reconnect using "${pendingSwitch}". You'll be asked to authenticate with your passkey.`
            : ''
        }
        confirmLabel="Switch"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={handleConfirmSwitch}
        onCancel={() => setPendingSwitch(null)}
      />
    </SlideInPage>
  );
};

export default LabelsPage;
