# Unilateral exit

Moves a Spark balance onto Bitcoin without the operators' help. A last resort:
it costs on-chain fees and takes days, because each step waits out a timelock.

This folder is a working implementation. Read it alongside the
[SDK guide](https://sdk-doc-spark.breez.technology/guide/unilateral_exit.html).

## Three calls

| call | you get | when |
|---|---|---|
| `prepareUnilateralExit` | a quote: which leaves, what it costs, how much to fund | once, to decide |
| `unilateralExit` | the signed transactions | once, after funding |
| `checkUnilateralExit` | where it got to, and what to send next | every few seconds, for days |

## The flow

![How an exit runs](exit-flow.svg)

## What you must do

**Pay the fees yourself.** The tree transactions are pre-signed with no fee, so
each is bumped by a child paid from a Bitcoin UTXO you supply. It must be native
SegWit. The quote tells you the amount.

**Store the response.** Both `unilateralExit` and `checkUnilateralExit` return
the exit; keep the latest. Lose it and you cannot finish, even though the money
is still recoverable.

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
quote and build again, naming the same leaves and passing back the
`fundingInputs` you stored. This app does that on its own, since it needs
nothing from the user and an exit left alone for days would otherwise stall.

**Let them pay more.** A rebuild reuses the fee rate it was quoted at, so an
exit that has stopped confirming because fees rose needs a new quote at a higher
rate. Offer that at any point, not only when something has gone wrong.

## Reading this folder

| | |
|---|---|
| `driver.ts` | what an exit is, what it is worth, how a paid one starts, and one pass over it: check, rebuild if needed, send what is ready |
| `engine.ts` | watches a saved exit's fee address, starts the exit when the user asks, then runs passes for as long as the app is open |
| `funding.ts` | the key and address the fees are paid from |
| `exitState.ts` | the rolling on-device copy of the leaf data an exit needs |
| `backup.ts` | that copy as a file the user keeps, and reads back |
| `hooks/`, `steps/`, `TrackerView.tsx` | the wizard and the tracker |
