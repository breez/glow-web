import React from 'react';
import { useSheetFullSnap } from '../ui/sheets/BottomSheetCardContext';
import { PrimaryButton, SecondaryButton } from '../ui';
import CryptoIcon from '../CryptoIcon';
import { crossChainCardClass } from '../../utils/crossChainRoutes';

interface CrossChainAssetStepProps {
  /** Display asset names to choose from (e.g. "USDC", "USDT"). */
  assets: string[];
  /** Currently highlighted asset, or null. */
  pending: string | null;
  onPendingChange: (asset: string) => void;
  onBack: () => void;
  onContinue: () => void;
  error?: string | null;
  /** Fill the parent's height (for a fixed-height container) instead of capping
   *  against the viewport. Keeps the receive sheet a constant height across steps. */
  fill?: boolean;
}

/** Coin-selection step shared by the cross-chain send and receive workflows. */
export const CrossChainAssetStep: React.FC<CrossChainAssetStepProps> = ({
  assets,
  pending,
  onPendingChange,
  onBack,
  onContinue,
  error,
  fill = false,
}) => {
  const isSheetFull = useSheetFullSnap();
  return (
  <div
    className={`flex flex-col ${fill ? 'flex-1 min-h-0' : ''}`}
    style={fill ? undefined : { maxHeight: isSheetFull ? '85dvh' : '60dvh' }}
  >
    {error && (
      <div className="mb-4 p-3 bg-spark-warn-surface border border-spark-warn-border rounded-xl text-sm text-spark-warn-text shrink-0">
        {error}
      </div>
    )}
    {assets.length > 0 && (
      <div className="mb-4 min-h-0 flex flex-col">
        <label className="block text-sm font-medium text-spark-text-primary mb-2 shrink-0">Select coin</label>
        <div className="space-y-2 overflow-y-auto overscroll-y-none touch-pan-y min-h-0 pr-1">
          {assets.map(asset => (
            <button
              key={asset}
              onClick={() => onPendingChange(asset)}
              className={crossChainCardClass(pending === asset)}
            >
              <div className="flex items-center gap-3">
                <CryptoIcon asset={asset} size={32} />
                <span className="font-display font-medium text-spark-text-primary">{asset}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    )}
    <div className="flex gap-3 shrink-0 pt-2">
      <SecondaryButton onClick={onBack} className="flex-1">
        Back
      </SecondaryButton>
      <PrimaryButton onClick={onContinue} className="flex-1" disabled={!pending}>
        Continue
      </PrimaryButton>
    </div>
  </div>
  );
};

export default CrossChainAssetStep;
