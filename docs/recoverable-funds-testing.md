# Recoverable Funds Testing

Recover Funds sends funds that have left the Spark balance to a Bitcoin address
you choose. Funds leave the balance when someone else puts part of the wallet's
tree on-chain, for example the operators' watchtower.

This guide walks through every case on local regtest. Each case gives its
setup, the steps, and the text each screen should show. Its unhappy paths
follow, each with the command that forces it.

## Before you start

### What you need

- Docker, running.
- `docker login ghcr.io` with an account that can read
  `ghcr.io/breez/spark-operator`. The first `regtest:up` builds the operator
  images from it.
- A Rust toolchain. The first `regtest:up` builds the cluster runner, which
  takes a few minutes.
- Node 24.

### Start the environment

```
npm run regtest:up
npm run dev
```

Restart `npm run dev` if it was already running. The cluster's ports change on
every `regtest:up`, and Vite reads them only at start.

Open http://localhost:5173/?network=regtest and restore the test wallet:

```
legal winner thank year wave sausage worth useful legal winner thank yellow
```

Every setup command below gives funds to this wallet.
[local-regtest/README.md](../local-regtest/README.md) explains the environment.

### Rules for test wallets

- Keep test wallets away from Send. There is no Spark service provider (SSP)
  locally, so preparing a send can lock the wallet's funds for about 10 minutes.
- Turn on dev mode for Case 1 only: tap the version line at the bottom of
  Settings 5 times. Recover Funds needs no dev mode.
- Glow checks a running recovery every 5 seconds on regtest. If nothing moves,
  mine more blocks.
- The explorer at http://localhost:3001 shows what happened on-chain.
- To start over, run `npm run regtest:down` and `npm run regtest:up`, restart
  `npm run dev`, and clear the site's data in the browser. Glow keeps its
  recovery records in the browser, and a fresh chain does not match them.

### Helper commands

| Command | What it does |
|---|---|
| `npm run regtest:recoverable -- <cosigned\|exit-fee\|both> [sats]` | gives the wallet funds to recover |
| `npm run regtest:operators -- down\|up` | cuts Glow off from the operators, or reconnects it |
| `npm run regtest:indexer -- down\|up` | stops or starts the chain indexer Glow reads |
| `npm run regtest:send -- <addr> <sats> [--no-mine]` | sends coins and confirms them, or leaves them unconfirmed |
| `npm run regtest:hold -- [txid...]` | keeps those transactions, or the whole mempool, out of blocks |
| `npm run regtest:release` | lets every held transaction into blocks again |
| `npm run regtest:mine -- <blocks>` | mines blocks |
| `npm run regtest:address` | gives a fresh address to recover to |

`regtest:recoverable` sends the wallet a leaf, waits until Glow has picked it
up, then has the watchtower move it on-chain:

- `cosigned`: the operators co-sign the recovery, so it needs no exit fee.
- `exit-fee`: the recovery needs an exit fee from another wallet.
- `both`: one of each.

Open Glow with the test wallet while it runs. It waits up to 10 minutes for
Glow to pick up the leaf, then prints what the Recoverable Funds row should
show. The co-signed leaf is ₿200 000 and the exit-fee leaf is ₿150 000, unless
you pass `sats`.

`regtest:operators -- down` stops only the proxy the browser uses. The other
regtest commands still reach the operators during the outage. After every
outage, run the same command with `up`.

## Case 1: recoverable funds inside your own unilateral exit

The watchtower moves a leaf on-chain while your unilateral exit is running.
Glow folds the leaf back into the unilateral exit as a co-signed recovery.

**Setup.** The leaf must be in the wallet when the unilateral exit starts, so
this case runs the scenario commands one at a time.

```
npm run regtest:fund -- 200000 2
npm run regtest:renewed-leaf -- 200000
```

Open Glow and wait until the balance includes the new leaf. Then run:

```
npm run regtest:parent-exit
npm run regtest:address
```

`regtest:parent-exit` refuses a leaf that Glow has not picked up yet. If it
does, wait for the balance and run it again.

