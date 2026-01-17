import React from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import { QRCodeContainer } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  address: string | null;
  isLoading: boolean;
}

const SparkAddressDisplay: React.FC<Props> = ({ address, isLoading }) => {
  const { showToast } = useToast();

  if (isLoading || !address) {
    return (
      <div className="text-center py-8">
        <LoadingSpinner text="Generating Spark address..." />
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

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <QRCodeContainer value={address} />

      <div className="w-full flex flex-col items-center gap-4">
        <div className="text-center font-mono text-spark-violet text-sm break-all px-2">
          {address}
        </div>
        
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-5 py-2.5 bg-spark-violet text-white rounded-xl font-medium text-sm hover:bg-spark-violet-light transition-colors"
          title="Copy Spark Address"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v7a2 2 0 002 2h6a2 2 0 002-2v-1h1a2 2 0 002-2V6l-4-4H8zm6 6h-2a2 2 0 01-2-2V4H8v1h3a1 1 0 011 1v2h2v2z"/>
          </svg>
          Copy
        </button>
      </div>
    </div>
  );
};

export default SparkAddressDisplay;
