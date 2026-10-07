// THROWAWAY: ?recovermock=<shot> mounts one screen of the Recover Funds
// walkthrough with fixture data, for screenshots. Sheets and dialogs sit over
// the wallet page as the app shows it at their moment, shot 01's by default.
import type React from 'react';
import ReactDOM from 'react-dom/client';
import { FOUND, MockProviders, WalletBackdrop, mockWalletInfo, walletShots, type WalletScene } from './wallet';
import { sheetScenes, sheetShots } from './sheet';
import { dialogScenes, dialogShots } from './dialogs';
import { exitScenes, exitShots } from './exit';
import { FEE_RATES } from './fixtures';

export const SHOT_IDS = [
  '01-wallet-row', '02-destination', '03-fee-cosigned', '04-review-cosigned', '05-sent',
  '06-wallet-after-cosigned', '07-review-stranded', '08-pending-owed', '08b-pending-owed-advanced',
  '09-pending-funded', '10-tracker-stranded', '11-archived-dialog', '12-review-mixed',
  '13-wallet-after-split', '14-review-error', '15-fee-nothing-worth', '17-tracker-bump',
  '18-bump-fee', '19-bump-review', '20a-dev-exit-quote-today', '20b-dev-exit-quote-proposed',
  'ux-01-intro', 'ux-02-destination', 'ux-03-fee', 'ux-04-quote', 'ux-05-pending-owed', 'ux-06-pending-funded',
  'ux-07-tracker', 'ux-08-wallet-exit-running', 'ux-09-wallet-after-exit-recoverable',
  'ux-09a-recover-destination', 'ux-09b-recover-fee', 'ux-09c-recover-review', 'ux-09d-recover-sent',
  'ux-09e-wallet-after-recover', 'ux-10-archived-dialog',
  'ux-11-intro-with-recoverable', 'ux-11-quote-with-recoverable', 'ux-11a-pending-with-recoverable', 'ux-11b-tracker-with-recoverable', 'ux-11d-wallet-running', 'ux-11e-wallet-landed',
  'ux-11c-archived-with-recoverable',
  'ux-13a-tracker-after-update', 'ux-13b-update-needed', 'ux-13b2-wallet-update-needed', 'ux-13c-wallet-landed',
  'ux-13d-archived-details',
];

/** The exit's fee step reads mempool.space; the shots answer with the fixture's rates. */
function stubFeeRates(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.endsWith('/v1/fees/recommended')) return realFetch(input, init);
    const body = { fastestFee: FEE_RATES.fast, halfHourFee: FEE_RATES.medium, hourFee: FEE_RATES.slow };
    return Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
  };
}

export async function mountRecoverMock(id: string): Promise<void> {
  const overlays: Partial<Record<string, React.FC>> = { ...sheetShots, ...dialogShots, ...exitShots };
  const scenes: Partial<Record<string, WalletScene>> = { ...walletShots, ...sheetScenes, ...dialogScenes, ...exitScenes };
  const Overlay = overlays[id];
  const scene = scenes[id] ?? (Overlay ? FOUND : undefined);
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  if (!scene) {
    root.render(<p style={{ color: '#d4a574', padding: 24 }}>No shot "{id}". Known: {SHOT_IDS.join(', ')}</p>);
    return;
  }
  stubFeeRates();
  // The page's first render already reads the engine state.
  scene.seed?.();
  const walletInfo = mockWalletInfo(scene.recoverableFundsSats, scene.balanceSats);
  root.render(
    <MockProviders walletInfo={walletInfo}>
      <WalletBackdrop scene={scene} />
      {Overlay && <Overlay />}
    </MockProviders>,
  );
}
