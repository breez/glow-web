# Unilateral Exit (Recovery Mode) Spec

> The v1 design, on the SDK 0.22 API. The flow now runs on the recover funds API: see `src/features/unilateral-exit/README.md` for how it works today.

## Overview

Recovery mode lets a user move their Spark balance on-chain without the Spark operators cooperating. It is the wallet's self-custody escape hatch: a last resort for when the network is unreachable or refuses to sign withdrawals.

The SDK (pinned `@breeztech/breez-sdk-spark` 0.22.0) already ships the full API: `prepareUnilateralExit` (quote), `unilateralExit` (build + sign), `singleKeyCpfpSigner`, and the `CpfpSigner` interface. The SDK builds and signs everything but never broadcasts; the app owns funding, broadcasting, sequencing, and multi-day tracking. Exit data auto-collects during normal sync (SDK default), so wallets are already prepared.

v1 ships as a guided wizard plus a persistent tracker, entered from a dev-gated Settings row ("Recover funds on-chain"). Promotion to generally visible Settings, and contextual surfacing on operator outage, come later.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Product shape | Full guided wizard + auto-broadcast tracker | Glow's audience cannot be handed a zip of tx hexes mid-crisis; trust feature must be survivable end to end |
| CPFP fee funding | P2WPKH address derived from the wallet's own seed | No key handling by the user; change recoverable in any BIP84 wallet from the same mnemonic |
| Funding shape | Single UTXO (quote's `singleUtxoFundingSat`), fan-out accepted | One address + one amount is the simplest instruction; per-branch funding is a later optimization |
| Funding confirmation | Require 1 conf before build | Avoids an unconfirmed extra link under 1P1C package relay limits |
| Visibility | Dev-gated (secret-tap dev mode) | Repo convention for unproven features; graduate after dogfooding |
| Leaf selection | `auto` for the initial quote; `specific` (persisted leaf ids) for every resume and fee bump | SDK guidance: auto re-selection mid-exit can drop leaves waiting out timelocks |
| Exit-state backup surface (export/import) | Not in v1 | Deferred by product decision |
| Mid-exit wallet usage warnings | None | Exit context implies Spark is inoperable; nothing to warn about |
| Fee bump | In v1, as a tracker action | Same machinery as resume; without it a low-fee exit dead-ends for days |

## Background: what an exit looks like

Two SDK calls: `prepareUnilateralExit` returns a quote (`leaves`, `recoverableValueSat`, `totalFeeSat`, `singleUtxoFundingSat`, `perBranchFunding`); `unilateralExit` takes the quote + funding UTXOs + a `CpfpSigner` and returns the signed transaction set. Each `UnilateralExitTransaction` carries `kind` (fanOut | node | refund | sweep), `txHex`, optional `cpfpTxHex`, `dependsOn` (txids that must confirm first), optional `csvTimelockBlocks`, and `status` (confirmed | unconfirmed | unverified).

Broadcast rules:

- A node or refund tx pays no fee; it is broadcast together with its `cpfpTxHex` as a package via a package-relay endpoint. Fan-out and sweep pay their own fee and are broadcast alone via a plain `/tx` endpoint.
- Within a branch, one package per confirmation (1P1C mempool relay limit), even for steps with no timelock. Branches progress in parallel; the sweep goes last, after every refund confirms.
- `csvTimelockBlocks` appears on refunds (2000 blocks fresh, minus 100 per transfer since the last renewal) and also on renewal-inserted node levels (up to 2000). The scheduler must treat any tx as possibly timelocked; never assume "nodes fast, refund slow". The CSV clock starts at the parent's confirmation. Worst-case tail (just-renewed leaf): about 4 weeks. Typical fresh leaf: about 2 weeks. Well-transferred leaf: hours to days.
- `unilateralExit` is safe to re-call: confirmed steps come back as `confirmed`, unconfirmed ones are rebuilt (RBF-replacing earlier versions at the current fee rate).

## Architecture

| Piece | Path | Notes |
|---|---|---|
| Screen | `src/pages/RecoveryPage.tsx` | Full-screen `SlideInPage`; new `Screen` union member `'recovery'` in `App.tsx` (+ back-button case) |
| Wizard state | `src/features/recovery/hooks/useRecoveryFlow.ts` | Phase-machine hook, modeled on `useMigrationFlow`; page maps phase to step component |
| Step components | `src/features/recovery/steps/*.tsx` | One component per wizard phase |
| Tracker engine | `src/services/recovery/engine.ts` | Module-level singleton (same style as `appLock.ts`); owns polling, readiness, broadcasting; subscribable |
| Persisted plan | `src/services/recovery/plan.ts` | localStorage, keyed by identity pubkey + network (same style as `depositState.ts`) |
| Chain access | `src/services/esplora.ts` | Fee rates, address UTXOs, tx status, tip height, broadcast (single + package) |
| Funding key | `src/services/recovery/fundingKey.ts` | BIP84 derivation from the wallet seed; new dep `@scure/bip32` |
| Entry point | `src/pages/SettingsPage.tsx` | Dev-gated row "Recover funds on-chain" |
| Progress banner | `src/pages/WalletPage.tsx` | Warning-variant card when a plan is active: "Recovery in progress · k/n · next in ~18h"; opens RecoveryPage |

Engine start: an `App.tsx` effect starts the engine when a wallet is connected and a persisted plan exists; the wizard starts it on build completion. Both the page and the banner subscribe, so progress advances on any app open without visiting the page.

Independence property: after build, the persisted plan carries everything needed to finish (signed hexes, dependencies, timelocks). Progressing the exit needs only esplora, never the SDK or the operators. The SDK instance is required only for quote, build, and fee bump. The tracker renders from the persisted plan without awaiting sync.

## Wizard

Phases: `intro -> destination -> fee -> quote -> fund -> confirm -> build -> tracker`. State machine in `useRecoveryFlow`; every phase can be abandoned safely before `build` (nothing persisted except the funding address index; sats already sent to the funding address stay spendable from the mnemonic in any BIP84 wallet).

1. **intro**: What this is, when to use it, what is needed: Bitcoin from outside this wallet for mining fees, an on-chain destination address, and days of patience. Amber framing (house rule: no red). Points to normal withdrawal when Spark is operational.
2. **destination**: On-chain address input, validated via `wallet.parse()` against the configured network. Copy: funds land here; it must be an external address whose keys the user controls.
3. **fee**: Slow/Medium/Fast from esplora `fees/recommended` (same radio-grid UI as `BitcoinWorkflow`), plus a custom sat/vB input.
4. **quote**: Auto-runs `prepareUnilateralExit` (`selection: auto`, `fundingKind: p2wpkh`); re-runs on fee change. Shows recoverable value, total fee, funding needed, and what is left behind: wallet balance minus quoted leaves rendered as "N sats across M small leaves are not worth exiting at this rate". Guards: empty `leaves` renders "nothing is worth exiting at this fee rate" (not an error); `totalFeeSat >= recoverableValueSat` blocks progress with "wait for lower fees". All amounts via `SatAmount`.
5. **fund**: Shows the derived funding address (QR + copy) and the exact ask: `singleUtxoFundingSat` plus a ~10% buffer (fee drift; overage returns to the funding key as CPFP change, recoverable from the mnemonic in any BIP84 wallet). Polls esplora for the UTXO; requires 1 confirmation. Multiple UTXOs on the address are all collected and passed as funding inputs.
6. **confirm**: Full summary (destination, rate, recoverable, fees, funding outpoints). Gated by the `PinGate`/`ConfirmDialog` pattern used for DB export (seed-derived keys are about to be used). Duration expectation set here: "typically days, sometimes weeks; the exact schedule appears after this step".
7. **build**: `unilateralExit` with the collected `CpfpInput.p2wpkh` inputs and `singleKeyCpfpSigner(fundingKey)`. On success: persist the plan, start the engine, enter the tracker. Errors map to actions (see Error handling).

## Tracker

Renders the plan as a staged timeline: fan-out, then branch packages grouped per branch, then refund timelocks, then sweep. Header: "k of n confirmed" plus next-action ETA computed from the critical path. Per-tx rows: kind, short txid linking to the explorer, status chip (waiting on deps | timelock countdown | ready | broadcast | confirmed | failed), and for timelocked rows a live countdown ("broadcastable in ~2d 4h").

### Engine rules

- Poll cadence: on start, on the `foregroundResync` visibility signal, and every 30s while the app is open. Sources: `/blocks/tip/height`, `/tx/:txid/status`.
- Readiness: a tx is broadcastable when every `dependsOn` txid is confirmed and, if `csvTimelockBlocks` is set, `tip - maxDepConfirmationHeight >= csv` (implementation adds a +1 block margin to avoid non-BIP68-final rejections).
- Broadcast: `[txHex, cpfpTxHex]` as a package when `cpfpTxHex` is present, single `/tx` otherwise. Already-`confirmed` steps are skipped.
- Failures: per-row error with manual retry; automatic retry with backoff for transient network errors. "min relay fee not met" surfaces the fee-bump suggestion; "non-BIP68-final" recomputes the countdown.
- Completion: sweep confirmed. Success state with total recovered and explorer link; plan archived (small local history), banner cleared.

### Resume

On every engine start: re-check statuses of the persisted signed set and broadcast whatever became ready. No signing, no SDK, no gate.

### Fee bump (tracker action)

Re-quote with `selection: specific` (persisted leaf ids) at a higher rate, then `unilateralExit` again behind the PinGate. Unconfirmed steps are rebuilt and RBF-replace their earlier versions; confirmed steps return free. `InsufficientCpfpFunds` after a confirmed fan-out routes to a top-up: the confirmed fan-out/CPFP outputs (they pay to the funding key) are passed back as funding inputs first, plus fresh funding to the same address if still short.

### Export package (tracker escape valve)

Always available: downloads a zip (reusing the `logExport.ts` plumbing) of ordered tx hexes with a README of `submitpackage` instructions and the dependency order. This is the fallback if in-app package broadcasting is unavailable.

## Funding key derivation

- Path: `m/84'/0'/0'/0/i` on mainnet, `m/84'/1'/0'/0/i` otherwise; `i` is a persisted per-wallet counter, incremented per exit (address stays stable within one exit, including top-ups).
- Source: the wallet mnemonic (`bip39` dep exists; add `@scure/bip32`). Seed access follows the same ceremony as other sensitive actions (PinGate).
- The signer is the SDK's `singleKeyCpfpSigner(secretKeyBytes)`; the app never implements PSBT logic.

## Persistence

```ts
type RecoveryPlan = {
  version: 1;
  createdAt: number;
  network: string;
  destination: string;
  feeRateSatPerVbyte: number;
  leafIds: string[];              // from the original quote; used for every resume/bump
  recoverableValueSat: number;
  totalFeeSat: number;
  fundingAddressIndex: number;
  fundingUtxos: { txid: string; vout: number; value: number }[];
  transactions: {
    txid: string;
    kind: 'fanOut' | 'node' | 'refund' | 'sweep';
    nodeId?: string;
    txHex: string;
    cpfpTxHex?: string;
    dependsOn: string[];
    csvTimelockBlocks?: number;
    status: 'pending' | 'broadcast' | 'confirmed' | 'failed';
    confirmationHeight?: number;
    lastError?: string;
  }[];
  phase: 'active' | 'complete';
};
```

Stored in localStorage keyed by `recovery-plan:<pubkeyHash>:<network>` (`pubkeyHash` as in `logExport.ts`). Build and bump map the SDK's per-tx status to the plan: `confirmed` stays `confirmed`, everything else starts as `pending`. A fee bump overwrites `transactions` with the rebuilt set (confirmed entries keep their status).

## Esplora service

Endpoints (mempool.space API shape): `GET /api/v1/fees/recommended`, `GET /api/address/:addr/utxo`, `GET /api/tx/:txid/status`, `GET /api/blocks/tip/height`, `POST /api/tx`, and the package submit endpoint. Base URL is a per-network constant (mainnet: mempool.space; regtest: configurable in dev settings). `GetRefundPage`'s hardcoded fee estimates can later migrate to this service (not in scope).

## Error handling

| Error | Where | Handling |
|---|---|---|
| Empty `leaves` in quote | quote | Informative terminal state, not an error |
| `totalFeeSat >= recoverableValueSat` | quote | Block progress; suggest waiting for lower fees |
| Sweep below dust limit | build | Suggest lower fee rate or waiting; explain thin margin |
| `InsufficientCpfpFunds` | build / bump | Route back to fund step (same address) showing the shortfall |
| `FundingUtxoConflict` | build / bump | Names the spent outpoint; request fresh funding |
| Package rejected: min relay fee | broadcast | Suggest fee bump |
| Package rejected: non-BIP68-final | broadcast | Recompute countdown; do not surface as failure |
| Tx `status: unverified` from SDK | build | Treat as unconfirmed; engine's own esplora check resolves it |
| Esplora unreachable | anywhere | Offline banner pattern; engine retries with backoff; export valve remains available |

## Testing

- Vitest pure-function tests: readiness computation (dependsOn + CSV + heights, the +1 margin), plan (de)serialization, derivation vectors (BIP84 known-answer), funding sufficiency math.
- Engine tests with a mocked esplora fetch: broadcast ordering across a two-branch plan, package vs single selection, retry/backoff, completion detection.
- Manual regtest checklist against the SDK's docker fixtures: full exit, resume after reload mid-exit, fee bump, top-up after `InsufficientCpfpFunds`, export valve.
- No Playwright coverage in v1 (would require mocking the SDK boundary).

## Out of scope (v1)

Outage detection/banner (`getSparkStatus`), exit-state export/import backup surface, per-branch funding, user-facing leaf cherry-picking, P2TR or custom funding, webhooks/background work, promotion out of dev mode.

## Prerequisites and risks

1. **CORS spike (blocking)**: confirm mempool.space's package submit endpoint is callable from a browser, and its exact request shape. If blocked, v1 broadcasts fan-out and sweep in-app and routes packages through the export valve until a Breez-hosted relay or proxy exists.
2. **Offline-operator smoke test**: verify quote + build succeed with operators unreachable on regtest (SDK docs say they read local data only; confirm in the app context).
3. **Seed availability**: confirm funding-key derivation works for every seed tier (device vault, biometric, legacy localStorage, passkey PRF); the flow needs seed material at build and bump only.

## House rules checklist

Amber for danger framing (no red); all sat amounts through `SatAmount`; new icons into `Icons.tsx`; sheets over the SlideInPage use `zIndex >= 70`; no em-dashes anywhere; `holdIdleLock()` during build; screen-capture protection is not required (no secrets rendered).
