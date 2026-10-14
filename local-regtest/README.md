# Local regtest

Runs Glow against a Spark cluster on your machine, on a Bitcoin chain you
control. Nothing here touches real money.

## Start

```
npm run regtest:up
npm run dev
```

Open http://localhost:5173/?network=regtest

`regtest:up` starts everything: the Spark cluster, the gRPC-web proxy the
browser needs, the chain indexer, and the mempool that broadcasts packages.
`npm run regtest:down` stops the lot.

The first run builds `cluster/`, a small Rust binary that stands the cluster up
from the sdk's own test fixtures. That takes a few minutes and needs a Rust
toolchain; later runs reuse it. Nothing else here needs Rust.

`regtest:up` also builds the two images the operators run, from the docker files
of the sdk revision `cluster/Cargo.toml` pins. They start from
`ghcr.io/breez/spark-operator`, a private image of Lightspark's current
operator, so the first run needs `docker login ghcr.io` with an account that can
read it. Later runs find the images already built.

Restart `npm run dev` after `regtest:up`: Vite reads `.env.local` once, and the
cluster's ports just changed.

## Give the wallet a balance

```
npm run regtest:fund -- 200000 3
```

Three leaves of 200,000 sats, for the wallet this phrase owns:

```
legal winner thank year wave sausage worth useful legal winner thank yellow
```

Restore that phrase in the app and the balance is there. The address comes from
the phrase rather than the cluster, so you can fund before opening the app. Run
it again whenever you want more. To fund a different wallet, pass its phrase or
its Spark address as a third argument.

## Test a unilateral exit

An exit walks your balance out of Spark onto the chain, waits out a timelock on
each step, then sweeps everything to an address you choose.

**1. Pick where the money lands.**

```
npm run regtest:address
```

**2. Start the exit in the app**: menu, Settings, Unilateral Exit. Paste that
address as the destination and pick a fee rate.

**3. Pay the miners.** Exit transactions are pre-signed with no fee, so a
separate coin pays for them. The app shows an address and an amount, and keeps
both in the wallet list if you close the sheet.

```
npm run regtest:send -- <funding address> <sats>
```

**4. Build.** Once that coin confirms, press Exit Spark. The app signs everything
and sends what is ready. `regtest:send` mines the block for the coin.

**5. Mine.** Nothing moves until blocks pass, and the refunds need about 1,950.

```
npm run regtest:mine -- 2016
```

Watch the tracker. It shows your money in three stages: still in Spark, out of
Spark and safe on-chain, and arrived at your address. Mine another hundred if it
stalls; the app re-checks every 5 seconds.

A refund may confirm that the app never sent: the operators run a watchtower
that publishes its own copy. That counts the same, and the app rebuilds around
it on its own.

**6. Check the money arrived.**

```
npm run regtest:balance -- <destination address>
```

Expect a little less than you started with: mining fees came out on the way.

## Exit a leaf's parent from outside

A wallet renews a leaf when its refund timelock has nearly run out. On each
renewal here the operators put a split node above the leaf, holding the
transactions the leaf had until then. Below the root, every node then has two
transactions for the same output: its own, and a direct one that is valid once
the node above has been on-chain for 50 blocks.

Anyone who ever held the leaf can confirm the root of its tree. The operators
then mark every node below the root `PARENT_EXITED`, and the wallet has 50
blocks to confirm the next node's own transaction. If nobody has by then, the
operators' watchtower publishes that node's direct transaction. From then on
nobody can confirm any transaction below that node, and the operators mark every
node below it `WATCHTOWER_EXITED`. The sats sit on-chain where only the wallet
and the operators together can move them.

**1. Give the wallet a leaf that has renewed twice.**

```
npm run regtest:renewed-leaf -- 200000
```

Two wallets inside the cluster send a 200,000 sat leaf back and forth until they
have renewed it twice, which takes 38 transfers. The cluster then sends the leaf
to the wallet with the phrase above. Open the app and wait for the balance: the
next command refuses a leaf the wallet has not claimed.

For a different wallet, pass the number of renewals and then its phrase or its
Spark address: `-- 200000 2 "<phrase>"`.

**2. Exit the leaf's parent.**

```
npm run regtest:parent-exit
```

The cluster confirms the root of the leaf's tree and nothing below it. The
command prints the status the operators give each node:

```
nodes, root first:
  01a12fb2-b239-7f29-a035-14f456f85ec4  ON_CHAIN
  01a12fb2-ce58-7537-a09e-bb37df7e90ad  PARENT_EXITED
  01a12fb2-8b78-7ce1-8018-b3612e943d9d  PARENT_EXITED
```

