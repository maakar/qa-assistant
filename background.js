// background.js - Service Worker for Smart QA Selector Assistant

// ─── Session State (BUG-01) ───────────────────────────────────────────────────
// Kept in-memory as a fast cache, but persisted to chrome.storage.session so it
// survives Service Worker restarts within the same browser session.
let activeSessionsByTab = {};

async function hydrateSessionState() {
  try {
    const data = await chrome.storage.session.get(['activeSessionsByTab']);
    if (data.activeSessionsByTab) activeSessionsByTab = data.activeSessionsByTab;
  } catch (e) {
    console.warn('QA Assistant: Could not hydrate session state:', e);
  }
}

async function persistSessionState() {
  try {
    await chrome.storage.session.set({ activeSessionsByTab });
  } catch (e) {
    console.warn('QA Assistant: Could not persist session state:', e);
  }
}

// Serialize site-history mutations in the service worker so multiple panels cannot
// overwrite each other's snapshots. Deleted IDs are retained as tombstones.
const siteStateQueues = new Map();

function generateStoredSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function queueSiteStateMutation(key, mutator) {
  const previous = siteStateQueues.get(key) || Promise.resolve();
  const next = previous.then(async () => {
    const result = await chrome.storage.local.get([key]);
    const state = result[key] || { history: [], deletedIds: [] };
    state.history = (state.history || []).map(session => ({
      ...session,
      id: session.id || generateStoredSessionId()
    }));
    state.deletedIds = state.deletedIds || [];
    await mutator(state);
    state.timestamp = Date.now();
    await chrome.storage.local.set({ [key]: state });
    chrome.runtime.sendMessage({ action: 'SITE_STATE_CHANGED', key }).catch(() => {});
    return state;
  }).finally(() => {
    if (siteStateQueues.get(key) === next) siteStateQueues.delete(key);
  });
  siteStateQueues.set(key, next);
  return next;
}

// Hydrate immediately on every SW startup
hydrateSessionState();

// ─── Shared Gemini Nano API detector (injected into MAIN world) ───────────────
// Defined as a string so it can be prepended to both analysis and refinement
// scripts, eliminating the code duplication (BUG-04 / code quality).
const GET_API_FN = `
  const getApi = () => {
    if (typeof ai !== 'undefined' && ai.languageModel) return ai.languageModel;
    if (window.ai?.languageModel) return window.ai.languageModel;
    if (typeof ai !== 'undefined' && ai.assistant) return ai.assistant;
    if (window.ai?.assistant) return window.ai.assistant;
    if (typeof LanguageModel !== 'undefined' && LanguageModel.create) return LanguageModel;
    if (window.LanguageModel?.create) return window.LanguageModel;
    if (typeof model !== 'undefined' && model.create) return model;
    if (window.model?.create) return window.model;
    return null;
  };
`;

function sendAiError(tabId, actionType, message, locatorType = undefined) {
  chrome.runtime.sendMessage({
    action: actionType,
    data: `Error: ${message}`,
    locatorType,
    tabId
  }).catch(() => {});
}

function validateExternalAiConfig(config) {
  if (config.engine === 'openai') {
    if (!config.openaiKey) return 'OpenAI API key is missing. Add it in Settings.';
    if (!config.openaiModel) return 'OpenAI model is missing. Select a model in Settings.';
  }

  if (config.engine === 'anthropic') {
    if (!config.anthropicKey) return 'Anthropic API key is missing. Add it in Settings.';
    if (!config.anthropicModel) return 'Anthropic model is missing. Select a model in Settings.';
  }

  if (config.engine === 'google') {
    if (!config.googleKey) return 'Google Gemini API key is missing. Add it in Settings.';
    if (!config.googleModel) return 'Google Gemini model is missing. Select a model in Settings.';
  }

  if (config.engine === 'ollama') {
    const url = (config.ollamaUrl || 'http://localhost:11434').trim();
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return 'Ollama URL must start with http:// or https://.';
    } catch {
      return 'Ollama URL is invalid. Check Settings.';
    }
    if (!config.ollamaModel) return 'Ollama model is missing. Select a local model in Settings.';
  }

  return null;
}

// ─── Side Panel Behavior & Scope (FEAT-P7) ────────────────────────────────────
let currentPanelScope = 'tab';
const openPanelTabs = new Set();

