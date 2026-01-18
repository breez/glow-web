# Glow Demo App

A demo web and PWA app showing how to implement [Breez SDK](https://sdk-doc-spark.breez.technology/) with WebAssembly. 

See it in action [here](https://glow-app.co). 

> **Note:** The demo is for demonstration purposes only and not intended for production use.

## Overview

Built with React, this demo app showcases best practices for integrating Lightning in a web environment using the Breez SDK’s WebAssembly bindings. It enables users to:

- Send payments via various protocols such as: Lightning address, LNURL-Pay, Bolt11, BTC address, Spark address
- Receive payments via various protocols such as: Lightning address, LNURL-Pay, Bolt11, BTC address

## Technologies Used

- React with TypeScript
- Tailwind CSS for styling
- [Breez SDK](https://sdk-doc-spark.breez.technology/) for all the bitcoin functionality


## Getting Started

### Clone the repository

```bash
git clone https://github.com:breez/breez-sdk-spark-example.git
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

## Project Structure

```
/src
  /components        # UI components
    /ui              # Reusable UI component library
  /contexts          # React context providers
  /services          # Business logic and API communication
  App.tsx            # Main application component
  main.tsx           # Application entry point
  index.css          # Global styles
/pkg                 # WebAssembly bindings for Breez SDK
```

## Key Components

- **walletService.ts** - Handles communication with the Breez SDK
- **SendPaymentDialog** - Dialog for making Lightning payments
- **ReceivePaymentDialog** - Dialog for generating invoices
- **PaymentDetailsDialog** - Shows detailed information about transactions


## Security Notes

- The app stores your mnemonic in localStorage, which is not suitable for production use
- For a production app, use secure storage and encryption for sensitive data
