# Glow Web App

A PWA app showing how to implement [Breez SDK](https://docs.breez.technology/) with WebAssembly.

See it in action [here](https://glow-app.co).

## Overview

Built with React, this demo app showcases best practices for integrating Lightning in a web environment using the Breez SDK’s WebAssembly bindings. It enables users to:

- Send payments via various protocols such as: Lightning address, LNURL-Pay, Bolt11, BTC address, Spark address
- Receive payments via various protocols such as: Lightning address, LNURL-Pay, Bolt11, BTC address

## Technologies Used

- [Breez SDK](https://docs.breez.technology/) for all the bitcoin functionality
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

## Building for Production

```bash
npm run build
```

The build output will be in the `dist` directory.

## Security Note

If you don’t use a passkey (recommended), your recovery phrase is stored in `localStorage` which is not a secure storage mechanism. Any JavaScript running in the browser (including XSS attacks or malicious extensions) can access it, potentially compromising your funds.
