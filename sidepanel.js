// sidepanel.js

let currentTabId = null;
let currentSiteUrl = "";
let sessionHistory = []; // Array of session objects
let currentSession = null;
let isHealing = false; // Global lock for AI refinement operations

const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 1 1 2 2v2"/></svg>';
const ICON_DELETE_SMALL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 1 1 2 2v2"/></svg>';

function safeJsonParse(value, fallback = null) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (err) {
    console.warn('[QA] Failed to parse JSON payload:', err);
    return fallback;
  }
}

function isEqualTarget(a, b) {
  if (!a || !b) return false;
  if (a.tagName !== b.tagName) return false;
  if ((a.id || '') !== (b.id || '')) return false;
  if ((a.testId || '') !== (b.testId || '')) return false;
  if ((a.textSnippet || '') !== (b.textSnippet || '')) return false;

  const sortKeys = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    return Object.keys(obj).sort().reduce((acc, k) => {
      acc[k] = sortKeys(obj[k]);
      return acc;
    }, {});
  };
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function showPanelError(message) {
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loader-text');
  if (loader && loaderText) {
    loader.style.display = 'flex';
    loaderText.innerText = message;
  }
}

function getDiagnostics() {
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    tabId: currentTabId,
    targetHost: currentSiteUrl,
    sessionCount: sessionHistory.length,
    provider: document.getElementById('engine-select')?.value || 'unknown',
    timestamp: new Date().toISOString()
  };
}

async function getActiveProviderLabel() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['aiConfig'], (res) => {
      const config = res.aiConfig || { engine: 'gemini-nano' };
      const engine = config.engine || 'gemini-nano';
      let label = '';

      if (engine === 'gemini-nano') {
        label = 'Chrome Built-in';
      } else if (engine === 'openai') {
        const m = config.openaiModel;
        label = m ? `OpenAI (${m})` : 'OpenAI';
      } else if (engine === 'anthropic') {
        const m = config.anthropicModel;
        label = m ? `Anthropic (${m})` : 'Anthropic';
      } else if (engine === 'google') {
        const m = config.googleModel;
        label = m ? `Google (${m})` : 'Google';
      } else if (engine === 'ollama') {
        const m = config.ollamaModel;
        label = m ? `Ollama (${m})` : 'Ollama';
      } else {
        label = engine;
      }
      resolve(label);
    });
  });
}

function initThemeSystem() {
  const themeSelect = document.getElementById('theme-select');
  
  const applyTheme = (mode) => {
    if (mode === 'system' || !mode) {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
    }
  };

  chrome.storage.local.get(['themeMode'], (res) => {
    const mode = res.themeMode || 'system';
    if (themeSelect) themeSelect.value = mode;
    applyTheme(mode);
  });

  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      applyTheme(mode);
      chrome.storage.local.set({ themeMode: mode });
    });
  }

  // Side Panel Scope controls: applies immediately on change without needing a manual save button
  const scopeSelect = document.getElementById('scope-select');
  const scopeStatus = document.getElementById('scope-status');

  chrome.storage.local.get(['sidePanelScope'], (res) => {
    const scope = res.sidePanelScope || 'tab';
    if (scopeSelect) scopeSelect.value = scope;
  });

  if (scopeSelect) {
    scopeSelect.addEventListener('change', async (e) => {
      const scope = e.target.value;
      chrome.storage.local.set({ sidePanelScope: scope }, () => {
        chrome.runtime.sendMessage({ action: 'UPDATE_PANEL_SCOPE', scope });
      });

      if (scopeStatus) {
        scopeStatus.style.display = 'inline';
        scopeStatus.innerText = scope === 'all' ? '✓ Applied: Follow All Tabs' : '✓ Applied: Current Tab Only';
        setTimeout(() => { scopeStatus.style.display = 'none'; }, 2500);
      }

      // Mode updated without forcing window-level takeover so per-tab panels remain independent
    });
  }

  // Auto react to system color scheme changes if set to 'system'
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      chrome.storage.local.get(['themeMode'], (res) => {
        if (!res.themeMode || res.themeMode === 'system') {
          document.documentElement.removeAttribute('data-theme');
        }
      });
    });
  }
}

window.addEventListener('beforeunload', () => {
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: 'CLEAR_HIGHLIGHTS' }).catch(() => {});
    chrome.tabs.sendMessage(currentTabId, { action: 'STOP_INSPECTION' }).catch(() => {});
  }
});

// Initialize the side panel and tools
function init() {
  initThemeSystem();
  const params = new URLSearchParams(window.location.search);
  const urlTabId = params.get('tabId');

  if (urlTabId) {
    currentTabId = parseInt(urlTabId);
    chrome.tabs.get(currentTabId, (tab) => {
      // BUG-12 fix: check lastError to avoid uncaught exception on stale tab IDs
      if (chrome.runtime.lastError || !tab) {
        const siteCtx = document.getElementById('site-context');
        if (siteCtx) siteCtx.innerText = "Target: Tab Not Found";
        return;
      }
      updateTabInfo(tab);
      syncWithBackground(currentTabId);
      chrome.runtime.connect({ name: `sidepanel_${currentTabId}` });
    });
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) {
        currentTabId = tab.id;
        updateTabInfo(tab);
        syncWithBackground(currentTabId);
        chrome.runtime.connect({ name: `sidepanel_${currentTabId}` });
      }
    });
  }
  isHealing = false; // Reset on every init to prevent stuck heal state after panel reload
  setupManualTool();
  setupFreezeTool();
  refreshMemoryUI();

  // FEAT-P7: Tab switching listener
  const isDetached = params.get('mode') === 'detached';
  if (!isDetached && chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(async ({ tabId }) => {
      const data = await chrome.storage.local.get(['sidePanelScope']);
      const scope = data.sidePanelScope || 'tab';

      if (scope === 'tab') {
        // In "Current Tab Only" mode, keep the side panel tied to its origin tab (currentTabId)
        // without closing or resetting the session when the user views another tab
        return;
      }

      if (scope === 'all') {
        if (currentTabId === tabId) return;

        if (currentTabId) {
          chrome.tabs.sendMessage(currentTabId, { action: 'STOP_INSPECTION' }).catch(() => {});
          setInspectionUIState(false);
        }

        currentTabId = tabId;
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          updateTabInfo(tab);
          syncWithBackground(tabId);
        });
      }
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tabId !== currentTabId) return;
      if (changeInfo.status === 'complete' || changeInfo.url) {
        updateTabInfo(tab);
      }
    });
  }
}

async function ensureContentScriptInjected(tabId) {
  if (!tabId) return false;
  try {
    const res = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
    if (res && res.status === 'pong') return true;
  } catch (e) {
    // Content script not yet active
  }

  try {
    if (chrome.scripting) {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content-styles.css']
      }).catch(() => {});
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      return true;
    }
  } catch (err) {
    console.warn('[QA] Could not inject content script:', err);
    return false;
  }
  return false;
}

function setupFreezeTool() {
  document.getElementById('freeze-btn')?.addEventListener('click', async () => {
    if (!currentTabId) {
      console.error("No active tab ID found for freezing.");
      return;
    }
    await ensureContentScriptInjected(currentTabId);
    console.log("Sending FREEZE_PAGE signal to tab:", currentTabId);
    chrome.tabs.sendMessage(currentTabId, { action: 'FREEZE_PAGE' }, (response) => {
      if (chrome.runtime.lastError) {
        alert("Could not reach the page. Please refresh the target tab and try again.");
      }
    });
  });
}

async function refreshMemoryUI() {
  chrome.storage.local.get(['knowledgeBase'], (res) => {
    const kb = res.knowledgeBase || [];
    const countEl = document.getElementById('memory-count');
    if (countEl) countEl.innerText = kb.length;
  });
}

function saveToKnowledgeBase(data) {
  // data: { tagName, textSnippet, selector, type }
  chrome.storage.local.get(['knowledgeBase'], (res) => {
    const kb = res.knowledgeBase || [];
    // Deduplicate
    const exists = kb.some(item => item.selector === data.selector && item.tagName === data.tagName);
    if (!exists) {
      kb.push(data);
      chrome.storage.local.set({ knowledgeBase: kb }, () => {
        refreshMemoryUI();
      });
    }
  });
}

