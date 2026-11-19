(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (i, k) => {
    const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  /* ------------------------------------------------------------------ state */
  const st = { chars: 0, perLog: 30, perDam: 80, shown: 0, busy: false, focused: true, pose: 'work', lastTyping: 0, timeMode: 'real', dark: 0, beaverX: 55 };
  const woodOf = (c) => Math.floor(c / st.perLog);

  /* ------------------------------------------------------------------ camp */
  const GROUND = 120, STEP_W = 8.5, STEP_H = 5.5, LOG_W = 8, LOG_H = 4.6, DAM_X0 = 108;
  const VIEW_L = 6, VIEW_R = 234, BODY_X0 = 26, TREE_TOP = 24, TRIP_USER = 24.2; // how far he walks to reach the dam, in scene units
  const TONES = ['#b07a45', '#a06b3a', '#c28a52'];
  const CHEERS = ['nice logs!', 'keep chewing!', 'dam good code', 'timber!', 'busy beaver'];

  let lay = null;
  let lodgeOn = false;
  let bubbleTimer;
  let visitor = false, visitToken = 0;

  function computeLayout() {
    const cap = st.perDam;
    let B = 2;
    while ((B * (B + 1)) / 2 - 1 < cap) B++;
    const rows = [];
    let total = 0;
    for (let w = B; w >= 2 && total < cap; w--) { rows.push(w); total += w; }
    const cx = DAM_X0 + (B * STEP_W) / 2;
    const pos = [];
    rows.forEach((n, r) => {
      const x0 = cx - (n * STEP_W) / 2;
      for (let c = 0; c < n; c++) pos.push({ x: x0 + c * STEP_W, y: GROUND - (r + 1) * STEP_H, r });
    });
    lay = { B, rows, pos, cx, right: DAM_X0 + B * STEP_W, height: rows.length * STEP_H };
  }

  function say(text, sticky) {
    const b = $('bubble');
    b.textContent = text;
    b.classList.add('show');
    placeBubble();
    clearTimeout(bubbleTimer);
    if (!sticky) bubbleTimer = setTimeout(() => b.classList.remove('show'), 3500);
  }

  // scene coordinates of the top of his head (follows him up onto the dam and through the camera)
  function beaverAnchor() {
    const off = st.pose === 'sitting' && sitSpot ? sitSpot.B : { x: 0, y: 0 };
    const x = st.beaverX + (off.x + 14) * BEAVER_S, y = GROUND + (off.y - 33) * BEAVER_S;
    const cam = st.cam || { s: 1, tx: 0 };
    return { x: cam.s * x + cam.tx, y: GROUND + cam.s * (y - GROUND) };
  }

  function placeBubble() {
    const b = $('bubble'), W = b.parentElement.clientWidth;
    if (!W) return;
    const k = W / 240, a = beaverAnchor(), bw = b.offsetWidth, bh = b.offsetHeight;
    const left = clamp(a.x * k - 24, 2, Math.max(2, W - bw - 2));
    b.style.left = left + 'px';
    b.style.top = Math.max(2, a.y * k - bh - 10) + 'px';
    b.style.setProperty('--tail', clamp(a.x * k - left - 4, 8, Math.max(8, bw - 18)) + 'px');
  }

  function hop() {
    if (reduceMotion) return;
    $('walker').animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' },
       { transform: 'translateY(-4px)' }, { transform: 'translateY(0)' }],
      { duration: 600, easing: 'ease-out', composite: 'add' }
    );
  }

  function drawLodge(on, level) {
    const g = $('lodge');
    g.textContent = '';
    if (!on) { lodgeOn = false; return; }
    const lx = lay.right + 14;
    const base = GROUND - level + 3; // sits on the waterline and rises with the pond
    const grp = el('g', {}, g);
    if (!lodgeOn) grp.classList.add('pop');
    lodgeOn = true;
    st.lodge = { lx, base };
    el('path', { d: 'M' + (lx - 15) + ' ' + base + ' A15 17 0 0 1 ' + (lx + 15) + ' ' + base + ' Z', fill: '#7b5233', stroke: '#4a2e1a', 'stroke-width': 0.9 }, grp);
    for (let k = 0; k < 7; k++) {
      el('path', { d: 'M' + (lx - 12 + k * 4) + ' ' + (base - 2) + ' l' + (k % 2 ? 3 : -3) + ' -' + (6 + (k % 3) * 2.5), stroke: '#a07040', 'stroke-width': 0.7, 'stroke-linecap': 'round', fill: 'none' }, grp);
    }
    el('ellipse', { cx: lx + 2, cy: base - 1, rx: 3.6, ry: 3, fill: '#3b2616' }, grp);
  }

  const BABY_S = 0.2;
  const babies = [];

  function dropBaby(b) { b.alive = false; b.wrap.remove(); }

  function syncBabies(count) {
    const g = $('babies');
    if (!lodgeOn || !st.lodge) count = 0;
    const lx = st.lodge ? st.lodge.lx : 0;
    if (babies.length && babies[0].lx !== lx) while (babies.length) dropBaby(babies.pop());
    while (babies.length > count) dropBaby(babies.pop());
    while (babies.length < count) babies.push(addBaby(g, lx, babies.length));
    babies.forEach((b) => b.wrap.setAttribute('transform', 'translate(' + b.x0 + ' ' + (st.waterY + 1.2) + ')'));
  }

  function addBaby(g, lx, i) {
    const x0 = lx + 22 + i * 10;
    const b = { alive: true, lx, x0, dx: 0, min: lx + 18 - x0, max: lx + 46 - x0 };
    b.wrap = el('g', {}, g);
    b.mover = el('g', { transform: 'translate(0 0)' }, b.wrap);
    const bob = el('g', {}, b.mover);
    b.flip = el('g', { transform: 'scale(' + -BABY_S + ' ' + BABY_S + ')' }, bob);
    const br = el('g', { class: 'breathe' }, b.flip);
    br.style.animationDelay = i * 0.9 + 's';
    const body = document.createElementNS(NS, 'use'); body.setAttribute('href', '#bodyArt'); br.appendChild(body);
    const head = document.createElementNS(NS, 'use'); head.setAttribute('href', '#headArt');
    head.setAttribute('transform', 'translate(-5.5 7.7) scale(1.3)'); // big head = cute
    br.appendChild(head);
    if (!reduceMotion) {
      bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-0.5px)' }, { transform: 'translateY(0)' }], { duration: 2600 + i * 500, iterations: Infinity, easing: 'ease-in-out' });
      wanderBaby(b);
    }
    return b;
  }

  async function wanderBaby(b) {
    try {
      while (b.alive) {
        await sleep(rand(2500, 6500));
        if (!b.alive) return;
        const tx = clamp(b.dx + rand(-9, 9), b.min, b.max);
        if (Math.abs(tx - b.dx) < 2) continue;
        b.flip.setAttribute('transform', 'scale(' + (tx > b.dx ? BABY_S : -BABY_S) + ' ' + BABY_S + ')');
        const a = b.mover.animate(
          [{ transform: 'translate(' + b.dx + 'px,0px)' }, { transform: 'translate(' + tx + 'px,0px)' }],
          { duration: Math.abs(tx - b.dx) * 800, easing: 'ease-in-out', fill: 'forwards' } // slow: about 1 unit per second
        );
        await a.finished;
        b.mover.setAttribute('transform', 'translate(' + tx + ' 0)');
        a.cancel();
        b.dx = tx;
      }
    } catch (err) { /* removed mid-walk */ }
  }

  function setTree(frac) {
    const f = Math.min(frac, 1);
    const w = 8 * (1 - 0.88 * f);                 // width of the chewed waist: 8 -> about 1
    const L = 87 - w / 2, R = 87 + w / 2;
    st.waistL = L;
    const cut = Math.min(1, (1 - w / 8) * 4).toFixed(2); // chewed surfaces fade in once he has started
    $('cutUp').setAttribute('opacity', cut);
    $('cutLow').setAttribute('opacity', cut);
    $('trunkShape').setAttribute('points', '83,70 91,70 91,99 ' + R.toFixed(2) + ',107 ' + R.toFixed(2) + ',113 91,121 83,121 ' + L.toFixed(2) + ',113 ' + L.toFixed(2) + ',107 83,99');
    $('cutUp').setAttribute('points', '83,99 91,99 ' + R.toFixed(2) + ',107 ' + L.toFixed(2) + ',107');
    $('cutLow').setAttribute('points', L.toFixed(2) + ',113 ' + R.toFixed(2) + ',113 91,121 83,121');
    st.beaverX = 55 + (L - 83);                    // he steps toward the chewed spot
    $('beaver').style.transform = 'translate(' + st.beaverX.toFixed(2) + 'px,120px) scale(0.8)';
    $('tree').style.transform = 'rotate(' + (5 * Math.pow(Math.max(0, (f - 0.6) / 0.4), 1.5)).toFixed(2) + 'deg)'; // starts to lean toward the dam
  }

  async function fellTree() {
    const t = $('treeFx');
    if (reduceMotion) { t.style.opacity = 0; return; }
    const a = t.animate(
      [{ transform: 'rotate(0deg)', opacity: 1 }, { transform: 'rotate(7deg)', opacity: 1, offset: 0.25 },
       { transform: 'rotate(84deg)', opacity: 1, offset: 0.75 }, { transform: 'rotate(90deg)', opacity: 0 }],
      { duration: 1500, easing: 'ease-in', fill: 'forwards' }
    );
    await a.finished;
    t.style.opacity = 0;
    a.cancel();
  }

  function growTree() {
    const t = $('treeFx');
    t.style.opacity = '';
    if (reduceMotion) return;
    t.animate([{ transform: 'scaleY(0.05)', opacity: 0.4 }, { transform: 'scaleY(1)', opacity: 1 }], { duration: 1000, easing: 'ease-out' });
  }

  function updateCamera(maxRight, minY, frac) {
    let bx1 = maxRight;
    const room = 66 * clamp((frac - 0.3) / 0.2, 0, 1); // pond, babies and otter: zoom out gradually from 30% to 50%
    if (room > 0) bx1 = Math.max(bx1, lay.right + room);
    const top = Math.min(minY - 5, TREE_TOP);
    const w = bx1 - BODY_X0;
    const s = Math.min(1, (VIEW_R - VIEW_L) / w, (GROUND - 8) / (GROUND - top));
    const txLeft = VIEW_L - s * BODY_X0;
    const txRight = VIEW_R - s * bx1;
    const tx = Math.max(txLeft, Math.min(0, txRight));
    st.cam = { s, tx };
    $('cam').style.transform = 'translate(' + tx.toFixed(2) + 'px,0) scale(' + s.toFixed(3) + ')';
  }

  function renderDam(count, popLast) {
    const g = $('dam');
    g.textContent = '';
    const mud = el('g', {}, g), sticks = el('g', {}, g), logs = el('g', {}, g);
    const rowMin = {}, rowMax = {};
    let maxRight = DAM_X0, minY = GROUND, topR = -1;
    if (count === 0) { visitToken++; $('critters').textContent = ''; visitor = false; }

    for (let i = 0; i < count && i < lay.pos.length; i++) {
      const p = lay.pos[i];
      rowMin[p.r] = Math.min(rowMin[p.r] === undefined ? 1e9 : rowMin[p.r], p.x);
      rowMax[p.r] = Math.max(rowMax[p.r] === undefined ? -1e9 : rowMax[p.r], p.x + LOG_W);
      maxRight = Math.max(maxRight, p.x + LOG_W);
      minY = Math.min(minY, p.y);
      topR = Math.max(topR, p.r);
      if (p.r >= 1 && hash(i, 1) < 0.33) {
        const sx = p.x + LOG_W / 2;
        el('line', { x1: sx, y1: p.y + LOG_H, x2: sx + (hash(i, 2) - 0.5) * 5, y2: p.y - 2.5 - hash(i, 3) * 3.5, stroke: '#7d5330', 'stroke-width': 1.1, 'stroke-linecap': 'round' }, sticks);
      }
      const log = el('g', { transform: 'rotate(' + ((hash(i, 5) - 0.5) * 5).toFixed(1) + ' ' + (p.x + LOG_W / 2) + ' ' + (p.y + LOG_H / 2) + ')' }, logs);
      el('rect', { x: p.x, y: p.y, width: LOG_W, height: LOG_H, rx: 0.9, fill: TONES[Math.floor(hash(i, 4) * 3)], stroke: 'rgba(60,35,20,.5)', 'stroke-width': 0.5 }, log);
      el('path', { d: 'M' + (p.x + LOG_W - 2) + ' ' + (p.y + 0.6) + ' L' + (p.x + LOG_W - 0.6) + ' ' + (p.y + 1.3) + ' L' + (p.x + LOG_W - 0.6) + ' ' + (p.y + LOG_H - 1.3) + ' L' + (p.x + LOG_W - 2) + ' ' + (p.y + LOG_H - 0.6) + 'Z', fill: '#e3c08c' }, log);
      el('path', { d: 'M' + (p.x + 1.6) + ' ' + (p.y + 1.5) + 'h2.6', stroke: '#7d5330', 'stroke-width': 0.5, 'stroke-linecap': 'round' }, log);
      if (popLast && i === count - 1) log.classList.add('pop');
    }
    for (const r in rowMin) {
      el('rect', { x: rowMin[r] - 0.6, y: GROUND - (+r + 1) * STEP_H - 0.3, width: rowMax[r] - rowMin[r] + 1.2, height: STEP_H, fill: '#6e4d37' }, mud);
    }

    // pond behind the dam rises as it fills
    st.topLogs = lay.pos.slice(0, count).filter((p) => p.r === topR);
    const frac = Math.min(1, count / st.perDam);
    setTree(frac);
    const level = frac * lay.height * 0.8;
    st.waterY = GROUND - level;
    const w = $('water'), wt = $('waterTop');
    w.setAttribute('x', lay.cx); wt.setAttribute('x', lay.cx);
    // plain attributes as the baseline, CSS properties on top so the pond level can animate
    w.setAttribute('y', GROUND - level); w.setAttribute('height', level); wt.setAttribute('y', GROUND - level);
    w.style.y = (GROUND - level) + 'px';
    w.style.height = level + 'px';
    wt.style.y = (GROUND - level) + 'px';
    wt.style.opacity = level > 0 ? '' : '0';

    drawLodge(frac >= 0.5, level);
    syncBabies(frac >= 0.9 ? 3 : frac >= 0.75 ? 2 : frac >= 0.6 ? 1 : 0);
    updateCamera(maxRight, minY, frac);
  }

  function renderStats() {
    const dams = Math.floor(st.shown / st.perDam);
    $('stDam').textContent = 'current dam ' + (st.shown % st.perDam) + '/' + st.perDam + '.';
    $('stDone').textContent = dams + (dams === 1 ? ' dam' : ' dams') + ' finished.';
    $('fill').style.width = ((st.chars % st.perLog) / st.perLog) * 100 + '%';
    const d = ((st.chars % st.perLog) / st.perLog) * 2.5; // the bite gets deeper as he chews
    const L = st.waistL === undefined ? 83 : st.waistL;
    $('bite').setAttribute('points', L.toFixed(2) + ',104 ' + (L + d).toFixed(2) + ',109 ' + L.toFixed(2) + ',114');
  }

  function chip() {
    const c = el('rect', { x: 81 + (st.beaverX - 55), y: 108, width: 2.2, height: 2.2, fill: '#e3c08c', stroke: '#5a3a22', 'stroke-width': 0.2 }, $('chips'));
    c.animate(
      [{ transform: 'translate(0,0) rotate(0)', opacity: 1 },
       { transform: 'translate(' + rand(3, 12) + 'px,' + rand(-14, -4) + 'px) rotate(200deg)', opacity: 0 }],
      { duration: 520, easing: 'ease-out' }
    ).onfinish = () => c.remove();
  }

  function leaf() {
    const l = el('rect', { x: rand(72, 102), y: rand(50, 90), width: 0.9, height: 3.4, fill: '#4b9558' }, $('chips'));
    l.animate(
      [{ transform: 'translate(0,0) rotate(0)', opacity: 1 },
       { transform: 'translate(' + rand(-8, 8) + 'px,' + rand(30, 46) + 'px) rotate(' + rand(90, 360) + 'deg)', opacity: 0 }],
      { duration: 1100, easing: 'ease-in' }
    ).onfinish = () => l.remove();
  }

  function shakeTree() {
    if (reduceMotion) return;
    $('canopy').animate(
      [{ transform: 'rotate(0)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(2.5deg)' }, { transform: 'rotate(-1deg)' }, { transform: 'rotate(0)' }],
      { duration: 550 }
    );
    leaf(); leaf();
  }

  function chew() {
    if (reduceMotion || st.pose !== 'work') return;
    $('head').animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(7deg) translate(1px,1px)' }, { transform: 'rotate(0deg)' }],
      { duration: 170 }
    );
    chip();
  }

  function buildTree() {
    const g = $('canopy');
    g.textContent = '';
    const cx = 87;
    const tiers = [[60, 92, 17], [47, 76, 14], [36, 61, 11], [26, 47, 7.5]]; // apex, base, half-width
    const fr = [1, 0.62, 0.3, 0, -0.3, -0.62, -1];
    tiers.forEach(([a, b, hw]) => {
      const mid = (a + b) / 2 - 2;
      const zig = fr.map((f, i) => [cx + f * hw, i % 2 ? b - 3.5 : b]);
      const full = [[cx, a], [cx + hw * 0.55, mid], ...zig, [cx - hw * 0.55, mid]];
      const lit = [[cx, a], [cx - hw * 0.55, mid], ...zig.slice(3).reverse()];
      const pts = (arr) => arr.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      el('polygon', { points: pts(full), fill: '#2f6b3f' }, g);
      el('polygon', { points: pts(lit), fill: '#4b9558' }, g);
      el('path', { d: 'M' + (cx - hw * 0.35).toFixed(1) + ' ' + (mid + 2) + ' l' + (hw * 0.2).toFixed(1) + ' -4', stroke: '#7bc27f', 'stroke-width': 0.7, 'stroke-linecap': 'round', opacity: 0.7 }, g);
    });
  }

  function confetti() {
    const cols = ['#f2b134', '#e86a5a', '#5bb6cf', '#8fd084', '#ffffff'];
    for (let i = 0; i < 18; i++) {
      const c = el('rect', { x: rand(58, 92), y: rand(84, 98), width: 2, height: 3.2, fill: cols[i % cols.length] }, $('chips'));
      const dx = rand(-26, 26), up = rand(-34, -14);
      c.animate(
        [{ transform: 'translate(0,0) rotate(0)', opacity: 1 },
         { transform: 'translate(' + dx * 0.6 + 'px,' + up + 'px) rotate(' + rand(90, 300) + 'deg)', opacity: 1, offset: 0.45 },
         { transform: 'translate(' + dx + 'px,' + (up + 46) + 'px) rotate(' + rand(300, 600) + 'deg)', opacity: 0 }],
        { duration: 1100 + rand(0, 300), easing: 'ease-out' }
      ).onfinish = () => c.remove();
    }
  }

  function cheer() {
    say('yay :)');
    if (reduceMotion) return;
    $('walker').animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-14px)' }, { transform: 'translateY(0)' },
       { transform: 'translateY(-14px)' }, { transform: 'translateY(0)' }],
      { duration: 900, easing: 'ease-out', composite: 'add' }
    );
    confetti();
  }

  /* ---- visitors: small birds once the dam is a decent size, a rare otter later ---- */
  const BIRDS = [
    { body: '#8c6a4d', head: '#7b5a3f', belly: '#e8c9a0', wing: '#5e4330' },
    { body: '#4a86c5', head: '#3f77b3', belly: '#f1f4f6', wing: '#2f5f93' },
    { body: '#7d6a5c', head: '#5f5149', belly: '#e9824f', wing: '#4e4038' },
  ];
  const FACE_L = 'scale(-0.55 0.55)', FACE_R = 'scale(0.55 0.55)';

  function makeBird(parent) {
    const pal = BIRDS[Math.floor(Math.random() * BIRDS.length)];
    const pos = el('g', {}, parent), bob = el('g', {}, pos), flip = el('g', { transform: FACE_L }, bob);
    el('path', { d: 'M-3.5 -4.2 L-9 -2.6 L-8.4 -5.4Z', fill: pal.wing }, flip);
    el('path', { d: 'M0 -2.4v2.4 M1.8 -2.2v2.2', stroke: '#7a5230', 'stroke-width': 0.5 }, flip);
    el('path', { d: 'M-4 -4.5 C-4 -8 0 -9 3 -8 C5.5 -7.2 6 -4.5 3.5 -2.5 C1 -1 -3 -2 -4 -4.5Z', fill: pal.body }, flip);
    el('path', { d: 'M-1 -1.6 C2 -1.4 5 -3 5.2 -5 C4 -3.2 1 -2.2 -1 -2Z', fill: pal.belly }, flip);
    el('path', { d: 'M2 -8 C2 -11.5 6 -12 7.6 -9.6 C8.2 -8.4 7.8 -7 6.6 -6.6 L3.4 -6.6 C2.4 -6.8 2 -7.4 2 -8Z', fill: pal.head }, flip);
    el('path', { d: 'M7.4 -9.4 L10.2 -8.6 L7.4 -8Z', fill: '#f2a93b' }, flip);
    el('circle', { cx: 5.8, cy: -9.4, r: 0.55, fill: '#1c120d' }, flip);
    const wing = el('path', { d: 'M-2.5 -6.8 C-0.5 -8.2 2.5 -7.2 2.4 -5.4 C0 -4.8 -2 -5.2 -2.5 -6.8Z', fill: pal.wing }, flip);
    wing.style.transformOrigin = '-1px -6.5px';
    return { pos, bob, flip, wing };
  }

  function fly(b, from, to, ms) {
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 14 };
    const t = (p) => 'translate(' + p.x + 'px,' + p.y + 'px)';
    const a = b.pos.animate([{ transform: t(from) }, { transform: t(mid), offset: 0.5 }, { transform: t(to) }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    const f = b.wing.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-40deg)' }, { transform: 'rotate(10deg)' }], { duration: 130, iterations: Math.ceil(ms / 130) });
    return a.finished.then(() => {
      b.pos.setAttribute('transform', 'translate(' + to.x + ' ' + to.y + ')');
      a.cancel(); f.cancel();
    });
  }

  async function birdVisit() {
    if (visitor || st.dark > 0.3 || !st.topLogs || !st.topLogs.length) return;
    visitor = true;
    const token = visitToken, g = $('critters');
    const picks = [...st.topLogs].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.3 ? 2 : 1);
    const birds = picks.map((p) => ({ b: makeBird(g), land: { x: p.x + LOG_W / 2, y: p.y + 0.3 } }));
    await Promise.all(birds.map(({ b, land }) => fly(b, { x: land.x + 95, y: land.y - 70 }, land, 1500)));
    if (token !== visitToken) return;
    const n = el('text', { x: birds[0].land.x + 3, y: birds[0].land.y - 9, 'font-size': 5, fill: '#f2b134' }, g);
    n.textContent = '\u266A';
    n.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-9px)', opacity: 0 }], { duration: 1500 }).onfinish = () => n.remove();
    const end = Date.now() + rand(3500, 6000);
    while (Date.now() < end && token === visitToken) {
      birds.forEach(({ b }) => {
        b.bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-1.6px)' }, { transform: 'translateY(0)' }], { duration: 260 });
        if (Math.random() < 0.3) b.flip.setAttribute('transform', Math.random() < 0.5 ? FACE_L : FACE_R);
      });
      await sleep(rand(600, 1200));
    }
    if (token !== visitToken) return;
    await Promise.all(birds.map(({ b, land }) => {
      b.flip.setAttribute('transform', FACE_R);
      return fly(b, land, { x: land.x + 95, y: land.y - 75 }, 1400);
    }));
    g.textContent = '';
    visitor = false;
  }

  function makeOtter(parent) {
    const pos = el('g', {}, parent), bob = el('g', {}, pos), flip = el('g', { transform: 'scale(-0.6 0.6)' }, bob);
    el('path', { d: 'M-10 0.9 h22 M-6 1.9 h12', stroke: '#e7f6fc', 'stroke-width': 0.8, opacity: 0.85, 'stroke-linecap': 'round' }, flip);
    el('path', { d: 'M-8 -0.4 C-12 -1 -15 -2.6 -17 -2.2 C-15 -1 -12 0.2 -8 0Z', fill: '#6a4731' }, flip);
    el('path', { d: 'M-8 0 C-8 -3.2 -3 -4.2 1 -3.8 C4 -3.6 5 -2.5 5.5 0Z', fill: '#7a5438' }, flip);
    el('path', { d: 'M4 0 C4 -3 6 -5.2 9 -5.2 C11.2 -5.2 12.6 -3.8 12.6 -2.2 L12.6 0Z', fill: '#8a6040' }, flip);
    el('path', { d: 'M9.5 -3.2 C11 -3.8 12.7 -3 12.6 -1.5 C12 -0.5 10 -0.3 9.2 -1Z', fill: '#ecd5b0' }, flip);
    el('ellipse', { cx: 12.3, cy: -2.5, rx: 0.8, ry: 0.55, fill: '#2b1a12' }, flip);
    el('circle', { cx: 8.3, cy: -3.9, r: 0.55, fill: '#1c120d' }, flip);
    el('ellipse', { cx: 6.4, cy: -5.4, rx: 0.9, ry: 0.8, fill: '#6a4731' }, flip);
    return { pos, bob, flip };
  }

  async function otterVisit() {
    if (visitor || !st.waterY || GROUND - st.waterY < 3) return;
    visitor = true;
    const token = visitToken, g = $('critters');
    const y = st.waterY + 1, xEnd = lay.right + 58, xStart = lay.right + 92;
    const o = makeOtter(g);
    const t = (x, yy) => 'translate(' + x + 'px,' + yy + 'px)';
    const swim = o.pos.animate(
      [{ transform: t(xStart, y), opacity: 0 }, { transform: t(xStart - 8, y), opacity: 1, offset: 0.2 }, { transform: t(xEnd, y), opacity: 1 }],
      { duration: 2400, easing: 'ease-out', fill: 'forwards' }
    );
    o.bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-0.6px)' }, { transform: 'translateY(0)' }], { duration: 500, iterations: 5 });
    await swim.finished;
    o.pos.setAttribute('transform', 'translate(' + xEnd + ' ' + y + ')');
    swim.cancel();
    if (token !== visitToken) return;
    o.bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-1.8px)' }, { transform: 'translateY(0)' }], { duration: 700, iterations: 2 });
    await sleep(2200);
    if (token !== visitToken) return;
    const rip = el('ellipse', { cx: xEnd, cy: y + 0.5, rx: 3, ry: 0.9, fill: 'none', stroke: '#e7f6fc', 'stroke-width': 0.6 }, g);
    rip.style.transformBox = 'fill-box'; rip.style.transformOrigin = 'center';
    rip.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 1000 }).onfinish = () => rip.remove();
    const dive = o.pos.animate([{ transform: t(xEnd, y), opacity: 1 }, { transform: t(xEnd, y + 7), opacity: 0 }], { duration: 700, fill: 'forwards' });
    await dive.finished;
    o.pos.remove();
    visitor = false;
  }

  async function visitAll() { await birdVisit(); await otterVisit(); }

  setInterval(() => {
    if (visitor || $('camp').hidden || document.hidden || !st.perDam) return;
    const frac = (st.shown % st.perDam) / st.perDam;
    if (frac >= 0.5 && Math.random() < 0.06) otterVisit();
    else if (frac >= 0.3 && Math.random() < 0.22) birdVisit();
  }, 10000);

  /* ---- day and night ---- */
  const SKY = [ // hour, sky top, sky bottom, darkness
    [0, '#16224d', '#2c3d72', 0.32], [5, '#2c3a73', '#6e5f93', 0.26], [6.5, '#6aa0d8', '#f6b98a', 0.08],
    [9, '#bfe3f0', '#f7efcf', 0], [17, '#bfe3f0', '#f7efcf', 0], [19, '#7a8fd0', '#f59e6b', 0.08],
    [20.5, '#34437f', '#8a5a7e', 0.22], [22, '#1a2655', '#2f4078', 0.32], [24, '#16224d', '#2c3d72', 0.32],
  ];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mixHex = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };

  function skyAt(h) {
    for (let i = 0; i < SKY.length - 1; i++) {
      const [h0, t0, b0, d0] = SKY[i], [h1, t1, b1, d1] = SKY[i + 1];
      if (h >= h0 && h <= h1) { const t = (h - h0) / (h1 - h0); return { top: mixHex(t0, t1, t), bot: mixHex(b0, b1, t), dark: d0 + (d1 - d0) * t }; }
    }
    return { top: SKY[0][1], bot: SKY[0][2], dark: SKY[0][3] };
  }

  let skyAnim = null, skyReady = false;

  function effectiveHour(mode) {
    if (mode === 'day') return 12;
    if (mode === 'night') return 0;
    if (mode === 'fast') return (Date.now() / 1000 / 20) % 24; // a full day in 8 minutes
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  function hourNow() {
    if (skyAnim) {
      const t = Math.min(1, (Date.now() - skyAnim.start) / skyAnim.dur);
      if (t < 1) {
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        return (skyAnim.from + skyAnim.d * e + 48) % 24;
      }
      skyAnim = null;
    }
    return effectiveHour(st.timeMode);
  }

  function setTimeMode(mode, animate) {
    if (mode === st.timeMode) return;
    const from = hourNow();
    st.timeMode = mode;
    if (animate && !reduceMotion) {
      let d = (effectiveHour(mode) - from + 48) % 24;
      if (d > 12) d -= 24; // the short way round, forward when it is a tie (day -> night plays a sunset)
      if (Math.abs(d) > 0.05) {
        skyAnim = { from, d, start: Date.now(), dur: 2600 };
        const loop = () => { updateSky(); if (skyAnim) requestAnimationFrame(loop); };
        loop();
        return;
      }
    }
    skyAnim = null;
    updateSky();
  }

  const TIME_ICONS = {
    day: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="#f2b134"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="#f2b134" stroke-width="1.3" stroke-linecap="round"/></svg>',
    night: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M12.8 10.4A5.6 5.6 0 0 1 5.6 3.2a5.6 5.6 0 1 0 7.2 7.2Z" fill="#dcd9f2"/></svg>',
    auto: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.6" fill="#dcd9f2"/><path d="M8 2.4a5.6 5.6 0 0 0 0 11.2Z" fill="#f2b134"/></svg>',
  };
  const TIME_TITLES = {
    auto: 'Sky follows your clock. Click to make it day.',
    day: 'Always day. Click to make it night.',
    night: 'Always night. Click to follow your clock again.',
  };
  const timeKey = () => (st.timeMode === 'day' ? 'day' : st.timeMode === 'night' ? 'night' : 'auto');

  function renderTimeBtn() {
    const b = $('timeBtn'), k = timeKey();
    b.innerHTML = TIME_ICONS[k];
    b.title = TIME_TITLES[k];
    b.setAttribute('aria-label', TIME_TITLES[k]);
  }

  $('timeBtn').addEventListener('click', () => {
    const next = { auto: 'day', day: 'night', night: 'real' }[timeKey()];
    setTimeMode(next, true);
    renderTimeBtn();
    vscode.postMessage({ type: 'setTime', mode: next });
  });

  function updateSky() {
    const h = hourNow(), s = skyAt(h);
    st.dark = s.dark;
    $('skyTop').setAttribute('stop-color', s.top);
    $('skyBot').setAttribute('stop-color', s.bot);
    $('night').setAttribute('opacity', s.dark.toFixed(3));
    $('stars').setAttribute('opacity', clamp((s.dark - 0.12) / 0.18, 0, 1).toFixed(3));
    $('flies').setAttribute('opacity', clamp((s.dark - 0.2) / 0.1, 0, 1).toFixed(3));
    const t = (h - 6) / 13, sun = $('sun');                       // sun: 6:00 to 19:00
    const edge = Math.min(t, 1 - t);
    sun.setAttribute('cx', (18 + 204 * t).toFixed(1));
    sun.setAttribute('cy', (70 - 52 * Math.sin(Math.PI * clamp(t, 0, 1))).toFixed(1));
    sun.setAttribute('opacity', clamp(edge * 10, 0, 1).toFixed(2));
    sun.setAttribute('fill', mixHex('#ffb050', '#ffe28a', clamp(edge * 5, 0, 1)));
    const mt = ((h - 19.5 + 24) % 24) / 10.5, moon = $('moon');   // moon: 19:30 to 6:00
    const medge = Math.min(mt, 1 - mt);
    moon.setAttribute('transform', 'translate(' + (18 + 204 * clamp(mt, 0, 1)).toFixed(1) + ' ' + (70 - 48 * Math.sin(Math.PI * clamp(mt, 0, 1))).toFixed(1) + ')');
    moon.setAttribute('opacity', mt <= 1 ? clamp(medge * 10, 0, 1).toFixed(2) : '0');
  }

  function buildSky() {
    const r = mulberry(31);
    for (let i = 0; i < 18; i++) {
      const s = el('circle', { cx: (8 + r() * 224).toFixed(1), cy: (6 + r() * 58).toFixed(1), r: (0.4 + r() * 0.5).toFixed(2), fill: '#fff' }, $('stars'));
      s.style.animationDelay = (r() * 3).toFixed(1) + 's';
    }
    for (let i = 0; i < 9; i++) {
      const g = el('g', { class: 'fly' }, $('flies'));
      g.style.animationDuration = (5 + r() * 4).toFixed(1) + 's';
      g.style.animationDelay = (-r() * 8).toFixed(1) + 's';
      el('circle', { cx: (10 + r() * 220).toFixed(1), cy: (88 + r() * 30).toFixed(1), r: 2.6, fill: '#ffe98a', opacity: 0.25 }, g);
      el('circle', { cx: g.firstChild.getAttribute('cx'), cy: g.firstChild.getAttribute('cy'), r: 0.8, fill: '#fff6b0' }, g);
    }
    updateSky();
    setInterval(() => { if (!document.hidden) updateSky(); }, 1000);
  }

  /* ---- a heart when the pointer is near the beaver ---- */
  const HEART = '<svg viewBox="0 0 16 14" width="14" height="12" aria-hidden="true"><path d="M8 13 C0 7.5 1 1 5 1 C6.5 1 7.5 2 8 3 C8.5 2 9.5 1 11 1 C15 1 16 7.5 8 13Z" fill="#e8506a"/></svg>';
  let nextHeart = 0;

  function spawnHeart() {
    const scene = document.querySelector('#camp .scene'), sr = scene.getBoundingClientRect(), hr = $('head').getBoundingClientRect();
    const h = document.createElement('div');
    h.className = 'heart';
    h.innerHTML = HEART;
    h.style.left = (hr.left + hr.width / 2 - sr.left - 7 + rand(-4, 4)) + 'px';
    h.style.top = (hr.top - sr.top - 8) + 'px';
    scene.appendChild(h);
    h.addEventListener('animationend', () => h.remove());
    if (!reduceMotion) {
      $('head').animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(0deg)' }], { duration: 600, composite: 'add' });
    }
  }

  document.querySelector('#camp .scene').addEventListener('mousemove', (e) => {
    const now = Date.now();
    if (now < nextHeart) return;
    const r = $('walker').getBoundingClientRect(), pad = 8;
    if (e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) {
      nextHeart = now + 900;
      spawnHeart();
    }
  });

  function oops() {
    say('oops :(');
    if (!reduceMotion && st.pose === 'work') {
      $('head').animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(12deg) translateY(2px)' }, { transform: 'rotate(10deg) translateY(2px)' }, { transform: 'rotate(0deg)' }], { duration: 1400 });
    }
  }

  /* ---- idle behaviour: slow chewing, and now and then a rest on top of the dam ---- */
  const BEAVER_X = 55, BEAVER_S = 0.8;
  const toLocal = (x, y) => ({ x: (x - st.beaverX) / BEAVER_S, y: (y - GROUND) / BEAVER_S });
  let poseP = Promise.resolve();
  let sitTimer = null, sitSpot = null, sitEndsAt = 0, nextSitAt = Date.now() + rand(30000, 70000), nextChewAt = 0;

  function goSit(force) {
    if (st.pose !== 'work' || (!force && st.busy) || !st.topLogs || st.topLogs.length < 3) return;
    st.pose = 'moving';
    poseP = poseP.then(async () => {
      const tops = st.topLogs;
      const spot = tops[Math.floor(tops.length / 2)];
      const A = toLocal(DAM_X0 - 6, GROUND), B = toLocal(spot.x + LOG_W / 2 - 4, spot.y);
      const up = $('walker').animate(
        [{ transform: 'translate(0px,0px)' }, { transform: 'translate(' + A.x + 'px,0px)', offset: 0.4 }, { transform: 'translate(' + B.x + 'px,' + B.y + 'px)' }],
        { duration: reduceMotion ? 1 : 2800, easing: 'ease-in-out', fill: 'forwards' }
      );
      await up.finished;
      sitSpot = { A, B, up };
      st.pose = 'sitting';
      sitEndsAt = Date.now() + rand(18000, 35000);
      say('nice view :)');
      sitTimer = setInterval(() => {
        if (reduceMotion) return;
        $('head').animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(0deg)' }], { duration: 2600 });
      }, 4000);
    }).catch(() => { st.pose = 'work'; });
  }

  function returnToWork(fast) {
    if (st.pose === 'work') return poseP;
    poseP = poseP.then(async () => {
      if (st.pose !== 'sitting' || !sitSpot) return;
      clearInterval(sitTimer);
      const { A, B, up } = sitSpot;
      const back = $('walker').animate(
        [{ transform: 'translate(' + B.x + 'px,' + B.y + 'px) scaleX(-1)' }, { transform: 'translate(' + A.x + 'px,0px) scaleX(-1)', offset: 0.6 }, { transform: 'translate(0px,0px) scaleX(-1)' }],
        { duration: reduceMotion ? 1 : fast ? 1300 : 2500, easing: 'ease-in-out', fill: 'forwards' }
      );
      await back.finished;
      up.cancel(); back.cancel();
      sitSpot = null;
      st.pose = 'work';
      nextSitAt = Date.now() + rand(50000, 120000);
    }).catch(() => { st.pose = 'work'; });
    return poseP;
  }

  function resetPose() {
    clearInterval(sitTimer);
    const w = $('walker');
    if (w.getAnimations) w.getAnimations().forEach((a) => a.cancel());
    sitSpot = null;
    st.pose = 'work';
  }

  setInterval(() => {
    if (!st.focused || document.hidden || !st.perDam) return;
    const now = Date.now();
    if (now - st.lastTyping < 6000) return; // typing handler keeps him at the tree
    if (st.pose === 'sitting' && now > sitEndsAt) { returnToWork(false); return; }
    if (st.pose !== 'work' || st.busy) return;
    if (now > nextChewAt) { chew(); nextChewAt = now + rand(1800, 3800); }
    if (now > nextSitAt) goSit(false);
  }, 1000);

  async function haul() {
    const w = $('walker'), carry = $('carry');
    shakeTree();
    carry.style.opacity = 1;

    const T = (TRIP_USER - (st.beaverX - 55)) / BEAVER_S; // he stands closer as the trunk thins
    const fwd = [
      { transform: 'translate(0px,0px)' },
      { transform: 'translate(' + T / 2 + 'px,-3px)' },
      { transform: 'translate(' + T + 'px,0px)' },
    ];
    const back = [
      { transform: 'translate(' + T + 'px,0px) scaleX(-1)' },
      { transform: 'translate(' + T / 2 + 'px,-3px) scaleX(-1)' },
      { transform: 'translate(0px,0px) scaleX(-1)' },
    ];
    const go = w.animate(fwd, { duration: reduceMotion ? 1 : 700, easing: 'ease-in-out', fill: 'forwards' });
    await go.finished;

    carry.style.opacity = 0;
    st.shown++;
    const inDam = st.shown % st.perDam;
    const full = inDam === 0;
    renderDam(full ? st.perDam : inDam, true);
    renderStats();
    renderWorld();

    if (full) {
      const dams = Math.floor(st.shown / st.perDam);
      say('Dam ' + dams + ' done! New spot on the map \u{1F5FA}\uFE0F', true);
      hop();
      await fellTree();
      await sleep(1200);
      renderDam(0);
      growTree();
      $('bubble').classList.remove('show');
    } else if (Math.random() < 0.2) {
      say(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
    }

    const ret = w.animate(back, { duration: reduceMotion ? 1 : 500, easing: 'ease-in-out', fill: 'forwards' });
    await ret.finished;
    go.cancel();
    ret.cancel();
  }

  async function pump() {
    if (st.busy) return;
    st.busy = true;
    try {
      while (st.shown < woodOf(st.chars)) {
        if (st.pose !== 'work') await returnToWork(true);
        await haul();
      }
    } finally {
      st.busy = false;
      renderStats();
    }
  }

  /* ------------------------------------------------------------------ world map */
  const SITES = 30, MW = 400, MH = 260;
  let world = null;

  function smoothPath(pts) {
    let d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    for (let i = 1; i < pts.length - 1; i++) {
      const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
      d += ' Q' + pts[i].x.toFixed(1) + ' ' + pts[i].y.toFixed(1) + ' ' + m.x.toFixed(1) + ' ' + m.y.toFixed(1);
    }
    const l = pts[pts.length - 1];
    return d + ' L' + l.x.toFixed(1) + ' ' + l.y.toFixed(1);
  }

  function blobPath(cx, cy, rad, r) {
    const n = 10, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = rad * (0.72 + r() * 0.5);
      pts.push({ x: cx + Math.cos(a) * rr * 1.25, y: cy + Math.sin(a) * rr * 0.85 });
    }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const m0 = mid(pts[n - 1], pts[0]);
    let d = 'M' + m0.x.toFixed(1) + ' ' + m0.y.toFixed(1);
    for (let i = 0; i < n; i++) {
      const p = pts[i], m = mid(p, pts[(i + 1) % n]);
      d += ' Q' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' ' + m.x.toFixed(1) + ' ' + m.y.toFixed(1);
    }
    return d + 'Z';
  }

  function beaverIcon(parent) {
    const outer = el('g', { transform: 'translate(0 -13)' }, parent);
    const g = el('g', { class: 'bob' }, outer);
    el('circle', { r: 5.6, fill: 'rgba(255,255,255,.75)' }, g);
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#headArt');
    use.setAttribute('transform', 'translate(-5.1 6) scale(.3)');
    g.appendChild(use);
  }

  const NAMES_A = ['Alder', 'Willow', 'Birch', 'Maple', 'Cedar', 'Aspen', 'Hazel', 'Rowan', 'Poplar', 'Elm', 'Juniper', 'Sedge'];
  const NAMES_B = ['Creek', 'Brook', 'Run', 'Beck', 'Burn', 'Rill'];

  function pine(parent, x, y, s, fill) {
    el('path', { d: 'M' + x.toFixed(1) + ' ' + (y - 4 * s).toFixed(1) + ' L' + (x + 2.4 * s).toFixed(1) + ' ' + (y + 1.5 * s).toFixed(1) + ' L' + (x - 2.4 * s).toFixed(1) + ' ' + (y + 1.5 * s).toFixed(1) + 'Z', fill }, parent);
  }

  // a water line: wet body + moving sparkles on top
  function waterLine(parent, d, width, opacity, bank) {
    if (bank) el('path', { d, fill: 'none', stroke: '#d6eef8', 'stroke-width': width + 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.75 }, parent);
    const wet = el('path', { d, class: 'wet', fill: 'none', stroke: '#4aa3d8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': width, opacity }, parent);
    const spark = el('path', { d, class: 'sparkle', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.65, 'stroke-width': 0.7, 'stroke-linecap': 'round', opacity }, parent);
    return [wet, spark];
  }

  function buildWorld() {
    const r = mulberry(9071);
    const svg = $('map');
    svg.textContent = '';
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const names = [];
    NAMES_A.forEach((a) => NAMES_B.forEach((b) => names.push(a + ' ' + b)));
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }

    el('rect', { width: MW, height: MH, fill: '#a8d08d' }, svg);
    for (let i = 0; i < 11; i++) {
      el('path', { d: blobPath(r() * MW, r() * MH, 26 + r() * 24, r), fill: i % 2 ? '#9bc582' : '#b3d99b', opacity: 0.6 }, svg);
    }
    const gDry = el('g', {}, svg), gFlowers = el('g', {}, svg), gMount = el('g', {}, svg), gForest = el('g', {}, svg),
      gPonds = el('g', {}, svg), gSwamps = el('g', {}, svg), gRivers = el('g', {}, svg), gStreams = el('g', {}, svg),
      gTrail = el('g', {}, svg), gSites = el('g', {}, svg), gFrame = el('g', {}, svg);

    // mountains
    [[30, 30], [84, 26], [150, 32], [226, 25], [298, 31], [362, 27], [22, 247], [96, 250]].forEach(([x, y]) => {
      const w = 12 + r() * 4, h = 14 + r() * 5;
      el('path', { d: 'M' + (x - w) + ' ' + y + ' L' + x + ' ' + (y - h) + ' L' + (x + w) + ' ' + y + 'Z', fill: '#b9a98e', stroke: '#7d6d55', 'stroke-width': 0.7, 'stroke-linejoin': 'round' }, gMount);
      el('path', { d: 'M' + x + ' ' + (y - h) + ' L' + (x + w) + ' ' + y + ' L' + (x + 2) + ' ' + y + 'Z', fill: '#a39378' }, gMount);
      el('path', { d: 'M' + (x - w * 0.32) + ' ' + (y - h * 0.68) + ' L' + x + ' ' + (y - h) + ' L' + (x + w * 0.3) + ' ' + (y - h * 0.7) + ' L' + x + ' ' + (y - h * 0.6) + 'Z', fill: '#fff' }, gMount);
    });
    for (let c = 0; c < 12; c++) {
      const cx = r() * MW, cy = 20 + r() * 220;
      for (let t = 0; t < 9; t++) pine(gForest, cx + (r() - 0.5) * 46, cy + (r() - 0.5) * 30, 0.8 + r() * 0.5, '#4f8f55');
    }

    // four big rivers (always flowing) with branches
    const riverPts = [], bigRivers = [];
    for (let i = 0; i < 4; i++) {
      const pts = [];
      let x = 45 + i * 105 + (r() - 0.5) * 30;
      for (let k = 0; k <= 12; k++) {
        x = clamp(x + (r() - 0.5) * 26, 14, 386);
        pts.push({ x, y: 6 + (k / 12) * 248 });
      }
      pts.forEach((p, k) => { riverPts.push(p); if (k < 12) riverPts.push(mid(p, pts[k + 1])); });
      bigRivers.push(smoothPath(pts));
      [3, 7].forEach((idx) => {
        const J = mid(pts[idx], pts[idx + 1]), side = r() < 0.5 ? -1 : 1;
        const S = { x: clamp(J.x + side * (28 + r() * 18), 12, 388), y: J.y - (26 + r() * 12) };
        const M = mid(S, J); M.x += (r() - 0.5) * 8;
        bigRivers.push({ d: smoothPath([S, M, J]), small: true });
        riverPts.push(M);
      });
    }

    // thirty small streams, one per grid cell, flowing toward the nearest big river
    const COLS = 6, ROWS = 5, cw = MW / COLS, ch = MH / ROWS;
    const streams = [], order = [];
    for (let row = 0; row < ROWS; row++) {
      const cols = [0, 1, 2, 3, 4, 5];
      if (row % 2) cols.reverse();
      cols.forEach((col) => {
        const cx = col * cw + cw / 2 + (r() - 0.5) * 18, cy = row * ch + ch / 2 + (r() - 0.5) * 14;
        let best = riverPts[0], bd = 1e9;
        riverPts.forEach((p) => { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = p; } });
        let ang = Math.atan2(best.y - cy, best.x - cx) + (r() - 0.5) * 0.9;
        if (bd < 22) ang += (Math.PI / 2) * (r() < 0.5 ? -1 : 1);
        let x = cx - Math.cos(ang) * 22, y = cy - Math.sin(ang) * 17;
        const pts = [];
        for (let k = 0; k < 5; k++) {
          pts.push({ x: clamp(x, 14, 386), y: clamp(y, 14, 246) });
          ang += (r() - 0.5) * 0.9;
          x += Math.cos(ang) * 11.5; y += Math.sin(ang) * 9;
        }
        const site = Object.assign(mid(pts[2], pts[3]), { i: order.length, name: names[order.length] }); // on the drawn curve
        order.push(site);
        const creeks = [];
        [[pts[1], pts[2], 0.6], [pts[3], pts[4], 0.35]].forEach(([p, q, prob]) => {
          if (r() >= prob) return;
          const J = mid(p, q);
          let dx = q.x - p.x, dy = q.y - p.y;
          const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
          const side = r() < 0.5 ? -1 : 1, off = 14 + r() * 8;
          const S = { x: clamp(J.x - dy * side * off - dx * 8, 12, 388), y: clamp(J.y + dx * side * off - dy * 8, 12, 248) };
          const M = mid(S, J); M.x += (r() - 0.5) * 5; M.y += (r() - 0.5) * 5;
          creeks.push([S, M, J]);
        });
        const end = pts[4];
        streams.push({ pts, creeks, site, cx, cy, swamp: { cx: clamp(end.x + Math.cos(ang) * 8, 18, 382), cy: clamp(end.y + Math.sin(ang) * 6, 18, 242), rad: 10 + r() * 5 } });
      });
    }

    // drought patches + flowers per cell: dry until the dam is built, then lush
    streams.forEach((s) => {
      s.dry = el('path', { d: blobPath(s.cx, s.cy, 46, r), class: 'lush', fill: '#d9c58a', opacity: 0.4 }, gDry);
      s.flowers = el('g', { class: 'lush', opacity: 0 }, gFlowers);
      for (let k = 0; k < 9; k++) {
        el('circle', { cx: (s.cx + (r() - 0.5) * cw * 0.95).toFixed(1), cy: (s.cy + (r() - 0.5) * ch * 0.95).toFixed(1), r: 0.9, fill: ['#ffffff', '#f6d365', '#f4a6c0', '#c9a7ee'][k % 4] }, s.flowers);
      }
    });

    // ponds (with a duck or two), away from the water lines
    const placed = [];
    for (let tries = 0; tries < 90 && placed.length < 8; tries++) {
      const p = { x: 20 + r() * 360, y: 20 + r() * 220 };
      const far = streams.every((s) => s.pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 20) && Math.hypot(s.swamp.cx - p.x, s.swamp.cy - p.y) > 24) &&
        riverPts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 16);
      if (far && placed.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 36)) {
        placed.push(p);
        const rad = 6 + r() * 3;
        el('path', { d: blobPath(p.x, p.y, rad, r), fill: '#5bb0d6' }, gPonds);
        el('path', { d: 'M' + (p.x - rad * 0.5) + ' ' + (p.y - 1) + ' h' + rad * 0.6, stroke: '#a9dff2', 'stroke-width': 0.7, 'stroke-linecap': 'round' }, gPonds);
        if (placed.length % 2) {
          const d = el('g', { transform: 'translate(' + (p.x + 1) + ' ' + (p.y + 1) + ')' }, gPonds);
          const dk = el('g', { class: 'bob' }, d);
          el('ellipse', { cx: 0, cy: 0, rx: 2.4, ry: 1.3, fill: '#fff' }, dk);
          el('circle', { cx: 2, cy: -1.4, r: 1, fill: '#2f7d4b' }, dk);
          el('path', { d: 'M2.9 -1.4 l1.4 .3 l-1.4 .5Z', fill: '#f2a93b' }, dk);
        }
      }
    }

    // swamps
    streams.forEach((s) => {
      const sw = s.swamp, g = el('g', {}, gSwamps);
      el('path', { d: blobPath(sw.cx, sw.cy, sw.rad, r), fill: '#bdb283' }, g);
      el('path', { d: blobPath(sw.cx, sw.cy, sw.rad * 0.66, r), fill: '#a89d70' }, g);
      for (let k = 0; k < 3; k++) {
        const x = sw.cx + (r() - 0.5) * sw.rad * 1.5, y = sw.cy + (r() - 0.5) * sw.rad;
        el('path', { d: 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'l-1 -3 M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'l1 -3', stroke: '#8a7d4f', 'stroke-width': 0.6, 'stroke-linecap': 'round' }, g);
      }
      const lush = el('g', { class: 'lush', opacity: 0 }, g);
      el('path', { d: blobPath(sw.cx, sw.cy, sw.rad, r), fill: '#5f9f5d' }, lush);
      el('path', { d: blobPath(sw.cx, sw.cy, sw.rad * 0.7, r), fill: '#4b8a52' }, lush);
      for (let k = 0; k < 3; k++) {
        const x = sw.cx + (r() - 0.5) * sw.rad * 1.1, y = sw.cy + (r() - 0.5) * sw.rad * 0.7;
        el('ellipse', { cx: x.toFixed(1), cy: y.toFixed(1), rx: (2.2 + r() * 2.2).toFixed(1), ry: (1.4 + r() * 1.2).toFixed(1), fill: '#5bb6cf' }, lush);
        el('circle', { cx: (x + 1).toFixed(1), cy: (y - 0.4).toFixed(1), r: 1.1, fill: '#9bdc7e' }, lush);
      }
      for (let k = 0; k < 5; k++) {
        const x = sw.cx + (r() - 0.5) * sw.rad * 1.7, y = sw.cy + (r() - 0.3) * sw.rad * 1.0;
        el('path', { d: 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'l-1 -6 M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'l0 -7 M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'l1 -6', stroke: '#3f6f3a', 'stroke-width': 0.7, 'stroke-linecap': 'round', fill: 'none' }, lush);
        el('ellipse', { cx: x.toFixed(1), cy: (y - 7).toFixed(1), rx: 0.7, ry: 1.5, fill: '#7a4a2a' }, lush);
      }
      s.lush = lush;
    });

    // big rivers on top of the swamps, then the small streams
    bigRivers.forEach((b) => (typeof b === 'string' ? waterLine(gRivers, b, 3.6, 1, true) : waterLine(gRivers, b.d, 2.2, 1, true)));
    streams.forEach((s) => {
      s.wets = [];
      const draw = (pts) => {
        const d = smoothPath(pts);
        el('path', { d, fill: 'none', stroke: '#b59f6e', 'stroke-width': 1.3, 'stroke-dasharray': '3 3' }, gStreams);
        s.wets.push(...waterLine(gStreams, d, 2, 0, false));
      };
      draw(s.pts);
      s.creeks.forEach(draw);
    });

    // journey trail (snake through the grid)
    const trailD = (n) => 'M' + order.slice(0, n).map((s) => s.x.toFixed(1) + ' ' + s.y.toFixed(1)).join('L');
    el('path', { d: trailD(order.length), fill: 'none', stroke: '#fff', 'stroke-opacity': 0.4, 'stroke-width': 1, 'stroke-dasharray': '1 3', 'stroke-linecap': 'round' }, gTrail);
    const trailDone = el('path', { d: '', fill: 'none', stroke: '#f2b134', 'stroke-width': 1.3, 'stroke-dasharray': '1 3', 'stroke-linecap': 'round' }, gTrail);

    // site markers
    const C = 2 * Math.PI * 7;
    order.forEach((s) => {
      const g = el('g', { transform: 'translate(' + s.x.toFixed(1) + ' ' + s.y.toFixed(1) + ')' }, gSites);
      s.title = el('title', {}, g);
      s.eTodo = el('circle', { r: 2.4, fill: 'none', stroke: '#fff', 'stroke-opacity': 0.9, 'stroke-width': 0.9, 'stroke-dasharray': '1.5 1.5' }, g);
      s.eDone = el('g', {}, g);
      el('ellipse', { cx: 1, cy: 2, rx: 9, ry: 2, fill: '#5bb6cf', opacity: 0.85 }, s.eDone);
      const lg = { fill: '#a06b3a', stroke: 'rgba(60,35,20,.6)', 'stroke-width': 0.5, rx: 0.8 };
      el('rect', Object.assign({ x: -5, y: -1, width: 10, height: 2.6 }, lg), s.eDone);
      el('rect', Object.assign({ x: -3.5, y: -3.5, width: 7, height: 2.6 }, lg), s.eDone);
      el('rect', Object.assign({ x: -2, y: -6, width: 4, height: 2.6 }, lg), s.eDone);
      el('path', { d: 'M4.5 2 A4 4 0 0 1 12.5 2Z', fill: '#7b5233', stroke: '#4a2e1a', 'stroke-width': 0.5 }, s.eDone);
      s.eCur = el('g', {}, g);
      el('circle', { r: 9, fill: 'none', stroke: '#f2b134', 'stroke-width': 0.8, class: 'pulse' }, s.eCur);
      el('circle', { r: 7, fill: 'rgba(255,255,255,.55)', stroke: 'rgba(0,0,0,.2)', 'stroke-width': 2 }, s.eCur);
      s.ring = el('circle', { r: 7, fill: 'none', stroke: '#f2b134', 'stroke-width': 2, 'stroke-linecap': 'round', transform: 'rotate(-90)', 'stroke-dasharray': '0 ' + C }, s.eCur);
      s.C = C;
      beaverIcon(s.eCur);
    });

    // frame + compass
    el('rect', { x: 1.5, y: 1.5, width: MW - 3, height: MH - 3, rx: 6, fill: 'none', stroke: '#6b4a2e', 'stroke-width': 3 }, gFrame);
    el('rect', { x: 4.5, y: 4.5, width: MW - 9, height: MH - 9, rx: 4, fill: 'none', stroke: '#d9c49a', 'stroke-width': 0.8 }, gFrame);
    const cg = el('g', { transform: 'translate(372 228)' }, gFrame);
    el('circle', { r: 12, fill: 'rgba(255,248,230,.7)', stroke: '#6b4a2e', 'stroke-width': 0.8 }, cg);
    el('path', { d: 'M0 -10 L2.4 0 L0 10 L-2.4 0Z M-10 0 L0 -2.4 L10 0 L0 2.4Z', fill: '#6b4a2e', opacity: 0.55 }, cg);
    el('path', { d: 'M0 -10 L2.4 0 L-2.4 0Z', fill: '#c0392b' }, cg);
    const nt = el('text', { x: 0, y: -13.5, 'text-anchor': 'middle', 'font-size': 5.5, fill: '#4a3022' }, cg);
    nt.textContent = 'N';

    world = { order, streams, trailD, trailDone };
  }

  function renderWorld() {
    if (!world) return;
    const dams = Math.floor(st.shown / st.perDam), inDam = st.shown % st.perDam;
    const built = Math.min(dams, SITES), complete = dams >= SITES;
    const f = inDam / st.perDam;

    world.order.forEach((s, i) => {
      s.isDone = i < built;
      const cur = !complete && i === built;
      s.eTodo.style.display = !s.isDone && !cur ? '' : 'none';
      s.eDone.style.display = s.isDone ? '' : 'none';
      s.eCur.style.display = cur || (complete && i === SITES - 1) ? '' : 'none';
      s.ring.style.display = cur ? '' : 'none';
      if (cur) s.ring.setAttribute('stroke-dasharray', (s.C * f).toFixed(1) + ' ' + s.C.toFixed(1));
      s.title.textContent = (i + 1) + '. ' + s.name + ' \u2013 ' + (s.isDone ? 'restored' : cur ? 'in progress, ' + Math.floor(f * 100) + '%' : 'waiting for a dam');
    });
    world.streams.forEach((s) => {
      const cur = !complete && s.site.i === built;
      const op = s.site.isDone ? 1 : cur ? 0.2 + 0.6 * f : 0;
      const w = s.site.isDone ? 2.4 : cur ? 1.4 + f : 1.4;
      s.wets.forEach((n) => { n.style.opacity = op; n.style.strokeWidth = n.classList.contains('wet') ? w : ''; });
      s.lush.style.opacity = s.site.isDone ? 1 : cur ? f * 0.85 : 0;
      s.dry.style.opacity = s.site.isDone ? 0 : cur ? 0.4 * (1 - f) : 0.4;
      s.flowers.style.opacity = s.site.isDone ? 1 : cur ? f * 0.7 : 0;
    });
    world.trailDone.setAttribute('d', built >= 1 ? world.trailD(Math.min(built + 1, SITES)) : '');

    const pct = complete ? 100 : Math.floor(((built + f) / SITES) * 100);
    $('mapPct').textContent = complete ? 'World restored!' : pct + '% of the world restored.';
    $('mapDams').textContent = complete ? dams - SITES + ' bonus dams.' : built + ' of ' + SITES + ' dams built.';
    $('mapNow').textContent = complete ? 'Every creek is flowing.' : 'Now building: ' + world.order[built].name + '.';
  }

  /* ------------------------------------------------------------------ tabs + messages */
  function setTab(t) {
    $('camp').hidden = t !== 'camp';
    $('world').hidden = t !== 'world';
    $('tab-camp').setAttribute('aria-selected', String(t === 'camp'));
    $('tab-world').setAttribute('aria-selected', String(t === 'world'));
    vscode.setState({ tab: t });
  }
  $('tab-camp').addEventListener('click', () => setTab('camp'));
  $('tab-world').addEventListener('click', () => setTab('world'));
  $('openMap').addEventListener('click', () => vscode.postMessage({ type: 'openMap' }));

  function setConfig(m) {
    const changed = m.perDam !== st.perDam || !lay;
    st.chars = m.chars; st.perLog = m.perLog; st.perDam = m.perDam;
    setTimeMode(m.timeMode || 'real', skyReady);
    skyReady = true;
    renderTimeBtn();
    if (changed) { lodgeOn = false; computeLayout(); }
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'init') {
      setConfig(m);
      if (m.focused !== undefined) st.focused = m.focused;
      resetPose();
      $('treeFx').style.opacity = '';
      st.shown = woodOf(m.chars);
      renderDam(st.shown % st.perDam);
      renderStats();
      renderWorld();
      if (m.greet) { say('hello :)'); hop(); }
    } else if (m.type === 'typing') {
      const layoutChanged = m.perDam !== st.perDam;
      setConfig(m);
      if (layoutChanged) renderDam(st.shown % st.perDam);
      if (!m.idle) {
        st.lastTyping = Date.now();
        if (st.pose !== 'work') returnToWork(true).then(chew);
        else chew();
      }
      renderStats();
      pump();
    } else if (m.type === 'focus') {
      st.focused = m.focused;
    } else if (m.type === 'rest') {
      goSit(true);
    } else if (m.type === 'visit') {
      visitAll();
    } else if (m.type === 'oops') {
      oops();
    } else if (m.type === 'yay') {
      cheer();
    } else if (m.type === 'say') {
      say(m.text, m.sticky);
      if (m.hop) hop();
    }
  });

  computeLayout();
  buildTree();
  buildSky();
  buildWorld();
  setTab(document.body.dataset.tab || (vscode.getState() || {}).tab || 'camp');
  vscode.postMessage({ type: 'ready' });
})();
