# Privacy Policy for QA Assistant

**Last Updated:** October 11, 2026

QA Assistant ("the Extension", "we", "us", or "our"), developed by QAMethod, is committed to protecting your privacy. This Privacy Policy describes how the Extension collects, uses, and safeguards information when you use QA Assistant.

---

## 1. Core Principle: Privacy by Default

QA Assistant is designed for software quality assurance and test automation professionals. The Extension operates locally on your machine. **We do not track, collect, sell, or store your personal data, web browsing history, or keystrokes on any remote servers.**

---

## 2. Information Handled by the Extension

### A. Element Snippets for Locator Generation
When you explicitly click **Analyze Element** and select a webpage element, the Extension extracts a minimal, pruned DOM representation of that specific element (such as tag name, class names, accessibility attributes, test IDs, and visible text snippet).
- This data is used solely to generate test locators (Playwright, CSS, XPath) for the active element.
- The Extension **does not** scan, record, or transmit the overall content of pages you visit.
- No content scripts run passively; scripts are injected on demand only when you initiate inspection.

### B. User Preferences & API Keys
When configuring the Extension in the Settings panel:
- Your chosen AI provider (Ollama, OpenAI, Anthropic Claude, or Google Gemini), model selections, and custom endpoints are stored locally in your browser's `chrome.storage.local`.
- If you provide API keys for OpenAI, Anthropic, or Google Gemini, they are saved locally in `chrome.storage.local` solely to authenticate your direct requests to those respective APIs.
- API keys are **never** transmitted to any server controlled by QAMethod or any unauthorized third party.

### C. Persistent Knowledge Base & Memory
If you save patterns or use the self-healing feature, selector rules and element signatures are stored in `chrome.storage.local` on your device.

---

## 3. Third-Party AI Services

When you generate or refine locators, requests are routed exclusively to the AI provider you have selected:

- **Ollama (Local AI):** Requests are sent directly to your local Ollama daemon (e.g., `http://localhost:11434`). No data ever leaves your computer.
- **OpenAI:** If you choose OpenAI and provide an API key, element snippets are sent directly to `https://api.openai.com` subject to [OpenAI's Privacy Policy](https://openai.com/privacy).
- **Anthropic Claude:** If you choose Anthropic, element snippets are sent directly to `https://api.anthropic.com` subject to [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).
- **Google Gemini:** If you choose Google Gemini, element snippets are sent directly to Google Gemini APIs subject to [Google's Privacy Policy](https://policies.google.com/privacy).

We do not operate an intermediate proxy server; all communications occur directly between your browser and the configured AI provider.

---

## 4. Data Sharing and Sale

- **No Sale of Data:** We do not sell, rent, trade, or monetize user data under any circumstances.
- **No Analytics or Telemetry:** The Extension contains no tracking pixels, analytics SDKs (such as Google Analytics), or third-party advertising scripts.
- **No Lending or Credit Purposes:** Data is never used for creditworthiness, lending, or advertising profiling.

---

## 5. User Controls and Data Deletion

You retain full control over all data stored by QA Assistant:
- **Clear History:** Click the trash icon in the Side Panel header to delete all cached session data.
- **Delete Knowledge Base Entries:** Remove individual learned locator patterns in the Settings panel.
- **Reset API Keys:** Clear or modify your API keys at any time in the Settings panel.
- **Uninstall:** Removing the Extension from Chrome immediately purges all data stored in `chrome.storage.local`.

---

## 6. Permissions Justification

- **Side Panel (`sidePanel`):** To display the locator generation interface alongside your test application.
- **Storage (`storage`):** To save settings and learned locator patterns locally on your device.
- **Scripting (`scripting`):** To temporarily inject the element inspection crosshair and locator verification badges on demand into the tab you are inspecting.
- **Host Permissions (`*://*/*`):** To enable testing across arbitrary web applications (including localhost, staging, and QA environments) and connect to user-selected AI endpoints.

---

## 7. Changes to This Privacy Policy

If we update this Privacy Policy, the revised version will be published with an updated "Last Updated" date.

---

## 8. Contact Us

If you have any questions or feedback regarding this Privacy Policy, please contact:

**QAMethod Support**  
Email: [support@qamethod.com](mailto:support@qamethod.com)  
Website: [https://github.com/qamethod/qa-assistant](https://github.com/qamethod/qa-assistant)
