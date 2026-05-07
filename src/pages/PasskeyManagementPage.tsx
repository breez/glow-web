import React, { useCallback, useMemo, useState } from 'react';
import SlideInPage from '../components/layout/SlideInPage';
import { ConfirmDialog } from '../components/ui';
import { PasskeyIcon, CheckIcon, EyeIcon, EyeOffIcon } from '../components/Icons';
import {
  getCredentialAaguid,
  getCredentialMeta,
  getCredentialUserName,
  getHiddenCredentialIds,
  hideCredential,
  unhideCredential,
  hasPasskeyHistory,
} from '../services/passkeyService';
import { passkeyPrfProvider } from '../services/passkeyPrfProvider';
import { lookupAaguid, type AaguidProvider } from '../services/aaguidLookup';

interface PasskeyManagementPageProps {
  onBack: () => void;
  /**
   * Pin the chosen credential and route through PasskeyPage so the
   * detect flow runs the new sign-in. Receives the base64 cred ID.
   */
  onSwitchCredential: (credentialId: string) => Promise<void>;
}

interface CredentialRow {
  credentialId: string;
  provider: AaguidProvider | null;
  userName: string | undefined;
  backupEligible: boolean | undefined;
  firstSeenAt: number | undefined;
  lastSeenAt: number | undefined;
  hidden: boolean;
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

/**
 * Short-form cred ID for the unknown-provider case so users can still
 * tell credentials apart visually. First 6 + last 4 chars of the
 * base64 string is enough to disambiguate without printing 44 chars.
 */
function shortCredId(credentialId: string): string {
  if (credentialId.length <= 12) return credentialId;
  return `${credentialId.slice(0, 6)}…${credentialId.slice(-4)}`;
}

function buildCredentialRow(credentialId: string, hiddenSet: Set<string>): CredentialRow {
  const aaguid = getCredentialAaguid(credentialId);
  const provider = aaguid ? lookupAaguid(aaguid) : null;
  const beRaw = localStorage.getItem(`passkeyBackupEligible:${credentialId}`);
  const backupEligible = beRaw === '1' ? true : beRaw === '0' ? false : undefined;
  const meta = getCredentialMeta(credentialId);
  return {
    credentialId,
    provider,
    userName: getCredentialUserName(credentialId),
    backupEligible,
    firstSeenAt: meta.firstSeenAt,
    lastSeenAt: meta.lastSeenAt,
    hidden: hiddenSet.has(credentialId),
  };
}

const PasskeyManagementPage: React.FC<PasskeyManagementPageProps> = ({
  onBack,
  onSwitchCredential,
}) => {
  const [registered] = useState<boolean>(() => hasPasskeyHistory());
  const [allCredIds, setAllCredIds] = useState<string[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => getHiddenCredentialIds());
  const [showHidden, setShowHidden] = useState(false);
  const [activeCredId, setActiveCredId] = useState<string | null>(
    () => localStorage.getItem('passkeyActiveCredentialId'),
  );
  const [pendingSwitchCredId, setPendingSwitchCredId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  // One-shot async load of the persisted credential list. Native uses
  // the iCloud-synced KnownCredentialsStore; web uses localStorage.
  // Either way, the read is fast enough that the empty initial render
  // doesn't flicker noticeably.
  React.useEffect(() => {
    let cancelled = false;
    passkeyPrfProvider.getKnownCredentialIds()
      .then((ids) => { if (!cancelled) setAllCredIds(ids); })
      .catch(() => { if (!cancelled) setAllCredIds([]); });
    return () => { cancelled = true; };
  }, []);

  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const rows = useMemo(
    () => allCredIds.map((id) => buildCredentialRow(id, hiddenSet)),
    [allCredIds, hiddenSet],
  );
  const visibleRows = useMemo(
    () => rows.filter((r) => !r.hidden || showHidden),
    [rows, showHidden],
  );
  const hiddenCount = useMemo(
    () => rows.filter((r) => r.hidden).length,
    [rows],
  );

  const handleHide = useCallback((credentialId: string) => {
    hideCredential(credentialId);
    setHiddenIds(getHiddenCredentialIds());
  }, []);

  const handleUnhide = useCallback((credentialId: string) => {
    unhideCredential(credentialId);
    setHiddenIds(getHiddenCredentialIds());
  }, []);

  const handleConfirmSwitch = useCallback(async () => {
    if (!pendingSwitchCredId) return;
    setIsSwitching(true);
    try {
      await onSwitchCredential(pendingSwitchCredId);
      // Caller routes us out of this page; no need to clear pending.
    } catch {
      // Recovery: clear pending so the dialog closes; user can retry.
      setPendingSwitchCredId(null);
      setIsSwitching(false);
      setActiveCredId(localStorage.getItem('passkeyActiveCredentialId'));
    }
  }, [pendingSwitchCredId, onSwitchCredential]);

  // Pre-onboarding shell: show the original empty card.
  if (!registered || rows.length === 0) {
    return (
      <SlideInPage title="Passkey" closeStyle="back" onClose={onBack} slideFrom="right">
        <div className="p-4">
          <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-spark-primary/15 flex items-center justify-center shrink-0">
                <PasskeyIcon size="lg" className="text-spark-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-semibold text-spark-text-primary">
                  No passkey
                </div>
              </div>
            </div>
          </div>
        </div>
      </SlideInPage>
    );
  }

  return (
    <SlideInPage title="Passkey" closeStyle="back" onClose={onBack} slideFrom="right">
      <div className="p-4 space-y-3">
        {visibleRows.map((row) => {
          const isActive = row.credentialId === activeCredId;
          // Title preference, in order:
          //   1. AAGUID-resolved provider name (most recognizable).
          //   2. The user.name we cached at create / signalRename
          //      time. Our format is `Glow` (older registrations)
          //      or `Glow · <ISO timestamp>`. Split on ' · ' so
          //      the "Glow" portion drives the title and the
          //      timestamp drops into the subtitle line — keeps
          //      the title readable without rewriting the stored
          //      label, since OS Settings / OS picker still need
          //      uniqueness via the timestamp.
          //   3. Generic 'Passkey' fallback with the short cred ID
          //      as subtitle (only stable handle we have when
          //      neither provider nor user.name is available).
          let title: string;
          let subtitle: string | undefined;
          if (row.provider) {
            // Provider name in the title; the cached user.name (when
            // we have it) drops into the subtitle in full so the
            // user can still cross-reference against their OS
            // Settings / picker labels.
            title = row.provider.name;
            subtitle = row.userName;
          } else if (row.userName) {
            // No provider; split user.name on ' · ' so the 'Glow'
            // portion drives the title and the ISO timestamp drops
            // into the subtitle. Older registrations are just
            // 'Glow' with no subtitle.
            const sepIdx = row.userName.indexOf(' · ');
            if (sepIdx >= 0) {
              title = row.userName.slice(0, sepIdx);
              subtitle = row.userName.slice(sepIdx + 3);
            } else {
              title = row.userName;
              subtitle = undefined;
            }
          } else {
            // Neither provider nor cached user.name — only stable
            // handle is the cred ID short form.
            title = 'Passkey';
            subtitle = shortCredId(row.credentialId);
          }
          const handleRowClick = () => {
            if (isActive) return;
            setPendingSwitchCredId(row.credentialId);
          };
          const toggleHidden = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isActive) return;
            if (row.hidden) handleUnhide(row.credentialId);
            else handleHide(row.credentialId);
          };
          return (
            <div
              key={row.credentialId}
              role={isActive ? undefined : 'button'}
              tabIndex={isActive ? undefined : 0}
              onClick={handleRowClick}
              onKeyDown={(e) => {
                if (isActive) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleRowClick();
                }
              }}
              className={`bg-spark-dark border rounded-2xl p-4 transition-colors ${
                isActive
                  ? 'border-spark-primary/60'
                  : 'border-spark-border hover:border-spark-border-light hover:bg-white/5 cursor-pointer'
              } ${row.hidden ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-3">
                {row.provider?.iconDark ? (
                  <img
                    src={row.provider.iconDark}
                    alt=""
                    className="w-12 h-12 rounded-xl shrink-0 overflow-hidden"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-spark-primary/15 flex items-center justify-center shrink-0">
                    <PasskeyIcon size="lg" className="text-spark-primary" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold text-spark-text-primary flex items-center gap-2">
                    <span className="truncate">{title}</span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-spark-primary bg-spark-primary/15 px-1.5 py-0.5 rounded">
                        <CheckIcon size="xs" /> Active
                      </span>
                    )}
                  </div>
                  {subtitle && (
                    <div className="text-xs text-spark-text-muted font-mono mt-0.5">
                      {subtitle}
                    </div>
                  )}
                </div>
                {!isActive && (
                  <button
                    type="button"
                    onClick={toggleHidden}
                    aria-label={row.hidden ? 'Show this passkey' : 'Hide this passkey'}
                    title={row.hidden ? 'Show this passkey' : 'Hide this passkey'}
                    className="shrink-0 p-2 rounded-lg text-spark-text-muted hover:text-spark-text-secondary hover:bg-white/5 transition-colors"
                  >
                    {row.hidden ? <EyeOffIcon size="sm" /> : <EyeIcon size="sm" />}
                  </button>
                )}
              </div>

              {(row.firstSeenAt || row.lastSeenAt || row.backupEligible !== undefined) && (
                <div className="mt-4 border-t border-spark-border pt-3 space-y-1.5">
                  {row.backupEligible !== undefined && (
                    <div className="flex items-center justify-between gap-3 text-xs text-spark-text-muted">
                      <span>Sync</span>
                      <span>{row.backupEligible ? 'Across your devices' : 'This device only'}</span>
                    </div>
                  )}
                  {row.firstSeenAt && (
                    <div className="flex items-center justify-between gap-3 text-xs text-spark-text-muted">
                      <span>First sign-in</span>
                      <span>{formatTimestamp(row.firstSeenAt)}</span>
                    </div>
                  )}
                  {row.lastSeenAt && (
                    <div className="flex items-center justify-between gap-3 text-xs text-spark-text-muted">
                      <span>Last sign-in</span>
                      <span>{formatTimestamp(row.lastSeenAt)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowHidden(v => !v)}
            className="w-full py-2 text-xs text-spark-text-muted hover:text-spark-text-secondary transition-colors"
          >
            {showHidden
              ? `Hide ${hiddenCount} hidden ${hiddenCount === 1 ? 'passkey' : 'passkeys'}`
              : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'passkey' : 'passkeys'}`}
          </button>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingSwitchCredId !== null}
        title="Use this passkey?"
        message="Glow will sign you in with the selected passkey."
        confirmLabel={isSwitching ? 'Switching…' : 'Use this passkey'}
        cancelLabel="Cancel"
        variant="default"
        onConfirm={handleConfirmSwitch}
        onCancel={() => { if (!isSwitching) setPendingSwitchCredId(null); }}
      />
    </SlideInPage>
  );
};

export default PasskeyManagementPage;