async function syncWithBackground(tabId) {
  chrome.runtime.sendMessage({ action: 'GET_ACTIVE_SESSION', tabId: tabId }, (active) => {
    if (active) {
      if (active.isInspecting) setInspectionUIState(true);
      if (active.isStreaming || active.accumulatedText) {
        restoreState(tabId, active);
      } else {
        restoreState(tabId);
      }
    } else {
      restoreState(tabId);
    }
  });
}

function setInspectionUIState(active) {
  const btn = document.getElementById('start-inspect');
  if (!btn) return;
  
  if (active) {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"></rect></svg> Stop Inspector`;
    btn.style.background = '#ef4444';
  } else {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> Analyze Element`;
    btn.style.background = 'var(--btn-primary-bg)';
  }
}

function updateTabInfo(tab) {
  const siteTitle = tab.title || "Unknown Site";
  try {
    currentSiteUrl = new URL(tab.url).hostname;
  } catch (e) {
    currentSiteUrl = "Internal Page";
  }
  
  document.title = `${currentSiteUrl} - AI Assistant`;
  const siteInfo = document.getElementById('site-context');
  if (siteInfo) {
    siteInfo.innerText = `Target: ${currentSiteUrl}`;
    siteInfo.title = siteTitle;
  }
}

function getSiteStorageKey() {
  const host = currentSiteUrl && currentSiteUrl !== 'Internal Page' ? currentSiteUrl : `tab_${currentTabId}`;
  return `state_site_${host}`;
}

async function restoreState(tabId, activeSessionBuffer = null) {
  const key = getSiteStorageKey();
  // Also check legacy state_${tabId} for smooth backwards compatibility
  const legacyKey = `state_${tabId}`;

  chrome.storage.local.get([key, legacyKey], async (result) => {
    const stored = result[key] || result[legacyKey];
    sessionHistory = (stored && stored.history) || [];
    const container = document.getElementById('results-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Handle active buffer from background
    if (activeSessionBuffer && activeSessionBuffer.targetData) {
      const matchedIndex = sessionHistory.findIndex(s =>
        isEqualTarget(s.target, activeSessionBuffer.targetData)
      );
      
      if (matchedIndex === -1) {
        if (activeSessionBuffer.isStreaming || (sessionHistory.length === 0 && activeSessionBuffer.accumulatedText)) {
          const providerLabel = await getActiveProviderLabel();
          currentSession = { 
            target: activeSessionBuffer.targetData, 
            text: activeSessionBuffer.accumulatedText || "", 
            isFinished: !activeSessionBuffer.isStreaming,
            providerLabel: providerLabel
          };
          sessionHistory.unshift(currentSession);
        }
      } else {
        currentSession = sessionHistory[matchedIndex];
        if (activeSessionBuffer.isStreaming) {
          currentSession.text = activeSessionBuffer.accumulatedText;
          currentSession.isFinished = false;
        }
      }
    }

    if (sessionHistory.length === 0) {
      container.innerHTML = '<div class="empty-state" style="text-align: center; opacity: 0.5; margin-top: 40px;"><p>Select an element to target.</p></div>';
      return;
    }

    sessionHistory.forEach((session, index) => {
      const isLatest = index === 0;
      // All sessions collapsed by default
      const block = createSessionBlock(session, index);
      block.classList.add('collapsed');
      
      container.appendChild(block);
      session.block = block;
      
      const contentArea = block.querySelector('.session-content');
      if (session.isFinished) {
        parseAndRenderCards(session.text, contentArea);
        if (isLatest) {
          const rawOutput = document.getElementById('full-response-text');
          if (rawOutput) rawOutput.textContent = session.text;
        }
      } else if (session.text) {
        const streamingDiv = document.createElement('div');
        streamingDiv.className = 'streaming-text';
        streamingDiv.innerText = session.text;
        contentArea.appendChild(streamingDiv);
        
        if (isLatest) {
          const rawOutput = document.getElementById('full-response-text');
          if (rawOutput) rawOutput.textContent = session.text;
        }
      }
      if (index === 0) currentSession = session;
    });
    
    const masterOut = document.getElementById('full-response-wrapper');
    if (masterOut) masterOut.style.display = 'block';
  });
}

function saveState() {
  const key = getSiteStorageKey();
  chrome.storage.local.set({ 
    [key]: { 
      history: sessionHistory.map(s => ({ 
        target: s.target, 
        text: s.text, 
        isFinished: s.isFinished, 
        title: s.title || "",
        providerLabel: s.providerLabel || ""
      })),
      timestamp: Date.now(),
      url: currentSiteUrl
    } 
  });
}

function getDefaultSessionTitle(targetInfo) {
  return targetInfo?.tagName || "Element";
}

function setSessionTitle(session, block, title) {
  const clean = String(title || '').trim().substring(0, 80);
  session.title = clean;
  const titleEl = block.querySelector('.session-title');
  if (titleEl) titleEl.innerText = clean || getDefaultSessionTitle(session.target);
}

function createSessionBlock(session, index) {
  const targetInfo = session.target;
  const template = document.getElementById('session-template');
  const clone = template.content.cloneNode(true);
  const block = clone.querySelector('.session-block');
  
  block.querySelector('.session-title').innerText = session.title || getDefaultSessionTitle(targetInfo);
  block.querySelector('.session-target-info').innerText = targetInfo.textSnippet || targetInfo.id || "Target";
  
  if (session.providerLabel) {
    const badge = block.querySelector('.session-provider-badge');
    if (badge) {
      badge.innerText = session.providerLabel;
      badge.style.display = 'inline-block';
    }
  }

  const header = block.querySelector('.session-header');
  const deleteBtn = block.querySelector('.delete-session-btn');
  const renameBtn = block.querySelector('.rename-session-btn');

  header.addEventListener('click', (e) => {
    if (e.target.closest('.delete-session-btn') || e.target.closest('.rename-session-btn') || e.target.closest('.session-title-input')) return;
    
    // Collapse all others first for focus
    document.querySelectorAll('.session-block').forEach(b => {
      if (b !== block) b.classList.add('collapsed');
    });

    const isCollapsing = !block.classList.contains('collapsed');
    block.classList.toggle('collapsed');
    
    if (!isCollapsing) {
      // If expanding, switch Master Output to this session's raw response
      const rawOutput = document.getElementById('full-response-text');
      if (rawOutput && session.text) {
        rawOutput.textContent = session.text;
        // Scroll to bottom
        rawOutput.scrollTop = rawOutput.scrollHeight;
      }
    }
  });

  renameBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const titleEl = block.querySelector('.session-title');
    if (!titleEl || block.querySelector('.session-title-input')) return;

    const input = document.createElement('input');
    input.className = 'session-title-input';
    input.value = session.title || getDefaultSessionTitle(targetInfo);
    input.maxLength = 80;

    const finish = (commit) => {
      if (!input.isConnected) return;
      const nextTitle = commit ? input.value : (session.title || getDefaultSessionTitle(targetInfo));
      input.replaceWith(titleEl);
      setSessionTitle(session, block, nextTitle);
      if (commit) saveState();
    };

    input.addEventListener('click', evt => evt.stopPropagation());
    input.addEventListener('keydown', evt => {
      if (evt.key === 'Enter') finish(true);
      if (evt.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));

    titleEl.replaceWith(input);
    input.focus();
    input.select();
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent toggling the session when deleting
    const historyIndex = sessionHistory.findIndex(s => s.target === targetInfo);
    if (historyIndex !== -1) {
      sessionHistory.splice(historyIndex, 1);
      block.remove();
      saveState();
      
      // If no sessions left, we might want to show a message or clear the master output
      if (sessionHistory.length === 0) {
        const container = document.getElementById('results-container');
        if (container) container.innerHTML = '<div class="empty-state" style="text-align:center; margin-top:40px; color:var(--text-dim); font-size:0.8rem; opacity:0.5;">Select an element to start analysis...</div>';
      }
    }
  });

  return block;
}

// Logic for manual verification
function setupManualTool() {
  const manualBox = document.getElementById('manual-verify-box');
  const manualToggle = document.getElementById('manual-verify-toggle');
  if (manualBox && manualToggle) {
    chrome.storage.local.get(['manualVerifyCollapsed'], (res) => {
      const isCollapsed = res.manualVerifyCollapsed !== undefined ? res.manualVerifyCollapsed : true;
      manualBox.classList.toggle('collapsed', isCollapsed);
      manualToggle.setAttribute('aria-expanded', String(!isCollapsed));
    });

    manualToggle.addEventListener('click', () => {
      const isCollapsed = manualBox.classList.toggle('collapsed');
      manualToggle.setAttribute('aria-expanded', String(!isCollapsed));
      chrome.storage.local.set({ manualVerifyCollapsed: isCollapsed });
    });
  }

  const verifyBtn = document.getElementById('manual-verify-btn');
  const copyBtn = document.getElementById('manual-copy-btn');
  const clearBtn = document.getElementById('manual-clear-btn');
  const queryInput = document.getElementById('manual-query');
  const typeSelect = document.getElementById('manual-type');
  const statusEl = document.getElementById('manual-status');

  if (!verifyBtn || !queryInput) return;

  verifyBtn.addEventListener('click', async () => {
    let q = queryInput.value.trim();
    const type = typeSelect.value;
    if (!q) return;

    statusEl.style.display = 'block';
    statusEl.innerText = 'Verifying...';
    statusEl.style.color = 'white';

    await ensureContentScriptInjected(currentTabId);

    // BUG-05 fix: pass query as-is; content.js playwrightToNative() handles all translation
    // (getByRole, getByTestId, getByText, getByLabel, getByPlaceholder, raw CSS/XPath)

    chrome.tabs.sendMessage(currentTabId, { action: 'VERIFY_LOCATOR', type, query: q }, (res) => {
      if (chrome.runtime.lastError || !res) {
        statusEl.innerText = 'Error: No response.';
        statusEl.style.color = '#f87171';
        return;
      }
      const count = res.count;
      if (count === 1) { 
        statusEl.innerText = 'Unique (1)'; 
        statusEl.style.color = 'var(--accent)'; 
      } else if (count === 0) { 
        statusEl.innerText = 'Broken (0)'; 
        statusEl.style.color = '#f87171'; 
      } else { 
        statusEl.innerText = `Brittle (${count})`; 
        statusEl.style.color = '#fbbf24'; 
      }
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await ensureContentScriptInjected(currentTabId);
      chrome.tabs.sendMessage(currentTabId, { action: 'CLEAR_HIGHLIGHTS' }, (res) => {
        statusEl.style.display = 'block';
        statusEl.innerText = 'Cleared';
        statusEl.style.color = 'var(--accent)';
        setTimeout(() => { if (statusEl.innerText === 'Cleared') statusEl.style.display = 'none'; }, 2000);
      });
    });
  }

  copyBtn.addEventListener('click', () => {
    const query = queryInput.value;
    if (query) {
      navigator.clipboard.writeText(query).then(() => {
        const orig = copyBtn.innerText;
        copyBtn.innerText = 'Copied!';
        setTimeout(() => copyBtn.innerText = orig, 2000);
      });
    }
  });

  document.getElementById('manual-save-memory-btn')?.addEventListener('click', () => {
    const query = (queryInput.value || "").trim();
    if (!query) return;
    
    // We don't have full element context for manual, so we guess/keep it simple
    saveToKnowledgeBase({
      tagName: "MANUAL",
      textSnippet: "Manual Entry",
      selector: query,
      type: typeSelect.value
    });

    const btn = document.getElementById('manual-save-memory-btn');
    const orig = btn.innerHTML;
    btn.innerHTML = "Learned!";
    btn.style.borderColor = "var(--accent)";
    setTimeout(() => { btn.innerHTML = orig; btn.style.borderColor = "var(--border)"; }, 2000);
  });
}

// Inspector Toggle
document.getElementById('start-inspect')?.addEventListener('click', async () => {
  if (!currentTabId) return;
  
  const btn = document.getElementById('start-inspect');
  const isCurrentlyActive = btn.innerHTML.includes('Stop');
  
  if (isCurrentlyActive) {
    setInspectionUIState(false);
    chrome.runtime.sendMessage({ action: 'STOP_INSPECTION_SIGNAL', tabId: currentTabId });
    chrome.tabs.sendMessage(currentTabId, { action: 'STOP_INSPECTION' });
    document.getElementById('loader').style.display = 'none';
  } else {
    setInspectionUIState(true);
    chrome.runtime.sendMessage({ action: 'START_INSPECTION_SIGNAL', tabId: currentTabId });
    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader-text').innerText = 'Select an element on the page...';
    const injected = await ensureContentScriptInjected(currentTabId);
    if (!injected) {
      setInspectionUIState(false);
      chrome.runtime.sendMessage({ action: 'STOP_INSPECTION_SIGNAL', tabId: currentTabId });
      showPanelError('Cannot inspect this page. Try a normal web page and refresh it before retrying.');
      return;
    }
    try {
      await chrome.tabs.sendMessage(currentTabId, { action: 'START_INSPECTION' });
    } catch (err) {
      setInspectionUIState(false);
      chrome.runtime.sendMessage({ action: 'STOP_INSPECTION_SIGNAL', tabId: currentTabId });
      showPanelError('Cannot inspect this page. Try refreshing the target tab.');
      console.warn('[QA] Could not start inspection:', err);
    }
  }
});

// Runtime Message Handling
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'ANALYSIS_START') {
    if (currentTabId && message.tabId && message.tabId !== currentTabId) return;
    
    const data = safeJsonParse(message.data);
    if (!data) return;
    setInspectionUIState(false);
    
    // Clear highlights on new selection
    chrome.tabs.sendMessage(currentTabId, { action: 'CLEAR_HIGHLIGHTS' });

    document.getElementById('loader').style.display = 'flex';
    document.getElementById('loader-text').innerText = 'AI is analyzing...';
    
    const container = document.getElementById('results-container');
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    // Get provider label asynchronously before creating session
    getActiveProviderLabel().then((providerLabel) => {
      currentSession = { target: data, text: "", isFinished: false, providerLabel: providerLabel };
      const block = createSessionBlock(currentSession, sessionHistory.length);
      currentSession.block = block;
      
      container.prepend(block);
      sessionHistory.unshift(currentSession);
      saveState();

      // Clear Master Output for new session
      const rawOutput = document.getElementById('full-response-text');
      if (rawOutput) rawOutput.textContent = "";
    });

  } else if (message.action === 'AI_STREAM_CHUNK') {
    if (currentTabId && message.tabId && message.tabId !== currentTabId) return;

    if (currentSession) {
      const loader = document.getElementById('loader');
      if (loader) loader.style.display = 'none';
      
      const chunk = message.data;
      const isChunk = message.isChunk || false;

      if (chunk === "FinishedSuccessfullyMark") {
        currentSession.isFinished = true;
        parseAndRenderCards(currentSession.text, currentSession.block.querySelector('.session-content'));
        saveState();
        if (currentTabId) {
          chrome.runtime.sendMessage({ action: 'CLEAR_ACTIVE_SESSION', tabId: currentTabId });
        }
        return;
      }

      // Handle accumulation based on engine type
      if (isChunk) {
        currentSession.text += chunk;
      } else {
        currentSession.text = chunk; // Gemini Nano replacement
      }

      // Update both the block UI and the Master Output
      const streamDiv = currentSession.block.querySelector('.streaming-text') || (() => {
        const d = document.createElement('div');
        d.className = 'streaming-text';
        currentSession.block.querySelector('.session-content').appendChild(d);
        return d;
      })();
      streamDiv.innerText = currentSession.text;

      const rawOutput = document.getElementById('full-response-text');
      if (rawOutput) {
        rawOutput.textContent = currentSession.text;
        rawOutput.scrollTop = rawOutput.scrollHeight;
      }
    }
  } else if (message.action === 'AI_REFINEMENT_CHUNK') {
    handleRefinementChunk(message.data, message.locatorType);
  }
});

// BUG-04: updateAiStream() removed — was dead code referencing undeclared globals
// (isAiStreaming, currentStreamText). Streaming is handled directly in the message listener.

function extractRefinedSelector(raw) {
  if (!raw || !raw.trim()) return null;

  // Debug: visible in sidepanel DevTools console
  console.debug('[Heal] raw accumulated text:', JSON.stringify(raw.substring(0, 300)));

  // Extract content of the first triple-backtick code block
  // [\/\w-]* handles language tags like 'css', 'xpath', 'javascript'
  const blockMatch = raw.match(/```[\/\w-]*\n?([\s\S]*?)(?:```|$)/);
  const candidate = blockMatch ? blockMatch[1].trim() : raw.trim();

  console.debug('[Heal] candidate after block extraction:', JSON.stringify(candidate.substring(0, 200)));

  const lines = candidate.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return null;

  // Filter lines that look like Python/JS code.
  // IMPORTANT: '#' alone is NOT a filter — CSS IDs start with '#'.
  // Only filter '# ' (Python comment with space) and '"""' (docstring).
  const hallucinationPattern = /^(import |from |def |function |class |const |let |var |# |"""|Args:|Returns:)/;
  const validLines = lines.filter(l => !hallucinationPattern.test(l));

  console.debug('[Heal] validLines:', validLines);

  if (validLines.length === 0) return null;
  if (validLines.length === 1) return validLines[0];

  // Multiple valid lines — prefer the one that looks most like a locator
  const locatorPattern = /^(page\.|\/{1,2}|#|\.\w|\[|\()/;
  return validLines.find(l => locatorPattern.test(l)) || validLines[0];
}

// ─── Auto-Heal Loop Helpers ──────────────────────────────────────────────────

const HEAL_TIMEOUT_MS = 90_000; // 90-second session limit

/**
 * Dispatches a REFINE_LOCATOR message, injecting the accumulated
 * list of failed locators so the AI knows what to avoid.
 */
function triggerAutoHeal(card, codeEl, type) {
  const sessionBlock = card.closest('.session-block');
  const session = sessionHistory.find(s => s.block === sessionBlock);
  if (!session) return;

  // Set / extend deadline on first call
  if (!card.getAttribute('data-heal-deadline')) {
    card.setAttribute('data-heal-deadline', Date.now() + HEAL_TIMEOUT_MS);
  }

  const badLocators = safeJsonParse(card.getAttribute('data-bad-locators') || '[]', []);

  isHealing = true;
  card.setAttribute('data-healing', 'true');
  card.classList.add('healing-pulse');
  updateHealButtonsState();

  const hBtn = card.querySelector('.heal-btn');
  const sBtn = card.querySelector('.stop-heal-btn');
  const attempt = badLocators.length + 1;
  hBtn.innerText = attempt > 1 ? `Healing… (try ${attempt})` : 'Healing...';
  sBtn.style.display = 'inline-block';

  chrome.runtime.sendMessage({
    action: 'REFINE_LOCATOR',
    tabId: currentTabId,
    data: {
      element: session.target,
      locatorType: type,
      oldLocator: codeEl.innerText,
      matchCount: 0,
      excludeLocators: badLocators   // ← passed to prompt builder
    }
  });
}

/**
 * Runs VERIFY_LOCATOR on the current locator code element.
 * If isAutoRetry=true and count≠1, records the locator as bad
 * and triggers another heal (if deadline not exceeded).
 */
async function verifyAndMaybeRetry(card, codeEl, type, isAutoRetry) {
  const status = card.querySelector('.verify-status');
  status.innerText = 'Verifying...';
  status.className = 'verify-status';

  await ensureContentScriptInjected(currentTabId);

  const q = codeEl.innerText.trim();
  let settled = false;
  const t = setTimeout(() => {
    if (!settled) {
      settled = true;
      status.innerText = 'Timeout';
      status.className = 'verify-status status-error';
    }
  }, 5000);

  chrome.tabs.sendMessage(currentTabId, { action: 'VERIFY_LOCATOR', type, query: q }, (res) => {
    if (settled) return;
    settled = true;
    clearTimeout(t);

    if (chrome.runtime.lastError || !res) {
      status.innerText = 'Tab Error';
      status.className = 'verify-status status-error';
      return;
    }

    if (res.count === 1) {
      // ✅ Success — clear auto-heal session
      status.innerText = 'Unique (1)';
      status.className = 'verify-status status-success';
      card.querySelector('.heal-btn').style.display = 'none';
      card.removeAttribute('data-bad-locators');
      card.removeAttribute('data-heal-deadline');
      updateHealButtonsState();
      return;
    }

    // Not unique — update status label
    if (res.count === 0) {
      status.innerText = 'Broken (0)';
      status.className = 'verify-status status-error';
    } else {
      status.innerText = `Brittle (${res.count})`;
      status.className = 'verify-status status-warning';
    }
    updateHealButtonsState();

    if (!isAutoRetry) return; // Manual verify — don't auto-loop

    // Record this locator as failed
    const badLocators = safeJsonParse(card.getAttribute('data-bad-locators') || '[]', []);
    if (!badLocators.includes(q)) badLocators.push(q);
    card.setAttribute('data-bad-locators', JSON.stringify(badLocators));

    // Check deadline
    const deadline = parseInt(card.getAttribute('data-heal-deadline') || '0', 10);
    if (Date.now() >= deadline) {
      status.innerText += ' — timed out';
      card.removeAttribute('data-heal-deadline');
      return;
    }

    // Still within window — retry after a brief pause
    status.innerText += ' — retrying…';
    setTimeout(() => {
      if (!isHealing) triggerAutoHeal(card, codeEl, type);
    }, 800);
  });
}

function handleRefinementChunk(chunk, type) {
  const card = document.querySelector(`.locator-card[data-healing="true"]`);
  if (!card) return;
  const codeEl = card.querySelector('.locator-code');

  const resetHealState = () => {
    card.removeAttribute('data-healing');
    card.classList.remove('healing-pulse');
    isHealing = false;
    updateHealButtonsState();
    card.querySelector('.stop-heal-btn').style.display = 'none';
    card.querySelector('.heal-btn').innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg> Heal`;
  };

  if (chunk === 'FinishedSuccessfullyMark') {
    const fullAcc = card.getAttribute('data-refine-acc') || '';
    card.removeAttribute('data-refine-acc');
    resetHealState();
    codeEl.style.opacity = '1';

    const clean = extractRefinedSelector(fullAcc);
    if (clean) {
      // Check if AI returned a locator we've already tried
      const badLocators = safeJsonParse(card.getAttribute('data-bad-locators') || '[]', []);
      if (badLocators.includes(clean)) {
        // Duplicate — record it and auto-retry without even verifying
        const deadline = parseInt(card.getAttribute('data-heal-deadline') || '0', 10);
        const status = card.querySelector('.verify-status');
        if (Date.now() < deadline) {
          if (status) { status.innerText = 'AI repeated a failed locator — retrying…'; status.className = 'verify-status status-warning'; }
          setTimeout(() => triggerAutoHeal(card, codeEl, type), 600);
        } else {
          if (status) { status.innerText = 'AI repeated a failed locator — timed out'; status.className = 'verify-status status-error'; }
        }
        return;
      }
      codeEl.innerText = clean;
      card.querySelector('.refined-badge').style.display = 'inline-block';
      // Auto-verify and potentially loop
      verifyAndMaybeRetry(card, codeEl, type, /* isAutoRetry */ true);
    } else {
      const status = card.querySelector('.verify-status');
      if (status) { status.innerText = 'Heal failed — AI returned invalid output'; status.className = 'verify-status status-error'; }
    }
    return;
  }

  if (chunk.startsWith('Error:') || chunk.startsWith('AI Error:')) {
    card.removeAttribute('data-refine-acc');
    resetHealState();
    const status = card.querySelector('.verify-status');
    if (status) { status.innerText = chunk; status.className = 'verify-status status-error'; }
    return;
  }

  const fullAcc = (card.getAttribute('data-refine-acc') || '') + chunk;
  card.setAttribute('data-refine-acc', fullAcc);
  const interim = extractRefinedSelector(fullAcc);
  if (interim) codeEl.innerText = interim;
}


function parseAndRenderCards(text, contentArea) {
  contentArea.innerHTML = '';
  const clean = text.replace("FinishedSuccessfullyMark", "");
  const blocks = [];
  const seen = new Set();

  const addBlock = (type, code) => {
    let cleanCode = String(code || '')
      .trim()
      .replace(/^`+/, '')
      .replace(/`+$/, '')
      .trim();

    if (!cleanCode || cleanCode.length <= 2) return;
    if (/^(Rules:|Task:|System:|Target Profile:)/i.test(cleanCode)) return;
    if (type === 'XPath') cleanCode = simplifyXPathForDisplay(cleanCode);

    const key = `${type}::${cleanCode}`;
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push({ type, code: cleanCode });
  };
  
  // Find all code blocks (triple backticks or single backticks)
  // [^\n]* ignores any language tags like 'css' or ' xpath' on the first line
  const blockRegex = /\`\`\`[^\n]*\n([\s\S]*?)\`\`\`|\`([^\`\n]+)\`/g;
  let m;
  while ((m = blockRegex.exec(clean)) !== null) {
    let code = (m[1] || m[2]).trim();
    // Strip trailing single backtick if the model hallucinated it inside the block
    if (code.endsWith('`')) code = code.slice(0, -1).trim();
    
    let type = "AI Suggestion";
    
    // 1. Check preceding text to identify explicit headers (Highest Priority)
    const preceding = clean.substring(Math.max(0, m.index - 150), m.index).toUpperCase();
    const cssIdx = preceding.lastIndexOf("[CSS]");
    const xpathIdx = preceding.lastIndexOf("[XPATH]");
    const pwIdx = Math.max(preceding.lastIndexOf("[PLAYWRIGHT]"), preceding.lastIndexOf("[PW]"));
    
    const maxIdx = Math.max(cssIdx, xpathIdx, pwIdx);
    
    if (maxIdx !== -1) {
      if (maxIdx === cssIdx) type = "CSS";
      else if (maxIdx === xpathIdx) type = "XPath";
      else if (maxIdx === pwIdx) type = "Playwright";
    }

    // 2. Split lines inside code block in case AI grouped multiple selectors together
    const getSyntaxType = (codeStr) => {
      if (codeStr.startsWith("//") || codeStr.startsWith("/") || codeStr.startsWith("(")) {
        return "XPath";
      } else if (codeStr.includes("page.") || codeStr.includes("getBy") || codeStr.includes("locator(")) {
        return "Playwright";
      } else if (!codeStr.includes(" ") && !codeStr.startsWith("/") && (codeStr.includes(".") || codeStr.includes("#") || codeStr.includes("["))) {
        return "CSS";
      }
      return "AI Suggestion";
    };

    const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach(line => {
      let cleanLine = line;
      if (cleanLine.endsWith('`')) cleanLine = cleanLine.slice(0, -1).trim();
      if (/^(#\s|\/\/\s|\/\*|\*)/.test(cleanLine)) return;
      if (/^(Rules:|Task:|System:|Target Profile:)/i.test(cleanLine)) return;

      let lineType = type;
      if (lineType === "AI Suggestion") {
        lineType = getSyntaxType(cleanLine);
      }
      addBlock(lineType, cleanLine);
    });
  }

  // Also parse line-by-line inside explicit sections. This catches malformed
  // single-backtick output like: `#selector with no closing backtick.
  const lines = clean.split('\n');
  let currentHeader = null;
  for (const line of lines) {
    const tLine = line.trim();
    const upper = tLine.toUpperCase();

    if (upper.includes('[CSS]')) { currentHeader = 'CSS'; continue; }
    if (upper.includes('[XPATH]')) { currentHeader = 'XPath'; continue; }
    if (upper.includes('[PLAYWRIGHT]') || upper.includes('[PW]')) { currentHeader = 'Playwright'; continue; }
    if (!currentHeader) continue;
    if (!tLine || tLine.startsWith('```')) continue;
    if (/^(Rules:|Task:|System:|Target Profile:)/i.test(tLine)) continue;

    let val = tLine
      .replace(/^[-*]\s+/, '')
      .replace(/^`+/, '')
      .replace(/`+$/, '')
      .trim();

    if (!val) continue;

    // Strip trailing explanations without damaging CSS combinators or XPath.
    if (/\s+-\s+[A-Za-z]/.test(val)) val = val.split(/\s+-\s+/)[0].trim();

    const looksLikeLocator =
      currentHeader === 'CSS' ||
      currentHeader === 'XPath' ||
      currentHeader === 'Playwright' ||
      val.startsWith('/') ||
      val.startsWith('#') ||
      val.startsWith('.') ||
      val.startsWith('[') ||
      val.includes('page.') ||
      val.includes('getBy');

    if (looksLikeLocator) {
      addBlock(currentHeader, val);
    }
  }

  // Sort blocks by type priority
  const typePriority = { "CSS": 1, "XPath": 2, "Playwright": 3, "AI Suggestion": 4 };
  blocks.sort((a, b) => (typePriority[a.type] || 9) - (typePriority[b.type] || 9));

  // Count occurrences to label variants
  const counts = {};
  blocks.forEach(b => {
    counts[b.type] = (counts[b.type] || 0) + 1;
    const label = counts[b.type] > 1 ? `${b.type} (v${counts[b.type]})` : b.type;
    renderCard(label, b.code, contentArea);
  });

  if (blocks.length === 0) {
    contentArea.innerHTML = '<div style="padding:10px; opacity:0.6; font-size:0.75rem;">No locators detected in AI output. Check Master Output for details.</div>';
  }

  const mw = document.getElementById('full-response-wrapper');
  if (mw) {
    mw.style.display = 'block';
    const textEl = document.getElementById('full-response-text');
    if (textEl) textEl.value = clean;
  }
}

function simplifyXPathForDisplay(xpath) {
  let out = String(xpath || '').trim();

  // Normalize exact text checks to ignore surrounding whitespace.
  out = out.replace(/\btext\(\)=('[^']*'|"[^"]*")/g, 'normalize-space()=$1');

  // Common model bloat:
  // contains(concat(' ', normalize-space(@class), ' '), ' dropbtn ')
  // For QA locator display, contains(@class,'dropbtn') is much easier to read.
  out = out.replace(
    /contains\(\s*concat\(\s*(['"])\s+\1\s*,\s*normalize-space\(@class\)\s*,\s*\1\s+\1\s*\)\s*,\s*\1\s+([^'"]+?)\s+\1\s*\)/g,
    "contains(@class,'$2')"
  );

  // If a predicate only has multiple simplified class contains() joined by
  // "and", keep it readable but avoid changing structure or uniqueness logic.
  out = out.replace(/\s+and\s+/g, ' and ');
  return out;
}

function renderCard(type, content, contentArea) {
  const template = document.getElementById('locator-template');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.locator-card');
  const codeEl = clone.querySelector('.locator-code');
  card.querySelector('.locator-type').innerText = type;
  codeEl.innerText = content;

  // BUG-03 fix: hide stop-heal-btn by default (template no longer sets display:none via inline style
  // since that conflicted with display:flex — we set it here instead)
  card.querySelector('.stop-heal-btn').style.display = 'none';

  card.querySelector('.copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(codeEl.innerText).then(() => {
      const btn = card.querySelector('.copy-btn');
      const orig = btn.innerText;
      btn.innerText = 'Copied!';
      setTimeout(() => btn.innerText = orig, 2000);
    });
  });

  // ─── Verify button ───────────────────────────────────────────────────────
  card.querySelector('.verify-btn').addEventListener('click', () => {
    verifyAndMaybeRetry(card, codeEl, type, /* isAutoRetry */ false);
  });

  // ─── Heal button ─────────────────────────────────────────────────────────
  card.querySelector('.heal-btn').addEventListener('click', () => {
    if (isHealing) return;
    // Fresh manual heal: reset bad-locator memory and deadline
    card.removeAttribute('data-bad-locators');
    card.removeAttribute('data-heal-deadline');
    triggerAutoHeal(card, codeEl, type);
  });

  // ─── Stop button ──────────────────────────────────────────────────────────
  card.querySelector('.stop-heal-btn').addEventListener('click', () => {
    isHealing = false;
    card.removeAttribute('data-healing');
    card.removeAttribute('data-bad-locators');
    card.removeAttribute('data-heal-deadline');
    card.classList.remove('healing-pulse');
    card.querySelector('.stop-heal-btn').style.display = 'none';
    card.querySelector('.heal-btn').innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg> Heal`;
    updateHealButtonsState();
  });

  card.querySelector('.learn-btn').addEventListener('click', () => {
    const sessionBlock = card.closest('.session-block');
    const session = sessionHistory.find(s => s.block === sessionBlock);
    if (!session) return;

    saveToKnowledgeBase({
      tagName: session.target.tagName,
      textSnippet: session.target.textSnippet,
      selector: codeEl.innerText,
      type: type
    });

    const btn = card.querySelector('.learn-btn');
    btn.style.background = "#10b981";
    btn.style.color = "white";
    setTimeout(() => { btn.style.background = "transparent"; btn.style.color = "#10b981"; }, 1000);
  });

  contentArea.appendChild(clone);

  // Phase 4: Automatic Validation
  // We trigger verification automatically so the user doesn't have to 
  // switch focus and risk losing dynamic elements (dropdowns, etc.)
  if (!isHealing) {
    const autoVerifyBtn = contentArea.lastElementChild.querySelector('.verify-btn');
    if (autoVerifyBtn) {
      // Small timeout to allow the DOM to settle and ensure we don't spam the message bus
      setTimeout(() => autoVerifyBtn.click(), 50);
    }
  }
}

function updateHealButtonsState() {
  document.querySelectorAll('.heal-btn').forEach(b => b.disabled = isHealing);
}

document.getElementById('clear-all-btn').addEventListener('click', () => {
  if (confirm('Clear history?')) {
    sessionHistory = [];
    const key = getSiteStorageKey();
    chrome.storage.local.remove([key, `state_${currentTabId}`]);
    if (currentTabId) {
      chrome.runtime.sendMessage({ action: 'CLEAR_ACTIVE_SESSION', tabId: currentTabId });
    }
    restoreState(currentTabId);
  }
});

document.getElementById('detach-btn').addEventListener('click', () => {
  chrome.windows.create({
    url: chrome.runtime.getURL(`sidepanel.html?tabId=${currentTabId}&mode=detached`),
    type: 'popup', width: 420, height: 650
  });
  window.close();
});

document.getElementById('attach-btn').addEventListener('click', async () => {
  if (chrome.sidePanel && currentTabId) {
    try {
      await chrome.sidePanel.open({ tabId: currentTabId });
      window.close();
    } catch (err) {
      console.error("Failed to open sidepanel:", err);
      window.close();
    }
  } else {
    window.close();
  }
});

// Initial Visibility Check
const params = new URLSearchParams(window.location.search);
if (params.get('mode') === 'detached') {
  const detachBtn = document.getElementById('detach-btn');
  const attachBtn = document.getElementById('attach-btn');
  if (detachBtn) detachBtn.style.display = 'none';
  if (attachBtn) attachBtn.style.display = 'flex';
}

// Intelligence Hub & Tabs Logic
function initIntelligenceHub() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.style.borderBottomColor = 'transparent';
        b.style.color = 'var(--text-dim)';
      });
      btn.classList.add('active');
      btn.style.borderBottomColor = 'var(--tab-active-border)';
      btn.style.color = 'var(--text)';
      tabPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${targetTab}`);
      });
      if (targetTab === 'settings') {
        refreshEngineAvailability();
      }
    });
  });

  initCollapsibleSections();

  const ruleInput = document.getElementById('custom-rule-input');
  const addRuleBtn = document.getElementById('add-rule-btn');
  const rulesList = document.getElementById('rules-list');

  const loadRules = () => {
    chrome.storage.local.get(['customRules'], (res) => {
      const rules = res.customRules || [];
      rulesList.innerHTML = '';
      rules.forEach((rule, index) => {
        const ruleEl = document.createElement('div');
        ruleEl.className = 'kb-entry';
        ruleEl.style.alignItems = 'center';

        const body = document.createElement('div');
        body.className = 'kb-entry-body';
        body.style.fontSize = '0.75rem';
        body.style.color = 'var(--text)';
        body.style.lineHeight = '1.4';
        body.textContent = String(rule);

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-rule-btn kb-entry-del';
        delBtn.dataset.index = String(index);
        delBtn.innerHTML = ICON_DELETE;

        ruleEl.appendChild(body);
        ruleEl.appendChild(delBtn);
        rulesList.appendChild(ruleEl);
      });

      rulesList.querySelectorAll('.delete-rule-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'));
          rules.splice(idx, 1);
          chrome.storage.local.set({ customRules: rules }, loadRules);
        });
      });
    });
  };

  addRuleBtn.addEventListener('click', () => {
    const text = ruleInput.value.trim();
    if (!text) return;
    chrome.storage.local.get(['customRules'], (res) => {
      const rules = res.customRules || [];
      rules.push(text);
      chrome.storage.local.set({ customRules: rules }, () => {
        ruleInput.value = '';
        loadRules();
      });
    });
  });

  const clearMemBtn = document.getElementById('clear-memory-btn');
  if (clearMemBtn) {
    clearMemBtn.addEventListener('click', () => {
      if (confirm('Wipe all learned patterns?')) {
        chrome.storage.local.set({ knowledgeBase: [] }, () => {
          refreshMemoryUI();
        });
      }
    });
  }

  loadRules();
  initEngineConfig();

  // Master Output Toggle
  const masterHeader = document.getElementById('full-response-header');
  const masterWrapper = document.getElementById('full-response-wrapper');
  if (masterHeader && masterWrapper) {
    masterHeader.addEventListener('click', (e) => {
      if (e.target.closest('#copy-master-btn')) return;
      masterWrapper.classList.toggle('collapsed');
    });
  }

  const copyMasterBtn = document.getElementById('copy-master-btn');
  if (copyMasterBtn) {
    copyMasterBtn.addEventListener('click', () => {
      const text = document.getElementById('full-response-text').value || document.getElementById('full-response-text').textContent;
      navigator.clipboard.writeText(text);
      const icon = copyMasterBtn.innerHTML;
      copyMasterBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => copyMasterBtn.innerHTML = icon, 1500);
    });
  }

  const diagnosticsBtn = document.getElementById('copy-diagnostics-btn');
  if (diagnosticsBtn) {
    diagnosticsBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(getDiagnostics(), null, 2));
      const orig = diagnosticsBtn.innerText;
      diagnosticsBtn.innerText = 'Copied';
      setTimeout(() => diagnosticsBtn.innerText = orig, 1500);
    });
  }
}