async function applySidePanelScope(scope) {
  currentPanelScope = scope || 'tab';
  if (currentPanelScope === 'all') {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    }
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }).catch(() => {});
    }
    const tabs = await chrome.tabs.query({}).catch(() => []);
    for (const tab of tabs) {
      if (tab.id) {
        chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true }).catch(() => {});
      }
    }
  } else {
    // Tab-only mode: disable global default so unopened tabs do not show panel
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
    }
    // Reconcile tabs: for any tab without an active open panel, disable its override
    const tabs = await chrome.tabs.query({}).catch(() => []);
    for (const tab of tabs) {
      if (tab.id && !openPanelTabs.has(tab.id)) {
        chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => {});
      }
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  if (currentPanelScope === 'tab') {
    chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true }).catch(() => {});
    chrome.sidePanel.open({ tabId: tab.id }).catch((err) => {
      console.warn('QA Assistant: tab open error:', err);
    });
  } else {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

chrome.storage.local.get(['sidePanelScope'], (data) => {
  applySidePanelScope(data.sidePanelScope || 'tab');
});

// ─── Install / Update ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log("QA Assistant: Service Worker Active.");
  chrome.storage.local.get(['sidePanelScope'], (data) => {
    applySidePanelScope(data.sidePanelScope || 'tab');
  });
  syncKnowledgeSeed();
});

// ─── Knowledge Seed (BUG-06) ──────────────────────────────────────────────────
// Now supports versioned seed format { "version": N, "entries": [...] }.
// New entries are only merged when seed version exceeds the last installed version,
// allowing developers to push new patterns to existing users via extension updates.
async function syncKnowledgeSeed() {
  try {
    const response = await fetch(chrome.runtime.getURL('knowledge_seed.json'));
    const seedData = await response.json();

    // Support plain array (legacy v1) and versioned object (v2+)
    const seedVersion = seedData.version || 1;
    const entries = Array.isArray(seedData) ? seedData : (seedData.entries || []);

    chrome.storage.local.get(['knowledgeBase', 'knowledgeSeedVersion'], (res) => {
      const kb = res.knowledgeBase || [];
      const installedVersion = res.knowledgeSeedVersion || 0;

      if (seedVersion <= installedVersion) return; // Already up to date

      const newEntries = entries.filter(seed =>
        !kb.some(existing => existing.selector === seed.selector && existing.tagName === seed.tagName)
      );

      const updates = { knowledgeSeedVersion: seedVersion };
      if (newEntries.length > 0) {
        updates.knowledgeBase = [...kb, ...newEntries];
        console.log(`Knowledge Hub: Merged ${newEntries.length} new patterns from seed v${seedVersion}.`);
      }
      chrome.storage.local.set(updates);
    });
  } catch (err) {
    console.error("Knowledge Hub Seed Error:", err);
  }
}

// ─── Port Listener ────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith('sidepanel_')) {
    const tabId = parseInt(port.name.split('_')[1]);
    openPanelTabs.add(tabId);
    port.onDisconnect.addListener(() => {
      openPanelTabs.delete(tabId);
      if (activeSessionsByTab[tabId]) {
        activeSessionsByTab[tabId].isInspecting = false;
        persistSessionState();
      }
      if (tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'CLEAR_HIGHLIGHTS' }).catch(() => {});
        chrome.tabs.sendMessage(tabId, { action: 'STOP_INSPECTION' }).catch(() => {});
      }
    });
  }
});

