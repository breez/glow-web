import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import SlideInPage from '../components/layout/SlideInPage';
import { ConfirmDialog } from '../components/ui';
import { TrashIcon } from '../components/Icons';
import { passkeyPrfProvider } from '../services/passkeyPrfProvider';
import {
  clearAllLabelLastUsed,
  clearAllCredentialMeta,
  clearAllHiddenCredentials,
  clearAllCredentialAaguids,
} from '../services/passkeyService';
import { useToast } from '@/contexts/ToastContext';
import { logger, LogCategory } from '@/services/logger';

interface PasskeyLocalStatePageProps {
  onBack: () => void;
  /**
   * Called after a successful Forget / Wipe so the host can route the
   * user out of the settings stack, typically to home via logout, so
   * the dev doesn't have to walk back through Settings → Passkey &
   * Labels → Wallet manually after every wipe. Not invoked by the
   * narrower Clear provider info path because that operation doesn't
   * affect home-page routing state.
   */
  onCompleted: () => void;
}

type ConfirmKind = 'forget' | 'wipe' | 'aaguids' | null;

// `passkeyHome` is where the OS keeps the passkey itself. `systemDelete`
// is the surface users navigate to remove it. The credential IDs Glow
// tracks live in our own secure storage (plugin keychain on iOS,
// Block Store + ESP on Android, localStorage on web), but the copy
// intentionally doesn't name that storage layer.
type PlatformCopy = {
  passkeyHome: string;
  systemDelete: string;
};

function getCopy(): PlatformCopy {
  switch (Capacitor.getPlatform()) {
    case 'ios':
      return {
        passkeyHome: 'iCloud Keychain',
        systemDelete: 'Settings → Passwords',
      };
    case 'android':
      return {
        passkeyHome: 'Google Password Manager',
        systemDelete: 'Google Password Manager',
      };
    default:
      return {
        passkeyHome: 'your browser or password manager',
        systemDelete: 'your browser or password manager',
      };
  }
}

const PasskeyLocalStatePage: React.FC<PasskeyLocalStatePageProps> = ({ onBack, onCompleted }) => {
  const { showToast } = useToast();
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [isWorking, setIsWorking] = useState(false);

  const copy = getCopy();

  const handleForget = () => {
    // Keep the credential-IDs registry intact so the platform-level
    // "already exists" check still refuses a duplicate Create. AAGUIDs
    // also stay — they're only captured at create time and not
    // recoverable on sign-in, so wiping them loses provider metadata
    // (name, icon) permanently for credentials that are still on the
    // device.
    localStorage.removeItem('passkeyRegistered');
    localStorage.removeItem('passkeyFirstSeenAt');
    localStorage.removeItem('passkeyLastSeenAt');
    clearAllLabelLastUsed();
    logger.warn(LogCategory.AUTH, 'User cleared passkey history (kept credential IDs and AAGUIDs)');
    showToast('success', 'Passkey history cleared');
    setConfirm(null);
    onCompleted();
  };

  const handleWipe = async () => {
    setIsWorking(true);
    let keychainCleared = true;
    try {
      await passkeyPrfProvider.clearKnownCredentialIds();
    } catch (e) {
      keychainCleared = false;
      logger.warn(LogCategory.AUTH, 'clearKnownCredentialIds threw during wipe', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    localStorage.removeItem('passkeyRegistered');
    localStorage.removeItem('passkeyKnownCredentials');
    localStorage.removeItem('passkeyActiveCredentialId');
    localStorage.removeItem('passkeyFirstSeenAt');
    localStorage.removeItem('passkeyLastSeenAt');
    clearAllLabelLastUsed();
    clearAllCredentialMeta();
    clearAllHiddenCredentials();
    // AAGUIDs intentionally kept: they're only captured at create
    // time and not recoverable on sign-in. Wiping them would lose
    // provider name/icon for any credential that still exists on the
    // device (or in iCloud Keychain / Block Store). The narrower
    // Clear provider info option below targets that case explicitly.
    logger.warn(LogCategory.AUTH, 'User performed full passkey state wipe (kept AAGUIDs)');
    if (keychainCleared) {
      showToast('success', 'Tracked passkeys wiped');
    } else {
      showToast('error', 'Partial wipe', 'Tracked passkey IDs clear failed; check logs.');
    }
    setIsWorking(false);
    setConfirm(null);
    onCompleted();
  };

  const handleClearAaguids = () => {
    // Drops every per-credential AAGUID + backupEligible entry.
    // Per-cred metadata, the credential-IDs registry, and the welcome
    // marker stay, so no sign-out is needed: only the management
    // page display surface changes (provider becomes a generic
    // 'Passkey' label until each credential is re-created).
    clearAllCredentialAaguids();
    logger.warn(LogCategory.AUTH, 'User cleared provider info (AAGUID + BE)');
    showToast('success', 'Provider info cleared');
    setConfirm(null);
  };

  const items: Array<{ kind: ConfirmKind; title: string }> = [
    { kind: 'forget', title: 'Forget history' },
    { kind: 'wipe', title: 'Wipe tracked passkeys' },
    { kind: 'aaguids', title: 'Clear provider info' },
  ];

  return (
    <SlideInPage title="Local State" closeStyle="back" onClose={onBack} slideFrom="right">
      <div className="p-4 space-y-2">
        {items.map((item) => (
          <button
            key={item.kind}
            type="button"
            onClick={() => setConfirm(item.kind)}
            className="w-full flex items-center gap-3 p-4 bg-spark-dark border border-spark-border rounded-2xl text-left hover:border-spark-border-light hover:bg-white/5 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-spark-error/10 flex items-center justify-center shrink-0">
              <TrashIcon size="sm" className="text-spark-error" />
            </div>
            <div className="font-display font-semibold text-spark-text-primary">
              {item.title}
            </div>
          </button>
        ))}
      </div>

      <ConfirmDialog
        isOpen={confirm === 'forget'}
        title="Forget history?"
        message="Glow signs you out and shows the new-user welcome screen. Tracked credential IDs and provider info are kept, so trying to create a new passkey is still refused by the OS as a duplicate."
        confirmLabel="Forget"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={handleForget}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        isOpen={confirm === 'wipe'}
        title="Wipe tracked passkeys?"
        message={`Glow signs you out and forgets the credential IDs it tracks on this device, the active selection, per-credential metadata, and the welcome-screen marker. Provider info (AAGUIDs) is kept. Your actual passkeys stay in ${copy.passkeyHome} until you remove them from ${copy.systemDelete}.`}
        confirmLabel={isWorking ? 'Working…' : 'Wipe'}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleWipe}
        onCancel={() => setConfirm(null)}
      />

      <ConfirmDialog
        isOpen={confirm === 'aaguids'}
        title="Clear provider info?"
        message='Glow forgets the provider name (AAGUID) and sync indicator for every known passkey. Sync indicator recovers on next sign-in. Provider name is captured at create time only, so existing passkeys will show "Passkey" on the management page until re-created.'
        confirmLabel="Clear"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleClearAaguids}
        onCancel={() => setConfirm(null)}
      />
    </SlideInPage>
  );
};

export default PasskeyLocalStatePage;
