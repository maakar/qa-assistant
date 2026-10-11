// content.js - QA Assistant
console.log("=== QA ASSISTANT CONTENT SCRIPT STARTING ===");
let isInspecting = false;
let lastHighlighted = null;

function cssString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cssIdent(value) {
  const raw = String(value ?? '');
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(raw);
  return raw.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function xpathString(value) {
  const raw = String(value ?? '');
  if (!raw.includes("'")) return `'${raw}'`;
  if (!raw.includes('"')) return `"${raw}"`;
  return `concat(${raw.split("'").map(part => `'${part}'`).join(`, "'", `)})`;
}

function cleanClassName(el) {
  const classValue = typeof el.className === 'string'
    ? el.className
    : (el.getAttribute?.('class') || '');

  return classValue
    .replace('qa-assistant-highlight', '')
    .replace('qa-assistant-hover', '')
    .trim();
}

// ─── Verification Logic ───────────────────────────────────────────────────────
function clearVerificationOverlays() {
  const overlays = document.querySelectorAll('.qa-verify-overlay');
  overlays.forEach(o => o.remove());
}

/**
 * Translates Playwright locator expressions to native CSS/XPath queries.
 * Handles getByRole, getByTestId, getByText, getByLabel, getByPlaceholder,
 * locator(), css=, xpath=, id=, data-testid=, text= prefixes, and raw selectors.
 * BUG-05: Previous implementation was too naive and stripped selectors to the
 * first quoted string only, producing invalid queries.
 */
function playwrightToNative(query) {
  const q = query.trim();

  // ── page.getByTestId('value') ──────────────────────────────────────────────
  const testIdM = q.match(/getByTestId\(['"]([^'"]+)['"]\)/);
  if (testIdM) {
    const val = cssString(testIdM[1]);
    return { css: `[data-testid="${val}"], [data-test="${val}"], [data-qa="${val}"], [data-cy="${val}"]` };
  }

  // ── page.getByRole('role', { name: 'text' }) ───────────────────────────────
  const roleM = q.match(/getByRole\(['"]([^'"]+)['"]/);
  if (roleM) {
    const role = roleM[1];
    const nameM = q.match(/name\s*:\s*['"]([^'"]+)['"]/);
    const name = nameM ? nameM[1] : null;
    const roleLit = xpathString(role);

    // Build native equivalents for common roles
    const roleMap = {
      button:  { tag: 'button', attrs: ['[type="button"]', '[type="submit"]', '[role="button"]'] },
      link:    { tag: 'a', attrs: ['[role="link"]'] },
      textbox: { tag: 'input', attrs: ['input[type="text"]', 'input:not([type])', 'textarea', '[role="textbox"]'] },
      checkbox: { tag: 'input[type="checkbox"]', attrs: ['[role="checkbox"]'] },
      radio:   { tag: 'input[type="radio"]', attrs: ['[role="radio"]'] },
      combobox: { tag: 'select', attrs: ['[role="combobox"]'] },
      listitem: { tag: 'li', attrs: ['[role="listitem"]'] },
      heading: { tag: 'h1, h2, h3, h4, h5, h6', attrs: ['[role="heading"]'] },
    };

    if (name) {
      const nameLit = xpathString(name);
      // With a name — use XPath for accessible name matching
      if (role === 'button') {
        return { xpath: `//button[normalize-space(.)=${nameLit} or @aria-label=${nameLit} or @title=${nameLit} or @value=${nameLit}] | //*[@role="button" and (normalize-space(.)=${nameLit} or @aria-label=${nameLit} or @title=${nameLit})]` };
      } else if (role === 'link') {
        return { xpath: `//a[normalize-space(.)=${nameLit} or @aria-label=${nameLit} or @title=${nameLit}] | //*[@role="link" and (normalize-space(.)=${nameLit} or @aria-label=${nameLit} or @title=${nameLit})]` };
      } else if (role === 'textbox') {
        return { xpath: `//input[@aria-label=${nameLit} or @placeholder=${nameLit} or @name=${nameLit}] | //textarea[@aria-label=${nameLit} or @placeholder=${nameLit} or @name=${nameLit}] | //*[@role="textbox" and (@aria-label=${nameLit} or @placeholder=${nameLit})]` };
      } else {
        return { xpath: `//*[@role=${roleLit} and (normalize-space(.)=${nameLit} or @aria-label=${nameLit} or @title=${nameLit})]` };
      }
    } else {
      // Without a name — use CSS
      const info = roleMap[role];
      const parts = info ? [`[role="${role}"]`, info.tag, ...(info.attrs || [])] : [`[role="${role}"]`];
      return { css: [...new Set(parts)].join(', ') };
    }
  }

  // ── page.getByText('value') ────────────────────────────────────────────────
  const textM = q.match(/getByText\(['"]([^'"]+)['"]/);
  if (textM) {
    const txt = xpathString(textM[1]);
    return { xpath: `//*[normalize-space(text())=${txt} or normalize-space(.)=${txt}]` };
  }

  // ── page.getByLabel('value') ───────────────────────────────────────────────
  const labelM = q.match(/getByLabel\(['"]([^'"]+)['"]/);
  if (labelM) {
    const lbl = xpathString(labelM[1]);
    return { xpath: `//input[@aria-label=${lbl}] | //textarea[@aria-label=${lbl}] | //label[normalize-space(.)=${lbl}]//input | //label[normalize-space(.)=${lbl}]//textarea` };
  }

  // ── page.getByPlaceholder('value') ────────────────────────────────────────
  const phM = q.match(/getByPlaceholder\(['"]([^'"]+)['"]/);
  if (phM) return { css: `[placeholder="${cssString(phM[1])}"]` };

  // ── page.locator('selector') ───────────────────────────────────────────────
  const locM = q.match(/\.locator\(['"]([^'"]+)['"]\)/);
  if (locM) {
    const sel = locM[1];
    if (sel.startsWith('//') || sel.startsWith('(') || sel.startsWith('./')) return { xpath: sel };
    return { css: sel };
  }

  // ── Explicit prefix selectors ──────────────────────────────────────────────
  if (q.startsWith('id='))            return { css: `#${cssIdent(q.substring(3))}` };
  if (q.startsWith('data-testid='))   return { css: `[data-testid="${cssString(q.substring(12))}"]` };
  if (q.startsWith('data-test='))     return { css: `[data-test="${cssString(q.substring(10))}"]` };
  if (q.startsWith('data-qa='))       return { css: `[data-qa="${cssString(q.substring(8))}"]` };
  if (q.startsWith('data-cy='))       return { css: `[data-cy="${cssString(q.substring(8))}"]` };
  if (q.startsWith('css='))           return { css: q.substring(4) };
  if (q.startsWith('xpath='))         return { xpath: q.substring(6) };

  if (q.startsWith('text=')) {
    const textVal = q.substring(5);
    if (textVal.startsWith('"') && textVal.endsWith('"')) {
      const clean = textVal.slice(1, -1);
      const cleanLit = xpathString(clean);
      return { xpath: `//*[normalize-space(text())=${cleanLit} or @value=${cleanLit} or @placeholder=${cleanLit}]` };
    }
    const textLit = xpathString(textVal);
    return { xpath: `//*[contains(normalize-space(text()), ${textLit}) or contains(@value, ${textLit}) or contains(@placeholder, ${textLit})]` };
  }

  if (q.startsWith('role=')) {
    const rm = q.match(/role=(\w+)/);
    if (rm) return { css: `[role="${rm[1]}"], ${rm[1] === 'button' ? 'button' : rm[1] === 'link' ? 'a' : `[role="${rm[1]}"]`}` };
  }

  // ── Raw XPath or CSS fallback ──────────────────────────────────────────────
  if (q.startsWith('//') || q.startsWith('(') || q.startsWith('./')) return { xpath: q };
  return { css: q };
}

/**
 * Strips Playwright-only pseudo-selectors from a CSS string and returns
 * { baseCss, textFilter } so querySelectorAll can run on the base and we
 * can filter the resulting nodes by text content afterwards.
 */
function stripPlaywrightPseudos(css) {
  let textFilter = null;

  // :text('value') or :text("value") — exact text match
  css = css.replace(/:text\(['"]([^'"]*)['"]\)/g, (_, val) => {
    textFilter = { mode: 'exact', value: val };
    return '';
  });

  // :has-text('value') — contains text
  css = css.replace(/:has-text\(['"]([^'"]*)['"]\)/g, (_, val) => {
    textFilter = { mode: 'contains', value: val };
    return '';
  });

  // :visible, :nth-match() — drop silently (browser has :nth-child)
  css = css.replace(/:visible/g, '').replace(/:nth-match\([^)]*\)/g, '');

  return { baseCss: css.trim(), textFilter };
}

function evaluatePlaywrightSelector(type, query) {
  let nodes = [];
  const native = playwrightToNative(query);

  try {
    if (native.css) {
      nodes = Array.from(document.querySelectorAll(native.css));
    } else if (native.xpath) {
      const result = document.evaluate(native.xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) nodes.push(result.snapshotItem(i));
    }
  } catch (err) {
    console.warn('Playwright translation error, trying raw query directly:', err);
    try { nodes = Array.from(document.querySelectorAll(query)); } catch (e) {}
  }
  return nodes;
}

function verifyLocator(type, query) {
  try {
    clearVerificationOverlays();
    let nodes = [];

    if (type.toUpperCase().includes('PLAYWRIGHT')) {
      nodes = evaluatePlaywrightSelector(type, query);
    } else if (type.toUpperCase().includes('CSS')) {
      // Detect Playwright pseudo-selectors that browsers don't understand
      const hasPlaywrightPseudo = /:text\(|:has-text\(|:visible|:nth-match\(/.test(query);
      if (hasPlaywrightPseudo) {
        const { baseCss, textFilter } = stripPlaywrightPseudos(query);
        try {
          let candidates = baseCss ? Array.from(document.querySelectorAll(baseCss)) : [];
          if (textFilter) {
            candidates = candidates.filter(el => {
              const t = (el.textContent || el.innerText || '').trim();
              return textFilter.mode === 'exact'
                ? t === textFilter.value || el.value === textFilter.value
                : t.includes(textFilter.value) || (el.value || '').includes(textFilter.value);
            });
          }
          nodes = candidates;
        } catch (e) {
          console.warn('Playwright-pseudo CSS fallback error:', e);
        }
      } else {
        try { nodes = Array.from(document.querySelectorAll(query)); }
        catch (e) { console.warn('CSS selector error:', e); }
      }
    } else if (type.toUpperCase().includes('XPATH')) {
      const result = document.evaluate(query, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < result.snapshotLength; i++) nodes.push(result.snapshotItem(i));
    }

    nodes.forEach((node, index) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const overlay = document.createElement('div');
      overlay.className = 'qa-verify-overlay';
      applyOverlayGeometry(overlay, node.getBoundingClientRect(), true);

      if (nodes.length > 1) {
        const badge = document.createElement('div');
        badge.className = 'qa-verify-badge';
        badge.innerText = `${index + 1}/${nodes.length}`;
        overlay.appendChild(badge);
      }

      document.body.appendChild(overlay);
    });

    return { count: nodes.length };
  } catch (err) {
    console.error("Verification logic error:", err);
    return { count: 0, error: err.message };
  }
}

// ─── Message Listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'PING') {
    sendResponse({ status: 'pong' });
    return false;
  } else if (message.action === 'START_INSPECTION') {
    startInspection();
    sendResponse({ status: 'started' });
  } else if (message.action === 'STOP_INSPECTION') {
    stopInspection();
    sendResponse({ status: 'stopped' });
  } else if (message.action === 'CLEAR_SELECTION') {
    const selectionOverlay = document.getElementById('qa-selection-overlay');
    if (selectionOverlay) selectionOverlay.style.display = 'none';
    clearVerificationOverlays();
    sendResponse({ status: 'cleared' });
  } else if (message.action === 'CLEAR_HIGHLIGHTS') {
    const selection = document.getElementById('qa-selection-overlay');
    if (selection) selection.style.display = 'none';

    document.querySelectorAll('.qa-assistant-highlight').forEach(el => {
      el.classList.remove('qa-assistant-highlight');
    });

    clearVerificationOverlays();
    sendResponse({ status: 'cleared' });
  } else if (message.action === 'VERIFY_LOCATOR') {
    const result = verifyLocator(message.type, message.query);
    sendResponse(result);
  } else if (message.action === 'FREEZE_PAGE') {
    freezePage();
    sendResponse({ status: 'freezing' });
  }
  return false;
});

// ─── Freeze Tool ──────────────────────────────────────────────────────────────
function freezePage() {
  let seconds = 3;
  const interval = setInterval(() => {
    if (seconds > 0) {
      showToast(`Freezing in ${seconds}s... Prepare the element!`);
      seconds--;
    } else {
      clearInterval(interval);
      showToast("FROZEN! (DevTools must be open)");

      const lockEvents = (e) => { e.stopPropagation(); };
      document.addEventListener('mouseout', lockEvents, true);
      document.addEventListener('mouseleave', lockEvents, true);

      console.log("=== QA ASSISTANT: PAGE FROZEN ===");
      debugger; // eslint-disable-line no-debugger

      setTimeout(() => {
        document.removeEventListener('mouseout', lockEvents, true);
        document.removeEventListener('mouseleave', lockEvents, true);
      }, 10000);
    }
  }, 1000);
}

// ─── Inspection ───────────────────────────────────────────────────────────────
function startInspection() {
  if (isInspecting) return;
  isInspecting = true;
  ensureOverlays();
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('click', onClick, true);
  showToast("Click an element to analyze...");
}

function stopInspection() {
  isInspecting = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('click', onClick, true);

  const hoverOverlay = document.getElementById('qa-hover-overlay');
  if (hoverOverlay) hoverOverlay.style.display = 'none';

  hideToast();
}

function ensureOverlays() {
  if (!document.getElementById('qa-hover-overlay')) {
    const hover = document.createElement('div');
    hover.id = 'qa-hover-overlay';
    document.body.appendChild(hover);
  }
  if (!document.getElementById('qa-selection-overlay')) {
    const selection = document.createElement('div');
    selection.id = 'qa-selection-overlay';
    document.body.appendChild(selection);
  }
}

// ─── Overlay Geometry (BUG-11) ────────────────────────────────────────────────
// All overlays now use position:fixed geometry consistently.
// The `fixed` parameter makes the intent explicit at call sites.
function applyOverlayGeometry(overlay, rect, fixed = false) {
  if (fixed) {
    // Fixed: coordinates are already viewport-relative
    overlay.style.top    = `${rect.top}px`;
    overlay.style.left   = `${rect.left}px`;
  } else {
    // Absolute: add scroll offset so overlay sticks to the element
    overlay.style.top    = `${rect.top + window.scrollY}px`;
    overlay.style.left   = `${rect.left + window.scrollX}px`;
  }
  overlay.style.width  = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.display = 'block';
}

function updateOverlay(id, el) {
  const overlay = document.getElementById(id);
  if (!overlay || !el) return;
  // Hover and selection overlays are fixed-position (see content-styles.css)
  applyOverlayGeometry(overlay, el.getBoundingClientRect(), true);
}

// ─── Mouse Handlers ───────────────────────────────────────────────────────────
function onMouseOver(e) {
  const el = e.target;
  if (el.id?.startsWith('qa-assistant') || el.id?.startsWith('qa-')) return;
  updateOverlay('qa-hover-overlay', el);
}

function onMouseOut(e) {
  const overlay = document.getElementById('qa-hover-overlay');
  if (overlay) overlay.style.display = 'none';
}

function onMouseDown(e) {
  if (isInspecting) {
    e.preventDefault();
    e.stopPropagation();
  }
}

async function onClick(e) {
  if (!isInspecting) return;

  e.preventDefault();
  e.stopPropagation();

  document.querySelectorAll('.qa-assistant-highlight').forEach(el => el.classList.remove('qa-assistant-highlight'));
  const oldSel = document.getElementById('qa-selection-overlay');
  if (oldSel) oldSel.style.display = 'none';

  const element = e.target;
  updateOverlay('qa-selection-overlay', element);
  element.classList.add('qa-assistant-highlight');

  const cleanClasses = cleanClassName(element);

  const findBestAnchor = (el) => {
    let current = el.parentElement;
    let depth = 0;
    const maxDepth = 5;

    while (current && current !== document.body && depth < maxDepth) {
      const id = current.id;
      const testId = current.getAttribute('data-testid') || current.getAttribute('data-test') || current.getAttribute('data-qa');
      const isStableId = id && /^[a-zA-Z][a-zA-Z0-9\s\-_:\.#]*$/.test(id) && !/\d{5,}/.test(id);

      if (testId || isStableId) {
        return {
          tagName: current.tagName,
          id: id || "",
          testId: testId || "",
          className: cleanClassName(current)
        };
      }
      current = current.parentElement;
      depth++;
    }
    return null;
  };

  const prunedData = {
    tagName: element.tagName,
    id: element.id,
    className: cleanClasses,
    testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-qa') || "",
    dataCy: element.getAttribute('data-cy') || "",
    name: element.getAttribute('name') || "",
    placeholder: element.getAttribute('placeholder') || "",
    title: element.getAttribute('title') || "",
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label'),
    textSnippet: (element.innerText || element.textContent || "").substring(0, 100).trim(),
    parentData: element.parentElement ? {
      tagName: element.parentElement.tagName,
      id: element.parentElement.id,
      className: cleanClassName(element.parentElement)
    } : null,
    anchorData: findBestAnchor(element)
  };

  stopInspection();
  hideToast();

  chrome.runtime.sendMessage({
    action: 'ELEMENT_SELECTED',
    data: JSON.stringify(prunedData)
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(text) {
  let toast = document.getElementById('qa-assistant-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'qa-assistant-toast';
    toast.style = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: #6366f1; color: white; padding: 10px 20px;
      border-radius: 99px; font-weight: 600; z-index: 100000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2); pointer-events: none;
    `;
    document.body.appendChild(toast);
  }
  toast.innerText = text;
}

function hideToast() {
  const toast = document.getElementById('qa-assistant-toast');
  if (toast) toast.remove();
}

// ─── Gemini Nano Relay ────────────────────────────────────────────────────────
// Relays postMessages from the MAIN world to the extension service worker.
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'AI_CHUNK') {
    chrome.runtime.sendMessage({
      action: 'AI_STREAM_CHUNK',
      data: event.data.data,
      tabId: event.data.tabId,
      isChunk: event.data.isChunk
    });
  } else if (event.data && event.data.type === 'AI_REFINEMENT_CHUNK') {
    chrome.runtime.sendMessage({
      action: 'AI_REFINEMENT_CHUNK',
      data: event.data.data,
      locatorType: event.data.locatorType,
      tabId: event.data.tabId,
      isChunk: event.data.isChunk
    });
  }
});
