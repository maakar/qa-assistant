# Chrome Web Store submission draft — QA Assistant

**Status: working draft for an update to an already-published extension.** This is not the live listing or an approved submission. First compare the published version and existing dashboard disclosures with the intended update; the policy and asset questions below are review items, not established rejection reasons. The older ignored `CHROMEWEBSTORE.md` contains outdated claims and must not be copied as-is.

## Listing text

- **Name:** QA Assistant
- **Category:** Developer Tools (proposed)
- **Language:** English (proposed)

**Short description**

AI-assisted QA locator generation and in-page verification in Chrome's Side Panel.

**Detailed description**

QA Assistant helps testers and developers inspect elements and work with test automation locators without leaving the browser.

- Select an element to capture a structured profile and request CSS, XPath and Playwright locator candidates.
- Check generated or manual locators against the live page and highlight matches. Playwright checks are approximated using browser queries, not run by Playwright; a single match does not guarantee a stable selector. Test candidates in your actual framework.
- Request AI-assisted replacement locators with Heal, and explicitly save useful examples with Learn.
- Choose Ollama, OpenAI, Anthropic Claude, Google Gemini or experimental Chrome Built-in AI, where available. Cloud providers require your own API key. Ollama defaults to localhost but can be configured to use a remote HTTP(S) endpoint.
- Use Freeze for transient UI: open DevTools on the target tab first, then resume execution in DevTools afterwards. Without an attached debugger the page will not pause.

Selected element attributes, text and context can contain sensitive data and are sent to the selected AI engine for generation or healing. Provider policies and retention apply. Review the privacy policy and your endpoint before use.

**Single purpose:** Assist QA testing by inspecting web elements and generating and checking automation locator candidates.

- **Support contact (verify before submission):** support@qamethod.com
- **Support URL (verify before submission):** https://github.com/maakar/qa-assistant/issues

## Manifest permissions: dashboard justifications

| Declaration | Purpose and scope |
| --- | --- |
| `sidePanel` | Show the inspection, locator and settings interface alongside the target site. |
| `storage` | Store settings, rules, knowledge-base entries and per-host history in `chrome.storage.local`; store current cloud API keys and active tab buffers in `chrome.storage.session`. |
| `scripting` | Inject inspection, verification and freeze tools on demand in the target tab; invoke the experimental built-in AI integration in that tab's main world. |
| `*://*/*` host permission | Allow interaction with user-selected HTTP(S) test sites on arbitrary hosts, and requests to AI services including a configurable Ollama endpoint. Content scripts are injected on demand, not declared as passive content scripts. |

## Privacy and data disclosure review

Use the updated `PRIVACY_POLICY.md` as the detailed source, and assess the actual release build against the current dashboard definitions. Do not reuse the old draft's blanket “no user data” or “no third-party sharing” answers.

- **Website content and possibly sensitive categories:** Inspection captures element attributes, text (including descendant text of a container), parent details and a nearby ancestor. Analysis sends selected profile fields, custom rules and, for non-Ollama engines, relevant saved examples to the chosen engine; healing sends selected fields and locators and may make multiple requests. The captured profile is not a full HTML document. Content can include personal, financial, health, communication, authentication or other sensitive information depending on what the user inspects; evaluate the dashboard categories accordingly. Provider responses and saved selectors can also contain page-derived data.
- **Authentication information:** Entered API keys authenticate cloud requests, including model-list requests; Google's key is in the request URL. The settings save flow puts cloud keys in session storage, not persistent local settings. Do not describe Chrome storage as an encrypted secrets vault.
- **Browsing and activity considerations:** The target tab's hostname is used to group history; active tab/session buffers are stored. Element selection and local verification interact with the page. Determine whether these behaviors fall under the dashboard's current web history, user activity or other categories rather than claiming none categorically.
- **Recipients and transport:** Requests go directly to the user-selected provider or Ollama endpoint, not through a QAMethod proxy in the extension code. Ollama can be remote, and HTTP traffic is not encrypted in transit. Provider processing and retention depend on its terms. Experimental Chrome Built-in AI runs in the target page's main world: the injection passes the entire captured profile JSON or refinement object as an argument alongside the constructed prompt, which is more than the selected fields in an external prompt. Page-controlled AI globals can receive the prompt, and responses are posted as messages to the page. Whether page scripts can directly observe the otherwise unused full analysis argument has not been verified; do not assume this data is isolated from the page. Do not promise that data never leaves the device or is never shared.
- **Other requests:** Ollama availability checks and provider model discovery can occur independently of analysis, including on panel/settings initialization, engine selection, key changes or refresh. Model-list requests use the entered cloud key but do not send the element profile. The diagnostics button copies version, tab ID, hostname, session count, provider and timestamp; it is not a general secret scrubber.
- **Controls:** Local history, saved patterns, rules and keys have separate controls. Clearing current-site history does not clear all other sites, tabs, settings or saved patterns; deletion IDs remain locally and individual deletion may leave a legacy entry or active buffer. Clearing local data does not delete provider-side data. Review policy details before making retention or deletion claims.

Dashboard data-use selections and certifications require a release-owner assessment of the complete data flows, actual operations and provider arrangements. Do not pre-check sale, unrelated-use, lending or other certifications without confirming them.

## Release and Developer Dashboard checklist

### Before dashboard submission

