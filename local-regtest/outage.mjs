#!/usr/bin/env node
/**
 * Cuts the app off from the operators or from the chain indexer, and back, to
 * test what Glow shows through an outage.
 *
 *   node local-regtest/outage.mjs operators down|up
 *   node local-regtest/outage.mjs indexer down|up
 *
 * `operators` stops only the browser's gRPC-web proxy, so the cluster's own
 * commands still reach the operators meanwhile.
 */
import { execFileSync } from 'node:child_process';

const containers = { operators: 'spark-grpcweb', indexer: 'spark-electrs' };

const [service, state] = process.argv.slice(2);
const container = containers[service];
if (!container || !['down', 'up'].includes(state)) {
  console.error('usage: operators down|up | indexer down|up');
  process.exit(1);
}

try {
  // Docker prints the name back on success, which says nothing here.
  execFileSync('docker', [state === 'down' ? 'stop' : 'start', container], { stdio: ['ignore', 'ignore', 'inherit'] });
} catch {
  console.error(`Could not ${state === 'down' ? 'stop' : 'start'} ${container}. Is the environment up? npm run regtest:up`);
  process.exit(1);
}
console.log(
  state === 'down'
    ? `Stopped ${container}: the app cannot reach the ${service}. Undo with: npm run regtest:${service} -- up`
    : `Started ${container}: the app can reach the ${service} again.`,
);