**Steps**

1. Turn on dev mode. In Settings, tap Start Unilateral Exit. Enter the address,
   pick a rate, tap Get Quote, then tap Continue.
   Glow shows "Send from another wallet" with ₿X and a QR code,
   "Exit fee address" and "Waiting for your payment".
2. Pay the exit fee with `npm run regtest:send -- <exit fee address> <X>`.
   Tap Exit Spark.
   Glow shows "Building and signing the exit...", then the tracker:
   "Processing", "Days left", "Processed transactions", "Processed sats" and
   "Current status". The note below them reads "You can close this. Open Glow
   regularly until the exit finishes."
3. Wait about 5 seconds for the first transaction to go out. Close Glow. Run
   `npm run regtest:watchtower-exit`. It mines past the watchtower's timelock
   in one go, so the watchtower wins. Reopen Glow.
4. No card appears: Glow rebuilds the unilateral exit on its own.
   "Current status" shows "Updating automatically" for a moment. The wallet
   list row reads "Transactions in progress" and "N of M processed". The leaf
   comes back as a co-signed recovery inside the unilateral exit. It never
   shows as Recoverable Funds.
5. Mine to the end with `npm run regtest:mine -- 2016`.
   The sheet closes and the row becomes "BTC Transfer". Its details show
   "Unilateral Exit", "Received", "Balance Exited", "Exit Fee Paid" and
   "Unspent Exit Fee".

**Unhappy paths**

- **Update needed.** Glow asks for a tap when its rebuild keeps failing across
  a block. In step 3, close Glow, run `npm run regtest:operators -- down`, then
  run `npm run regtest:watchtower-exit`. Reopen Glow and run
  `npm run regtest:mine -- 1`.
  Expect the card "Some of your funds were moved on-chain to keep them safe.
  Please update your unilateral exit to recover all your funds.", the header
  "Paused", the status "Update needed" and the button "Update & Continue Exit".
  The wallet list row reads "Update needed" and "Tap to update". Forcing this
  through the proxy is racy, so it can take more than one try.
- **Update while the operators are down.** With the card showing, tap
  Update & Continue Exit.
  Expect "Updating...", then "Could not update the exit" and "Please try again
  or choose a different fee.", with a Choose a Different Fee button. Run
  `npm run regtest:operators -- up` and tap Update & Continue Exit again.
- **Sheet closed or page reloaded.** Close the sheet or reload the page while
  the unilateral exit runs. Reopening it lands on the tracker.
- **Indexer down.** Run `npm run regtest:indexer -- down`. The tracker stops
  moving and shows no error. That is by design: Glow logs it. Run
  `npm run regtest:indexer -- up` and the tracker moves again.

## Case 2a: the Recoverable Funds row

**Setup**

```
npm run regtest:recoverable -- cosigned
```

**Steps**

1. Open the wallet list, without dev mode.
   A row "Recoverable Funds" shows ₿200 000 and "Tap to recover". Its group
   heading reads "Recovery".
2. Check the heading again on a wallet that has started a unilateral exit
   (Case 1). It reads "Unilateral Exit".

**Other states**

- **A pending unilateral exit or recovery** (Case 2c, step 2): the row is
  hidden.
- **A unilateral exit running** (Case 1, after step 2): run
  `npm run regtest:recoverable -- cosigned`. The row shows only the new funds,
  without "Tap to recover".
- **Funds the running unilateral exit covers** (Case 1, step 4): the row never
  lists them.

## Case 2b: funds the operators co-sign

**Setup**

```
npm run regtest:recoverable -- cosigned
npm run regtest:address
```

**Steps**

1. Tap the Recoverable Funds row.
   The sheet "Recover Funds" opens on the address field. Tapping Continue with
   the field empty shows "Enter a Bitcoin address". A Spark address or a
   Lightning invoice shows "That is not an on-chain Bitcoin address".
2. Paste the address and tap Continue. Pick a rate and tap Get Quote.
   Glow shows "Reading current fee rates...", then "Working out what can be
   recovered...". The review shows "You'll receive", "To address", "Funds" and
   "Network fee", with the button "Recover Funds".
