// THROWAWAY: ?recovermock=<shot> mounts one screen of the Recover Funds
// walkthrough with fixture data, for screenshots. Sheets and dialogs sit over
// the wallet page as the app shows it at their moment, shot 01's by default.
import type React from 'react';
import ReactDOM from 'react-dom/client';
import {
  FOUND,
  MockProviders,
  WalletBackdrop,
  mockWalletInfo,
  stubChainBackend,
  walletShots,
  type Step,
  type WalletScene,
} from './wallet';
import { sheetScenes, sheetShots } from './sheet';
import { dialogScenes, dialogShots } from './dialogs';
import { exitScenes, exitShots } from './exit';

export const SHOT_IDS = [
  '01-wallet-row', '02-destination', '03-fee-cosigned', '04-review-cosigned', '04b-review-left-out', '05-sent',
  '06-wallet-after-cosigned', '07-review-stranded', '07b-review-no-exit-fee', '07c-running-no-exit-fee',
  '08-pending-owed', '09-pending-funded', '10-tracker-stranded', '11-archived-dialog', '12-review-mixed',
  '13-wallet-after-split', '14-review-error', '15-fee-nothing-worth', '17-tracker-bump', '18-bump-fee',
  '19-bump-review', '20-bump-sent', 'ux-13a-tracker-after-update', 'ux-13b-update-needed', 'ux-13b2-wallet-update-needed',
  'ux-13b3-updating', 'ux-13b4-update-error', 'ux-13c-wallet-landed', 'ux-13d-archived-details',
];

const STEP_TIMEOUT_MS = 10_000;
/** Long enough for a sheet to finish opening, which a tap inside it waits for. */
const STEP_SETTLE_MS = 800;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Taps each step's element once it is there and enabled. A missing one is logged, and the shot shows where it stopped. */
async function tapThrough(steps: Step[]): Promise<void> {
  for (const step of steps) {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    let target = step.find();
    while (!target || (target as HTMLButtonElement).disabled) {
      if (Date.now() > deadline) {
        console.error(`recovermock: nothing to tap for "${step.label}"`);
        return;
      }
      await sleep(50);
      target = step.find();
    }
    target.click();
    await sleep(STEP_SETTLE_MS);
  }
}

export async function mountRecoverMock(id: string): Promise<void> {
  stubChainBackend();
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
  await tapThrough(scene.steps ?? []);
}
