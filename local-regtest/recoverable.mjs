#!/usr/bin/env node
/**
 * Gives the test wallet funds to recover, against the cluster already running:
 * a renewed leaf that the operators' watchtower then cuts off.
 *
 *   node local-regtest/recoverable.mjs <cosigned|exit-fee|both> [sats]
 *
 * A leaf renewed twice ends WATCHTOWER_EXITED, and the operators co-sign its
 * recovery. One renewed once ends ON_CHAIN, and its recovery needs an exit fee.
 */
const base = process.env.FUND_URL ?? 'http://127.0.0.1:8997';

const KINDS = {
  cosigned: { renewals: 2, sats: 200_000, note: 'the operators co-sign its recovery' },
  'exit-fee': { renewals: 1, sats: 150_000, note: 'its recovery needs an exit fee' },
};

const die = msg => {
  console.error(msg);
  process.exit(1);
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const grouped = sats => String(sats).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

async function ask(path, query) {
  let response;
  try {
    response = await fetch(`${base}${path}?${new URLSearchParams(query)}`, {
      signal: AbortSignal.timeout(15 * 60_000),
    });
  } catch {
    die(`No cluster answering at ${base}. Start it first: npm run regtest:up`);
  }
  return response.json();
}

// The cluster exits only a leaf the wallet has claimed, and only the app claims
// it. While a claim settles, the operators disagree on the leaf for a moment.
const unclaimed = error => /has not claimed|between statuses/.test(error ?? '');

const [mode, satsArg] = process.argv.slice(2);
const kinds = mode === 'both' ? ['cosigned', 'exit-fee'] : [mode];
if (!kinds.every(kind => kind in KINDS) || (satsArg && !/^[1-9]\d*$/.test(satsArg))) {
  die('usage: <cosigned|exit-fee|both> [sats]');
}

const leaves = [];
for (const kind of kinds) {
  const { renewals } = KINDS[kind];
  const sats = Number(satsArg ?? KINDS[kind].sats);
  console.log(`Renewing a ${sats} sat leaf ${renewals} time(s)...`);
  const body = await ask('/renewed-leaf', { sats, renewals });
  if (body.error) die(body.error);
  console.log(`Sent leaf ${body.leaf} to the wallet.`);
  leaves.push({ kind, sats, id: body.leaf });
}

const plural = leaves.length > 1;
console.log(`\nOpen Glow with the test wallet so it picks up the ${plural ? 'leaves' : 'leaf'}.`);
console.log(`Once it has, the watchtower moves ${plural ? 'them' : 'it'} on-chain. That takes a few minutes.\n`);
for (const [index, leaf] of leaves.entries()) {
  const deadline = Date.now() + 10 * 60_000;
  let report = await ask('/watchtower-exit', { leaf: leaf.id });
  while (unclaimed(report.error) && Date.now() < deadline) {
    await sleep(5_000);
    report = await ask('/watchtower-exit', { leaf: leaf.id });
  }
  if (unclaimed(report.error)) {
    const resume = leaves.slice(index).map(({ id }) => `  npm run regtest:watchtower-exit -- ${id}`);
    die(`Glow did not claim leaf ${leaf.id} in 10 minutes. Open it with the test wallet, then run:\n${resume.join('\n')}`);
  }
  if (report.error) die(report.error);
  console.log(`Leaf ${leaf.id} is ${report.status}: ${KINDS[leaf.kind].note}.`);
}

const total = leaves.reduce((sum, leaf) => sum + leaf.sats, 0);
console.log(`
Glow's wallet list should show, after its next sync (reload if it does not):
  Recoverable Funds  ₿${grouped(total)}  Tap to recover
The cases to test are in docs/recoverable-funds-testing.md.`);
