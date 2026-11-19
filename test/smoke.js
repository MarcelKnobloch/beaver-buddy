// Headless smoke test: loads the extension with a stubbed `vscode` module, renders the webview in jsdom,
// and checks the main behaviours. Run with `npm test`.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fake `vscode` and `positron` modules
const notebookListeners = [];
const positronListeners = { exec: [], state: [], msg: [] };
const session = {
  onDidReceiveRuntimeMessage: (f) => { positronListeners.msg.push(f); return { dispose() {} }; },
  onDidChangeRuntimeState: (f) => { positronListeners.state.push(f); return { dispose() {} }; },
};
const POSITRON = {
  runtime: {
    getForegroundSession: () => Promise.resolve(session),
    onDidChangeForegroundSession: () => ({ dispose() {} }),
    onDidExecuteCode: (f) => { positronListeners.exec.push(f); return { dispose() {} }; },
  },
};
const VSCODE = {
  Uri: { joinPath: (b, ...p) => ({ p: path.join(b.p || b, ...p) }) },
  ViewColumn: {},
  ConfigurationTarget: { Global: 1 },
  window: {
    state: { focused: true },
    onDidChangeWindowState: () => ({ dispose() {} }),
    registerWebviewViewProvider: (id, p) => { VSCODE.provider = p; return { dispose() {} }; },
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
  },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => d, update() {} }),
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidChangeNotebookDocument: (f) => { notebookListeners.push(f); return { dispose() {} }; },
  },
  commands: { registerCommand: () => ({ dispose() {} }) },
  tasks: {},
};
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return VSCODE;
  if (request === 'positron') return POSITRON;
  return load.call(this, request, ...rest);
};

(async () => {
  const ext = require(path.join(root, 'extension.js'));
  ext.activate({ subscriptions: [], globalState: { get: () => 0, update: () => {} }, extensionUri: { p: root } });
  const provider = VSCODE.provider;
  assert.ok(provider, 'webview view provider registered');

  // ---- the extension side: what runs mean
  const posts = [];
  provider.post = (m) => { posts.push(m.type); return Promise.resolve(); };
  await sleep(10); // let the fake Positron session attach
  const fire = (list, ...args) => list.forEach((f) => f(...args));

  fire(positronListeners.exec, { languageId: 'r', code: 'source("a.R")', attribution: { source: 'script' } });
  fire(positronListeners.state, 'busy'); fire(positronListeners.state, 'idle');
  assert.deepStrictEqual(posts.splice(0), ['yay'], 'a successful script run cheers');

  provider.lastYay = 0;
  fire(positronListeners.exec, { languageId: 'python', code: 'run()', attribution: { source: 'script' } });
  fire(positronListeners.state, 'busy'); fire(positronListeners.msg, { type: 'error' }); fire(positronListeners.state, 'idle');
  assert.deepStrictEqual(posts.splice(0), ['oops'], 'a failing script run says oops');

  fire(positronListeners.exec, { languageId: 'r', code: '1+1', attribution: { source: 'interactive' } });
  fire(positronListeners.state, 'busy'); fire(positronListeners.state, 'idle');
  assert.deepStrictEqual(posts.splice(0), [], 'single console lines are ignored by default');

  provider.lastYay = 0;
  notebookListeners.forEach((f) => f({ cellChanges: [{ cell: { document: { uri: { toString: () => 'nb' }, languageId: 'python' } }, executionSummary: { success: true, timing: { endTime: Date.now() } } }] }));
  assert.deepStrictEqual(posts.splice(0), ['yay'], 'a successful notebook cell cheers');

  // ---- the webview side
  const html = provider.html({ cspSource: 'x', asWebviewUri: (u) => u.p }, 'camp').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.message));
  w.matchMedia = () => ({ matches: false });
  const sent = [];
  w.acquireVsCodeApi = () => ({ postMessage: (m) => sent.push(m), getState: () => ({}), setState() {} });
  w.Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, set onfinish(f) { setTimeout(f, 0); } });
  const P = w.HTMLElement.prototype;
  Object.defineProperty(P, 'clientWidth', { get: () => 400 });
  Object.defineProperty(P, 'offsetWidth', { get: () => 80 });
  Object.defineProperty(P, 'offsetHeight', { get: () => 24 });
  w.eval(fs.readFileSync(path.join(root, 'media/main.js'), 'utf8'));
  const $ = (id) => w.document.getElementById(id);
  const send = (m) => w.dispatchEvent(new w.MessageEvent('message', { data: m }));
  const init = (logs, extra) => send(Object.assign({ type: 'init', chars: logs * 30, perLog: 30, perDam: 80, greet: false, focused: true, timeMode: 'day' }, extra));

  assert.strictEqual(sent[0].type, 'ready', 'webview announces itself');

  init(0, { greet: true });
  await sleep(20);
  assert.strictEqual($('bubble').textContent, 'hello :)', 'greets on start');
  assert.strictEqual($('stDam').textContent, 'current dam 0/80.');
  assert.strictEqual($('stDone').textContent, '0 dams finished.');

  init(40);
  assert.strictEqual($('stDam').textContent, 'current dam 40/80.');
  const waistAt40 = $('cutUp').getAttribute('points');
  init(76);
  assert.notStrictEqual($('cutUp').getAttribute('points'), waistAt40, 'the tree gets chewed as the dam grows');
  assert.ok($('babies').children.length > 0, 'baby beavers appear near the end');
  assert.ok($('map').querySelectorAll('*').length > 300, 'the world map is drawn');

  send({ type: 'yay' }); assert.strictEqual($('bubble').textContent, 'yay :)');
  send({ type: 'oops' }); assert.strictEqual($('bubble').textContent, 'oops :(');

  init(40, { timeMode: 'night' }); await sleep(2800); // the sky eases into night over ~2.6 s
  assert.ok(+$('night').getAttribute('opacity') > 0.2, 'night is dark');
  init(40, { timeMode: 'day' }); await sleep(2800);
  assert.ok(+$('night').getAttribute('opacity') < 0.05, 'day is bright');

  // finishing a dam fells the tree, builds a new one, and counts it
  init(79);
  send({ type: 'typing', idle: false, chars: 80 * 30, perLog: 30, perDam: 80, focused: true });
  await sleep(4500);
  assert.strictEqual($('stDone').textContent, '1 dam finished.');
  assert.strictEqual($('stDam').textContent, 'current dam 0/80.');

  assert.deepStrictEqual(errors, [], 'no script errors');
  console.log('smoke test passed');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
