const vscode = require('vscode');
const crypto = require('crypto');

const KEY = 'beaverDam.chars';
const MAX_CHARS_PER_EVENT = 8; // stops big pastes / formatters from farming logs
const TYPING_REF = 3; // chars per second a typical coding session produces (idle pace is a % of this)

class Beaver {
  constructor(context) {
    this.context = context;
    this.targets = new Set(); // every open webview (sidebar + optional map panel)
    this.greeted = false;
    this.timer = undefined;
    this.panel = undefined;
    this.chars = context.globalState.get(KEY, 0);
    this.lastYay = 0;
    this.out = vscode.window.createOutputChannel('Beaver Dam');
    this.lastTyped = 0;
    this.idleCarry = 0;
  }

  // Slow background progress while the window is focused but you are not typing.
  startIdle() {
    const timer = setInterval(() => {
      const pct = vscode.workspace.getConfiguration('beaverDam').get('idleWorkPercent', 3);
      if (!pct || !vscode.window.state.focused || Date.now() - this.lastTyped < 10000) return;
      this.idleCarry += (pct / 100) * TYPING_REF * 2;
      const whole = Math.floor(this.idleCarry);
      if (whole < 1) return;
      this.idleCarry -= whole;
      this.chars += whole;
      this.flush(true);
    }, 2000);
    return { dispose: () => clearInterval(timer) };
  }

  yay() {
    const now = Date.now();
    if (now - this.lastYay < 6000) return;
    this.lastYay = now;
    this.post({ type: 'yay' });
  }

  note(msg) {
    this.out.appendLine('[' + new Date().toLocaleTimeString() + '] ' + msg);
  }

  // Decides what a finished run means: cheer on success, "oops" on failure.
  runResult(label, kind, exitCode) {
    const cfg = vscode.workspace.getConfiguration('beaverDam');
    const allowed = cfg.get('celebrate', ['script', 'notebook', 'terminal', 'tasks']);
    const ok = allowed.includes(kind);
    this.note(label + ' -> exit=' + exitCode + (ok ? '' : ' (ignored: "' + kind + '" is not in beaverDam.celebrate)'));
    if (!ok) return;
    if (exitCode === 0) this.yay();
    else if (exitCode !== undefined && cfg.get('reactToFailedRuns', true)) this.post({ type: 'oops' });
  }

  commandResult(kind, label, text, exitCode, forced) {
    const re = this.runRegex();
    const matched = !!(forced || (re && re.test(text)));
    this.note(label + ': "' + String(text).trim().slice(0, 140) + '" exit=' + exitCode + ' counts as a run=' + matched);
    if (matched) this.runResult(label, kind, exitCode);
  }

  setTime(mode) {
    vscode.workspace.getConfiguration('beaverDam').update('timeOfDay', mode, vscode.ConfigurationTarget.Global);
  }

  toggleTime() {
    const cur = vscode.workspace.getConfiguration('beaverDam').get('timeOfDay', 'real');
    this.setTime(cur === 'day' ? 'night' : cur === 'night' ? 'real' : 'day');
  }

  runRegex() {
    try {
      return new RegExp(vscode.workspace.getConfiguration('beaverDam').get('runPattern', ''), 'i');
    } catch (err) {
      return undefined;
    }
  }

  media() {
    return vscode.Uri.joinPath(this.context.extensionUri, 'media');
  }

  payload() {
    const cfg = vscode.workspace.getConfiguration('beaverDam');
    return {
      chars: this.chars,
      perLog: cfg.get('charsPerLog', 30),
      perDam: cfg.get('logsPerDam', 80),
      focused: vscode.window.state.focused,
      timeMode: cfg.get('timeOfDay', 'real'),
    };
  }

  post(msg) {
    return Promise.all([...this.targets].map((w) => w.postMessage(msg)));
  }

  attach(webview, { tab, greets }) {
    webview.options = { enableScripts: true, localResourceRoots: [this.media()] };
    webview.html = this.html(webview, tab);
    this.targets.add(webview);
    return webview.onDidReceiveMessage((m) => {
      if (m.type === 'ready') {
        const greet = greets && !this.greeted;
        if (greet) this.greeted = true;
        webview.postMessage({ type: 'init', ...this.payload(), greet });
      } else if (m.type === 'openMap') {
        this.openMap();
      } else if (m.type === 'setTime') {
        this.setTime(m.mode);
      }
    });
  }

  resolveWebviewView(view) {
    const sub = this.attach(view.webview, { tab: 'camp', greets: true });
    view.onDidDispose(() => {
      this.targets.delete(view.webview);
      sub.dispose();
    });
  }

