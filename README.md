# QA Assistant

<div align="center">

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](#)
[![Version](https://img.shields.io/badge/version-2.0.1-81C995)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Chrome_116+-202124)](#)

**AI-powered QA locator generator, real-time in-page verifier, and self-healing test automation companion with native Chrome Side Panel integration.**

</div>

---

## 🎯 Overview

**QA Assistant** is an open-source Chrome extension built for software test engineers, QA automation professionals, and developers. It assists with test automation by capturing DOM elements, generating locator candidates, checking matches on the live page, and requesting AI-assisted replacements for selectors.

Integrated directly into Chrome's native **Side Panel**, QA Assistant works seamlessly alongside your web application without obscuring page content or interrupting your workflow.

---

## ✨ Features

- **🔍 Point & Click Element Inspection:** Click any button, input, or container on your test application to capture its DOM attributes, accessibility roles, and hierarchy.
- **🤖 Multi-Engine AI (Bring Your Own Key / BYOK):**
  - **Ollama:** Connect to a local server by default, or configure another HTTP(S) endpoint. A remote endpoint receives your prompts.
  - **Cloud Providers (BYOK):** Connect directly to **OpenAI**, **Anthropic Claude**, or **Google Gemini** using your personal API keys.
  - **Model Discovery:** Queries provider model lists and filters and ranks candidates using naming heuristics; the list is limited and may not include every suitable model.
  - **Tier Heuristics:** Picks a mix of approximate budget tiers where available; these are not guarantees of price or capability.
  - **Chrome Built-In AI:** Experimental support for a detected Prompt API in the target tab; availability depends on the page and Chrome configuration.
- **🎭 Multi-Framework Locators:** Generates locator candidates for:
  - **Playwright:** `page.getByRole()`, `page.getByTestId()`, `page.getByText()`, `page.locator()`
  - **Cypress / Selenium:** CSS selectors and XPath queries.
- **⚡ Real-Time In-Page Verification:** Check generated or manual locators with one click; matches are highlighted on the live page. Playwright expressions are approximated using native CSS/XPath, not evaluated by Playwright, so results can differ from the test framework. Verify candidates in your actual tests.
  - 🟢 **Unique (1):** The in-page check found one match; this does not guarantee resilience.
  - 🟡 **Brittle (>1):** The check found multiple matches; refinement may be needed.
  - 🔴 **Broken (0):** The check found no matches; unsupported or invalid expressions can also produce this result.
- **🩹 AI Self-Healing & Memory:** Click **Heal** to request and verify replacement selectors, with retries. Use **Learn** to save a selector to the local **Knowledge Base**; saving is not automatic.
- **❄️ Page Freeze Tool:** A countdown triggers a JavaScript `debugger` statement to inspect ephemeral UI. Open DevTools for the target tab before using it; resume execution in DevTools afterwards. Without an attached debugger, the page will not pause.
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

QA Assistant supports **Bring Your Own Key (BYOK)** for cloud providers. Choose a provider and a model from the available options:

### 1. AI via Ollama
1. Install and start [Ollama](https://ollama.ai/):
   ```bash
   ollama run llama3.1
   # or any code/instruction model of your choice
   ```
2. In QA Assistant **Settings**, select **Ollama** as the Active Engine (endpoint defaults to `http://localhost:11434`).
3. Click **Refresh Models** to query the configured server's models, select a model, and click **Save Engine Settings**.
4. Verify the endpoint and your network setup before using sensitive data. The default endpoint is local; a custom endpoint can be remote.

### 2. Cloud AI Providers (OpenAI / Anthropic / Google Gemini)
1. In QA Assistant **Settings**, select your preferred provider in **Active Engine**.
2. Paste your personal API Key.
3. Click **Refresh Models** to query the provider's model list. The extension applies heuristic filters and displays a limited selection; it cannot guarantee model suitability. Model discovery may also run when you select an engine or change a key.
4. Select a model and click **Save Engine Settings**. The displayed mix of model tiers is heuristic, not a separate budget control.

---

## 🛡️ Security & API Key Handling

- **Direct provider requests:** External-engine analysis and healing prompts go from the extension to the configured endpoint, without a QAMethod proxy in the extension code. Cloud keys authenticate requests; Google's key is included in the request URL. Ollama defaults to localhost but supports remote HTTP(S) endpoints; HTTP does not encrypt traffic.
- **Data sent to AI:** After selecting an element, analysis prompts include selected profile fields, including attributes, text and parent/ancestor details, rather than full page HTML. Container text can include descendant text. Analysis may also include custom rules and relevant learned selectors. Healing uses profile fields, current and previously tried locators, and a match-count value currently fixed at zero; it may make multiple requests. Chrome Built-in AI runs in the target page's main world and passes the full captured profile JSON or refinement object as an injection argument alongside the prompt. Page-controlled AI globals can receive the prompt, and responses are posted as messages to the page. Whether page scripts can directly observe the otherwise unused full analysis argument has not been verified; do not assume this data is isolated from the page. Review sensitive data and provider policies before use.
- **Browser storage:** Engine settings, rules, saved patterns and per-host analysis history (including element profiles and responses) are kept in `chrome.storage.local`. The settings save flow keeps cloud keys in `chrome.storage.session`, not persistent local settings; keys generally need re-entry after browser restart. Chrome storage is not a dedicated encrypted secrets vault.
- **Other requests and diagnostics:** Availability checks and model discovery can run independently of analysis, including when the panel or settings opens, an engine is selected, or a key changes. Model-list requests use the entered cloud key but do not include the element profile. **Copy Beta Diagnostics** copies version, tab ID, target hostname, session count, provider and timestamp, not scrubbed session logs. Review copied content before sharing.
- **Deletion:** The header trash button clears the current site's stored history, current tab's legacy entry and current tab's active buffer, not other tabs' legacy entries or active buffers, other sites, saved patterns, rules or settings; deletion IDs remain locally. Individual deletion may leave a legacy entry or active buffer. Manage the Knowledge Base and rules separately. Clear keys and save settings; revoke keys with the provider if needed. Provider-side data is not deleted by these controls.

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for more details.

---

## 📦 Building for Chrome Web Store

To build a `.zip` package for Chrome Web Store review:

```bash
chmod +x package-extension.sh
./package-extension.sh
```

This generates `qa-assistant-v2.0.1.zip` with an explicit allowlist of runtime files and the license, with `manifest.json` at the archive root. Existing output is never overwritten; pass a different path to create another archive, e.g. `./package-extension.sh /tmp/qa-assistant-release.zip`. Check the archive and smoke-test the extracted build in Chrome before submission. See [STORE_LISTING.md](STORE_LISTING.md) for the release checklist.

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
