/**
 * The Spark cluster: three operators, their databases and a bitcoind, started
 * from the sdk's own test fixtures by the `cluster` crate beside this file.
 *
 * It runs detached with its output in a log file, so `regtest:up` can return
 * rather than holding a terminal. `regtest:down` stops it.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const crate = resolve(here, 'cluster');
const runner = resolve(crate, 'target', 'release', 'glow-regtest');

export const CONFIG_PATH = '/tmp/spark-regtest.json';
export const LOG_PATH = resolve(here, 'cluster.log');
const PID_PATH = resolve(here, 'cluster.pid');
const FUND_URL = 'http://127.0.0.1:8997/';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const reachable = async url => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
};

export const isClusterUp = () => reachable(FUND_URL);

/**
 * Builds the two images the operators run, from the docker files of the sdk
 * revision the crate pins, unless they are already there. The fixtures run each
 * under a tag derived from those files, which the cluster runner prints. They
 * are built for Intel: the private operator image ships Intel binaries, which
 * an ARM Mac runs through Rosetta.
 */
function buildOperatorImages() {
  const metadata = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1'], {
      cwd: crate,
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
  const fixtures = metadata.packages.find(pkg => pkg.name === 'spark-itest');
  const docker = resolve(dirname(fixtures.manifest_path), 'docker');
  const references = JSON.parse(execFileSync(runner, ['image-tags']));
  for (const [image, file] of [
    ['spark-migrations', 'migrations-private.dockerfile'],
    ['spark-so', 'spark-so-private.dockerfile'],
  ]) {
    const reference = references[image];
    try {
      execFileSync('docker', ['image', 'inspect', reference], { stdio: 'ignore' });
      continue;
    } catch {
      // Not built yet.
    }
    try {
      execFileSync('docker', ['build', '--platform', 'linux/amd64', '-t', reference, '-f', resolve(docker, file), docker], {
        stdio: 'inherit',
      });
    } catch {
      throw new Error(
        `Could not build ${reference}. It starts from ghcr.io/breez/spark-operator, which is private: ` +
          'run `docker login ghcr.io` with an account that can read it, then try again.',
      );
    }
  }
}

export async function startCluster() {
  if (await isClusterUp()) {
    console.log('Cluster already up.');
    return;
  }

  // Built ahead of spawning: a first build takes minutes, and its progress is
  // worth seeing rather than hiding in the log.
  console.log('Building the cluster runner...');
  execFileSync('cargo', ['build', '--release'], { stdio: 'inherit', cwd: crate });
  console.log('Building the operator images...');
  buildOperatorImages();

  rmSync(CONFIG_PATH, { force: true });
  const log = openSync(LOG_PATH, 'w');
  const child = spawn(runner, [], {
    cwd: crate,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'info,testcontainers=warn' },
  });
  child.unref();
  writeFileSync(PID_PATH, String(child.pid));

  console.log('Starting the cluster (bitcoind, 3 operators)...');
  for (let waited = 0; waited < 600_000; waited += 2_000) {
    if (existsSync(CONFIG_PATH) && (await isClusterUp())) return;
    if (child.exitCode !== null) {
      throw new Error(`The cluster exited early. See ${LOG_PATH}`);
    }
    await sleep(2_000);
  }
  throw new Error(`The cluster did not come up in 10 minutes. See ${LOG_PATH}`);
}

export function stopCluster() {
  if (!existsSync(PID_PATH)) return;
  const pid = Number.parseInt(readFileSync(PID_PATH, 'utf8'), 10);
  try {
    // SIGINT, not SIGKILL: the fixtures tear their containers down on Ctrl-C.
    process.kill(pid, 'SIGINT');
  } catch {
    // Already gone.
  }
  rmSync(PID_PATH, { force: true });
}
