# Glow Privacy Policy

**Effective date: July 6, 2026**

Glow is a non-custodial Bitcoin app made by Breez, available at [glow-app.co](https://glow-app.co) and as a native app for iOS and Android. This policy explains what data Glow handles and where it goes.

## 1. What we don't collect

- **No accounts.** There is no registration, login, email, phone number, or password.
- **No identity verification.** Glow never asks for your name, documents, or any KYC information.
- **No analytics or tracking.** Glow contains no analytics SDKs, tracking pixels, advertising identifiers, or fingerprinting.
- **No remote logging.** Diagnostic logs stay on your device with sensitive values redacted, and are shared only if you choose to export and send them to us.

## 2. Data that leaves your device

To move funds, some data necessarily travels over the network:

- **Payment data.** Payments are executed through the Breez SDK, which may communicate with Spark or other providers (e.g. swap services like Boltz or Flashnet) to create invoices, execute transfers, and fetch fiat exchange rates. This traffic may include payment details (amounts, invoices, addresses) and, like any internet traffic, your IP address. On-chain Bitcoin transactions are, by design, recorded permanently on the public blockchain.
- **Lightning address.** To receive payments at an address like `you@breez.tips`, the app registers your chosen (or randomly generated) username with the Lightning address server (configurable in settings). This username is public: anyone who knows it can look it up to pay you. Don't use a username you consider private.

## 3. Buying Bitcoin through partners

If you choose to buy Bitcoin, Glow redirects you to a third-party provider such as MoonPay or Cash App. These are independent services with their own privacy policies, and they may require identity verification (KYC). Glow does not send them any of your personal information; whatever you provide to them is between you and the provider.

## 4. Data retention and deletion

- **On-device data** (settings, contacts, logs) is under your control. Clear the app's data or uninstall the app to delete it.
- **Lightning address usernames** remain registered on the Lightning address server so that your address keeps working. You can replace your username at any time from the app, which deregisters the old one.

## 5. Changes to this policy

If we change this policy, we will update it here with a new effective date.

## 6. Contact

Questions about privacy in Glow? Contact Breez at [contact@breez.technology](mailto:contact@breez.technology) or open an issue at [github.com/breez/glow-web](https://github.com/breez/glow-web).