function initCollapsibleSections() {
  const sections = Array.from(document.querySelectorAll('.collapsible-section'));
  if (sections.length === 0) return;

  chrome.storage.local.get(['collapsedIntelligenceSections'], (res) => {
    const collapsed = res.collapsedIntelligenceSections || {};

    sections.forEach(section => {
      const id = section.dataset.sectionId;
      const header = section.querySelector('.collapsible-header');
      if (!id || !header) return;

      const applyState = (isCollapsed) => {
        section.classList.toggle('collapsed', isCollapsed);
        header.setAttribute('aria-expanded', String(!isCollapsed));
      };

      const isCollapsed = collapsed[id] !== undefined ? Boolean(collapsed[id]) : true;
      applyState(isCollapsed);

      header.addEventListener('click', () => {
        const nextCollapsed = !section.classList.contains('collapsed');
        collapsed[id] = nextCollapsed;
        applyState(nextCollapsed);
        chrome.storage.local.set({ collapsedIntelligenceSections: collapsed });
      });
    });
  });
}

async function checkOllamaAvailability(url = 'http://localhost:11434') {
  try {
    const cleanUrl = (url || 'http://localhost:11434').trim().replace(/\/$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const resp = await fetch(`${cleanUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return false;
    const data = await resp.json();
    return Array.isArray(data.models) && data.models.length > 0;
  } catch (e) {
    return false;
  }
}

async function isChromeAiAvailable() {
  try {
    const getApi = () => {
      if (typeof ai !== 'undefined' && ai.languageModel) return ai.languageModel;
      if (typeof window !== 'undefined' && window.ai?.languageModel) return window.ai.languageModel;
      if (typeof ai !== 'undefined' && ai.assistant) return ai.assistant;
      if (typeof window !== 'undefined' && window.ai?.assistant) return window.ai.assistant;
      if (typeof LanguageModel !== 'undefined' && LanguageModel.create) return LanguageModel;
      if (typeof window !== 'undefined' && window.LanguageModel?.create) return window.LanguageModel;
      if (typeof model !== 'undefined' && model.create) return model;
      if (typeof window !== 'undefined' && window.model?.create) return window.model;
      return null;
    };
    const api = getApi();
    if (!api) return false;
    if (typeof api.capabilities === 'function') {
      const cap = await api.capabilities();
      if (cap && (cap.available === 'no' || cap.available === false)) {
        return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

async function refreshEngineAvailability() {
  const select = document.getElementById('engine-select');
  const nanoOpt = document.getElementById('option-gemini-nano');
  const ollamaOpt = document.getElementById('option-ollama');
  const ollamaUrl = document.getElementById('ollama-url')?.value?.trim() || 'http://localhost:11434';

  const [chromeAiAvailable, ollamaAvailable] = await Promise.all([
    isChromeAiAvailable(),
    checkOllamaAvailability(ollamaUrl)
  ]);

  if (nanoOpt) nanoOpt.hidden = !chromeAiAvailable;
  if (ollamaOpt) ollamaOpt.hidden = !ollamaAvailable;

  const currentOpt = select?.querySelector(`option[value="${select.value}"]`);
  if (!currentOpt || currentOpt.hidden) {
    const firstAvailable = Array.from(select.options).find(opt => !opt.hidden);
    if (firstAvailable) {
      select.value = firstAvailable.value;
      chrome.storage.local.get(['aiConfig'], (res) => {
        const cfg = res.aiConfig || {};
        cfg.engine = select.value;
        chrome.storage.local.set({ aiConfig: cfg });
      });
    }
  }

  return { chromeAiAvailable, ollamaAvailable };
}

async function initEngineConfig() {
  const select = document.getElementById('engine-select');
  const saveBtn = document.getElementById('save-config-btn');
  const configs = document.querySelectorAll('.engine-config');
  const ollamaSelect = document.getElementById('ollama-model-select');
  const openaiSelect = document.getElementById('openai-model-select');
  const anthropicSelect = document.getElementById('anthropic-model-select');
  const googleSelect = document.getElementById('google-model-select');
  const scopeSelect = document.getElementById('scope-select');
  const refreshOllamaBtn = document.getElementById('refresh-ollama-btn');
  const refreshOpenaiBtn = document.getElementById('refresh-openai-btn');
  const refreshAnthropicBtn = document.getElementById('refresh-anthropic-btn');
  const refreshGoogleBtn = document.getElementById('refresh-google-btn');

  const updateVisibility = (val) => {
    configs.forEach(c => c.style.display = 'none');
    if (val === 'ollama') {
      document.getElementById('config-ollama').style.display = 'flex';
      fetchOllamaModels();
    }
    if (val === 'openai') {
      document.getElementById('config-openai').style.display = 'flex';
      fetchOpenAIModels();
    }
    if (val === 'anthropic') {
      document.getElementById('config-anthropic').style.display = 'flex';
      fetchAnthropicModels();
    }
    if (val === 'google') {
      document.getElementById('config-google').style.display = 'flex';
      fetchGoogleModels();
    }
  };

  chrome.storage.local.get(['sidePanelScope', 'aiConfig'], async (res) => {
    if (scopeSelect) {
      scopeSelect.value = res.sidePanelScope || 'tab';
    }

    const config = res.aiConfig || { engine: 'ollama', ollamaUrl: 'http://localhost:11434' };
    if (config.ollamaUrl) document.getElementById('ollama-url').value = config.ollamaUrl;

    const { chromeAiAvailable, ollamaAvailable } = await refreshEngineAvailability();

    if (config.engine === 'gemini-nano' && !chromeAiAvailable) {
      config.engine = ollamaAvailable ? 'ollama' : 'openai';
    } else if (config.engine === 'ollama' && !ollamaAvailable) {
      config.engine = chromeAiAvailable ? 'gemini-nano' : 'openai';
    }

    select.value = config.engine;

    // Temporarily store saved model name to pre-select after fetch
    if (config.ollamaModel) ollamaSelect.dataset.savedModel = config.ollamaModel;
    if (config.openaiModel && isOpenAIModelAllowedForDropdown(config.openaiModel)) {
      openaiSelect.dataset.savedModel = config.openaiModel;
    } else if (config.openaiModel) {
      config.openaiModel = '';
      chrome.storage.local.set({ aiConfig: config });
    }
    if (config.anthropicModel) anthropicSelect.dataset.savedModel = config.anthropicModel;
    if (config.googleModel) googleSelect.dataset.savedModel = config.googleModel;

    updateVisibility(select.value);
  });

  chrome.storage.session.get(['openaiKey', 'anthropicKey', 'googleKey'], (res) => {
    if (res.openaiKey) document.getElementById('openai-key').value = res.openaiKey;
    if (res.anthropicKey) document.getElementById('anthropic-key').value = res.anthropicKey;
    if (res.googleKey) document.getElementById('google-key').value = res.googleKey;

    if (select.value === 'openai') fetchOpenAIModels();
    if (select.value === 'anthropic') fetchAnthropicModels();
    if (select.value === 'google') fetchGoogleModels();
  });

  select.addEventListener('change', (e) => updateVisibility(e.target.value));
  refreshOllamaBtn.addEventListener('click', async () => {
    await refreshEngineAvailability();
    fetchOllamaModels();
  });
  refreshOpenaiBtn.addEventListener('click', () => fetchOpenAIModels());
  refreshAnthropicBtn.addEventListener('click', () => fetchAnthropicModels());
  refreshGoogleBtn.addEventListener('click', () => fetchGoogleModels());
  document.getElementById('ollama-url').addEventListener('change', () => refreshEngineAvailability());
  document.getElementById('openai-key').addEventListener('change', () => fetchOpenAIModels());
  document.getElementById('anthropic-key').addEventListener('change', () => fetchAnthropicModels());
  document.getElementById('google-key').addEventListener('change', () => fetchGoogleModels());

  saveBtn.addEventListener('click', () => {
    const aiConfig = {
      engine: select.value,
      ollamaUrl: document.getElementById('ollama-url').value.trim(),
      ollamaModel: ollamaSelect.value,
      openaiModel: openaiSelect.value,
      anthropicModel: anthropicSelect.value,
      googleModel: googleSelect.value
    };
    const sidePanelScope = scopeSelect ? scopeSelect.value : 'tab';
    const openaiKey = document.getElementById('openai-key').value.trim();
    const anthropicKey = document.getElementById('anthropic-key').value.trim();
    const googleKey = document.getElementById('google-key').value.trim();

    chrome.storage.local.set({ aiConfig, sidePanelScope }, () => {
      chrome.runtime.sendMessage({ action: 'UPDATE_PANEL_SCOPE', scope: sidePanelScope });
      chrome.storage.session.set({ openaiKey, anthropicKey, googleKey }, () => {
        const orig = saveBtn.innerText;
        saveBtn.innerText = "Settings Saved!";
        saveBtn.style.background = "var(--accent)";
        setTimeout(() => {
          saveBtn.innerText = orig;
          saveBtn.style.background = "var(--btn-primary-bg)";
        }, 2000);
      });
    });
  });
}

function setModelOptions(select, models, savedModel, emptyLabel = 'Select Model...') {
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.innerText = emptyLabel;
  select.appendChild(placeholder);

  (models || []).forEach(model => {
    const id = typeof model === 'string' ? model : model.id;
    const label = typeof model === 'string' ? model : (model.label || model.display_name || model.id);
    const opt = document.createElement('option');
    opt.value = id;
    opt.innerText = label;
    if (id === savedModel) opt.selected = true;
    select.appendChild(opt);
  });
}

function isOpenAIModelAllowedForDropdown(modelObj) {
  if (!modelObj) return false;
  const id = typeof modelObj === 'string' ? modelObj : (modelObj.id || modelObj.name || '');
  if (!id || !isTaskSuitableModel(id)) return false;
  if (/-\d{4}/.test(id)) return false;
  return true;
}

// Rule 1: Exclude non-text/code specialized endpoints (audio, images, embeddings, moderation, etc.)
function isTaskSuitableModel(modelObj) {
  const id = typeof modelObj === 'string' ? modelObj : (modelObj.id || modelObj.name || '');
  if (!id) return false;
  if (/(transcribe|diarize|audio|realtime|tts|whisper|embedding|embed|search|moderation|image|dtop|dall-e|instruct|vision-preview|bidi|voice|speech)/i.test(id)) {
    return false;
  }
  return true;
}

// Rule 4: Extract recency score using API created timestamp and version numbers
function getModelRecencyScore(modelObj) {
  let score = 0;
  
  // High weight for API created timestamp (Unix timestamp in seconds)
  if (typeof modelObj === 'object' && modelObj !== null && typeof modelObj.created === 'number') {
    score += modelObj.created;
  }
  
  const id = (typeof modelObj === 'string' ? modelObj : (modelObj.id || modelObj.name || '')).toLowerCase();
  
  // Extract numerical version indicators (e.g. 4.5, 3.7, 2.0, 1.5)
  const ver = id.match(/(\d+\.\d+)/);
  if (ver) {
    score += parseFloat(ver[1]) * 100000000;
  }
  
  // Family weights
  if (/o3/i.test(id)) score += 300000000;
  if (/o1/i.test(id)) score += 250000000;
  if (/gpt-4o/i.test(id)) score += 200000000;
  if (/claude-3-7|claude-3-5/i.test(id)) score += 200000000;
  if (/gemini-2/i.test(id)) score += 200000000;

  // Penalize dated snapshots like -2024-05-13 or -0613 in favor of clean aliases
  if (/-\d{4}/.test(id)) {
    score -= 50000000;
  }

  return score;
}

// Rule 3: Group models into approximate budget tiers (compact, standard, pro)
function getModelBudgetTier(modelObj) {
  const id = (typeof modelObj === 'string' ? modelObj : (modelObj.id || modelObj.name || '')).toLowerCase();
  if (/nano|mini|haiku|flash|lite|small|8b/i.test(id)) {
    return 'compact'; // Low-cost / Fast
  }
  if (/o1|o3|pro|opus|4\.5|5|flagship|reasoning/i.test(id)) {
    return 'pro'; // High Reasoning / Pro
  }
  return 'standard'; // Mid-tier / Standard
}

// Rule 5: Choose up to 5 models with budget diversity and automatic fallback
function selectDiverseTopModels(models, savedModel, maxCount = 5) {
  if (!Array.isArray(models) || models.length === 0) return [];
  
  const valid = models.filter(isTaskSuitableModel);
  if (valid.length === 0) return [];
  
  // Sort valid models by recency/version score descending
  const sorted = [...valid].sort((a, b) => getModelRecencyScore(b) - getModelRecencyScore(a));
  
  // Group models by budget tier
  const tiers = { compact: [], standard: [], pro: [] };
  sorted.forEach(m => {
    tiers[getModelBudgetTier(m)].push(m);
  });
  
  const selected = [];
  const selectedIds = new Set();
  
  const addModel = (m) => {
    if (!m) return;
    const id = typeof m === 'string' ? m : m.id;
    if (!selectedIds.has(id)) {
      selectedIds.add(id);
      selected.push(m);
    }
  };
  
  // Ensure budget diversity: pick the newest 1 model from each tier if available
  if (tiers.pro.length > 0) addModel(tiers.pro[0]);
  if (tiers.compact.length > 0) addModel(tiers.compact[0]);
  if (tiers.standard.length > 0) addModel(tiers.standard[0]);
  
  // Fill remaining slots with newest overall models
  for (const m of sorted) {
    if (selected.length >= maxCount) break;
    addModel(m);
  }
  
  // Preserve saved model if valid but not selected in top 5
  if (savedModel && !selectedIds.has(savedModel)) {
    const savedObj = valid.find(m => (typeof m === 'string' ? m : m.id) === savedModel) || savedModel;
    selected.unshift(savedObj);
  }
  
  return selected;
}

async function fetchOllamaModels() {
  const url = document.getElementById('ollama-url').value.trim() || 'http://localhost:11434';
  const select = document.getElementById('ollama-model-select');
  const savedModel = select.dataset.savedModel;
  
  try {
    select.innerHTML = '<option value="">Loading Ollama models...</option>';
    const response = await fetch(`${url}/api/tags`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    
    if (data.models && data.models.length > 0) {
      const selected = selectDiverseTopModels(data.models.map(m => m.name), savedModel, 5);
      setModelOptions(select, selected, savedModel, 'Select Model...');
    } else {
      select.innerHTML = '<option value="">No local models found in Ollama</option>';
    }
  } catch (err) {
    select.innerHTML = '<option value="">Ollama API Unreachable</option>';
    console.warn("Ollama fetch error:", err);
  }
}

async function fetchOpenAIModels() {
  const select = document.getElementById('openai-model-select');
  const key = document.getElementById('openai-key').value.trim();
  const savedModel = select.dataset.savedModel;

  if (!key) {
    select.innerHTML = '<option value="">Enter API Key to load models</option>';
    return;
  }

  try {
    select.innerHTML = '<option value="">Loading OpenAI models...</option>';
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rawList = (data.data || []).filter(m => (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3')));
    const selected = selectDiverseTopModels(rawList, savedModel, 5);

    if (selected.length === 0) {
      select.innerHTML = '<option value="">No compatible OpenAI models found</option>';
      return;
    }
    setModelOptions(select, selected, savedModel, 'Select Model...');
  } catch (err) {
    select.innerHTML = '<option value="">Error loading OpenAI models (check API key)</option>';
    console.warn('OpenAI model fetch error:', err);
  }
}

async function fetchAnthropicModels() {
  const select = document.getElementById('anthropic-model-select');
  const key = document.getElementById('anthropic-key').value.trim();
  const savedModel = select.dataset.savedModel;

  if (!key) {
    select.innerHTML = '<option value="">Enter Anthropic API Key to load models</option>';
    return;
  }

  try {
    select.innerHTML = '<option value="">Loading Anthropic models...</option>';
    const response = await fetch('https://api.anthropic.com/v1/models?limit=20', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rawList = (data.data || [])
      .filter(m => /claude/i.test(m.id))
      .map(m => ({ id: m.id, label: m.display_name ? `${m.display_name} (${m.id})` : m.id }));
    const selected = selectDiverseTopModels(rawList, savedModel, 5);

    if (selected.length === 0) {
      select.innerHTML = '<option value="">No compatible Anthropic models found</option>';
      return;
    }
    setModelOptions(select, selected, savedModel, 'Select Model...');
  } catch (err) {
    select.innerHTML = '<option value="">Error loading Anthropic models (check API key)</option>';
    console.warn('Anthropic model fetch error:', err);
  }
}

async function fetchGoogleModels() {
  const select = document.getElementById('google-model-select');
  const key = document.getElementById('google-key').value.trim();
  const savedModel = select.dataset.savedModel;

  if (!key) {
    select.innerHTML = '<option value="">Enter Gemini API Key to load models</option>';
    return;
  }

  try {
    select.innerHTML = '<option value="">Loading Gemini models...</option>';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rawList = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => (m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    const selected = selectDiverseTopModels(rawList, savedModel, 5);

    if (selected.length === 0) {
      select.innerHTML = '<option value="">No compatible Gemini models found</option>';
      return;
    }
    setModelOptions(select, selected, savedModel, 'Select Model...');
  } catch (err) {
    select.innerHTML = '<option value="">Error loading Gemini models (check API key)</option>';
    console.warn('Google model fetch error:', err);
  }
}

// Override refreshMemoryUI to sync counters AND render the #kb-list viewer
const originalRefresh = refreshMemoryUI;
refreshMemoryUI = async function() {
  chrome.storage.local.get(['knowledgeBase'], (res) => {
    const kb = res.knowledgeBase || [];
    const count = kb.length;

    ['memory-count', 'memory-count-detail'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerText = count;
    });

    // Render KB list with per-item delete
    const kbList = document.getElementById('kb-list');
    if (!kbList) return;

    if (kb.length === 0) {
      kbList.innerHTML = '<div style="font-size:0.75rem; color:var(--text-dim); text-align:center; padding:16px 0; opacity:0.5;">No patterns learned yet.</div>';
      return;
    }

    kbList.innerHTML = '';
    kb.forEach((entry, idx) => {
      const row = document.createElement('div');
      row.className = 'kb-entry';

      const info = document.createElement('div');
      info.className = 'kb-entry-body';

      const meta = document.createElement('div');
      meta.className = 'kb-entry-meta';

      const type = document.createElement('span');
      type.className = 'meta-type';
      type.textContent = entry.type || 'Unknown';

      const separator = document.createElement('span');
      separator.textContent = '-';

      const tag = document.createElement('span');
      tag.textContent = entry.tagName || '';

      const selector = document.createElement('code');
      selector.className = 'kb-entry-selector';
      selector.textContent = entry.selector || '';

      meta.appendChild(type);
      meta.appendChild(separator);
      meta.appendChild(tag);
      info.appendChild(meta);
      info.appendChild(selector);

      if (entry.textSnippet) {
        const note = document.createElement('div');
        note.className = 'kb-entry-note';
        note.textContent = `"${entry.textSnippet}"`;
        info.appendChild(note);
      }

      const delBtn = document.createElement('button');
      delBtn.title = 'Remove pattern';
      delBtn.className = 'kb-entry-del';
      delBtn.innerHTML = ICON_DELETE_SMALL;
      delBtn.addEventListener('click', () => {
        const updated = kb.filter((_, i) => i !== idx);
        chrome.storage.local.set({ knowledgeBase: updated }, () => refreshMemoryUI());
      });

      row.appendChild(info);
      row.appendChild(delBtn);
      kbList.appendChild(row);
    });
  });
};

init();
initIntelligenceHub();
