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
| `unilateral-exit` | a local Spark environment | moving a balance on-chain without the operators |
| `payment-scenario` | `RUN_FULL_E2E=1` | release-only payment checks, skipped by default |

A suite whose environment is missing skips rather than fails, so a plain
`npx playwright test` on a laptop with nothing set up is quiet and green.

## Unilateral exit

This one needs the app running on a local Spark environment, as the
[README](../README.md#running-on-a-local-spark-environment) sets up, with the
environment mining only on request, so each test decides when a timelock
passes. From the spark-sdk clone:

```
make local-env-block-interval SECONDS=0
```

Under Nix, from the directory it ran in:

```
nix run github:breez/spark-sdk/jssdwt-ssp-additions#local-env -- block-interval 0
```

Then:

```
npx playwright test unilateral-exit
```

The suite skips, naming the reason, without the environment or while the
environment still mines on its own. Afterwards,
`make local-env-block-interval SECONDS=5` has it mine every 5 seconds again.

You do not need to fund anything. Each test makes its own wallet from a fresh
phrase and funds it with a deposit from the environment's Bitcoin node, so
tests never inherit leaves from each other or from a previous run.

Give it time: each test walks a real exit down a real chain, mining as it goes.
About five minutes for the pair.

## Environment

Everything below has a working default.

| | |
|---|---|
| `TEST_EXIT_MNEMONIC` | pin the exit tests to one wallet instead of a fresh one |
| `BITCOIND_RPC_URL`, `BITCOIND_RPC_USER`, `BITCOIND_RPC_PASSWORD` | the environment's Bitcoin node (`http://127.0.0.1:18443/wallet/default`, `rpcuser`, `rpcpassword`) |
| `TEST_ESPLORA_URL` | the chain API the tests read (`http://127.0.0.1:8090/api`) |
| `RUN_FULL_E2E` | set to `1` to include `payment-scenario` |
| `FAUCET_URL`, `FAUCET_USERNAME`, `FAUCET_PASSWORD` | mainnet faucet for `wallet-transfer` |

## When a test fails

Playwright writes a screenshot and a page snapshot to `test-results/` for every
failure; the snapshot shows what was on screen, which is usually enough.

The exit tests also stream the sdk's own logs to
`test-results/sdk-console.log`, and print the plan and the chain state around it
when an exit never reaches its sweep.

If an exit test times out, check the environment is still up, and look at
what its services logged: `make local-env-logs` in the spark-sdk clone.
