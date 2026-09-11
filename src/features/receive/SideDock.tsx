import React from 'react';
import { ChainLinkIcon, LightningBoltIcon } from '../../components/Icons';

export type BtcMode = 'lightning' | 'bitcoin';

const LABEL: Record<BtcMode, string> = { lightning: 'Lightning', bitcoin: 'On-chain' };
const other = (mode: BtcMode): BtcMode => (mode === 'lightning' ? 'bitcoin' : 'lightning');

/**
 * Lightning / on-chain switch docked beside the receive QR. Each half of
 * the 44 x 90 dock is a 44 px target; the gold thumb slides between them.
 * The test ids keep the old tab ids so e2e flows still pick a format.
 */
export const SideDock: React.FC<{ mode: BtcMode; onChange: (mode: BtcMode) => void }> = ({ mode, onChange }) => (
  <div className="relative h-[90px] w-11 rounded-[22px] border border-spark-border bg-spark-dark/50 last:justify-self-end">
    <div
      aria-hidden="true"
      className={`absolute left-[3px] top-1 size-9 rounded-full bg-spark-primary shadow-[0_0_16px_var(--glow-primary)] transition-transform duration-[320ms] ease-m3-emphasized motion-reduce:transition-none ${mode === 'bitcoin' ? 'translate-y-11' : ''}`}
    />
    {(['lightning', 'bitcoin'] as const).map((m) => (
      <button
        key={m}
        type="button"
        onClick={() => onChange(m)}
        aria-label={LABEL[m]}
        aria-pressed={mode === m}
        data-testid={m === 'lightning' ? 'lightning-tab' : 'bitcoin-tab'}
        className={`relative flex h-11 w-full items-center justify-center rounded-[22px] outline-none transition-colors duration-[320ms] focus-visible:ring-2 focus-visible:ring-spark-primary/60 ${mode === m ? 'text-black' : 'text-spark-text-muted'}`}
      >
        {m === 'lightning' ? <LightningBoltIcon size="sm" /> : <ChainLinkIcon size="sm" />}
      </button>
    ))}
  </div>
);

/**
 * Names the code on screen. The margin switches too, with no visual cue:
 * the dock stays the one visible control. Left of the code it turns over,
 * so the text runs bottom to top and its baseline still faces the code.
 */
export const SideCaption: React.FC<{ shown: BtcMode; mode: BtcMode; onChange: (mode: BtcMode) => void }> = ({ shown, mode, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(other(mode))}
    aria-label={`Switch to ${LABEL[other(mode)]}`}
    className="flex w-11 items-center justify-center self-stretch rounded-lg outline-none first:rotate-180 last:justify-self-end focus-visible:ring-2 focus-visible:ring-spark-primary/60"
  >
    <span className="text-spark-text-muted text-xs font-display font-medium tracking-widest uppercase [writing-mode:vertical-rl]">
      {LABEL[shown]}
    </span>
  </button>
);
