# End-to-end tests

Playwright drives the real app in a browser. The dev server starts on its own,
so most of these need nothing from you.

```
npx playwright test
```

One suite at a time, by file name:

```
npx playwright test smoke
npx playwright test unilateral-exit
```

Add `--headed` to watch it, `--debug` to step through, `--ui` for the runner.

## The suites

| | needs | |
|---|---|---|
| `smoke` | nothing | the app loads and you can navigate it |
| `wallet-transfer` | mainnet faucet | sending and receiving |
| `unilateral-exit` | a local regtest cluster | moving a balance on-chain without the operators |
| `recoverable-funds` | a local regtest cluster | recovering funds that already left the balance |
| `payment-scenario` | `RUN_FULL_E2E=1` | release-only payment checks, skipped by default |

A suite whose environment is missing skips rather than fails, so a plain
`npx playwright test` on a laptop with nothing set up is quiet and green.

## Unilateral exit

This one needs the local cluster:

```
npm run regtest:up
npx playwright test unilateral-exit
```

See [local-regtest/README.md](../local-regtest/README.md) for what that starts.
Without it, the suite skips.

You do not need to fund anything. Each test makes its own wallet from a fresh
phrase and funds it before it runs, so tests never inherit leaves from each
other or from a previous run.

Give it time: each test walks a real exit down a real chain, mining as it goes.
About three minutes for the pair.

## Recoverable funds

Each test runs one case of
[docs/recoverable-funds-testing.md](../docs/recoverable-funds-testing.md)
against the same cluster:

```
npm run regtest:up
TEST_PORT=5181 npx playwright test recoverable-funds
```

`TEST_PORT` starts a dev server from this checkout on a port of its own.
Without it the run reuses whatever already answers on 5173, which can be
another checkout's server.

Each test makes its own wallet, then has the cluster move that wallet's funds
out of Spark, as `regtest:recoverable` does. The file takes about seven
minutes. It covers Case 1 and Cases 2a, 2b, 2c, 2e, 2f and 2g, plus the
operators going down after a quote. The guide's other paths still need a
person.

Run it on its own. It and `unilateral-exit` both mine blocks and count them,
so running them side by side breaks both. The outage test stops the gRPC-web
proxy for a few seconds and starts it again.

## Environment

Everything below has a working default.

| | |
|---|---|
| `TEST_PORT` | the dev server's port (5173), which the run reuses if anything answers there |
| `TEST_EXIT_MNEMONIC` | pin the exit tests to one wallet instead of a fresh one |
| `TEST_FUND_URL` | the funding endpoint (`http://127.0.0.1:8997`) |
| `BITCOIND_RPC_URL`, `BITCOIND_RPC_USER`, `BITCOIND_RPC_PASSWORD` | the regtest node, written to `.env.local` by `regtest:up` |
| `TEST_ESPLORA_URL` | the chain the tests read |
| `RUN_FULL_E2E` | set to `1` to include `payment-scenario` |
| `FAUCET_URL`, `FAUCET_USERNAME`, `FAUCET_PASSWORD` | mainnet faucet for `wallet-transfer` |

## When a test fails

Playwright writes a screenshot and a page snapshot to `test-results/` for every
failure; the snapshot shows what was on screen, which is usually enough.

The exit tests also stream the sdk's own logs to
`test-results/sdk-console.log`, and print the plan and the chain state around it
when an exit never reaches its sweep.

If an exit test times out, check the cluster is still up
(`npm run regtest:up` is safe to re-run) and look at
`local-regtest/cluster.log`.
