# Unilateral exit

Moves a Spark balance onto Bitcoin without the operators' help. A last resort:
it costs on-chain fees and takes days, because each step waits out a timelock.

This folder is a working implementation. Read it alongside the
[SDK guide](https://sdk-doc-spark.breez.technology/guide/recover_funds.html).
The same calls move funds that already left the balance: that is Recover
Funds, which the wallet list offers as its own row.

## Three calls

| call | you get | when |
|---|---|---|
| `prepareRecoverFunds` | a quote: which leaves, what it costs, how much to fund | once, to decide |
| `recoverFunds` | the signed transactions | once, after funding |
| `checkRecoverFunds` | where it got to, and what to send next | every few seconds, for days |

**Co-signed recoveries.** A leaf the operators moved on-chain comes back as a
cooperative recovery: one transaction they co-sign, paying its fee from the
leaf, so it needs no funding. It goes out when `ready`, and also while
`unverified`, since the network refuses it if its funds already moved. One
still `unverified` six blocks on may never confirm, so this app prepares it
again by name at the same rate, holding its leaf meanwhile, and lets the leaf
go back to the recoverable funds after about a week. One the operators did not
co-sign is listed in `failed`, outside the transactions. `done` covers only the
transactions, so this app keeps such a leaf, and one a rebuild skipped for
now, part of the exit: it prepares it again on the same schedule, builds a
co-signed one into the exit, and asks for more exit fee for a unilateral one
once the exit's unilateral steps have landed. The week then starts over, so
the user has all of it to pay.

## The flow

![How an exit runs](exit-flow.svg)

## What you must do

**Pay the fees yourself.** The tree transactions are pre-signed with no fee, so
each is bumped by a child paid from a Bitcoin UTXO you supply. It must be native
SegWit. The quote tells you the amount.

**Store the response.** Both `recoverFunds` and `checkRecoverFunds` return the
recovery; keep the latest. Lose it and you cannot finish, even though the money
is still recoverable. A plan stored under SDK 0.26 does not parse any more, so
`legacyPlan.ts` converts it on load and the engine builds it again.

**Let them keep the exit state off the device.** `exportUnilateralExitState`
returns the leaf data an exit is quoted and built from. It is the one thing the
operators cannot serve again once they stop answering, and it dies with the
device unless the user holds a copy. `importUnilateralExitState` reads it back
into a restored wallet, reporting how many leaves it took and how many it
skipped as another wallet's.

**Broadcast only what is ready.** Each transaction carries a `status`. Send the
ones that say `ready` and leave the rest; a later check will say when their turn
comes. Sending one twice is harmless, so you need not remember what you sent.

**Send the pairs together.** A transaction with a `cpfpTxHex` pays no fee on its
own, so broadcast it and its child as one package through something that
supports package relay. The fan-out and the sweep have no child and go on their
own, anywhere.

**Handle `redo`.** It means the chain no longer matches what you hold, usually
because the operators' watchtower published a refund first. Nothing is lost:
quote and build again, naming the same leaves with a `specific` selection and
passing back the `fundingInputs` you stored. This app does that on its own,
since an exit left alone for days would otherwise stall. A passkey wallet is
the exception: its fee key needs the passkey, which only a tap can ask for, so
its rebuild waits for the tracker's Update & Continue button.

**Let them pay more.** A rebuild reuses the fee rate it was quoted at, so an
exit that has stopped confirming because fees rose needs a new quote at a higher
rate. Offer that at any point, not only when something has gone wrong. A
confirmed fan-out does not cap it: pass the exit's funding back with the new
coins, and the sdk spends them together, fanning out again if it has to. A
co-signed recovery is bumped the same way: quote its leaves again at a higher
rate, to the same address, and the build replaces it on the network. This app
keeps such a build only when it holds every leaf, since a partial one beside
the original would list the same leaf twice.

## Reading this folder

| | |
|---|---|
| `quote.ts` | everything read off a quote, for Recover Funds and the Unilateral Exit alike: what it moves, what it costs, what arrives and whether that is an estimate, whether it needs funding, and what the exit fee address was paid |
| `driver.ts` | what an exit is, how one is built and started, and one pass over it: check, rebuild if needed, send what is ready, then read what landed for the archive |
| `legacyPlan.ts` | a plan stored under SDK 0.26, converted to this SDK's shape on load |
| `engine.ts` | watches a saved exit's fee address, starts the exit when the user asks, then runs passes over it and over kept co-signed recoveries for as long as the app is open |
| `funding.ts` | the key and address the fees are paid from |
| `exitState.ts` | the rolling on-device copy of the leaf data an exit needs |
| `backup.ts` | that copy as a file the user keeps, and reads back |
| `hooks/`, `steps/`, `TrackerView.tsx` | the wizard and the tracker |
