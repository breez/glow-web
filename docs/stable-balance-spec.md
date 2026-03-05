# Stable Balance — UI Spec

## Overview

Users can hold their balance in USD (via USDB) while continuing to send and receive in BTC. The SDK handles BTC↔USDB conversions automatically. There is a 1,000 sat minimum threshold for conversion — amounts below this remain as BTC ("change").

## 1. Mode Switching

**Location**: The balance label in `CollapsingWalletHeader` — currently reads `Balance · sats`.

**Interaction**: Tapping the label toggles between modes (same pattern as the existing fiat currency tap-to-cycle below the balance).

| Mode | Label | Main balance | Secondary line |
|------|-------|-------------|----------------|
| BTC (default) | `Balance · sats` | Sats amount (large) | Fiat equivalent (current behavior) |
| Stable | `Balance · USD` | USD amount (large) | — |

**First-time explanation**: When the user switches to stable mode for the first time, show an inline explanation text (not a tooltip) below the balance area. Something like:

> "Your balance is held in USD. Incoming BTC is automatically converted to USDB, and outgoing payments are converted back to BTC. Amounts under 1,000 sats remain as change until they accumulate. [Conversion fees](link-to-fee-info)"

This should only appear once (persist dismissal in local storage).

## 2. Change (Sub-threshold BTC)

Because BTC→USDB conversion requires a minimum of 1,000 sats, small received amounts remain unconverted. This residual BTC is referred to as "change."

**Change auto-converts**: Once accumulated change crosses 1,000 sats (e.g., from multiple small receives), the SDK converts it automatically. No manual action needed.

### Terminology

Use the term **"change"** directly in the UI — it's intuitive (maps to physical cash change) and compact.

### When to show change

- **Don't show** in the balance header when the user has a USDB balance — keep it clean.
- **Do show** when the user's entire balance is below 1,000 sats (no USDB balance exists yet). Display as e.g.: `"847 sats change"` with a brief note that it will convert once it reaches 1,000 sats.

### Change in Send flow

In `SendPaymentDialog` → `AmountStep`, if the user is in stable mode and has unconverted change:

- Show the available change amount, e.g.: `"847 sats change available"`
- The user can manually enter this amount to send it; no special quick-amount button needed.

## 3. SDK Dependencies

TBD — need to confirm which SDK APIs are available for:
- Querying USDB balance vs BTC balance separately
- Triggering or checking conversion status
- Getting the conversion threshold value (hardcoded 1,000 sats or SDK-provided?)

## 4. Files Likely Affected

- `src/components/CollapsingWalletHeader.tsx` — mode toggle, label, explanation text
- `src/features/send/steps/AmountStep.tsx` — change display
- `src/contexts/WalletContext.tsx` — expose stable balance state
- `src/services/walletService.ts` — new SDK calls for USDB balance
- `src/services/settings.ts` or local storage — persist mode preference + first-time flag
