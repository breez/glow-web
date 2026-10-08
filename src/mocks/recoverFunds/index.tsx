// THROWAWAY: ?recovermock=<shot> mounts one screen of the Recover Funds
// walkthrough with fixture data, for screenshots. Sheets and dialogs sit over
// the wallet page as the app shows it at their moment, shot 01's by default.
import type React from 'react';
import ReactDOM from 'react-dom/client';
import { FOUND, MockProviders, WalletBackdrop, mockWalletInfo, walletShots, type WalletScene } from './wallet';
import { sheetScenes, sheetShots } from './sheet';
import { dialogScenes, dialogShots } from './dialogs';
import { exitScenes, exitShots } from './exit';

export const SHOT_IDS = [
  '01-wallet-row', '02-destination', '03-fee-cosigned', '04-review-cosigned', '04b-review-left-out', '05-sent',
  '06-wallet-after-cosigned', '07-review-stranded', '07b-review-no-exit-fee', '07c-running-no-exit-fee',
  '08-pending-owed', '09-pending-funded', '10-tracker-stranded', '11-archived-dialog', '12-review-mixed',
  '13-wallet-after-split', '14-review-error', '15-fee-nothing-worth', '17-tracker-bump', '18-bump-fee',
  '19-bump-review', 'ux-13a-tracker-after-update', 'ux-13b-update-needed', 'ux-13b2-wallet-update-needed',
  'ux-13c-wallet-landed', 'ux-13d-archived-details',
];

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