The wallet can no longer send the leaf, and the watchtower steps in once 50 more
blocks are mined. To test a wallet that gets there first, exit from the app now
and mine one block at a time until the next node's own transaction has
confirmed. Mining 50 blocks in one go hands the leaf to the watchtower.

**3. Let the watchtower cut the leaf off.**

```
npm run regtest:watchtower-exit
```

The cluster mines the rest of the 50 blocks, waits for the watchtower to publish
the second split node's direct transaction, and mines one more block:

```
nodes, root first:
  01a12fb2-b239-7f29-a035-14f456f85ec4  ON_CHAIN
  01a12fb2-ce58-7537-a09e-bb37df7e90ad  ON_CHAIN
  01a12fb2-8b78-7ce1-8018-b3612e943d9d  WATCHTOWER_EXITED
```

Run without step 2, the command exits the leaf's parent first.

The operators here co-sign a recovery of such a leaf. A wallet builds a
transaction for the output the watchtower's transaction left, and asks them to
sign it with `recover_watchtower_exited_leaf`. They mark the leaf
`WATCHTOWER_EXIT_RECOVERED` when they do.

Two renewals are the fewest that end in `WATCHTOWER_EXITED` here. After the
first renewal the split node is the root of the tree, and the watchtower only
publishes for a node whose parent is on-chain. With one renewal that node is the
leaf itself: the watchtower publishes the leaf's direct transaction and the
operators mark the leaf `ON_CHAIN`. Pass `1` as the number of renewals to see
that.

## Test Recover Funds

[docs/recoverable-funds-testing.md](../docs/recoverable-funds-testing.md) walks
through every Recover Funds case, with the text each screen should show. Most
cases start from one command:

```
npm run regtest:recoverable -- cosigned
```

`cosigned` gives the wallet a leaf renewed twice, whose recovery the operators
co-sign. `exit-fee` gives it a leaf renewed once, whose recovery needs an exit
fee. `both` gives one of each. Keep Glow open with the test wallet while the
command runs. It waits for the claim, has the watchtower cut the leaf off, and
prints what the Recoverable Funds row should show.

## Commands

| | |
|---|---|
| `npm run regtest:up` | start everything |
| `npm run regtest:down` | stop everything |
| `npm run regtest:fund -- <sats> <count>` | give the wallet `count` leaves |
| `npm run regtest:renewed-leaf -- <sats> [renewals]` | give the wallet a leaf renewed twice, or `renewals` times |
| `npm run regtest:parent-exit -- [leaf id]` | confirm the root above that leaf, or above the one made last |
| `npm run regtest:watchtower-exit -- [leaf id]` | mine until the watchtower has cut that leaf off |
| `npm run regtest:recoverable -- <cosigned\|exit-fee\|both> [sats]` | give the wallet funds to recover, in one go |
| `npm run regtest:address` | a fresh address to receive at |
| `npm run regtest:send -- <addr> <sats> [--no-mine]` | send coins and confirm them, or leave them unconfirmed |
| `npm run regtest:hold -- [txid...]` | keep those transactions, or the whole mempool, out of blocks |
| `npm run regtest:release` | let every held transaction into blocks again |
| `npm run regtest:mine -- <blocks>` | mine blocks |
| `npm run regtest:balance -- <addr>` | what an address holds |
| `npm run regtest:operators -- down\|up` | cut the app off from the operators, or reconnect it |
| `npm run regtest:indexer -- down\|up` | stop or start the chain indexer |

## When something looks wrong

- **Balance stays 0** after funding: the app syncs on open, so give it a few
  seconds, or reload.
- **An exit step never confirms**: mine more blocks. Timelocks are counted in
  blocks, and regtest only has the ones you make.
- **`regtest:up` fails**: the cluster's output is in `cluster.log`.
- **Ports changed**: every `regtest:up` picks new ones, so restart `npm run dev`
  after it.

## What is running

| | |
|---|---|
| `cluster/` | three Spark operators, their databases, and a bitcoind |
| `spark-grpcweb` | envoy: browsers cannot speak native gRPC to the operators |
| `spark-electrs` | the chain the app reads: balances, confirmations |
| `spark-mempool-api` | fee estimates, and the package relay an exit needs |
| `spark-mempool-web` | a block explorer at http://localhost:3001 |

An explorer over your own chain is often the quickest way to see what happened.

Ports and generated files (`envoy.yaml`, `.env`, `cluster.log`) are rewritten
every run and gitignored.