// ─── Main Message Router (BUG-02) ─────────────────────────────────────────────
// All JSON.parse calls are now wrapped in try/catch so malformed payloads
// cannot break the listener for subsequent messages.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : message.tabId;

  if (message.action === 'ELEMENT_SELECTED') {
    let targetData;
    try {
      targetData = JSON.parse(message.data);
    } catch (e) {
      console.error('QA Assistant: Failed to parse element data:', e);
      return true;
    }

    activeSessionsByTab[tabId] = {
      ...activeSessionsByTab[tabId],
      targetData,
      accumulatedText: "",
      isStreaming: true,
      isInspecting: false
    };
    persistSessionState();

    chrome.runtime.sendMessage({
      action: 'ANALYSIS_START',
      data: message.data,
      tabId: tabId
    }).catch(() => {});

    handleAiRequest(tabId, message.data);

  } else if (message.action === 'AI_STREAM_CHUNK') {
    if (activeSessionsByTab[tabId]) {
      if (message.data === "FinishedSuccessfullyMark") {
        activeSessionsByTab[tabId].isStreaming = false;
      } else if (message.isChunk) {
        activeSessionsByTab[tabId].accumulatedText = (activeSessionsByTab[tabId].accumulatedText || "") + message.data;
      } else {
        activeSessionsByTab[tabId].accumulatedText = message.data;
      }
      persistSessionState();
    }
  } else if (message.action === 'START_INSPECTION_SIGNAL') {
    if (!activeSessionsByTab[tabId]) activeSessionsByTab[tabId] = {};
    activeSessionsByTab[tabId].isInspecting = true;
    persistSessionState();
  } else if (message.action === 'STOP_INSPECTION_SIGNAL') {
    if (activeSessionsByTab[tabId]) {
      activeSessionsByTab[tabId].isInspecting = false;
      persistSessionState();
    }
  } else if (message.action === 'GET_ACTIVE_SESSION') {
    sendResponse(activeSessionsByTab[tabId] || null);
  } else if (message.action === 'CLEAR_ACTIVE_SESSION') {
    delete activeSessionsByTab[tabId];
    persistSessionState();
  } else if (message.action === 'UPDATE_PANEL_SCOPE') {
    applySidePanelScope(message.scope);
  } else if (message.action === 'GET_SITE_STATE') {
    const key = message.key;
    const legacyKey = message.legacyKey;
    (async () => {
      const result = await chrome.storage.local.get([key, legacyKey]);
      let state = result[key];
      if (!state && result[legacyKey]?.url === message.siteHost) {
        state = result[legacyKey];
      }
      state = state || { history: [], deletedIds: [] };
      state.history = (state.history || []).map(session => ({
        ...session,
        id: session.id || generateStoredSessionId()
      }));
      sendResponse(state);
    })();
  } else if (message.action === 'UPSERT_SITE_SESSIONS') {
    queueSiteStateMutation(message.key, async (state) => {
      const deleted = new Set(state.deletedIds || []);
      const incomingList = message.history || [];
      for (let i = incomingList.length - 1; i >= 0; i--) {
        const incoming = incomingList[i];
        const session = { ...incoming, id: incoming.id || generateStoredSessionId() };
        if (deleted.has(session.id)) continue;
        const index = state.history.findIndex(existing => existing.id === session.id);
        if (index >= 0) state.history[index] = session;
        else state.history.unshift(session);
      }
      state.url = message.siteHost;
    }).then(() => sendResponse({ ok: true }));
  } else if (message.action === 'DELETE_SITE_SESSION') {
    queueSiteStateMutation(message.key, async (state) => {
      state.history = state.history.filter(session => session.id !== message.sessionId);
      if (message.sessionId && !state.deletedIds.includes(message.sessionId)) {
        state.deletedIds.push(message.sessionId);
      }
    }).then(() => sendResponse({ ok: true }));
  } else if (message.action === 'CLEAR_SITE_STATE') {
    queueSiteStateMutation(message.key, async (state) => {
      state.deletedIds = [...new Set([...(state.deletedIds || []), ...state.history.map(s => s.id).filter(Boolean)])];
      state.history = [];
      state.url = message.siteHost;
    }).then(() => sendResponse({ ok: true }));
  } else if (message.action === 'REFINE_LOCATOR') {
    handleRefinementRequest(tabId, message.data);
  }
  return true;
});

