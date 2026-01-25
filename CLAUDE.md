# Claude Code Guidelines

## Project Overview

Glow is a Bitcoin/Lightning wallet web app built with React + TypeScript + Vite, using the Breez Spark SDK (WASM).

## SDK Integration

The app uses `@breeztech/breez-sdk-spark` for all wallet functionality. The SDK is a WASM module loaded at startup.

**Key files:**
- `src/services/walletService.ts` - SDK wrapper with all wallet operations
- `src/services/WalletAPI.ts` - TypeScript interface contract
- `src/services/wasmLoader.ts` - WASM initialization

## Local SDK Development

When testing unreleased SDK changes (PRs, feature branches):

### Build & Link SDK
```bash
# 1. Switch SDK to target branch and build
cd ~/Documents/GitHub/spark-sdk
git checkout <branch-name>
git pull origin <branch-name>
cd packages/wasm && make build

# 2. Link SDK (one-time in SDK dir)
npm link

# 3. Link to app
cd ~/Documents/GitHub/breez-sdk-spark-example
npm link @breeztech/breez-sdk-spark
```

### Verify Link
```bash
ls -la node_modules/@breeztech/breez-sdk-spark
# Should show symlink → ../../../spark-sdk/packages/wasm
```

### After SDK Changes
```bash
cd ~/Documents/GitHub/spark-sdk/packages/wasm && make build
# App automatically uses updated WASM
```

### Unlink (restore npm version)
```bash
npm unlink @breeztech/breez-sdk-spark && npm install
```

### Check SDK Types
```bash
# Find type definitions for breaking changes
grep "export interface <TypeName>" ~/Documents/GitHub/spark-sdk/packages/wasm/bundler/breez_sdk_spark_wasm.d.ts
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
1. Checkout SDK PR branch, build WASM, link to app
2. Fix any breaking changes in app code
3. Test locally with `npm run dev`
4. Once confirmed working, PR can be merged on SDK side
5. After SDK release, update app's package.json and unlink

### Updating SDK Version
```bash
npm unlink @breeztech/breez-sdk-spark  # if linked
npm install @breeztech/breez-sdk-spark@<version>
```
