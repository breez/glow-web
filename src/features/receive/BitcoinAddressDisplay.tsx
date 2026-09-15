import React from 'react';
import { QRCodeContainer, QrPlaceholder, CopyableText } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  address: string | null;
  isLoading: boolean;
  /** The QR slot beside the side dock, or the address and actions under it. */
  section: 'qr' | 'details';
  qrSize?: number;
  qrCardClassName?: string;
}

const BitcoinAddressDisplay: React.FC<Props> = ({ address, isLoading, section, qrSize, qrCardClassName }) => {
  const { showToast } = useToast();

  if (section === 'qr') {
    // A placeholder, not a spinner: the card's turn already covers most of the wait.
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
          label="Bitcoin Address"
          onCopied={() => showToast('success', 'Copied!')}
          onShareError={() => showToast('error', 'Failed to share')}
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