// ─── Intelligence Context ─────────────────────────────────────────────────────
async function getIntelligenceContext(tagName, engine = 'gemini-nano') {
  return new Promise((resolve) => {
    chrome.storage.local.get(['knowledgeBase', 'customRules'], (res) => {
      const kb = res.knowledgeBase || [];
      const rules = res.customRules || [];
      const relevant = kb.filter(item => item.tagName === tagName || item.tagName === "MANUAL")
                         .slice(-4);

      let context = "";

      if (rules.length > 0) {
        context += "\n### CUSTOM PROJECT RULES (STRICT):\n";
        // SEC: Sanitize rules — strip angle brackets and newlines to prevent prompt injection
        rules.forEach((rule, i) => {
          const safeRule = String(rule)
            .replace(/[<>]/g, '')
            .replace(/\n/g, ' ')
            .replace(/"/g, "'")
            .substring(0, 200);
          context += `${i + 1}. ${safeRule}\n`;
        });
      }

      // Small models (Ollama 7B/8B) fail at abstracting patterns from few-shot examples
      // and will literally copy the text from the examples. Skip for Ollama.
      if (relevant.length > 0 && engine !== 'ollama') {
        context += "\n### USER PREFERENCES (LEARNED):\n";
        relevant.forEach(ex => {
          context += `- Element <${ex.tagName}>: Use style of \`${ex.selector}\` (${ex.type})\n`;
        });
        context += "WARNING: THESE ARE ONLY STYLISTIC EXAMPLES. DO NOT COPY THEIR LITERAL TEXT OR IDs. USE ONLY THE TARGET ELEMENT'S DATA!\n";
      }

      resolve(context);
    });
  });
}

// ─── Request Dispatchers ──────────────────────────────────────────────────────
async function handleAiRequest(tabId, elementDataJson) {
  let dataObj;
  try {
    dataObj = JSON.parse(elementDataJson);
  } catch (e) {
    console.error('QA Assistant: handleAiRequest parse error:', e);
    return;
  }

  chrome.storage.local.get(['aiConfig'], async (res) => {
    const config = res.aiConfig || { engine: 'ollama', ollamaUrl: 'http://localhost:11434' };
    const sessionRes = await chrome.storage.session.get(['openaiKey', 'anthropicKey', 'googleKey']);
    if (sessionRes.openaiKey) config.openaiKey = sessionRes.openaiKey;
    if (sessionRes.anthropicKey) config.anthropicKey = sessionRes.anthropicKey;
    if (sessionRes.googleKey) config.googleKey = sessionRes.googleKey;
    const context = await getIntelligenceContext(dataObj.tagName, config.engine);

    if (config.engine === 'gemini-nano') {
      return handleGeminiNanoRequest(tabId, elementDataJson, context);
    } else {
      return handleExternalAiRequest(tabId, dataObj, context, config, 'analysis');
    }
  });
}

async function handleRefinementRequest(tabId, data) {
  chrome.storage.local.get(['aiConfig'], async (res) => {
    const config = res.aiConfig || { engine: 'ollama', ollamaUrl: 'http://localhost:11434' };
    const sessionRes = await chrome.storage.session.get(['openaiKey', 'anthropicKey', 'googleKey']);
    if (sessionRes.openaiKey) config.openaiKey = sessionRes.openaiKey;
    if (sessionRes.anthropicKey) config.anthropicKey = sessionRes.anthropicKey;
    if (sessionRes.googleKey) config.googleKey = sessionRes.googleKey;
    const context = await getIntelligenceContext(data.element.tagName, config.engine);

    if (config.engine === 'gemini-nano') {
      return handleGeminiNanoRefinement(tabId, data, context);
    } else {
      return handleExternalAiRequest(tabId, data, context, config, 'refinement');
    }
  });
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────
function buildDeterministicCandidates(data) {
  const candidates = [];
  const tag = String(data.tagName || '').toLowerCase();
  const text = String(data.textSnippet || '').trim().replace(/\s+/g, ' ').substring(0, 80);
  const stableId = data.id && /^[a-zA-Z][a-zA-Z0-9\-_:.]*$/.test(data.id) && !/\d{5,}/.test(data.id);
  const testId = data.testId || data.dataCy;

  if (testId) {
    candidates.push(`CSS: [data-testid="${testId}"] or [data-qa="${testId}"] or [data-cy="${testId}"]`);
    candidates.push(`Playwright: page.getByTestId('${testId}')`);
  }

  if (stableId) {
    candidates.push(`CSS: #${data.id}`);
    candidates.push(`XPath: //*[@id='${data.id}']`);
  }

  if (data.role && (data.ariaLabel || text)) {
    const name = data.ariaLabel || text;
    candidates.push(`Playwright: page.getByRole('${data.role}', { name: '${name}' })`);
  }

  if ((tag === 'input' || tag === 'textarea') && data.placeholder) {
    candidates.push(`Playwright: page.getByPlaceholder('${data.placeholder}')`);
    candidates.push(`CSS: [placeholder="${data.placeholder}"]`);
  }

  if ((tag === 'input' || tag === 'textarea') && data.name) {
    candidates.push(`CSS: ${tag}[name="${data.name}"]`);
  }

  if (candidates.length === 0) return '';
  return `\n### DETERMINISTIC CANDIDATES TO PREFER IF VALID:\n${candidates.map(c => `- ${c}`).join('\n')}\n`;
}

function constructPrompt(type, data, context, engine = 'gemini-nano') {
  if (type === 'analysis') {
    const isLatin = (s) => s && s.trim() !== "" && /^[a-zA-Z0-9\s\-_:\.#]*$/.test(s);
    const anchor = data.anchorData || {};
    const cleanId = isLatin(data.id) ? data.id : "";
    const anchorId = isLatin(anchor.id) ? anchor.id : "";
    const anchorTestId = isLatin(anchor.testId) ? anchor.testId : "";
    const anchorCss = anchorTestId ? `[data-testid='${anchorTestId}']` : (anchorId ? `#${anchorId}` : "");

    let basePrompt = `System: You are a machine-readable QA selector generator.
    Target Profile:
    - TAG: <${data.tagName}>
    - ID: ${cleanId || "none"}
    - TEST ID: ${data.testId || "none"}
    - DATA-CY: ${data.dataCy || "none"}
    - NAME: ${data.name || "none"}
    - PLACEHOLDER: ${data.placeholder || "none"}
    - TITLE: ${data.title || "none"}
    - CLASSES: ${data.className || "none"}
    - ROLE: ${data.role || "none"}
    - ARIA: ${data.ariaLabel || "none"}
    - TEXT: "${(data.textSnippet || "").substring(0, 50)}"
    - PARENT: <${data.parentData ? data.parentData.tagName : "none"}> (ID: ${data.parentData?.id || "none"}, Classes: ${data.parentData?.className || "none"})
    - STABLE ANCESTOR: ${anchorCss || "none"}
    
    ${buildDeterministicCandidates(data)}
    ${context}
    
    Task:
    Generate exactly 2 variants for ALL 3 categories below: CSS, XPATH, and PLAYWRIGHT.
    Format your response exactly as follows:\n\n`;

    const bestPractices = `
    - BEST PRACTICE: ALWAYS prioritize data-testid, data-qa, or data-cy if available.
    - BEST PRACTICE: AVOID index-based selectors like nth-child(2) or [2] UNLESS absolutely necessary for uniqueness.
    - BEST PRACTICE: Keep selectors short. Do NOT chain more than 3 elements.
    - BEST PRACTICE: For Playwright, ALWAYS prefer getByRole or getByTestId over page.locator() when possible.
    - BEST PRACTICE: In XPath, ALWAYS use the descendant axis (//) between an ancestor and the target element. NEVER use a single slash (/) for the final step — /a is wrong, //a is correct.
    - XPATH STYLE: Prefer readable XPath over defensive boilerplate. Use @id='x', @data-testid='x', @class='single-class', contains(@class,'class'), and normalize-space()='Text' when sufficient.
    - XPATH STYLE: Avoid contains(concat(' ', normalize-space(@class), ' '), ' class ') unless the element has many classes and exact class-token matching is truly necessary.
    - XPATH STYLE: Prefer //button[normalize-space()='Save'] over //button[text()='Save']; prefer //*[@id='main']//button[normalize-space()='Save'] over long class chains.
    - CRITICAL XPATH RULE: The [XPATH] block must contain ONLY valid XPath, never CSS syntax. XPath should usually start with //, .//, or (. Do NOT write CSS IDs like #leftmenuinner inside XPath.
    - CRITICAL CSS RULE: NEVER use :text(), :has-text(), :visible, or :nth-match() in the [CSS] block. These are Playwright-only pseudo-selectors. NEVER use [textContent="..."], [text="..."], or [innerText="..."] either. Standard CSS cannot match text content! The [CSS] block must contain ONLY standard CSS selectors that work in a browser. To match by text, use XPath text() or a Playwright getByText locator instead.`;

    if (engine === 'ollama') {
      basePrompt += `    [CSS]
    \`\`\`
    selector_string
    \`\`\`
    
    [XPATH]
    \`\`\`
    selector_string
    \`\`\`
    
    [PLAYWRIGHT]
    \`\`\`
    selector_string
    \`\`\`
    
    Rules:
    - No explanations or preamble.
    - Output ONLY the category headers and the code blocks.
    - DO NOT OUTPUT RAW LINES. YOU MUST WRAP SELECTORS IN TRIPLE BACKTICKS.
    - CRITICAL: DO NOT write full CSS rules (no { }). DO NOT write JavaScript DOM commands. Output ONLY the literal selector string!
    - CRITICAL: DO NOT invent or guess attributes. Only use attributes provided in the Target Profile. DO NOT hallucinate IDs based on the User Preferences!${bestPractices}`;
    } else if (engine === 'openai') {
      basePrompt += `    [CSS]
    \`\`\`css
    selector_string
    \`\`\`
    
    [XPATH]
    \`\`\`xpath
    selector_string
    \`\`\`
    
    [PLAYWRIGHT]
    \`\`\`javascript
    selector_string
    \`\`\`
    
    Rules:
    - No explanations or preamble.
    - Output only the category headers and code blocks.
    - XPath must use text()='...' and not @text().
    - DO NOT invent attributes.${bestPractices}`;
    } else {
      // Gemini Nano
      basePrompt += `    [CSS]
    \`selector_string\`
    \`selector_string\`
    
    [XPATH]
    \`selector_string\`
    \`selector_string\`
    
    [PLAYWRIGHT]
    \`selector_string\`
    \`selector_string\`
    
    Rules:
    - No explanations or preamble.
    - Output only the category headers and code blocks.
    - XPath must use text()='...' and not @text().
    - CRITICAL: DO NOT invent or guess attributes. Only use attributes provided in the profile.${bestPractices}`;
    }

    return basePrompt;
  } else {
    const { element, locatorType, oldLocator, matchCount } = data;

    const isLatin = (s) => s && s.trim() !== "" && /^[a-zA-Z0-9\s\-_:\.#]*$/.test(s);
    const anchor = element.anchorData || {};
    const cleanId = isLatin(element.id) ? element.id : "";
    const anchorId = isLatin(anchor.id) ? anchor.id : "";
    const anchorTestId = isLatin(anchor.testId) ? anchor.testId : "";
    const anchorCss = anchorTestId ? `[data-testid='${anchorTestId}']` : (anchorId ? `#${anchorId}` : "");

    const profileStr = `
    Target Profile:
    - TAG: <${element.tagName}>
    - ID: ${cleanId || "none"}
    - TEST ID: ${element.testId || "none"}
    - DATA-CY: ${element.dataCy || "none"}
    - NAME: ${element.name || "none"}
    - PLACEHOLDER: ${element.placeholder || "none"}
    - TITLE: ${element.title || "none"}
    - CLASSES: ${element.className || "none"}
    - ROLE: ${element.role || "none"}
    - ARIA: ${element.ariaLabel || "none"}
    - TEXT: "${(element.textSnippet || "").substring(0, 50)}"
    - PARENT: <${element.parentData ? element.parentData.tagName : "none"}> (ID: ${element.parentData?.id || "none"}, Classes: ${element.parentData?.className || "none"})
    - STABLE ANCESTOR: ${anchorCss || "none"}`;

    // Build the "already tried" exclusion block
    const excludeLocators = Array.isArray(data.excludeLocators) ? data.excludeLocators : [];
    const exclusionBlock = excludeLocators.length > 0
      ? `\nDO NOT RETURN any of these locators — they have already been tried and failed:\n` +
        excludeLocators.map(l => `  - \`${l}\``).join('\n') + `\n`
      : '';

    let refPrompt;
    if (engine === 'ollama') {
      refPrompt = `Fix this broken ${locatorType} locator. It matched ${matchCount} elements (should be 1).\n` +
        `BROKEN: \`${oldLocator}\`\n` +
        `${profileStr}\n` +
        `${exclusionBlock}\n` +
        `OUTPUT FORMAT — respond with EXACTLY this structure, nothing else:\n` +
        `\`\`\`\n` +
        `your_fixed_selector_here\n` +
        `\`\`\`\n\n` +
        `STRICT RULES:\n` +
        `- ONE selector only. No alternatives.\n` +
        `- NEVER write Python, JavaScript, functions, imports, or class definitions.\n` +
        `- NEVER add comments, explanations, or text outside the code block.\n` +
        `- Output the LITERAL selector string (e.g. #id .class, //xpath, page.getByRole(...)).\n` +
        `- Do NOT use attributes not listed in the Target Profile.\n` +
        `- XPath RULE: ALWAYS use // (descendant axis) before the target element, NEVER a bare / (child axis). Write //a not /a.\n` +
        `- XPath STYLE: Prefer compact readable XPath. Avoid contains(concat(' ', normalize-space(@class), ' '), ' class ') unless exact class-token matching is required.\n` +
        `- CSS RULE: NEVER use [textContent="..."], [text="..."], :text(), or :has-text() in CSS. Standard CSS cannot match text content.`;
    } else {
      // OpenAI / Gemini Nano
      refPrompt = `Fix this broken ${locatorType} locator. It matched ${matchCount} elements (should be exactly 1).\n` +
        `BROKEN: \`${oldLocator}\`\n` +
        `${profileStr}\n` +
        `${exclusionBlock}\n` +
        `Reply with ONLY a single code block containing the fixed selector. ` +
        `No explanations. No Python. No JavaScript. Just the selector string inside triple backticks. ` +
        `XPath rule: use // (descendant) before the target — never a bare / (direct child). ` +
        `XPath style: prefer compact readable XPath; avoid normalize-space(@class) token boilerplate unless required. ` +
        `CSS rule: NEVER use [textContent="..."], [text="..."], :text(), or :has-text(). Standard CSS cannot match text.`;
    }
    return refPrompt;
  }
}

function sendProviderChunk(tabId, actionType, content, locatorType) {
  if (!content) return;
  chrome.runtime.sendMessage({
    action: actionType,
    data: content,
    isChunk: true,
    locatorType,
    tabId
  }).catch(() => {});
}

function sendProviderFinished(tabId, actionType, locatorType) {
  chrome.runtime.sendMessage({
    action: actionType,
    data: "FinishedSuccessfullyMark",
    locatorType,
    tabId
  }).catch(() => {});
}

async function readOpenAICompatibleStream(response, tabId, actionType, locatorType) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.trim() === "") continue;
      if (line.trim() === "data: [DONE]") return;

      try {
        const json = JSON.parse(line.replace(/^data: /, ''));
        sendProviderChunk(tabId, actionType, json.choices[0]?.delta?.content || "", locatorType);
      } catch (e) {}
    }
  }
}

