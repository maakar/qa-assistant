# QA Assistant

<div align="center">

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](#)
[![Version](https://img.shields.io/badge/version-2.0.0-81C995)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Chrome_116+-202124)](#)

**AI-powered QA locator generator, real-time in-page verifier, and self-healing test automation companion with native Chrome Side Panel integration.**

</div>

---

## 🎯 Overview

**QA Assistant** is an open-source Chrome extension built for software test engineers, QA automation professionals, and developers. It accelerates writing test automation by capturing DOM elements, generating robust locators across major test frameworks, validating uniqueness directly on the live page, and self-healing broken selectors using AI.

Integrated directly into Chrome's native **Side Panel**, QA Assistant works seamlessly alongside your web application without obscuring page content or interrupting your workflow.

---

## ✨ Features

- **🔍 Point & Click Element Inspection:** Click any button, input, or container on your test application to capture its DOM attributes, accessibility roles, and hierarchy.
- **🤖 Multi-Engine AI (Bring Your Own Key / BYOK):**
  - **Local Ollama:** 100% private, runs entirely on your local machine with zero external network traffic.
  - **Cloud Providers (BYOK):** Connect directly to **OpenAI**, **Anthropic Claude**, or **Google Gemini** using your personal API keys.
  - **Dynamic Model Discovery:** Automatically queries your provider's API to fetch the latest supported text, code, and reasoning models available on your account—no hardcoded or outdated model lists.
  - **Smart Tier Grouping:** Automatically categorizes discovered models into practical performance and budget tiers (lightweight/fast, balanced, and high-capability reasoning).
  - **Chrome Built-In AI:** Experimental support for Chrome's native on-device Gemini Nano via the Prompt API.
- **🎭 Multi-Framework Locators:** Generates clean, resilient locators for:
  - **Playwright:** `page.getByRole()`, `page.getByTestId()`, `page.getByText()`, `page.locator()`
  - **Cypress / Selenium:** Best-practice CSS selectors and scoped XPath queries.
- **⚡ Real-Time In-Page Verification:** Test any generated or manual locator with one click. Visual badges highlight matches on the live page:
  - 🟢 **Unique (1):** Ideal, resilient locator.
  - 🟡 **Brittle (>1):** Matches multiple elements; prompts refinement.
  - 🔴 **Broken (0):** No elements matched.
- **🩹 AI Self-Healing & Memory:** If an element changes, click **Heal** to automatically diagnose failures and generate an updated selector. Proven patterns are saved to your local **Knowledge Base**.
- **❄️ Page Freeze Tool:** 3-second countdown freeze with DevTools debugger integration to inspect ephemeral tooltips, flyout menus, and hover states.
- **🎨 Chrome-Native Dark & Light Theme:** Beautifully matches Chrome's neutral aesthetic with collapsible tool sections and minimal screen footprint.

---

## 🚀 Installation

### Unpacked Developer Mode

1. Clone or download this repository:
   ```bash
   git clone git@github.com:maakar/qa-assistant.git
   cd qa-assistant
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in top-right corner).
4. Click **Load unpacked** and select the `qa-assistant` project folder.
5. Pin the **QA Assistant** icon in your Chrome toolbar.
6. Click the icon to open the native **Side Panel**.

---

## ⚙️ AI Engine Configuration (BYOK)

QA Assistant follows a **Bring Your Own Key (BYOK)** model. You maintain complete control over which provider, models, and budget tiers you use:

### 1. Local AI via Ollama (Recommended for Air-Gapped / Private Testing)
1. Install and start [Ollama](https://ollama.ai/):
   ```bash
   ollama run llama3.1
   # or any code/instruction model of your choice
   ```
2. In QA Assistant **Settings**, select **Ollama** as the Active Engine (endpoint defaults to `http://localhost:11434`).
3. Click **Refresh Models** to populate installed local models, select your model, and click **Save Settings**.
4. *Zero data leaves your computer.*

### 2. Cloud AI Providers (OpenAI / Anthropic / Google Gemini)
1. In QA Assistant **Settings**, select your preferred provider in **Active Engine**.
2. Paste your personal API Key.
3. Click **Refresh Models**: the extension dynamically queries the provider's API to detect the newest and most suitable models accessible to your key, filtering out obsolete or incompatible endpoints.
4. Select your preferred model and budget tier, then click **Save Settings**.

---

## 🛡️ Security & API Key Handling

Security and privacy are core architectural priorities of QA Assistant:

- **🔒 Direct Client-to-API Communication (Zero Intermediaries):**
  - All AI requests are made **directly** from your local browser to your configured provider endpoint (e.g. `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, or local `localhost:11434`).
  - There are **no intermediary proxy servers, third-party relays, or tracking backends**. QAMethod never sees or handles your traffic.
- **💾 Encrypted Local Storage Only (`chrome.storage.local`):**
  - Your API keys, custom endpoints, and preferences are stored exclusively in Chrome's sandboxed `chrome.storage.local` on your local device.
  - Keys are **never** synced to Google accounts (`chrome.storage.sync` is deliberately avoided for credentials).
- **🧹 Sanitized Diagnostics & Exports:**
  - The built-in diagnostics export tool strictly scrubs and redacts API keys and sensitive tokens before displaying or copying session logs.
- **🎯 Minimal On-Demand Data Exposure:**
  - The extension never monitors web browsing in the background or sends full page contents.
  - Only when you explicitly click *Analyze Element*, a pruned HTML snippet containing only the targeted element's structural attributes (tag, classes, test IDs, and accessibility roles) is sent to your chosen AI engine.
- **🗑️ Instant Revocation & Full User Control:**
  - You can update, overwrite, or clear your API keys at any time directly in the Settings panel.
  - Uninstalling the extension immediately wipes all stored keys and data from your browser storage.
  - For full legal disclosures, see [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

---

## 📦 Building for Chrome Web Store

To build a clean production `.zip` package for the Chrome Web Store:

```bash
chmod +x package-extension.sh
./package-extension.sh
```

This generates `qa-assistant-v2.0.0.zip` containing only active runtime files (excluding docs, scripts, and tests).

---

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome!
1. Fork the repository.
2. Create your feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes (`git commit -m 'Add amazing feature'`).
4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.

Developed with ❤️ by **QAMethod**.
