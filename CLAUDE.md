# Claude Code Guidelines

## Project Overview

Glow is a Bitcoin/Lightning wallet web app built with React + TypeScript + Vite, using the Breez Spark SDK (WASM).

## Comment Style

Same standard as spark-sdk's CLAUDE.md "Comment Style" section, condensed for this repo. Applies to any new or modified comment, JSDoc, commit message, or PR description.

0. **No em-dashes or en-dashes** anywhere (code, comments, commits, PRs). Use a colon for an aside, a period between independent clauses, comma + conjunction for contrast, parentheses for a parenthetical, "to" for ranges (`3 to 5 lines`).
1. **Cut what the code already says.** Default to no comment. Add one only for a non-obvious WHY: a hidden constraint, a workaround, a subtle invariant, surprising behavior. When a signature changes, audit nearby JSDoc for params/fields that no longer exist.
2. **Compact what stays.** Target 3 to 5 lines. Longer means it wants to be a linked doc, not an inline essay. No multi-paragraph docstrings.
3. **Calibrate to the reader.** Internal `//` comments: why the code is shaped this way, for whoever maintains the file. Commit messages and PR bodies: what changed and why, not what the code looks like.
4. **Don't leak internal-looking specifics.** No production identifiers, stack-trace excerpts, or one-off debugging breadcrumbs in committed comments.
5. **Strip narrative; keep implementation facts.** No development history ("we used to..."), no PR-credit ("added for #1234"). State workarounds as present-tense facts: "Uses `bar()`: `foo()` deadlocks on the main thread." Pointers to active context are fine (an open upstream bug, a spec section, the issue a defense exists for, e.g. `(#213)`). Decision history belongs in the commit message.
6. **Frame what something IS,** not what happens downstream and not what lives elsewhere. Don't restate the type; document what `undefined`/absence means at the domain level.

## Key Paths (Hardcoded)

Assume these repos are checked out locally:

```
App:     ~/Documents/GitHub/glow-web
SDK:     ~/Documents/GitHub/spark-sdk
WASM:    ~/Documents/GitHub/spark-sdk/packages/wasm
Types:   ~/Documents/GitHub/spark-sdk/packages/wasm/bundler/breez_sdk_spark_wasm.d.ts
```

## SDK Integration

The app uses `@breeztech/breez-sdk-spark` for all wallet functionality. The SDK is a WASM module loaded at startup in `src/main.tsx`.

**Architecture — direct SDK pattern (no wrappers):**
- `src/hooks/useBreezSdk.ts` — owns the full SDK lifecycle: connect, disconnect, event listeners, mnemonic storage, data fetching
- `src/contexts/WalletContext.tsx` — provides `WalletProvider` (React context) and `useWallet()` hook
- `src/App.tsx` — wraps the app in `<WalletProvider client={sdk.sdk}>`
- Components call `useWallet()` to get the `BreezSdk` instance and call SDK methods directly

**How it works:**
```tsx
// In any component rendered after wallet connection:
import { useWallet } from '@/contexts/WalletContext';

const wallet = useWallet(); // Returns BreezSdk — guaranteed non-null

// Call SDK methods directly — no wrappers
const info = await wallet.getInfo({});
const parsed = await wallet.parse(input);
await wallet.sendPayment(preparedPayment);
```

**Key files:**
- `src/hooks/useBreezSdk.ts` — SDK lifecycle, state, event handling
- `src/contexts/WalletContext.tsx` — WalletProvider + useWallet()
- `src/main.tsx` — WASM init + app bootstrap

## Local SDK Development

When testing unreleased SDK changes (PRs, feature branches):

### Quick Setup (One Command)
```bash
# Build SDK and link to app
cd ~/Documents/GitHub/spark-sdk && git checkout <branch-name> && git pull origin <branch-name> && cd packages/wasm && make build && cd ~/Documents/GitHub/glow-web && npm link @breeztech/breez-sdk-spark
```

### Verify Link
```bash
ls -la node_modules/@breeztech/breez-sdk-spark
# Should show symlink → ../../../spark-sdk/packages/wasm
```

### After SDK Changes
```bash
cd ~/Documents/GitHub/spark-sdk/packages/wasm && make build
```

### Unlink (restore npm version)
```bash
npm unlink @breeztech/breez-sdk-spark && npm install
```

### Check SDK Types
```bash
# Find specific type definition
grep -A 10 "export interface TypeName" ~/Documents/GitHub/spark-sdk/packages/wasm/bundler/breez_sdk_spark_wasm.d.ts

# Find method signature
grep "methodName" ~/Documents/GitHub/spark-sdk/packages/wasm/bundler/breez_sdk_spark_wasm.d.ts
```

