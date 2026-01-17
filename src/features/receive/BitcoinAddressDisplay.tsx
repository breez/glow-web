import React, { useState, useEffect } from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  address: string | null;
  isLoading: boolean;
}

const BitcoinAddressDisplay: React.FC<Props> = ({ address, isLoading }) => {
  const { showToast } = useToast();
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    // Check if Web Share API is available (primarily mobile)
    setCanShare(typeof navigator !== 'undefined' && !!navigator.share);
  }, []);

  if (isLoading || !address) {
    return (
      <div className="text-center py-8">
        <LoadingSpinner text="Generating Bitcoin address..." />
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      showToast('success', 'Copied!');
    } catch {
      // no-op fallback
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({
        title: 'Bitcoin Address',
        text: address,
      });
    } catch (err) {
      // User cancelled or share failed - ignore
      if ((err as Error).name !== 'AbortError') {
        showToast('error', 'Failed to share');
      }
    }
  };

  // Truncate address for display: show first 10 and last 10 chars
  const truncatedAddress = address.length > 24
    ? `${address.slice(0, 12)}...${address.slice(-12)}`
    : address;

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <QRCodeContainer value={address} />

      <div className="w-full flex flex-col items-center gap-4">
        {/* Truncated address with tap to copy */}
        <button
          onClick={handleCopy}
          className="text-center font-mono text-spark-text-muted text-xs hover:text-spark-text-secondary transition-colors"
          title="Tap to copy full address"
        >
          {truncatedAddress}
        </button>
        
        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 bg-spark-violet text-white rounded-xl font-medium text-sm hover:bg-spark-violet-light transition-colors"
            title="Copy Bitcoin Address"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v7a2 2 0 002 2h6a2 2 0 002-2v-1h1a2 2 0 002-2V6l-4-4H8zm6 6h-2a2 2 0 01-2-2V4H8v1h3a1 1 0 011 1v2h2v2z"/>
            </svg>
            Copy
          </button>
          
          {canShare && (
            <button
              onClick={handleShare}
              className="flex items-center gap-2 px-4 py-2 border border-spark-border text-spark-text-secondary rounded-xl font-medium text-sm hover:text-spark-text-primary hover:border-spark-border-light transition-colors"
              title="Share Bitcoin Address"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z"/>
              </svg>
              Share
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BitcoinAddressDisplay;