  openMap() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'beaverDam.map',
      'Beaver world',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.media()] }
    );
    this.panel = panel;
    const sub = this.attach(panel.webview, { tab: 'world', greets: false });
    panel.onDidDispose(() => {
      this.targets.delete(panel.webview);
      sub.dispose();
      this.panel = undefined;
    });
  }

  onTyping(n) {
    this.lastTyped = Date.now();
    this.chars += n;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, 120);
  }

  flush(idle) {
    this.context.globalState.update(KEY, this.chars);
    this.post({ type: 'typing', idle: !!idle, ...this.payload() });
  }

  refresh() {
    this.post({ type: 'init', ...this.payload(), greet: false });
  }

  async reset() {
    this.chars = 0;
    await this.context.globalState.update(KEY, 0);
    this.refresh();
  }

  async bye() {
    await this.context.globalState.update(KEY, this.chars);
    if (this.targets.size === 0) return;
    await this.post({ type: 'say', text: 'bye :)', sticky: true, hop: true });
    await new Promise((r) => setTimeout(r, 1500));
  }

  html(webview, tab) {
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(this.media(), f));
    const nonce = crypto.randomBytes(16).toString('hex');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('main.css')}">
</head>
<body data-tab="${tab}" class="${tab === 'world' ? 'wide' : ''}">
<svg class="defs" width="0" height="0" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop id="skyTop" offset="0" stop-color="#bfe3f0"/><stop id="skyBot" offset="1" stop-color="#f7efcf"/></linearGradient>
        <linearGradient id="fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4915c"/><stop offset="1" stop-color="#8a5a34"/></linearGradient>
        <linearGradient id="furHead" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98350"/><stop offset="1" stop-color="#97633a"/></linearGradient>
        <linearGradient id="tail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e5646"/><stop offset="1" stop-color="#3f3027"/></linearGradient>
        <linearGradient id="muzzle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efd5ae"/><stop offset="1" stop-color="#d2aa7c"/></linearGradient>
        <linearGradient id="trunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#bf8c5c"/><stop offset="1" stop-color="#7a5031"/></linearGradient>
        <g id="bodyArt">
            <path d="M-9 -6 C-15 -11 -27 -11 -33 -5 C-34 -2 -30 0.5 -24 0.5 C-18 0.5 -12 -1 -9 -2.5Z" fill="url(#tail)"/>
            <path d="M-29 -7 l4 5 M-24 -8 l5 6.5 M-19 -8 l4 6 M-14 -7 l3 4 M-28 -3 l4 -4 M-23 -2 l5 -6 M-18 -1.5 l4 -5" stroke="#241a14" stroke-width="0.45" opacity="0.55" fill="none"/>
            <path d="M-9.5 0 L-9.5 -3 C-9.5 -5 -6 -5.5 -4 -4.5 C-2.5 -4 -2 -2 -1.5 0Z" fill="#5e3d27"/>
            <path d="M-12 -5 C-14 -15 -8 -22 1 -22.5 C9 -23 15 -19 17 -13 C18 -9 16 -4 13 -1.5 C11 0 9 0 7 0 L-7 0 C-10 0 -12 -2 -12 -5Z" fill="url(#fur)"/>
            <path d="M-8 -17 C-5 -21 1 -22 6 -21 C1 -20 -4 -18 -7 -13Z" fill="#fff" opacity="0.18"/>
            <path d="M3 -1.5 C8 -2.5 14 -6 15.5 -11 C16.5 -6 13.5 -1 8 -0.5Z" fill="#dcae78" opacity="0.55"/>
            <path d="M7 0 L7 -4 C7 -6 11 -6.5 13 -5 C14.5 -4 15 -2 15 0Z" fill="#5e3d27"/>
        </g>
        <g id="headArt">
          <ellipse cx="11" cy="-27.5" rx="2.6" ry="3" fill="#7a4d2c"/>
          <ellipse cx="11.2" cy="-27.2" rx="1.3" ry="1.7" fill="#4a2e1a"/>
          <path d="M5 -17 C4.5 -25 10 -30.5 17.5 -30 C24 -29.6 29.5 -25 30 -20.5 C30.3 -17 28.5 -13 25 -11.5 L13 -11.5 C8 -12 5.3 -14 5 -17Z" fill="url(#furHead)"/>
          <path d="M19 -18.5 C21 -23 27.5 -23.5 29.8 -20.5 C31 -18 29.5 -13.5 26 -12.2 C22 -11.5 18.5 -14.5 19 -18.5Z" fill="url(#muzzle)"/>
          <path d="M9 -24 C11 -28 16 -29 20 -28.5 C16 -27.5 12 -26 9 -24Z" fill="#fff" opacity="0.22"/>
          <path d="M28.6 -22 C30.6 -22 31.4 -20.2 30.4 -19 C29.4 -18.2 28 -19 28 -20.4Z" fill="#2b1a12"/>
          <ellipse cx="18" cy="-23" rx="1.7" ry="1.9" fill="#1c120d"/>
          <circle cx="18.6" cy="-23.7" r="0.6" fill="#fff"/>
          <path d="M24 -14.2 q2.5 1 5 -0.4" stroke="#5a3a22" stroke-width="0.5" fill="none" stroke-linecap="round"/>
          <path d="M24.2 -13.6 h2.8 l-0.2 3.6 q-1.1 0.5 -2.2 0z" fill="#fbecc8" stroke="#c9a15f" stroke-width="0.35"/>
          <path d="M27 -13.8 h2.4 l-0.2 3.4 q-0.9 0.5 -1.9 0z" fill="#fff4d8" stroke="#c9a15f" stroke-width="0.35"/>
          <path d="M27 -17.6 l6 -1.3 M27 -16.6 l6 0.5" stroke="#f1dcc0" stroke-width="0.3"/>
        </g>
      </defs></svg>
