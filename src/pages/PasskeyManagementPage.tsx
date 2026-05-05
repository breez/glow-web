import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import SlideInPage from '../components/layout/SlideInPage';
import { PasskeyIcon } from '../components/Icons';
import { getPasskeyMeta, hasPasskeyHistory } from '../services/passkeyService';

interface PasskeyManagementPageProps {
  onBack: () => void;
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

// Hidden on web: UA heuristics can't reliably identify the credential
// provider. Third-party password managers intercept across browsers,
// and Apple's OS picker surfaces iCloud Keychain even in Chromium.
function getStorageLabel(): string | null {
  switch (Capacitor.getPlatform()) {
    case 'ios': return 'iCloud Keychain';
    case 'android': return 'Google Password Manager';
    default: return null;
  }
}

const PasskeyManagementPage: React.FC<PasskeyManagementPageProps> = ({ onBack }) => {
  const [registered] = useState<boolean>(() => hasPasskeyHistory());
  const [meta] = useState(() => getPasskeyMeta());
  const storage = getStorageLabel();
  const title = registered ? (storage ?? 'Passkey') : 'No passkey';
  const hasTimestamps = registered && (meta.firstSeenAt || meta.lastSeenAt);

  return (
    <SlideInPage title="Passkey" closeStyle="back" onClose={onBack} slideFrom="right">
      <div className="p-4 space-y-4">
        <div className="bg-spark-dark border border-spark-border rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-spark-primary/15 flex items-center justify-center shrink-0">
              <PasskeyIcon size="lg" className="text-spark-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-spark-text-primary">
                {title}
              </div>
            </div>
          </div>

          {hasTimestamps && (
            <div className="mt-4 border-t border-spark-border pt-3 space-y-1.5">
              {meta.firstSeenAt && (
                <div className="flex items-center justify-between gap-3 text-xs text-spark-text-muted">
                  <span>First sign-in</span>
                  <span>{formatTimestamp(meta.firstSeenAt)}</span>
                </div>
              )}
              {meta.lastSeenAt && (
                <div className="flex items-center justify-between gap-3 text-xs text-spark-text-muted">
                  <span>Last sign-in</span>
                  <span>{formatTimestamp(meta.lastSeenAt)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SlideInPage>
  );
};

export default PasskeyManagementPage;