3. Tap Recover Funds.
   Glow shows "Building and signing the recovery...", then "Funds sent" and
   "₿X on its way". Tap Done. The wallet list row reads "BTC Transfer" and
   "Waiting for a confirmation".
4. Run `npm run regtest:mine -- 1`.
   The row becomes a finished "BTC Transfer". Its details show "Recovery",
   "Received" and "Funds Recovered".

**Unhappy paths**

- **Operators down before the quote.** Run `npm run regtest:operators -- down`,
  then tap Get Quote.
  Expect "Could not quote the recovery" with the SDK's error text, and only a
  Back button.
- **Operators down after the quote.** Tap Get Quote, run
  `npm run regtest:operators -- down`, then tap Recover Funds.
  Expect "Could not recover the funds" and "Please try again.".
- **Sheet closed during the build.** Tap Recover Funds and close the sheet
  while "Building and signing the recovery..." shows.
  Glow keeps the recovery, and its "BTC Transfer" row appears.

## Case 2c: funds that need an exit fee

**Setup**

```
npm run regtest:recoverable -- exit-fee
npm run regtest:address
```

**Steps**

1. Tap the row, enter the address, pick a rate and tap Get Quote.
   The review adds a highlighted "Exit fee" and "To start the recovery you need
   to pay the exit fee from another wallet. These are the mining fees that move
   your funds on-chain, which takes several days." The button reads "Continue".
2. Tap Continue. If you set a PIN, enter it at "Recover funds".
   Glow shows "Send from another wallet" with ₿X and a QR code,
   "Exit fee address" and "Waiting for your payment". Advanced holds
   "Save exit data", "Restore exit data" and "Cancel recovery". The wallet list
   row reads "Waiting for exit fee" and "Send ₿X to start".
3. Pay part of it with `npm run regtest:send -- <exit fee address> <Y>`, where
   Y is less than X.
   Glow shows "₿Y received". The row reads "Send ₿Z more", where Z is X minus Y.
4. Pay the rest without mining:
   `npm run regtest:send -- <exit fee address> <Z> --no-mine`.
   Glow shows "Exit fee received", "Waiting for a confirmation" and "You can
   close this. Come back to start the recovery once the fee confirms." The row
   reads "Exit fee sent" and "Waiting for a confirmation".
5. Run `npm run regtest:mine -- 1`.
   The row reads "Exit fee received" and "Tap to start", and the button reads
   "Recover Funds". Tap it. The tracker opens with "You can close this. Open
   Glow regularly until the recovery finishes."
6. Run `npm run regtest:mine -- 2016`.
   The row becomes a finished "BTC Transfer". Its details show "Recovery",
   "Funds Recovered" and "Exit Fee Paid".

**Unhappy paths**

- **Indexer down at the start.** In step 5, once the button reads
  Recover Funds, run `npm run regtest:indexer -- down`. Then tap Recover Funds.
  Expect "Nothing can be recovered right now" and "Try again later.", with the
  Recover Funds button still there. Run `npm run regtest:indexer -- up` and tap
  it again. If Glow shows "Could not start the recovery" with the SDK's error
  text instead, the SDK failed rather than skipped the funds. The button stays
  in both cases. Note which one you saw.
- **Nothing worth moving at the start.** Expect "Nothing is worth recovering
  right now" and "At N sat/vB these funds would cost more to move on-chain than
  they are worth. Cancel the recovery under Advanced and start again at a lower
  rate. The fee you sent counts toward it." The row reads "Nothing to recover"
  and "Tap to cancel". No helper forces this: the start quotes again at the
  rate the review accepted.
- **Page reloaded while pending.** Reload in step 2 or 3. The pending recovery
  is still there, with its amounts.
- **Recovery cancelled.** In step 2 or later, tap Cancel recovery under
  Advanced. The sheet closes. Coins already sent stay at the exit fee address
  for the next recovery (Case 2d).