- [ ] Identify the currently published item, version, package, listing and privacy disclosures. Compare them with the final update; do not assume that differences from the repository parent are also differences from the published version. Prioritize material changes and any requirements applicable to the update.
- [ ] Release version: **2.0.1** (bumped from published 2.0.0 in `manifest.json`). Confirm release materials are consistent.
- [ ] Compare the existing published privacy policy and dashboard disclosures with the final code and actual data practices. The repository already has a policy that describes session data; the revised `PRIVACY_POLICY.md` is a local draft, not the live or approved policy. Review material differences and any needed corrections, including history profiles and responses. Verify the current public policy URL and update the published text or dashboard only if needed and approved.
- [ ] Review existing ignored `imgs/screenshots/` and the tiles under `imgs/` for sensitive data, visible identifiers, current UI/feature accuracy and store specifications before selecting or uploading them. The screenshots include a demo storefront and visible third-party brands; screenshot 04 also displays a masked key and model names. Replace or recapture as appropriate. Candidate tiles include `imgs/small_promo_tile_440x280.png` and `imgs/marquee_promo_tile_1400x560.png`; the marquee depicts a stylized interface. Do not treat old asset placeholders in `CHROMEWEBSTORE.md` as existing files or assets as approved.
- [ ] Check whether the current assets and any replacement assets meet applicable [image guidelines](https://developer.chrome.com/docs/webstore/images). The 128 px icon's nontransparent pixels extend to approximately 2 px from the edge; assess the guideline's padding recommendation and any screenshot requirements in the context of this update. This review has not established a rejection reason.
- [ ] Review **transport security**: configurable Ollama endpoints can use remote HTTP, sending prompts in clear text. This predates the reviewed merge. Assess applicability of the [policies](https://developer.chrome.com/docs/webstore/program-policies/policies) and [user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including distinctions for localhost and any relevant exceptions, before deciding whether changes are needed. Review applicable provider terms and safeguards.
- [ ] Review **disclosure and consent**: element selection starts analysis immediately, and model discovery can separately transmit API keys. These behaviors predate the reviewed merge. The repository policy already contains disclosures; compare the actual published disclosures and complete installation and in-product flows with the [policy](https://developer.chrome.com/docs/webstore/program-policies/policies) and [FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq). Determine whether any additional disclosure or consent is required; this audit has not established that it is.
- [ ] Assess **storage at rest**: the [user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) describes strong encryption for stored user data. Determine its applicability to the actual stored profiles and responses, verify Chrome storage protections and implement any required safeguards. API keys are saved in session storage, not persistent local settings. Neither compliance nor a violation has been established by this review.
- [ ] Review [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the required affirmative compliance statement on an extension-owned website and restrictions on transfers, use and human access. Verify actual practices and provider agreements first; publish only an accurate statement and do not make unsupported dashboard certifications.
- [ ] Assess least-privilege permissions: determine whether `activeTab` or optional host permissions can cover inspection, verification, healing and configurable endpoint workflows without breaking them; document why broad access remains necessary if retained. A definite violation has not been established.
- [ ] Run the build and validation procedure below on the final intended source. Load and exercise the **exact extracted ZIP** in Chrome with non-sensitive test data: Side Panel, inspection, CSS/XPath and approximated Playwright verification, Heal/Learn, history controls, provider configuration and requests, and Freeze with DevTools open and resume. Check restricted pages and errors as applicable. Provider availability, credentials and Chrome Built-in AI support vary; record what was actually tested.
- [ ] Review listing copy, permissions, disclosure categories, third-party processing, retention/deletion and data-use certifications against the final package and current Chrome Web Store requirements. Resolve discrepancies before submission.

### Account-only tasks (release owner)

- [ ] Sign in to the correct Chrome Web Store developer account; complete any required registration, identity, contact and security steps and applicable fees. Confirm the publisher name, support email and support URL.
- [ ] Select the existing published item, upload the validated ZIP as an update when authorized, and confirm the detected manifest version and permissions. Review the existing listing, category, language, screenshots and promotional graphics; change them only as appropriate.
- [ ] Enter the verified public privacy policy URL and complete the single-purpose, permission-justification, data-use disclosure and certification fields based on the final review. Supply any reviewer instructions or credentials only if needed, using safe test data.
- [ ] Choose visibility, regions and distribution/release settings intentionally; review all dashboard previews and required fields. Submit for review only after approval, monitor review feedback, and publish according to the chosen release setting. No submission or publication is implied by this draft.

## Repeatable build validation

Run from the repository root after the version decision and final code review. The packager uses an explicit file allowlist and refuses to overwrite existing output. Keep the printed staging path until the validated ZIP is uploaded. If source contents change, rebuild and repeat validation and the Chrome smoke test.

```bash
set -euo pipefail
node --check background.js
node --check content.js
node --check sidepanel.js
node --test tests/*.test.js
stage=$(mktemp -d)
mkdir "$stage/unpacked"
version=$(node -p "require('./manifest.json').version")
zip="$stage/qa-assistant-v${version}.zip"
./package-extension.sh "$zip"
unzip -t "$zip"
unzip -Z1 "$zip"
unzip -p "$zip" manifest.json
sha256sum "$zip"
unzip -q "$zip" -d "$stage/unpacked"
printf 'Validated ZIP: %s\nLoad unpacked for smoke test: %s\n' "$zip" "$stage/unpacked"
```

Confirm the archive's root manifest, version, required runtime files and permissions, review every entry for unnecessary or sensitive material, and compare the hash immediately before upload. Run the manual Chrome checks above against `"$stage/unpacked"`; ZIP integrity and the automated history tests alone do not establish release readiness. After the upload and release records are complete, remove the temporary staging directory.
