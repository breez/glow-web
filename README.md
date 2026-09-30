# Glow Web App

A PWA app showing how to implement [Breez SDK](https://sdk-doc-spark.breez.technology/) with WebAssembly.

See it in action [here](https://glow-app.co).

## Overview

Built with React, this demo app showcases best practices for integrating Lightning in a web environment using the Breez SDK’s WebAssembly bindings. It enables users to:

- Send payments via various protocols such as: Lightning address, LNURL-Pay, Bolt11, BTC address, Spark address
- Receive payments via various protocols such as: Lightning address, LNURL-Pay, Bolt11, BTC address

## Technologies Used

- [Breez SDK](https://sdk-doc-spark.breez.technology/) for all the bitcoin functionality
- React with TypeScript
- Tailwind CSS for styling

## Getting Started

### Clone the repository

```bash
git clone https://github.com/breez/glow-web.git
cd glow-web
```

### Install dependencies

```bash
npm install
```

### Set up environment variables

1. Copy the example environment file:

```bash
cp example.env .env.local
```

2. Edit `.env.local` and add your Breez API key (required):

```
VITE_BREEZ_API_KEY="your_breez_api_key_here"
```

See `example.env` for all available configuration options.

### Start the development server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Running on a local Spark environment

The [spark-sdk](https://github.com/breez/spark-sdk) has a local environment, a Spark regtest network of your own: a Bitcoin node, Spark operators, a service provider with its Lightning node, a second Lightning node called Alice, an LNURL server, a data-sync service and a block explorer. The environment's [README](https://github.com/breez/spark-sdk/blob/main/regtest/local/README.md) lists its settings. On regtest, Glow connects to the environment without an API key.

1. From a clone of the spark-sdk, start the environment:

   ```bash
   make local-env-up
   ```

   Or run it natively with Nix, which needs no clone:

   ```bash
   nix run github:breez/spark-sdk#local-env
   ```

   Once it can serve a wallet, it prints where its Spark config is: `regtest/local/data/spark-config.json` in the clone under Docker, `.spark-local/local/spark-config.json` in the directory it ran in under Nix.

2. Name that file in `.env.local`, then start the dev server:

   ```
   SPARK_CONFIG_PATH=../spark-sdk/regtest/local/data/spark-config.json
   ```

3. Open `http://localhost:5173/?network=regtest`.

Run the commands below from the spark-sdk clone. Under Nix, the `make` commands are `fund <address> <sats>`, `mine <blocks>` and `block-interval <seconds>` after `nix run github:breez/spark-sdk#local-env --`, run from the directory you started the environment in.

| | |
|---|---|
| Fund a wallet | `make local-env-fund ADDRESS=<address> AMOUNT_SATS=<sats>`, to an on-chain address from Receive. The wallet claims the deposit once it confirms. |
| Pay and get paid over Lightning | The environment prints Alice's commands: `bolt11-receive` makes an invoice for Glow to pay, `bolt11-send` pays one Glow made. |
| Mine blocks | `make local-env-mine BLOCKS=<blocks>` |
| Mine only on request | `make local-env-block-interval SECONDS=0`. The environment otherwise mines a block every 5 seconds. |
| See what happened on-chain | The explorer at `http://127.0.0.1:8090` |

A unilateral exit's refund transactions are timelocked for up to 2,000 blocks, and `make local-env-mine BLOCKS=2000` mines that many at once. You fund the exit's fee like a wallet, with `make local-env-fund`.

## Building for Production

```bash
npm run build
```

The build output will be in the `dist` directory.

## Security Note

If you don’t use a passkey (recommended), your recovery phrase is stored in `localStorage` which is not a secure storage mechanism. Any JavaScript running in the browser (including XSS attacks or malicious extensions) can access it, potentially compromising your funds.
