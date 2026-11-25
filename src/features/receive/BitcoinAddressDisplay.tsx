import React from 'react';
import { QRCodeContainer, QrPlaceholder, CopyableText } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from 'react-i18next';

interface Props {
  address: string | null;
  isLoading: boolean;
  /** The QR slot beside the side dock, or the address and actions under it. */
  section: 'qr' | 'details';
  qrSize?: number;
  qrCardClassName?: string;
}

const BitcoinAddressDisplay: React.FC<Props> = ({ address, isLoading, section, qrSize, qrCardClassName }) => {
  const { t } = useTranslation('common');
  const { showToast } = useToast();

  if (section === 'qr') {
    // Rarely seen: the address is prefetched on open and the turn waits for it.
    // This is the long-tail fallback, where the turn ran out before it landed.
    return !isLoading && address
      ? <QRCodeContainer value={address} size={qrSize} cardClassName={qrCardClassName} />
      : <QrPlaceholder size={qrSize} cardClassName={qrCardClassName} />;
  }

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {!isLoading && address ? (
        <CopyableText
          text={address}
          truncate
          showShare
          label={t('receive.bitcoinAddress')}
          onCopied={() => showToast('success', t('actions.copied'))}
          onShareError={() => showToast('error', t('labels.shareFailed'))}
          data-testid="bitcoin-address-text"
        />
      ) : (
        <div className="flex flex-col items-center gap-4" aria-hidden="true">
          <div className="h-4 w-48 rounded-full bg-white/5" />
          <div className="flex gap-2">
            <div className="h-[38px] w-[92px] rounded-xl bg-white/5" />
            <div className="h-[38px] w-[100px] rounded-xl bg-white/5" />
          </div>
        </div>
      )}

      {/* Spacer to match Lightning tab height */}
      <div className="mt-2 h-6" aria-hidden="true" />
    </div>
  );
};

export default BitcoinAddressDisplay;