- **Watchtower wins while the recovery runs.** This needs a leaf the
  watchtower has not moved yet, so it uses the scenario commands:

  ```
  npm run regtest:renewed-leaf -- 200000
  npm run regtest:parent-exit
  ```

  Run `regtest:parent-exit` once Glow shows the leaf in the balance. Then
  recover the funds as in steps 1 to 5. Once the tracker opens, wait about
  5 seconds, close Glow, run `npm run regtest:watchtower-exit`, and reopen it.
  Expect the same as Case 1, step 4. To force the card, take the operators down
  as in Case 1. The card then reads "Some of your funds were moved on-chain to
  keep them safe. Please update your recovery to recover all your funds." and
  the button reads "Update & Continue Recovery".

## Case 2d: no exit fee to send

The exit fee address is shared, and it already holds enough from an earlier
recovery.

**Setup.** Run Case 2c to step 2 and pay the full amount with
`npm run regtest:send -- <exit fee address> <X>`. Then tap Cancel recovery
under Advanced.

**Steps**

1. Tap the Recoverable Funds row again. Enter the address, pick the same rate
   and tap Get Quote.
   The review still shows the exit fee line. This is a known gap.
2. Tap Continue.
   The pending screen opens on "Exit fee received", with the button
   "Recover Funds" and nothing to send. The row reads "Exit fee received" and
   "Tap to start".
3. Tap Recover Funds and finish as in Case 2c, steps 5 and 6.

**Unhappy paths.** The same as in Case 2c.

## Case 2e: both at once

**Setup**

```
npm run regtest:recoverable -- both
npm run regtest:address
```

**Steps**

1. Tap the row, which shows ₿350 000. Enter the address, pick a rate and tap
   Get Quote.
   The review shows "Funds", "Network fee" and "Exit fee", and "₿x goes to this
   address now. The other ₿y needs the exit fee from another wallet, then takes
   several days." The button reads "Recover Funds".
2. Tap Recover Funds.
   The co-signed part goes out first: a row "BTC Transfer" with "Waiting for a
   confirmation" appears. If you set a PIN, enter it. The pending screen then
   asks for the exit fee for the rest.
3. Finish the rest as in Case 2c, from step 2.

**Unhappy paths**

- **Operators refuse to co-sign.** Tap Get Quote, run
  `npm run regtest:operators -- down`, then tap Recover Funds.
  Expect "Could not recover the funds" and "Please try again." on every try.
  The exit-fee part cannot start either. This is a known gap.
- **Sheet closed after the co-signed part.** Close the sheet once the
  "BTC Transfer" row appears.
  The Recoverable Funds row then shows only the exit-fee part, ₿150 000.

## Case 2f: nothing co-signed, or nothing to recover

Each check has its own setup. Regtest fee rates are flat, so two of them fake a
rate on `/v1/fees/recommended`: use a Playwright route, or a response override
in Chrome DevTools (Network panel, right-click the request, Override content).

- **Nobody co-signed.** Run `npm run regtest:recoverable -- cosigned`. Tap
  Get Quote, run `npm run regtest:operators -- down`, then tap Recover Funds.
  Expect "Could not recover the funds" and "Please try again.".
- **The fee eats the funds.** Run `npm run regtest:recoverable -- cosigned`.
  Fake a rate of about 50 000 sat/vB, then tap Get Quote.
  Expect "Nothing is worth recovering right now" and "At today's fee rates
  these funds would cost more to move on-chain than they are worth. Try again
  once the network is cheaper."
- **Indexer down at the quote.** Run `npm run regtest:recoverable -- cosigned`,
  then `npm run regtest:indexer -- down`, then tap Get Quote.
  Expect "Nothing can be recovered right now" and "Try again later.". If Glow
  shows "Could not quote the recovery" instead, the SDK failed rather than
  skipped the funds. Note which one you saw.
