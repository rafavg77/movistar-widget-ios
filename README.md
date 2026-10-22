# Mi Movistar iOS Widget (Scriptable) [NON-FUNCTIONAL / EXPERIMENTAL]

> [!WARNING]
> **Status: Non-Functional / Deprecated**  
> Automated headless and webview session scraping for **Movistar México** (`mi.movistar.com.mx`) is currently **non-functional** due to strict Cloudflare Bot Management (`cf_clearance`), Google reCAPTCHA v3 score requirements, and session cookie validation that cannot be reliably maintained in iOS Scriptable widget timelines.
>
> This repository is preserved solely for educational, reverse-engineering, and cryptographic research purposes.

[![iOS](https://img.shields.io/badge/iOS-16%2B-blue?logo=apple)](https://apps.apple.com/app/scriptable/id1405459188)
[![Status](https://img.shields.io/badge/Status-Non--Functional-red)](https://github.com/rafavg77/movistar-widget-ios)
[![Movistar](https://img.shields.io/badge/Carrier-Movistar%20M%C3%A9xico-00A9E0)](https://mi.movistar.com.mx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A standalone, privacy-first **iOS Home Screen Widget** built for [Scriptable](https://scriptable.app) that displays real-time mobile data consumption, remaining GB, daily budget allowance, cutoff countdown, and recharge balance for **Movistar México** subscribers.

Inspired by [telcel-widget-agy](https://github.com/amaynez/telcel-widget-agy) and engineered specifically for Movistar's AES-256-GCM cryptographic eCare portal.

---

## Widget Preview

```text
+-----------------------------------+
|  Mi Movistar        Cutoff Oct 28 |
|  Movistar Libre 10GB              |
|                                   |
|       . - ~ ~ ~ - .               |
|    . '   65% USED   ' .           |
|   /  (RED)     (CYAN)  \          |
|                                   |
|   3.50 GB left of 10.00 GB        |
|                                   |
|  [⚡ 448 MB/day]   [Bal: $150.00]  |
+-----------------------------------+
```

---

## Features

- **Real-Time Data Consumption:** Displays remaining GB, total plan quota, consumed data, and active percentage.
- **Dual-Color Gauge:** High-resolution semicircular arc drawn dynamically via `DrawContext` (Spent data in red, remaining allowance in Movistar Cyan).
- **Daily Budget Calculation:** Automatically computes your recommended daily pace (`MB/day` or `GB/day`) based on the exact days remaining until plan cutoff.
- **Prepaid & Postpaid Balance:** Displays available recharge funds (`$0.00` / `$150.00`) and expiration dates.
- **100% Direct & Private:** No middleman servers, Proxies, or external cloud workers. All HTTPS traffic travels directly between your iPhone and Movistar's official endpoints (`mi.movistar.com.mx`).
- **iOS Keychain Protection:** Session tokens and credentials are encrypted using Apple's hardware-backed Keychain subsystem—never stored in plain text.
- **reCAPTCHA v3 Ready:** Seamless in-app `WebView` authentication helper solves Google reCAPTCHA v3 once and caches the session token (`p_id`) for days of automated widget background refreshes.
- **Hardware Decryption:** Built-in WebCrypto **AES-256-GCM** decryption with automatic fallback to headless WebView evaluation.
- **Smart Offline Cache:** Seamlessly falls back to local cached JSON data with an indicator (`⏳ cached`) if cellular signal is lost or servers are temporarily down.
- **Multiple Sizes:** Designed for both **Small** and **Medium** iOS widget layouts.

---

## Quick Start (Scriptable — No Mac or Xcode Required)

Install and run the widget in under 2 minutes directly from your iPhone:

### 1. Install Scriptable
Download the free [Scriptable App](https://apps.apple.com/app/scriptable/id1405459188) from the Apple App Store on your iPhone.

### 2. Copy the Widget Script
Open [`src/MiMovistarWidget.js`](src/MiMovistarWidget.js) on your iPhone or Mac and copy the entire code to your clipboard.

### 3. Add Script to Scriptable
1. Open **Scriptable** on your iPhone.
2. Tap the **`+`** button in the top-right corner to create a new script.
3. Paste the copied code.
4. Tap the script title at the top and rename it to **`Mi Movistar`**.
5. Tap **Done**.

### 4. Authenticate
1. Tap the **`Mi Movistar`** script inside Scriptable to run it once.
2. An alert will ask you to authenticate:
   - Select **Web Login (Recommended)**.
   - An in-app browser will load `https://mi.movistar.com.mx/login`.
   - Log in using your 10-digit number and password (or autofill with iCloud Keychain / Face ID).
   - Once logged in, the script will automatically detect your session token (`p_id`), store it securely in iOS Keychain, and close the browser.
3. The widget preview will immediately render on your screen!

### 5. Add Widget to Home Screen
1. Go to your iPhone Home Screen and long-press anywhere until the apps jiggle.
2. Tap the **`+`** button in the top-left corner.
3. Search for **Scriptable** and select either **Small** or **Medium**.
4. Tap **Add Widget**.
5. Long-press the newly placed widget and select **Edit Widget**.
6. Set **Script** to **`Mi Movistar`**, and **When Interacting** to **Run Script**.

---

## Repository Structure

```text
.
├── src/
│   ├── MiMovistarWidget.js     # Standalone iOS Scriptable widget
│   └── ResetCredentials.js     # Scriptable helper to clear Keychain tokens
├── test/
│   ├── test_decrypt.mjs        # Node.js unit tests for AES-256-GCM & parsing
│   └── probe_movistar.mjs      # CLI probe tool to test API endpoints
├── assets/                     # Visual previews and architecture diagrams
├── Movistar Widget API.md      # Full reverse-engineered technical API specification
├── package.json                # Project metadata & pnpm scripts
└── README.md                   # Project documentation
```

---

## Technical Specifications

| Component | Detail |
| :--- | :--- |
| **Carrier** | Movistar México (`Telefonica Moviles Mexico`) |
| **Authentication** | `POST /login-register/authenticate` + Google reCAPTCHA v3 |
| **Session Key** | `p_id` (passed via `Authorization: <p_id>` without Bearer prefix) |
| **Cipher** | AES-256-GCM (128-bit tag, 12-byte IV, static `guardString`) |
| **Query Endpoint** | `GET /consumptions-controller/datos-iniciales` |
| **Profile Endpoint** | `GET /consumptions-controller/detail-profile` |
| **Billing Endpoint** | `GET /billing-controller/datos-iniciales` |

For deep dive details on byte encodings, cryptographic keys, and wire schemas, read [`Movistar Widget API.md`](Movistar%20Widget%20API.md).

---

## Development & Testing

This project uses [pnpm](https://pnpm.io) for package and script management:

```bash
# Run unit tests (AES-256-GCM decryption & JSON parsing)
pnpm test

# Run mock API simulation
pnpm probe

# Test live query with an active session token
MOVISTAR_TOKEN="<your_p_id_here>" pnpm probe
```

---

## Resetting Credentials

If your session expires, your plan changes, or you wish to switch phone numbers:
1. Copy and run [`src/ResetCredentials.js`](src/ResetCredentials.js) inside Scriptable.
2. Select **Clear Everything**.
3. Rerun `Mi Movistar` to sign in fresh.

---

## Security & Privacy

- **No Third-Party Analytics or Telemetry:** No tracking libraries, external analytics, or crash reporters are embedded.
- **Hardware Security:** Apple's Secure Enclave and Keychain manage all tokens.
- **Open Source:** Every line of code is auditable in this repository.

---

## License

This project is licensed under the [MIT License](LICENSE).
