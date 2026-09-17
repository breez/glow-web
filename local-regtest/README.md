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

## Commands

| | |
|---|---|
| `npm run regtest:up` | start everything |
| `npm run regtest:down` | stop everything |
| `npm run regtest:fund -- <sats> <count>` | give the wallet `count` leaves |
| `npm run regtest:address` | a fresh address to receive at |
| `npm run regtest:send -- <addr> <sats>` | send coins and confirm them |
| `npm run regtest:mine -- <blocks>` | mine blocks |
| `npm run regtest:balance -- <addr>` | what an address holds |

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
