const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadWorker() {
  const local = {};
  const session = {};
  const sent = [];
  let onMessage;
  const get = store => (keys, callback) => {
    const result = Object.fromEntries(keys.map(key => [key, store[key]]));
    if (callback) { callback(result); return; }
    return Promise.resolve(result);
  };
  const chrome = {
    storage: {
      local: { get: get(local), set: async values => Object.assign(local, structuredClone(values)) },
      session: { get: get(session), set: async values => Object.assign(session, structuredClone(values)) }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onConnect: { addListener() {} },
      onMessage: { addListener(fn) { onMessage = fn; } },
      sendMessage: async message => { sent.push(message); }
    },
    action: { onClicked: { addListener() {} } },
    sidePanel: { setPanelBehavior: async () => {}, setOptions: async () => {} },
    tabs: { query: async () => [] }
  };
  const context = vm.createContext({ chrome, console, setTimeout });
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);
  vm.runInContext('handleAiRequest = () => {}', context);
  const dispatch = (message, tabId) => new Promise(resolve => {
    onMessage(message, tabId ? { tab: { id: tabId } } : {}, resolve);
  });
  return { local, session, sent, context, dispatch };
}

function findSessionIndex(history, active) {
  const code = fs.readFileSync('sidepanel.js', 'utf8');
  const start = code.indexOf('function isEqualTarget(');
  const end = code.indexOf('function splitCodeBlockIntoExpressions(', start);
  const ctx = vm.createContext({});
  vm.runInContext(code.slice(start, end), ctx);
  return vm.runInContext('findActiveSessionIndex', ctx)(history, active);
}

test('one request has one ID in two panels, including buffer recovery', async () => {
  const { local, sent, dispatch } = loadWorker();
  const target = { tagName: 'BUTTON', id: 'same-target' };
  dispatch({ action: 'ELEMENT_SELECTED', data: JSON.stringify(target) }, 11);
  const start = sent.find(message => message.action === 'ANALYSIS_START');
  assert.ok(start.sessionId);
  const active = await dispatch({ action: 'GET_ACTIVE_SESSION', tabId: 11 });
  assert.equal(active.sessionId, start.sessionId);

  const key = 'state_site_example.test';
  const base = { id: start.sessionId, target, text: '', isFinished: false, providerLabel: '' };
  // Two open panels receiving the same request may each upsert their local copy.
  await Promise.all([1, 2].map(() => dispatch({
    action: 'UPSERT_SITE_SESSIONS', key, siteHost: 'example.test', history: [base]
  })));
  assert.equal(local[key].history.length, 1);
  assert.equal(findSessionIndex(local[key].history, active), 0);
  // Target equality must not collapse two different requests for the same element.
  assert.equal(findSessionIndex([{ ...base, id: 'other-request' }], active), -1);

  // A finished write wins even when a delayed provider-label write arrives later.
  await dispatch({ action: 'UPSERT_SITE_SESSIONS', key, history: [{ ...base, text: 'selector', isFinished: true }] });
  await dispatch({ action: 'UPSERT_SITE_SESSIONS', key, history: [{ ...base, providerLabel: 'OpenAI' }] });
  assert.equal(local[key].history.length, 1);
  assert.equal(local[key].history[0].text, 'selector');
  assert.equal(local[key].history[0].isFinished, true);
});

test('same target in a different request remains a separate history entry', async () => {
  const { local, sent, dispatch } = loadWorker();
  const target = { tagName: 'BUTTON', id: 'same-target' };
  const key = 'state_site_example.test';
  for (let i = 0; i < 2; i++) {
    dispatch({ action: 'ELEMENT_SELECTED', data: JSON.stringify(target) }, 11);
    const id = sent.filter(m => m.action === 'ANALYSIS_START').at(-1).sessionId;
    await dispatch({ action: 'UPSERT_SITE_SESSIONS', key, history: [
      { id, target, text: 'selector', isFinished: true }
    ] });
  }
  assert.equal(local[key].history.length, 2);
  assert.notEqual(local[key].history[0].id, local[key].history[1].id);
});

test('deletion tombstone prevents a stale panel upsert from resurrecting a session', async () => {
  const { local, dispatch } = loadWorker();
  const key = 'state_site_example.test';
  const history = [{ id: 'request-1', target: { tagName: 'A' }, text: '' }];
  await dispatch({ action: 'UPSERT_SITE_SESSIONS', key, history });
  await dispatch({ action: 'DELETE_SITE_SESSION', key, sessionId: 'request-1' });
  await dispatch({ action: 'UPSERT_SITE_SESSIONS', key, history });
  assert.equal(local[key].history.length, 0);
});