- **Already recovered.** Run `npm run regtest:recoverable -- cosigned`. Open
  the wallet in two browser tabs: http://localhost:5173/?network=regtest and
  http://127.0.0.1:5173/?network=regtest keep separate storage. Recover in the
  first and run `npm run regtest:mine -- 1`. In the second, tap the row and
  Get Quote before it syncs.
  Expect "Nothing left to recover" and "These funds were already recovered."
- **Some funds left out.** Run `npm run regtest:recoverable -- both`. Fake a
  rate that eats the exit-fee leaf but not the co-signed one (try about
  1 000 sat/vB), then tap Get Quote.
  Expect "Some funds stay behind" and "₿X is left out of this recovery."

## Case 2g: speeding up a stuck recovery

### A co-signed recovery

**Setup.** Run Case 2b to step 3 and do not mine. To mine other blocks in the
meantime, first hold the recovery with `npm run regtest:hold`. With no txid, it
holds everything in the mempool.

**Steps**

1. Tap the "BTC Transfer" row. Under Advanced, tap Rebuild at a higher fee. It
   is offered only while nothing has confirmed.
   The rates start above the recovery's own rate.
2. Pick a rate, tap Get Quote, then tap Continue Recovery.
   Glow shows "Building and signing the recovery...", then "Funds sent" and
   "₿X on its way".
3. Run `npm run regtest:mine -- 1`. If you held anything, run
   `npm run regtest:release`.

**Unhappy paths**

- **Operators refuse.** Tap Get Quote, run `npm run regtest:operators -- down`,
  then tap Continue Recovery.
  Expect "Could not continue the recovery" and "Please try again or choose a
  different fee.".
- **The rate eats a leaf.** Fake a rate of about 50 000 sat/vB, then tap
  Get Quote.
  Expect "Nothing to rebuild right now" and "Glow keeps your recovery moving on
  its own.".
- **The original confirms first.** Open Rebuild at a higher fee. Run
  `npm run regtest:release`, then `npm run regtest:mine -- 1`.
  The sheet closes.

### A recovery with an exit-fee part

**Setup.** Run Case 2c to step 5. Once the tracker opens, wait about 5 seconds
and run `npm run regtest:hold`. It keeps the recovery's first transaction out
of blocks.

**Steps**

1. On the tracker, under Advanced, tap Rebuild at a higher fee. Pick a higher
   rate, tap Get Quote, then tap Continue.
   Glow tries once with the coins already at the exit fee address.
2. When those fall short, Glow shows "More exit fee needed" and "At N sat/vB,
   the recovery needs more exit fee than its fee address holds." The breakdown
   shows "Exit fee at N sat/vB", "You've already sent" and "Still to send",
   with the button "Top Up to Continue".
3. Tap Top Up to Continue.
   Glow shows "Send to Continue Recovery" with ₿X and a QR code.
4. Pay without mining:
   `npm run regtest:send -- <exit fee address> <X> --no-mine`.
   Glow shows "Waiting for a confirmation" instead of the amount, and
   Continue Recovery stays disabled.
5. Run `npm run regtest:mine -- 1` and tap Continue Recovery. It reads
   "Updating..." while Glow builds. Run `npm run regtest:release` to clear the
   hold.

**Unhappy paths**

- **Network fees went up.** Fake a rate above the recovery's own rate before
  step 1. The card reads "Network fees went up" instead of
  "More exit fee needed".

## Known gaps

These are open issues. Report them only if they behave differently.

- In a recovery with both parts, a refused co-sign also blocks the exit-fee
  part.
- A passkey prompt cancelled at the unlock shows raw text and no button.
- A failed update always suggests a different fee.
- Error screens show the SDK's raw text as the body.
- Glow cannot decline a leftover that asks for more exit fee. It lets the
  leftover go after about a week.
- In Case 2d, the review asks for the exit fee although the address already
  covers it.

## Covered by unit tests only

These have no local setup:

- A quote that skips funds as `fundsNotFound`.
- A leaf the operators stopped but have not relabelled yet, which quotes as
  `notRecoverable` for a moment. The window is too short to hit by hand.
- Funds that cannot be recovered at all: "Nothing left to recover" and
  "These funds can't be recovered."