<nav class="tabs">
  <button id="tab-camp" class="tab" aria-selected="true">Camp</button>
  <button id="tab-world" class="tab" aria-selected="false">World</button>
  <span class="spacer"></span>
  <button id="openMap" class="link">Open map in editor</button>
</nav>

<section id="camp">
  <div class="scene">
    <div id="bubble" class="bubble" role="status" aria-live="polite"></div>
    <button id="timeBtn" class="timebtn" type="button"></button>
    <svg class="camp" viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg" aria-label="A beaver building a dam">
      <rect width="240" height="140" fill="url(#sky)"/>
      <g class="cloud"><rect x="136" y="21" width="28" height="7" rx="3.5" fill="#fff" opacity="0.8"/><rect x="144" y="15" width="16" height="8" rx="4" fill="#fff" opacity="0.8"/></g>
      <path d="M0 104 L28 90 L58 100 L96 84 L138 99 L178 88 L240 102 L240 125 L0 125Z" fill="#b4dc9b"/>
      <path d="M0 113 L40 100 L84 111 L130 102 L190 112 L240 106 L240 125 L0 125Z" fill="#9ccb83"/>
      <rect y="120" width="240" height="20" fill="#8b6244"/>
      <rect y="120" width="240" height="5" fill="#7fb865"/>

      <g id="cam">
        <g id="treeFx"><g id="tree">
          <g id="trunk">
          <path d="M83 120 l-5 -0.8 M91 120 l5 -0.8" stroke="#6a4528" stroke-width="1.5" stroke-linecap="round"/>
          <polygon id="trunkShape" points="83,70 91,70 91,121 83,121" fill="url(#trunk)"/>
          <polygon id="cutUp" points="" fill="#e0bd86"/>
          <polygon id="cutLow" points="" fill="#d9b27a"/>
          <path d="M85.5 93v5 M88.5 94v4 M86 115v4 M89 116v3" stroke="#5e3d25" stroke-width="0.6" stroke-linecap="round" opacity="0.7"/>
          <polygon id="bite" points="83,104 83,109 83,114" fill="#f3dcb4" stroke="#5e3d25" stroke-width="0.4" stroke-linejoin="round"/>
          </g>
          <g id="canopy"></g>
        </g></g>

        <g id="babies"></g>
        <rect id="water" class="water" x="130" y="120" width="500" height="0" fill="#4aa3d8"/>
        <rect id="waterTop" class="waterTop" x="130" y="120" width="500" height="1.4" fill="#d3f1fb"/>
        <g id="lodge"></g>
        <g id="dam"></g>
        <g id="critters"></g>

        <!-- beaver, in profile facing right. origin = between the feet, ground at y=0 -->
        <g id="beaver" transform="translate(55 120) scale(0.8)">
          <g id="walker">
            <use href="#bodyArt"/>
            <g transform="translate(-2.5 3.5)">
            <g id="head">
              <use href="#headArt"/>
              <g id="carry" opacity="0">
                <g transform="rotate(-5 24 -12)">
                  <rect x="22" y="-14" width="15" height="4" rx="1" fill="#b07a45" stroke="#5e3d25" stroke-width="0.5"/>
                  <rect x="35.4" y="-14" width="1.6" height="4" fill="#e3c08c"/>
                </g>
              </g>
            </g>
            </g>
          </g>
        </g>
        <g id="chips"></g>
      </g>
      <rect id="night" width="240" height="140" fill="#0b1236" opacity="0" pointer-events="none"/>
      <g id="stars" opacity="0"></g>
      <g id="moon" opacity="0"><circle r="6.5" fill="#f3f1d8"/><circle cx="-2" cy="-1.5" r="1.3" fill="#dcd9b9"/><circle cx="2.4" cy="2" r="0.9" fill="#dcd9b9"/><circle cx="1.5" cy="-3" r="0.7" fill="#dcd9b9"/></g>
      <circle id="sun" cx="210" cy="22" r="9" fill="#ffe28a"/>
      <g id="flies" opacity="0"></g>
    </svg>
  </div>
  <div class="bar" aria-hidden="true"><div id="fill" class="fill"></div></div>
  <div class="stats"><span id="stDam"></span><span id="stDone"></span></div>
