import React from 'react';

interface CurrencySwitcherProps {
  isTokenMode: boolean;
  tokenSymbol: string;
  onSwitch: () => void;
  disabled?: boolean;
}

const CurrencySwitcher: React.FC<CurrencySwitcherProps> = ({
  isTokenMode,
  tokenSymbol,
  onSwitch,
  disabled,
}) => (
  <button
    type="button"
    onClick={onSwitch}
    disabled={disabled}
    // `pointer-events-none` when disabled, or it still lights on hover and
    // shrinks on press: a control that names the unit and cannot change it
    // should not answer to a tap at all.
    className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 active:scale-95 text-sm font-medium text-spark-text-secondary hover:text-spark-text-primary transition-all disabled:opacity-50 disabled:pointer-events-none"
  >
    {isTokenMode ? tokenSymbol : '₿'}
  </button>
);

export default CurrencySwitcher;