async function readAnthropicStream(response, tabId, actionType, locatorType) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop();

    for (const event of events) {
      const dataLine = event.split('\n').find(line => line.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const json = JSON.parse(dataLine.replace(/^data: /, ''));
        if (json.type === 'content_block_delta') {
          sendProviderChunk(tabId, actionType, json.delta?.text || "", locatorType);
        }
      } catch (e) {}
    }
  }
}

async function getProviderErrorDetails(response) {
  try {
    const raw = await response.text();
    if (!raw) return '';

    try {
      const json = JSON.parse(raw);
      const err = json.error || json;
      const parts = [
        err.code ? `code=${err.code}` : '',
        err.type ? `type=${err.type}` : '',
        err.message ? String(err.message).replace(/\s+/g, ' ').substring(0, 240) : ''
      ].filter(Boolean);
      return parts.length ? ` ${parts.join(' | ')}` : '';
    } catch {
      return ` ${raw.replace(/\s+/g, ' ').substring(0, 240)}`;
    }
  } catch {
    return '';
  }
}

// ─── External AI (OpenAI / Ollama / Cloud Providers) ─────────────────────────
async function handleExternalAiRequest(tabId, data, context, config, mode) {
  const prompt = constructPrompt(mode, data, context, config.engine);
  const actionType = mode === 'analysis' ? 'AI_STREAM_CHUNK' : 'AI_REFINEMENT_CHUNK';
  const locatorType = mode === 'refinement' ? data.locatorType : undefined;
  const configError = validateExternalAiConfig(config);

  if (configError) {
    sendAiError(tabId, actionType, configError, locatorType);
    return;
  }

  let url, body, headers = { 'Content-Type': 'application/json' };

  const SYSTEM_MSG = mode === 'analysis'
    ? 'You are a QA selector generator. Output only the requested selector categories and code blocks. Never write explanations, comments, functions, imports, or prose.'
    : 'You are a QA selector generator. Output only one raw selector string inside a single code block. Never write explanations, comments, functions, imports, or prose.';

  if (config.engine === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers['Authorization'] = `Bearer ${config.openaiKey}`;
    body = {
      model: config.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_MSG },
        { role: 'user', content: prompt }
      ],
      stream: true
    };
  } else if (config.engine === 'ollama') {
    url = `${(config.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1/chat/completions`;
    body = {
      model: config.ollamaModel,
      messages: [
        { role: 'system', content: SYSTEM_MSG },
        { role: 'user', content: prompt }
      ],
      stream: true
    };
  } else if (config.engine === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = config.anthropicKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = {
      model: config.anthropicModel,
      max_tokens: 1200,
      system: SYSTEM_MSG,
      messages: [{ role: 'user', content: prompt }],
      stream: true
    };
  } else if (config.engine === 'google') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.googleModel)}:generateContent?key=${encodeURIComponent(config.googleKey)}`;
    body = {
      contents: [{
        role: 'user',
        parts: [{ text: `${SYSTEM_MSG}\n\n${prompt}` }]
      }]
    };
  }

  try {
    let response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      if (config.engine === 'openai' && response.status === 404 && config.openaiModel !== 'gpt-4o-mini') {
        console.warn(`OpenAI model ${config.openaiModel} returned 404. Retrying with gpt-4o-mini.`);
        body.model = 'gpt-4o-mini';
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });
      }

      if (!response.ok) {
        const providerDetails = await getProviderErrorDetails(response);
        let providerHint = '';
        if (config.engine === 'openai') {
          if (response.status === 404) {
            providerHint = ` Selected model: ${config.openaiModel}. Try refreshing models and selecting gpt-4o-mini.`;
          } else if (response.status === 429) {
            providerHint = config.openaiModel === 'gpt-4o-mini'
              ? ` OpenAI rate limit or quota was reached for gpt-4o-mini. Wait a bit, or check project billing, usage limits, and rate limits in OpenAI.`
              : ` OpenAI rate limit or quota was reached for model ${config.openaiModel}. Wait a bit, check billing/limits, or try gpt-4o-mini.`;
          } else {
            providerHint = ` Selected model: ${config.openaiModel}.`;
          }
        }
        throw new Error(`Provider request failed with HTTP ${response.status}.${providerHint}${providerDetails}`);
      }
    }

    if (config.engine === 'anthropic') {
      await readAnthropicStream(response, tabId, actionType, locatorType);
    } else if (config.engine === 'google') {
      const json = await response.json();
      const content = (json.candidates || [])
        .flatMap(c => c.content?.parts || [])
        .map(part => part.text || '')
        .join('');
      sendProviderChunk(tabId, actionType, content, locatorType);
    } else {
      await readOpenAICompatibleStream(response, tabId, actionType, locatorType);
    }

    sendProviderFinished(tabId, actionType, locatorType);

  } catch (err) {
    chrome.runtime.sendMessage({
      action: actionType,
      data: `Error: ${err.message}`,
      locatorType,
      tabId
    }).catch(() => {});
  }
}

// ─── Gemini Nano — Analysis ───────────────────────────────────────────────────
async function handleGeminiNanoRequest(tabId, elementDataJson, context) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: async (elementDataJson, tabId, promptText) => {
      // Inline API detector (avoids duplicate declaration across injections)
      const getApi = () => {
        if (typeof ai !== 'undefined' && ai.languageModel) return ai.languageModel;
        if (window.ai?.languageModel) return window.ai.languageModel;
        if (typeof ai !== 'undefined' && ai.assistant) return ai.assistant;
        if (window.ai?.assistant) return window.ai.assistant;
        if (typeof LanguageModel !== 'undefined' && LanguageModel.create) return LanguageModel;
        if (window.LanguageModel?.create) return window.LanguageModel;
        if (typeof model !== 'undefined' && model.create) return model;
        if (window.model?.create) return window.model;
        return null;
      };

      const modelApi = getApi();
      if (!modelApi) {
        window.postMessage({ type: 'AI_CHUNK', data: "AI Error: Gemini Nano not found in this tab. Try Ollama or OpenAI in settings.", tabId }, "*");
        return;
      }
      try {
        const session = await modelApi.create();
        let finalResult = "";

        try {
          const stream = session.promptStreaming(promptText);
          let previousLength = 0;
          for await (const chunk of stream) {
            let newContent = chunk;
            if (chunk.length >= previousLength && chunk.startsWith(finalResult)) {
              newContent = chunk.substring(previousLength);
            }
            previousLength = chunk.length;
            finalResult = chunk;
            window.postMessage({ type: 'AI_CHUNK', data: newContent, tabId, isChunk: true }, "*");
          }
        } catch (e) {
          // Streaming failed, fallback to standard prompt
          finalResult = await session.prompt(promptText);
          window.postMessage({ type: 'AI_CHUNK', data: finalResult, tabId }, "*");
        }

        if (!finalResult || finalResult.trim() === "") {
          finalResult = await session.prompt("Please generate CSS, XPATH, and PLAYWRIGHT locators for this element: " + promptText.substring(0, 100));
          window.postMessage({ type: 'AI_CHUNK', data: finalResult, tabId }, "*");
        }

        if (!finalResult || finalResult.trim() === "") {
          window.postMessage({ type: 'AI_CHUNK', data: "Error: Gemini Nano returned an empty response. It might be blocking the request due to safety filters.", tabId }, "*");
        }

        window.postMessage({ type: 'AI_CHUNK', data: "FinishedSuccessfullyMark", tabId }, "*");
        if (session.destroy) session.destroy();
      } catch (err) {
        window.postMessage({ type: 'AI_CHUNK', data: "Error: " + err.message, tabId }, "*");
      }
    },
    args: [elementDataJson, tabId, constructPrompt('analysis', JSON.parse(elementDataJson), context, 'gemini-nano')]
  });
}

// ─── Gemini Nano — Refinement (BUG-10) ───────────────────────────────────────
// Now has the same streaming→fallback→error-boundary pattern as the analysis handler.
async function handleGeminiNanoRefinement(tabId, data, context) {
  let parsedData;
  try {
    parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    parsedData = data;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: async (dataJson, tabId, promptText) => {
      const getApi = () => {
        if (typeof ai !== 'undefined' && ai.languageModel) return ai.languageModel;
        if (window.ai?.languageModel) return window.ai.languageModel;
        if (typeof ai !== 'undefined' && ai.assistant) return ai.assistant;
        if (window.ai?.assistant) return window.ai.assistant;
        if (typeof LanguageModel !== 'undefined' && LanguageModel.create) return LanguageModel;
        if (window.LanguageModel?.create) return window.LanguageModel;
        if (typeof model !== 'undefined' && model.create) return model;
        if (window.model?.create) return window.model;
        return null;
      };

      const locatorType = JSON.parse(dataJson).locatorType;

      const modelApi = getApi();
      if (!modelApi) {
        window.postMessage({ type: 'AI_REFINEMENT_CHUNK', data: "Error: Gemini Nano not found.", tabId }, "*");
        return;
      }
      try {
        const session = await modelApi.create();
        let finalResult = "";

        try {
          // Attempt streaming first
          const stream = session.promptStreaming(promptText);
          for await (const chunk of stream) {
            finalResult = chunk;
            window.postMessage({ type: 'AI_REFINEMENT_CHUNK', data: chunk, locatorType, tabId }, "*");
          }
        } catch (streamErr) {
          // Fallback to standard prompt on streaming failure
          finalResult = await session.prompt(promptText);
          window.postMessage({ type: 'AI_REFINEMENT_CHUNK', data: finalResult, locatorType, tabId, isChunk: false }, "*");
        }

        if (!finalResult || finalResult.trim() === "") {
          window.postMessage({ type: 'AI_REFINEMENT_CHUNK', data: "Error: Gemini Nano returned empty response.", locatorType, tabId }, "*");
        } else {
          window.postMessage({ type: 'AI_REFINEMENT_CHUNK', data: "FinishedSuccessfullyMark", locatorType, tabId }, "*");
        }

        if (session.destroy) session.destroy();
      } catch (err) {
        window.postMessage({ type: 'AI_REFINEMENT_CHUNK', data: "Error: " + err.message, locatorType, tabId }, "*");
      }
    },
    args: [JSON.stringify(parsedData), tabId, constructPrompt('refinement', parsedData, context, 'gemini-nano')]
  });
}
