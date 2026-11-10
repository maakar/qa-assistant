# Privacy Policy for QA Assistant

**Last Updated:** November 10, 2026

This policy describes data handled by the QA Assistant browser extension, developed by QAMethod. Your choice of AI engine and endpoint determines where AI requests are sent. Review the applicable provider's terms and privacy policy before inspecting sensitive applications.

---

## 1. Information Handled by the Extension

### Element inspection and locator generation

When you start **Analyze Element** and select an element, the extension captures a structured profile, not a full HTML document. It includes the element's tag, ID, classes, test attributes, name, placeholder, title, role, aria-label and up to 100 characters of text. It also captures the parent tag, ID and classes, plus attributes of a nearby stable ancestor when available. Selecting a container can include text from its descendants; attributes and text may contain sensitive information.

For analysis, the extension builds a prompt from these fields, including element text (normally up to 50 characters, with some deterministic candidates using up to 80), custom rules and, for non-Ollama engines, relevant saved selector examples. **Heal** builds a refinement prompt from selected profile fields, the existing locator, locator type, a match-count value and previously attempted locators. The current heal flow supplies a match count of zero, not necessarily the actual verification count. A heal operation can issue multiple requests. Generated locators and other provider responses can also contain information derived from the inspected page.

The extension injects its content script on demand for inspection, verification or freezing; the manifest does not declare a passive content script. Locator verification queries the live page locally and highlights matches. The extension uses the current tab's hostname to group history. It does not send the full page HTML as the AI prompt, but you should inspect only data you are comfortable sharing with the selected engine.

### Browser storage

- `chrome.storage.local` holds engine and model settings, the configured Ollama endpoint, interface preferences, custom rules, saved knowledge-base entries and per-host analysis history. History includes selected element profiles, generated responses, titles and provider labels. Knowledge-base entries may include selector text and selected element text. Bundled seed patterns are added on installation or update.
- When settings are saved, OpenAI, Anthropic and Google API keys are stored in `chrome.storage.session`, not persistent local settings. Session storage also holds active per-tab inspection and response buffers so they can survive service-worker restarts. Keys generally need to be re-entered after a browser restart.
- Chrome storage is not described here as encrypted credential storage. Protect your browser profile and device accordingly.

---

## 2. AI Providers and Other Requests

For external engines, AI generation and healing requests go directly from the extension to the selected endpoint; the extension code does not use a QAMethod proxy. Provider processing and retention are governed by the provider's policies and your agreement with it:

- **Ollama:** The default endpoint is `http://localhost:11434`, but the endpoint is configurable and may be remote. The extension sends prompts to that endpoint; an HTTP connection is not encrypted in transit. A local endpoint alone does not guarantee the behavior of other software on your machine.
- **OpenAI:** Requests go to `api.openai.com`, using your API key. See [OpenAI's Privacy Policy](https://openai.com/privacy).
- **Anthropic Claude:** Requests go to `api.anthropic.com`, using your API key. See [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).
- **Google Gemini:** Requests go to `generativelanguage.googleapis.com`; the API key is included in the request URL. See [Google's Privacy Policy](https://policies.google.com/privacy).
- **Chrome Built-in AI:** Experimental support invokes a detected Prompt API in the target tab's main world. The injection passes the entire captured profile JSON for analysis, or the entire refinement object for healing, as an argument alongside the constructed prompt. Page-controlled AI globals can receive the prompt, and responses are posted as messages to the page. Whether page scripts can directly observe the otherwise unused full analysis argument has not been verified; do not assume this data is isolated from the page. Availability and behavior depend on the page, Chrome and its configuration.

The settings interface also makes model-list requests: Ollama availability checks can occur when the panel initializes or settings are opened, and model discovery can occur on engine selection, key changes or refresh. Cloud model-list requests include the entered provider key but not the selected element profile. An OpenAI generation request may be retried with a fallback model after a 404. These requests are separate from element inspection.

The extension includes a **Copy Beta Diagnostics** action that copies version, tab ID, target hostname, session count, provider and timestamp to your clipboard. It does not export session logs or implement a general-purpose secret scrubber. Review diagnostics and any copied locator or master output before sharing them.

---

## 3. User Controls and Deletion

- **Clear History:** The header trash button clears the current hostname's stored site history, removes the current tab's legacy history entry and clears that tab's active session buffer. It does not clear other sites' history, other tabs' legacy entries or active buffers, knowledge-base entries, rules, settings or keys. Deletion IDs from the site history are retained locally to prevent stale panels from restoring deleted sessions.
- **Delete an individual session:** Use its trash button. A deletion ID remains in local storage; an active session buffer or legacy entry can remain until separately cleared or removed.
- **Knowledge Base and rules:** Delete individual entries or use **Reset All** for the Knowledge Base; delete custom rules individually in Settings. These controls do not clear history.
- **API keys:** Clear or replace key fields and click **Save Engine Settings**. This updates the session keys. To invalidate a compromised key, revoke it with the provider as well.
- **Uninstall:** Removing the extension removes its Chrome extension storage. This does not delete data already sent to providers, copied to the clipboard, or retained in separate backups or logs.

---

## 4. Permissions

- **Side Panel (`sidePanel`):** Displays the locator interface beside the target application.
- **Storage (`storage`):** Saves settings, history, rules and learned patterns, and holds session keys and active buffers.
- **Scripting (`scripting`):** Injects inspection, verification and freeze functionality into the selected tab on demand.
- **Host permissions (`*://*/*`):** Allow interaction with HTTP(S) test applications and requests to the selected AI endpoints, including configurable Ollama endpoints.

---

## 5. Changes and Contact

If this policy changes, the revised version will be published with an updated date. For questions or feedback:

**QAMethod Support**  
Email: [support@qamethod.com](mailto:support@qamethod.com)  
Website: [https://github.com/maakar/qa-assistant](https://github.com/maakar/qa-assistant)
