# Glow Web App

A demo web and PWA app showing how to implement [Breez SDK](https://sdk-doc-spark.breez.technology/) with WebAssembly. 

See it in action [here](https://glow-app.co). 

> **Note:** The demo is for demonstration purposes only and not intended for production use.

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
git clone https://github.com/breez/breez-sdk-spark-example.git
cd breez-sdk-spark-example
```

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

## Building for Production

```bash
npm run build
```

The build output will be in the `dist` directory.

## Security Notes

- The wallet mnemonic is encrypted at rest using AES-256-GCM with a non-exportable device-bound key (Web Crypto API + IndexedDB)
- The encryption key cannot be extracted via JavaScript and is tied to the browser/device
- Clearing IndexedDB will make the encrypted mnemonic unrecoverable — users must back up their mnemonic phrase