## Branch Strategy

| Branch | SDK Source | Deployment |
|--------|------------|------------|
| `main` | npm release | breez-glow.vercel.app (prod) |
| `staging` | npm pre-release | breez-glow-staging.vercel.app |
| feature branches | `npm link` local | Local dev |

## Staging Environment

- **URL**: breez-glow-staging.vercel.app
- **Password**: Set via `VITE_STAGING_PASSWORD` env var in Vercel (Preview only)
- SDK version should track latest pre-release for integration testing

## Common Tasks

### Testing an SDK PR
1. Create feature branch: `git checkout -b feat/sdk-pr-XXX-description staging`
2. Build & link SDK (use Quick Setup above)
3. Fix any breaking changes in app code
4. Test locally with `npm run dev`
5. Open **draft** PR against `staging` branch
6. Once SDK PR merges and releases, update package.json and convert to ready

### PR Naming Convention
- Branch: `feat/sdk-pr-XXX-short-description`
- PR title: `feat: short description (SDK PR #XXX)`
- PR body should link to SDK PR and note it's blocked until SDK releases

### Adding New SDK Methods
Just call them directly — no wrapper files to update:
```tsx
const wallet = useWallet();
const result = await wallet.newSdkMethod({ param: value });
```

### Adding Side Menu Items
1. Add prop to `SideMenuProps` interface in `src/components/SideMenu.tsx`
2. Add to `menuItems` array in SideMenu component
3. Add prop to `WalletPageProps` in `src/pages/WalletPage.tsx`
4. Pass prop through WalletPage to SideMenu
5. Add screen type and case in `src/App.tsx`

### Adding Passkey & Labels items

The Settings → Passkey entry opens the **Passkey & Labels** hub at `src/pages/PasskeySettingsPage.tsx`. The hub has three sub-pages:

- Passkey: `src/pages/PasskeyManagementPage.tsx`
- Labels: `src/pages/LabelsPage.tsx`
- Local State: `src/pages/PasskeyLocalStatePage.tsx`

**Screen wiring (in `src/App.tsx`):**
The screen types `'passkeySettings'`, `'passkeyManagement'`, `'labels'`, and `'passkeyLocalState'` each layer on top of `renderSettingsPage()` + `renderPasskeySettingsPage()` so the back stack stays consistent.

**Adding a new sub-page to the hub:**
1. Create the page under `src/pages/`
2. Register a row inside `PasskeySettingsPage.tsx` that navigates to the new screen
3. Add a screen type string in `src/App.tsx` and a case that renders the new page on top of `renderPasskeySettingsPage()`

**Dev gating:**
The Settings entry is gated behind `isDevMode` (toggled via `useSecretTap`). Keep new hub items dev-only until they are ready for production.

**Switching active passkey label:**
Use `sdk.switchPasskeyLabel(label)` from `useBreezSdk` to switch the active label without bouncing through the home page. This triggers a fresh PRF prompt and reconnects the SDK with the new label.

```tsx
const { sdk } = useBreezSdk();
await sdk.switchPasskeyLabel(nextLabel);
```

### Passkey Metadata

Per-device passkey metadata lives in `src/services/passkeyService.ts` and `src/services/passkeyMetadata.ts`, persisted in `localStorage`:

Device-level keys (`passkeyService.ts`):

- `passkeyRegistered`: this device has ever successfully used a passkey
- `passkeyLabel`: active wallet label for the current passkey session
- `passkeyActiveCredentialId`: the cred we last signed in with; passed back as `allowCredentials` to pin the next derive
- `passkeyFirstSeenAt` / `passkeyLastSeenAt`: device-level timestamps for the first / most recent PRF ceremony
- `passkeyPendingSwitchFromCredentialId`: the cred we were signed in with before a switch attempt, used by the switch-recovery branch in `PasskeyPage`
- `passkeyAaguid:<credId>` / `passkeyBackupEligible:<credId>`: provider AAGUID + BE flag captured at create time, drives the provider icon + sync indicator in the management page
- `passkeyLabelLastUsed:<label>`: per-label last-used timestamp, surfaces on `LabelsPage` as a relative hint

Per-credential metadata keys (`passkeyMetadata.ts`):

- `passkeyCredFirstSeenAt:<credId>` / `passkeyCredLastSeenAt:<credId>`: per-credential timestamps
- `passkeyUserName:<credId>`: per-credential picker label captured at create
- `passkeyHiddenCredentials`: JSON array of credential IDs the user opted to hide from the management page