</section>

<section id="world" hidden>
  <svg id="map" class="map" viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg" aria-label="World map of beaver dams"></svg>
  <div class="stats"><span id="mapPct"></span><span id="mapDams"></span><span id="mapNow"></span></div>
</section>

<script nonce="${nonce}" src="${uri('main.js')}"></script>
</body>
</html>`;
  }
}

// Positron: watch code run in the console / via "Run File" and report whether it ended in an error.
// Everything here is feature-detected, so it does nothing in plain VS Code. See "Beaver: Show run detection log".
function hookPositron(beaver, context) {
  let positron;
  try { positron = require('positron'); } catch (err) { /* plain VS Code */ }
  if (!positron && typeof acquirePositronApi === 'function') {
    try { positron = acquirePositronApi(); } catch (err) { /* ignore */ }
  }
  if (!positron || !positron.runtime) {
    beaver.note('Positron runtime API not found (expected in plain VS Code)');
    return;
  }
  beaver.note('Positron runtime API found');

  const classify = (ev) => {
    const a = ev.attribution;
    const s = String(a && a.source !== undefined ? a.source : a).toLowerCase();
    if (s.includes('script')) return 'script';
    if (s.includes('notebook')) return 'notebook';
    if (s.includes('interactive') || s.includes('paste')) return 'console';
    return 'other';
  };

  let pending = null, session = null, subs = [], lastErrorAt = 0;
  const finish = (why) => {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    const failed = lastErrorAt >= p.startedAt;
    beaver.runResult(p.kind + ' in ' + p.lang + ' (' + why + ')', p.kind, failed ? 1 : 0);
  };
  const attach = (s) => {
    subs.forEach((d) => d && d.dispose && d.dispose());
    subs = [];
    session = s || null;
    if (!session) return;
    if (session.onDidReceiveRuntimeMessage) {
      subs.push(session.onDidReceiveRuntimeMessage((msg) => {
        if (String(msg && msg.type).toLowerCase().includes('error')) lastErrorAt = Date.now();
      }));
    }
    if (session.onDidChangeRuntimeState) {
      subs.push(session.onDidChangeRuntimeState((state) => {
        const s2 = String(state).toLowerCase();
        if (pending && s2 === 'busy') pending.sawBusy = true;
        if (pending && s2 === 'idle' && (pending.sawBusy || Date.now() - pending.startedAt > 1500)) finish('finished');
      }));
    }
  };
  const refresh = () => {
    try { Promise.resolve(positron.runtime.getForegroundSession()).then(attach, () => {}); } catch (err) { /* ignore */ }
  };
  refresh();
  if (positron.runtime.onDidChangeForegroundSession) context.subscriptions.push(positron.runtime.onDidChangeForegroundSession(refresh));

  if (!positron.runtime.onDidExecuteCode) {
    beaver.note('positron.runtime.onDidExecuteCode is missing in this Positron version');
    return;
  }
  context.subscriptions.push(
    positron.runtime.onDidExecuteCode((ev) => {
      const kind = classify(ev);
      beaver.note('Positron executed ' + ev.languageId + ' code, ' + String(ev.code || '').length + ' chars, source=' + JSON.stringify(ev.attribution && ev.attribution.source) + ' -> ' + kind);
      if (kind === 'other' || kind === 'notebook') return; // notebook cells are handled through the notebook API
      if (pending) { clearTimeout(pending.timer); pending = null; } // a new run started: drop the old one without judging it
      pending = { kind, lang: ev.languageId, startedAt: Date.now(), sawBusy: false };
      pending.timer = setTimeout(() => finish('timeout'), session && session.onDidChangeRuntimeState ? 120000 : 2500);
    })
  );
}

let beaver;

function activate(context) {
  beaver = new Beaver(context);

  context.subscriptions.push(
    beaver.startIdle(),
    vscode.window.onDidChangeWindowState((s) => beaver.post({ type: 'focus', focused: s.focused })),
    vscode.window.registerWebviewViewProvider('beaverDam.view', beaver, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file' && e.document.uri.scheme !== 'untitled') return;
      let n = 0;
      for (const c of e.contentChanges) {
        // typing counts, and so does deleting (backspace / delete)
        const amount = c.text.length > 0 ? c.text.length : c.rangeLength;
        n += Math.min(amount, MAX_CHARS_PER_EVENT);
      }
      if (n > 0) beaver.onTyping(n);
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('beaverDam')) beaver.refresh();
    }),

    vscode.commands.registerCommand('beaverDam.toggleDayNight', () => beaver.toggleTime()),
    vscode.commands.registerCommand('beaverDam.showLog', () => beaver.out.show(true)),
    vscode.commands.registerCommand('beaverDam.rest', () => beaver.post({ type: 'rest' })),
    vscode.commands.registerCommand('beaverDam.visit', () => beaver.post({ type: 'visit' })),
    vscode.commands.registerCommand('beaverDam.yay', () => beaver.post({ type: 'yay' })),
    vscode.commands.registerCommand('beaverDam.sayHello', () =>
      beaver.post({ type: 'say', text: 'hello :)', hop: true })
    ),
    vscode.commands.registerCommand('beaverDam.sayBye', () => beaver.bye()),
    vscode.commands.registerCommand('beaverDam.openMap', () => beaver.openMap()),
    vscode.commands.registerCommand('beaverDam.reset', () => beaver.reset())
  );

  // Run detection: tasks, terminal commands (needs shell integration), notebook cells, and Positron's console/scripts.
  const taskText = (task) => {
    let s = task.name + ' ' + (task.source || '');
    const x = task.execution;
    if (x) {
      const str = (v) => (v && typeof v === 'object' ? v.value : v) || '';
      if (x.commandLine) s += ' ' + x.commandLine;
      if (x.command) s += ' ' + str(x.command) + ' ' + (x.args || []).map(str).join(' ');
      if (x.process) s += ' ' + x.process + ' ' + (x.args || []).map(str).join(' ');
    }
    return s;
  };
  if (vscode.tasks && vscode.tasks.onDidEndTaskProcess) {
    context.subscriptions.push(
      vscode.tasks.onDidEndTaskProcess((ev) => {
        const t = ev.execution.task;
        const forced = !!(t.group && (t.group.id === 'build' || t.group.id === 'test'));
        beaver.commandResult('tasks', 'task', taskText(t), ev.exitCode, forced);
      })
    );
  }
  if (vscode.window.onDidEndTerminalShellExecution) {
    context.subscriptions.push(
      vscode.window.onDidEndTerminalShellExecution((ev) => {
        const cmd = ev.execution.commandLine ? ev.execution.commandLine.value : '';
        beaver.commandResult('terminal', 'terminal "' + ev.terminal.name + '"', cmd, ev.exitCode, false);
      })
    );
  }
  if (vscode.window.onDidChangeTerminalShellIntegration) {
    context.subscriptions.push(
      vscode.window.onDidChangeTerminalShellIntegration((ev) => beaver.note('shell integration active in terminal "' + ev.terminal.name + '"'))
    );
  }
  if (vscode.workspace.onDidChangeNotebookDocument) {
    const seen = new Set();
    context.subscriptions.push(
      vscode.workspace.onDidChangeNotebookDocument((ev) => {
        for (const c of ev.cellChanges || []) {
          const s = c.executionSummary;
          if (!s || typeof s.success !== 'boolean') continue;
          const end = s.timing && s.timing.endTime;
          if (!end || Date.now() - end > 5000) continue;
          const key = c.cell.document.uri.toString() + ':' + end;
          if (seen.has(key)) continue;
          seen.add(key);
          beaver.runResult('notebook cell (' + c.cell.document.languageId + ')', 'notebook', s.success ? 0 : 1);
        }
      })
    );
  }
  hookPositron(beaver, context);
  context.subscriptions.push(beaver.out);
}

function deactivate() {
  return beaver ? beaver.bye() : undefined;
}

module.exports = { activate, deactivate };
