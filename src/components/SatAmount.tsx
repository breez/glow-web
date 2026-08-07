import React from 'react';
import { formatWithSpaces } from '../utils/formatNumber';

/**
 * A sat amount: the ₿ symbol followed by space-grouped thousands.
 *
 * Owns the mono font together with the `word-spacing` that corrects it. Mono
 * gives a space a full character cell, and -0.4em is calibrated against that,
 * so a caller must never be able to set one without the other. Inherits its
 * size, so wrap it to scale.
 *
 * Two displays stay hand-rolled: the balance header positions ₿ absolutely and
 * tightens via `.balance-display`, and the transaction list's token rows carry
 * a symbol that varies per asset.
 */
export const SatAmount: React.FC<{ sats: number | bigint; className?: string }> = ({ sats, className = '' }) => (
  <span className={`inline-flex items-center font-mono [word-spacing:-0.4em] ${className}`}>
    <span className="text-[0.8em] opacity-70 mr-px">₿</span>
    {formatWithSpaces(sats)}
  </span>
);

export default SatAmount;