The credential-IDs list itself is owned by the app, not the SDK (the SDK no longer tracks credentials). On web it lives in `LocalStorageCredentialRegistry` (`src/services/localStorageCredentialRegistry.ts`), one `localStorage` key per RP; on native the Capacitor passkey plugin owns it (Keychain / Block Store). Reach it via `getKnownCredentialIdsBase64()` (`passkeyService.ts`), which wraps `getPasskey().credentials().get()`.

Call `markPasskeyUsed()` after any successful PRF ceremony to update `passkeyLastSeenAt` (and seed `passkeyFirstSeenAt` on first use); `markCredentialUsed(credentialId)` does the per-credential equivalent.

### Build Notes
- `npm run dev` works with npm-linked SDK packages
- `npm run build` may fail with linked packages (vite polyfill resolution)
- Production builds require npm-published SDK version
- Type check: `npx tsc --noEmit`

## Bitcoin Symbol (₿) in Amount Displays

All sat amounts shown to the user include the ₿ symbol. Follow these conventions:

**Standard pattern** — for inline amounts (buttons, labels, breakdowns):
```tsx
<span className="inline-flex items-center">
  <span className="text-[0.8em] opacity-70 mr-px">₿</span>
  {formatWithSpaces(amount)}
</span>
```

**Balance header** — ₿ is absolutely positioned left of the centered number:
```tsx
<span className="absolute right-full top-1/2 -translate-y-1/2 mr-0.5 text-3xl text-spark-text-secondary opacity-70 font-mono">₿</span>
```

**Transaction list** — ₿ after the +/- sign:
```tsx
{isReceive ? '+' : '-'}<span className="text-[0.8em] opacity-70">₿</span>{amount}
```

**Plain text** (error messages, alerts, string props) — just prefix with `₿`:
```tsx
setError(`Amount must be at least ₿${minSats.toLocaleString()}`);
```

**Key rules:**
- Use `formatWithThinSpaces` for large text (text-4xl+), `formatWithSpaces`/`formatWithCommas` for smaller text
- Input field labels can use "sats" as a unit name (e.g., "Amount (sats)")
- Range displays and placeholders use "sats" text, not ₿

## Icons

All SVG icons live in `src/components/Icons.tsx` as named React components. **Never add inline `<svg>` elements** — always add a new component to `Icons.tsx` and import it.

```tsx
// Adding a new icon:
export const MyIcon: React.FC<IconProps> = ({ className = '', size = 'md' }) => (
  <svg className={`${sizeClasses[size]} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="..." />
  </svg>
);

// Using an icon:
import { MyIcon } from '../components/Icons';
<MyIcon size="sm" className="text-spark-primary" />
```

**Sizes:** `xs`=w-3, `sm`=w-4, `md`=w-5, `lg`=w-6, `xl`=w-8. For non-standard sizes, override via `className`.

**Note:** Animated SVGs internal to a single component (e.g., `LoadingSpinner`, `ProcessingStep`) can stay in that component. The rule applies to reusable icons — always define them in `Icons.tsx`.

## Logging Practices

The app uses a structured logging service (`src/services/logger.ts`) following OWASP guidelines.

### Log Levels
- `DEBUG`: Detailed diagnostic info (dev only)
- `INFO`: Normal operations (initialization, successful payments)
- `WARN`: Recoverable issues (validation failures, retries)
- `ERROR`: Failures requiring attention (SDK errors, payment failures)

### Categories
- `auth`: Authentication events
- `payment`: Payment operations
- `sdk`: SDK lifecycle and operations
- `ui`: User interactions
- `session`: Session start/end
- `validation`: Input validation

### Usage
```typescript
import { logger, LogCategory } from '../services/logger';

// Basic logging
logger.info(LogCategory.PAYMENT, 'Payment initiated', { type: 'lightning' });
logger.error(LogCategory.SDK, 'Operation failed', { operation: 'sendPayment', error: errorMsg });

// Security event helpers
logger.authSuccess('mnemonic');
logger.authFailure('mnemonic', 'Invalid format');
logger.paymentInitiated('lightning');
logger.paymentCompleted('lightning');
logger.paymentFailed('lightning', errorMsg);
```

### Security Rules (NEVER log)
- Mnemonics, seeds, private keys
- Passwords, passphrases
- API keys, tokens
- Payment hashes, preimages
- Full bolt11 invoices

The logger automatically redacts these if accidentally passed in context.
