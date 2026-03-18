# Claude Code Guidelines

## Project Overview

Glow is a Bitcoin/Lightning wallet web app built with React + TypeScript + Vite, using the Breez Spark SDK (WASM).

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

### Build Notes
- `npm run dev` works with npm-linked SDK packages
- `npm run build` may fail with linked packages (vite polyfill resolution)
- Production builds require npm-published SDK version
- Type check: `npx tsc --noEmit`

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
