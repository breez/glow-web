import React from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer, CopyableText } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  address: string | null;
  isLoading: boolean;
}

const BitcoinAddressDisplay: React.FC<Props> = ({ address, isLoading }) => {
  const { showToast } = useToast();

  if (isLoading || !address) {
    return (
      <div className="text-center py-8">
        <LoadingSpinner text="Generating Bitcoin address..." />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <QRCodeContainer value={address} />

      <div className="w-full flex flex-col items-center gap-4">
        <CopyableText
          text={address}
          truncate
          showShare
          label="Bitcoin Address"
          onCopied={() => showToast('success', 'Copied!')}
          onShareError={() => showToast('error', 'Failed to share')}
          data-testid="bitcoin-address-text"
        />

        {/* Spacer to match Lightning tab height */}
        <div className="mt-2 h-6" aria-hidden="true" />
      </div>
    </div>
  );
};

export default BitcoinAddressDisplay;
