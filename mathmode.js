(function () {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isTouch = () => matchMedia('(pointer: coarse)').matches;
const fmt = (n) => (Math.round(n * 1000) / 1000).toString().replace('.', ',');

const Snd = (() => {
  let ctx = null, master = null, muted = false;
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    } catch (_) { ctx = null; }
  }
  function tone(f, d, type = 'sine', v = 0.12, slide = 0, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.05);
  }
  function whoosh(d = 0.6, from = 300, to = 2400, v = 0.09) {
    if (!ctx || muted) return;
    const t = ctx.currentTime, n = Math.floor(ctx.sampleRate * d), buf = ctx.createBuffer(1, n, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t);
  }
  return {
    init, tone, whoosh,
    get muted() { return muted; }, toggleMute() { muted = !muted; return muted; },
    click: () => tone(700, 0.06, 'triangle', 0.07),
    key: () => tone(520 + Math.random() * 80, 0.04, 'square', 0.03),
    pop: () => tone(480, 0.12, 'sine', 0.12, 420),
    tick: () => tone(1200, 0.03, 'square', 0.03),
    step: () => { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, 0, i * 0.07)); },
    chime: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.4, 'sine', 0.1, 0, i * 0.08)); },
    fail: () => { tone(240, 0.35, 'sawtooth', 0.07, -90); tone(170, 0.45, 'sawtooth', 0.07, -60, 0.14); },
    slowIn: () => { whoosh(0.7, 2200, 200, 0.1); tone(220, 0.6, 'sine', 0.08, -120); },
    slowOut: () => { whoosh(0.5, 200, 2400, 0.08); },
    boom: () => { tone(110, 0.5, 'sine', 0.2, -70); whoosh(0.5, 900, 120, 0.12); },
  };
})();

let RS = null, THREE = null;
const U = (x, y, z, out) => { const o = out || { x: 0, y: 0, z: 0 }; RS.rsToThreeInto(x, y, z, o); return o; };
const M = 0.02;

const Fx = {
  root: null, items: [],
  init() { this.root = new THREE.Group(); this.root.name = 'mm-root'; RS.scene.add(this.root); },
  add(obj, update) { this.root.add(obj); const it = { obj, update }; this.items.push(it); return it; },
  remove(obj) { this.root.remove(obj); this.items = this.items.filter((i) => i.obj !== obj); obj.traverse && obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.__shared) { o.material.map && o.material.map.dispose(); o.material.dispose(); } }); },
  update(dt) {
    for (const it of this.items.slice()) {
      if (it.update && it.update(dt, it.obj) === false) this.remove(it.obj);
    }
  },
  clear() { for (const it of this.items.slice()) this.remove(it.obj); },
};

const _glow = (() => {
  let tex = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); tex = new THREE.CanvasTexture(c); tex.__shared = true; return tex;
  };
})();

function matAdd(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
}

function shock(x, y, color = 0x7f9db5, radiusUU = 700, dur = 0.8) {
  const geo = new THREE.RingGeometry(0.9, 1, 64); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, matAdd(color, 0.95)); const p = U(x, y, 4); mesh.position.set(p.x, p.y, p.z);
  let t = 0; Fx.add(mesh, (dt) => { t += dt / dur; if (t >= 1) return false; const s = (0.15 + easeOut(t)) * radiusUU * M; mesh.scale.set(s, 1, s); mesh.material.opacity = 0.95 * (1 - t); });
}

function burst(x, y, z, color = 0xd9a441, n = 70, speed = 22, life = 1.2) {
  const pos = new Float32Array(n * 3), vel = [];
  const p0 = U(x, y, z);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = p0.x; pos[i * 3 + 1] = p0.y; pos[i * 3 + 2] = p0.z;
    const a = Math.random() * Math.PI * 2, b = Math.acos(rand(-0.2, 1)), s = rand(0.35, 1) * speed;
    vel.push(Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size: 1.7, map: _glow(), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  let t = 0;
  Fx.add(pts, (dt) => {
    t += dt; if (t >= life) return false;
    const a = geo.attributes.position.array;
    for (let i = 0; i < n; i++) { vel[i * 3 + 1] -= 16 * dt; a[i * 3] += vel[i * 3] * dt; a[i * 3 + 1] = Math.max(0.05, a[i * 3 + 1] + vel[i * 3 + 1] * dt); a[i * 3 + 2] += vel[i * 3 + 2] * dt; }
    geo.attributes.position.needsUpdate = true; mat.opacity = 1 - t / life;
  });
}

function labelSprite(text, { size = 2.2, color = '#ffffff', glow = '#6f93ad', bg = null } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d'); g.font = '900 64px "Arial Narrow", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (bg) { g.fillStyle = bg; g.fillRect(0, 8, 512, 112); }
  g.shadowColor = glow; g.shadowBlur = 22; g.fillStyle = color; g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
  sp.scale.set(size * 4, size, 1); sp.renderOrder = 20; return sp;
}

function makeGate({ x, y, z = 260, r = 260, yaw = Math.PI / 2, color = 0x6f93ad }) {
  const g = new THREE.Group(), R = r * M;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.22, 12, 64), matAdd(color, 0.95));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), matAdd(color, 0.1));
  const ripple = new THREE.Mesh(new THREE.TorusGeometry(R, 0.08, 8, 64), matAdd(color, 0.6));
  g.add(ring, disc, ripple);
  const p = U(x, y, z); g.position.set(p.x, p.y, p.z);
  const dx = Math.cos(yaw), dy = Math.sin(yaw); g.rotation.y = Math.atan2(dx, -dy);
  let t = Math.random() * 6;
  const st = { group: g, ring, disc, color, done: false, x, y, z, r, pulse: 0 };
  Fx.add(g, (dt) => {
    t += dt; const s = 1 + 0.5 * ((t * 0.9) % 1); ripple.scale.set(s, s, 1); ripple.material.opacity = 0.6 * (1 - ((t * 0.9) % 1));
    if (st.pulse > 0) { st.pulse -= dt; const k = 1 + Math.max(0, st.pulse) * 0.5; g.scale.set(k, k, k); } else g.scale.set(1, 1, 1);
  });
  st.setColor = (c) => { ring.material.color.setHex(c); disc.material.color.setHex(c); ripple.material.color.setHex(c); };
  return st;
}

function makeZone({ x, y, r = 260, color = 0x6f93ad, beam = true, text = null }) {
  const g = new THREE.Group(), R = r * M;
  const ringGeo = new THREE.RingGeometry(R * 0.92, R, 64); ringGeo.rotateX(-Math.PI / 2);
  const fillGeo = new THREE.CircleGeometry(R, 48); fillGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, matAdd(color, 0.95)), fill = new THREE.Mesh(fillGeo, matAdd(color, 0.14));
  g.add(ring, fill); ring.position.y = fill.position.y = 0.06;
  let beamMesh = null;
  if (beam) { beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R * 0.85, 26, 32, 1, true), matAdd(color, 0.09)); beamMesh.position.y = 13; g.add(beamMesh); }
  const arrows = [];
  for (let i = 0; i < 3; i++) { const a = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 4), matAdd(color, 0.9)); a.rotation.x = Math.PI; g.add(a); arrows.push(a); }
  let lab = null; if (text) { lab = labelSprite(text, { size: 1.7, glow: '#' + color.toString(16).padStart(6, '0') }); g.add(lab); }
  const p = U(x, y, 0); g.position.set(p.x, p.y, p.z);
  let t = 0;
  const st = { group: g, ring, fill, x, y, r, color, done: false };
  Fx.add(g, (dt) => {
    t += dt;
    arrows.forEach((a, i) => { a.position.y = 6 + i * 2.4 + Math.sin(t * 3 + i * 0.7) * 0.6; a.material.opacity = 0.9 - i * 0.22; });
    if (lab) lab.position.y = 4.2 + Math.sin(t * 2) * 0.3;
    ring.material.opacity = 0.7 + 0.25 * Math.sin(t * 4);
  });
  st.setColor = (c) => { [ring, fill, beamMesh, ...arrows].forEach((m) => m && m.material.color.setHex(c)); };
  st.setPos = (nx, ny) => { st.x = nx; st.y = ny; const q = U(nx, ny, 0); g.position.set(q.x, q.y, q.z); };
  return st;
}

function makeArena(hx, hy) {
  const g = new THREE.Group();
  const W = hx * 2 * M, D = hy * 2 * M;
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  { const c = gc.getContext('2d'); c.clearRect(0, 0, 128, 128); c.strokeStyle = 'rgba(80,200,255,.9)'; c.lineWidth = 3; c.strokeRect(1, 1, 126, 126); }
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(W / 8, D / 8); gt.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: gt, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.05; g.add(floor);
  const wc = document.createElement('canvas'); wc.width = 4; wc.height = 128;
  { const c = wc.getContext('2d'), gr = c.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(70,200,255,.85)'); gr.addColorStop(0.35, 'rgba(70,200,255,.25)'); gr.addColorStop(1, 'rgba(70,200,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 4, 128); }
  const wt = new THREE.CanvasTexture(wc);
  const H = 14;
  const wallMat = () => new THREE.MeshBasicMaterial({ map: wt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const mk = (w, px, pz, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat()); m.position.set(px, H / 2, pz); m.rotation.y = ry; g.add(m); };
  mk(W, 0, -D / 2, 0); mk(W, 0, D / 2, 0); mk(D, -W / 2, 0, Math.PI / 2); mk(D, W / 2, 0, Math.PI / 2);
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-W / 2, 0.1, -D / 2), new THREE.Vector3(W / 2, 0.1, -D / 2), new THREE.Vector3(W / 2, 0.1, D / 2), new THREE.Vector3(-W / 2, 0.1, D / 2)]), new THREE.LineBasicMaterial({ color: 0x8aa6bb, toneMapped: false }));
  g.add(edge);
  const p = U(0, 0, 0); g.position.set(p.x, p.y, p.z);
  g.visible = false; Fx.add(g, () => {});
  return g;
}

function makePrism(sx = 700, sy = 700, sz = 820) {
  const g = new THREE.Group(), w = sx * M, d = sy * M, hh = sz * M;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), matAdd(0x6f93ad, 0.16));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, hh, d)), new THREE.LineBasicMaterial({ color: 0x9db6c8, toneMapped: false }));
  const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w * 0.45, w * 0.45, w * 0.45)), new THREE.LineBasicMaterial({ color: 0xd9a441, toneMapped: false }));
  const innerSolid = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, w * 0.45, w * 0.45), matAdd(0xd08a2e, 0.25));
  g.add(body, edges); const core = new THREE.Group(); core.add(inner, innerSolid); core.position.y = 0; g.add(core);
  const lab = labelSprite('ÁREA DE PRISMAS', { size: 2.2, glow: '#d08a2e' }); lab.position.y = hh / 2 + 3.2; g.add(lab);
  const baseGeo = new THREE.RingGeometry(w * 0.62, w * 0.7, 48); baseGeo.rotateX(-Math.PI / 2);
  const base = new THREE.Mesh(baseGeo, matAdd(0xd08a2e, 0.9)); base.position.y = -hh / 2 + 0.08; g.add(base);
  const st = { group: g, x: 0, y: 0, sx, sy, sz, flash: 0 };
  let t = 0;
  Fx.add(g, (dt) => {
    t += dt; core.rotation.y += dt * 0.9; core.rotation.x += dt * 0.5; core.position.y = Math.sin(t * 1.6) * 0.6;
    lab.position.y = hh / 2 + 3.2 + Math.sin(t * 2) * 0.35;
    base.material.opacity = 0.6 + 0.3 * Math.sin(t * 4);
    body.material.opacity = 0.14 + 0.05 * Math.sin(t * 3) + st.flash * 0.4; if (st.flash > 0) st.flash -= dt * 1.5;
  });
  st.setPos = (x, y) => { st.x = x; st.y = y; const p = U(x, y, sz / 2); g.position.set(p.x, p.y, p.z); };
  st.hit = (bx, by, bz, r = 91.25) => {
    const dx = Math.max(Math.abs(bx - st.x) - sx / 2, 0), dy = Math.max(Math.abs(by - st.y) - sy / 2, 0), dz = Math.max(Math.abs(bz - sz / 2) - sz / 2, 0);
    return dx * dx + dy * dy + dz * dz <= r * r;
  };
  return st;
}

const Ex = (() => {
  const sq = (n) => n * n;
  const rowCells = (n) => Array.from({ length: n }, (_, i) => [i, 0, 0]);
  const chip = (label, value) => ({ label, value });
  const dimsChips = (a, b, c) => [chip(`largo = ${fmt(a)}`, a), chip(`ancho = ${fmt(b)}`, b), chip(`alto = ${fmt(c)}`, c)];
  const prismOf = (a, b, c, unit = 'cm') => [{ dims: [a, b, c], unit }];
  const areaTotal = (a, b, c) => 2 * (a * b + a * c + b * c);

  const builders = {
    base(lv) {
      const a = randInt(3, 9), b = randInt(2, a), c = randInt(2, 8);
      return { id: 'base', title: 'Área de una cara', prompt: `Un prisma rectangular mide <b>${a} cm de largo</b>, <b>${b} cm de ancho</b> y <b>${c} cm de alto</b>. ¿Cuál es el área de su <b>base</b> (la cara de abajo)?`,
        solids: prismOf(a, b, c), unit: 'cm²', answer: a * b, chips: dimsChips(a, b, c),
        steps: [`La base es un rectángulo de ${a} cm por ${b} cm.`, `Área de la base = ${a} × ${b} = <b>${a * b} cm²</b>.`],
        hints: ['La base es la cara de abajo: un rectángulo.', 'Área del rectángulo = largo × ancho.', `Calcula ${a} × ${b}.`] };
    },
    total(lv) {
      const a = randInt(3, lv <= 1 ? 8 : 12), b = randInt(2, a), c = randInt(2, lv <= 1 ? 6 : 9), t = areaTotal(a, b, c);
      return { id: 'total', title: 'Área total del prisma', prompt: `Un prisma rectangular mide <b>${a} cm de largo</b>, <b>${b} cm de ancho</b> y <b>${c} cm de alto</b>. ¿Cuál es su <b>área total</b>?`,
        solids: prismOf(a, b, c), unit: 'cm²', answer: t, chips: dimsChips(a, b, c),
        steps: [`Tiene 3 pares de caras iguales: ${a}×${b}, ${a}×${c} y ${b}×${c}.`, `Áreas: ${a * b} + ${a * c} + ${b * c} = ${a * b + a * c + b * c} cm².`, `Se cuentan dos veces: 2 × ${a * b + a * c + b * c} = <b>${t} cm²</b>.`],
        hints: ['Marca las 6 caras en el visor: son 3 pares de caras iguales.', `Calcula ${a}×${b}, ${a}×${c} y ${b}×${c}, y súmalas.`, 'Multiplica esa suma por 2.'] };
    },
    lateral(lv) {
      const a = randInt(3, 10), b = randInt(2, a), c = randInt(2, 9), l = 2 * (a + b) * c;
      return { id: 'lateral', title: 'Área lateral', prompt: `Un prisma rectangular mide <b>${a} cm de largo</b>, <b>${b} cm de ancho</b> y <b>${c} cm de alto</b>. ¿Cuál es su <b>área lateral</b> (sin la base ni la tapa)?`,
        solids: prismOf(a, b, c), unit: 'cm²', answer: l, chips: dimsChips(a, b, c),
        steps: [`El perímetro de la base es 2 × (${a} + ${b}) = ${2 * (a + b)} cm.`, `Área lateral = perímetro × alto = ${2 * (a + b)} × ${c} = <b>${l} cm²</b>.`],
        hints: ['Las caras laterales son 4: dos de largo × alto y dos de ancho × alto.', `Suma ${a} + ${b} y multiplica por 2: es el perímetro de la base.`, `Multiplica el perímetro por el alto (${c}).`] };
    },
    missing(lv) {
      const a = randInt(3, 8), b = randInt(2, a), c = randInt(2, 8), t = areaTotal(a, b, c);
      return { id: 'missing', title: 'Hallar una medida', prompt: `Un prisma de <b>${a} cm de largo</b> y <b>${b} cm de ancho</b> tiene un <b>área total de ${t} cm²</b>. ¿Cuántos cm mide su <b>alto</b>?`,
        solids: [{ dims: [a, b, c], unit: 'cm', hideHeight: true }], unit: 'cm', answer: c, chips: [chip(`largo = ${a}`, a), chip(`ancho = ${b}`, b), chip(`A = ${t}`, t)],
        steps: [`2 × (${a * b} + ${a}c + ${b}c) = ${t}, así que ${a * b} + ${a + b}c = ${t / 2}.`, `${a + b}c = ${t / 2} − ${a * b} = ${t / 2 - a * b}.`, `c = ${t / 2 - a * b} ÷ ${a + b} = <b>${c} cm</b>.`],
        hints: ['Divide el área total entre 2 para quitar el factor doble.', `Resta el área de la base (${a} × ${b}) a lo que queda.`, `Lo que queda es (${a} + ${b}) × alto. Divide entre ${a + b}.`] };
    },
    row(lv) {
      const n = randInt(2, lv >= 4 ? 4 : 3), a = randInt(2, 6), faces = 4 * n + 2;
      return { id: 'row', title: 'Cubos en fila', prompt: `<b>${n} cubos iguales</b> de arista <b>${a} cm</b> se pegan en fila y forman un prisma. ¿Cuál es el <b>área total</b> del prisma?`,
        solids: [{ cells: rowCells(n), edge: a, unit: 'cm' }], unit: 'cm²', answer: faces * sq(a), chips: [chip(`arista = ${a}`, a), chip(`caras = ${faces}`, faces)],
        steps: [`Cada unión esconde 2 caras.`, `Caras visibles: ${n}×6 − 2×${n - 1} = <b>${faces}</b>.`, `Cada cara mide ${a}² = ${sq(a)} cm², así que ${faces} × ${sq(a)} = <b>${faces * sq(a)} cm²</b>.`],
        hints: ['Pulsa «Resaltar exteriores» y cuenta las caras que se ven por fuera.', `Hay ${n - 1} uniones y cada una esconde 2 caras.`, `Caras visibles = ${n}×6 − 2×${n - 1}. Luego multiplica por ${a}².`] };
    },
    paint(lv) {
      const a = randInt(3, 7), b = randInt(2, a), c = randInt(2, 6), k = pick([2, 3, 5]), t = areaTotal(a, b, c);
      return { id: 'paint', title: 'Costo de pintura', prompt: `Se pinta por fuera todo un prisma de <b>${a} × ${b} × ${c} cm</b>. Cada <b>cm²</b> de pintura cuesta <b>$${k}</b>. ¿Cuánto cuesta pintarlo?`,
        solids: prismOf(a, b, c), unit: '$', answer: t * k, chips: [...dimsChips(a, b, c), chip(`$${k} por cm²`, k)],
        steps: [`Área total = 2 × (${a * b} + ${a * c} + ${b * c}) = ${t} cm².`, `Costo = ${t} × $${k} = <b>$${t * k}</b>.`],
        hints: ['Primero calcula el área total del prisma.', `Área total = 2 × (${a}×${b} + ${a}×${c} + ${b}×${c}).`, `Multiplica el área por el precio de cada cm² ($${k}).`] };
    },
    units(lv) {
      const [a, b, c] = pick([[2, 1, 1.5], [3, 2, 1], [1.5, 1, 2], [2.5, 2, 1], [2, 2, 0.5]]), A = areaTotal(a * 10, b * 10, c * 10);
      return { id: 'units', title: 'Cambio de unidades', prompt: `Un prisma mide <b>${fmt(a)} dm de largo</b>, <b>${fmt(b)} dm de ancho</b> y <b>${fmt(c)} dm de alto</b>. ¿Cuál es su <b>área total en cm²</b>? <small>(1 dm = 10 cm)</small>`,
        solids: prismOf(a, b, c, 'dm'), unit: 'cm²', answer: A, chips: [...dimsChips(a, b, c), chip('1 dm = 10 cm', 10)],
        steps: [`Pasamos a cm: ${a * 10}, ${b * 10} y ${c * 10} cm.`, `Área total = 2 × (${a * b * 100} + ${a * c * 100} + ${b * c * 100}) = <b>${A} cm²</b>.`],
        hints: ['Primero pasa las tres medidas a centímetros: 1 dm = 10 cm.', `Quedan ${a * 10}, ${b * 10} y ${c * 10} cm.`, 'Ahora calcula el área total con esas medidas.'] };
    },
  };

  const levels = { 1: ['base', 'total'], 2: ['total', 'lateral', 'base'], 3: ['row', 'paint', 'units', 'missing', 'lateral'], 4: ['row', 'paint', 'units', 'missing', 'total'] };
  let lastId = '';
  function generate(level) {
    const lv = clamp(level, 1, 4);
    let id, tries = 0;
    do { id = pick(levels[lv]); tries++; } while (id === lastId && tries < 6);
    lastId = id;
    const ex = builders[id](lv);
    ex.level = lv;
    return ex;
  }
  function tutorial() {
    return { id: 'tutorial', level: 0, title: 'Área total del prisma', prompt: 'Un prisma rectangular mide <b>5 cm de largo</b>, <b>4 cm de ancho</b> y <b>3 cm de alto</b>. ¿Cuál es su <b>área total</b>?',
      solids: prismOf(5, 4, 3), unit: 'cm²', answer: 94, chips: dimsChips(5, 4, 3),
      steps: ['Tiene 3 pares de caras iguales: 5×4 = 20, 5×3 = 15 y 4×3 = 12.', 'Suma: 20 + 15 + 12 = 47 cm².', 'Se cuentan dos veces: 2 × 47 = <b>94 cm²</b>.'],
      hints: ['Marca las 6 caras en el visor: son 3 pares de caras iguales.', 'Calcula 5×4, 5×3 y 4×3, y súmalas.', 'Multiplica esa suma por 2.'] };
  }
  return { generate, tutorial };
})();

class SolidViewer {
  constructor(solid, { onEvent = () => {} } = {}) {
    this.solid = solid;
    this.onEvent = onEvent;
    this.rotX = -24;
    this.rotY = -32;
    this.marked = new Set();
    this.dragMoved = 0;
    this.userRotated = false;
    this.u = 1;
    this.unfolded = false;
    this.auto = true;
    this.exposed = false;
    this.raf = 0;
    this.single = !!solid.dims;
    this.el = h('div', { class: 'cv' });
    this.scene = h('div', { class: 'cv-scene' });
    this.cube = h('div', { class: 'cv-cube' });
    this.scene.append(this.cube);
    this.edgeTag = h('div', { class: 'cv-edge' }, this.edgeText());
    this.counter = h('div', { class: 'cv-count' });
    this.el.append(this.scene, this.edgeTag, this.counter);
    this.single ? this.buildBox() : this.buildCells();
    this.bindDrag();
    this.apply();
    this.updateCount();
    this.spin();
  }
  edgeText() {
    const s = this.solid;
    if (!s.dims) return `arista = ${fmt(s.edge)} ${s.unit}`;
    const [a, b, c] = s.dims;
    return `${fmt(a)} × ${fmt(b)} × ${s.hideHeight ? '?' : fmt(c)} ${s.unit}`;
  }
  face(cls, label, id) {
    const f = h('div', { class: 'cv-face ' + cls });
    f.append(h('span', { class: 'cv-tag' }, label), h('i', { class: 'cv-chk' }));
    f.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.dragMoved > 6) return;
      this.toggle(f, id || cls);
    });
    return f;
  }
  toggle(f, id) {
    const on = !this.marked.has(id);
    on ? this.marked.add(id) : this.marked.delete(id);
    f.classList.toggle('marked', on);
    Snd.tick();
    this.updateCount();
    this.onEvent('mark', this.marked.size);
  }
  updateCount() {
    this.counter.textContent = this.single ? `Caras marcadas: ${this.marked.size} / 6` : `Caras marcadas: ${this.marked.size}`;
    this.counter.classList.toggle('full', this.single && this.marked.size === 6);
  }
  buildBox() {
    const [a, b, c] = this.solid.dims, k = 120 / Math.max(a, b, c);
    const W = a * k, D = b * k, H = c * k;
    this.dimsPx = { W, D, H };
    this.cube.style.setProperty('--d', D + 'px');
    this.cube.style.setProperty('--hh', H + 'px');
    this.cube.classList.add('hinged');
    const size = (el, w, hgt, left, top) => Object.assign(el.style, { width: w + 'px', height: hgt + 'px', left: left + 'px', top: top + 'px' });
    const front = this.face('front', `${fmt(a)} × ${this.solid.hideHeight ? '?' : fmt(c)}`);
    const left = this.face('left', `${fmt(b)} × ${this.solid.hideHeight ? '?' : fmt(c)}`);
    const right = this.face('right', `${fmt(b)} × ${this.solid.hideHeight ? '?' : fmt(c)}`);
    const top = this.face('top', `${fmt(a)} × ${fmt(b)}`);
    const bottom = this.face('bottom', `${fmt(a)} × ${fmt(b)}`);
    const back = this.face('back', `${fmt(a)} × ${this.solid.hideHeight ? '?' : fmt(c)}`);
    size(front, W, H, -W / 2, -H / 2);
    size(left, D, H, -D, 0);
    size(right, D, H, W, 0);
    size(top, W, D, 0, -D);
    size(bottom, W, D, 0, H);
    size(back, W, H, 0, D);
    bottom.append(back);
    front.append(left, right, top, bottom);
    this.cube.append(front);
  }
  buildCells() {
    const cells = this.solid.cells;
    const span = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c[i])) - Math.min(...cells.map((c) => c[i])) + 1);
    const s = Math.round(clamp(150 / Math.max(...span, 1.6), 54, 104));
    this.cube.style.setProperty('--s', s + 'px');
    this.cube.classList.add('solid');
    const mn = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
    const mx = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c[i])));
    const mid = [0, 1, 2].map((i) => (mn[i] + mx[i]) / 2);
    const taken = new Set(cells.map((c) => c.join(',')));
    const dirs = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
    for (const c of cells) {
      const cell = h('div', { class: 'cv-cell' });
      cell.style.transform = `translate3d(${(c[0] - mid[0]) * s}px, ${-(c[1] - mid[1]) * s}px, ${(c[2] - mid[2]) * s}px)`;
      for (const name in dirs) {
        const d = dirs[name];
        const f = this.face('cell ' + name, '', `${c.join('')}${name}`);
        f.classList.add(taken.has([c[0] + d[0], c[1] + d[1], c[2] + d[2]].join(',')) ? 'inner' : 'outer');
        cell.append(f);
      }
      this.cube.append(cell);
    }
  }
  setExposed(on) {
    this.exposed = on;
    this.el.classList.toggle('show-exposed', on);
  }
  bindDrag() {
    let down = null;
    const sc = this.scene;
    sc.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, rx: this.rotX, ry: this.rotY };
      this.dragMoved = 0;
      this.auto = false;
      sc.setPointerCapture(e.pointerId);
    });
    sc.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      this.dragMoved = Math.max(this.dragMoved, Math.hypot(dx, dy));
      if (this.unfolded) return;
      this.rotY = down.ry + dx * 0.6;
      this.rotX = clamp(down.rx - dy * 0.6, -85, 85);
      this.apply();
      if (this.dragMoved > 40 && !this.userRotated) { this.userRotated = true; this.onEvent('rotate'); }
    });
    const up = () => { down = null; setTimeout(() => { this.dragMoved = 0; }, 30); };
    sc.addEventListener('pointerup', up);
    sc.addEventListener('pointercancel', up);
  }
  apply() {
    this.cube.style.transform = `rotateX(${this.rotX}deg) rotateY(${this.rotY}deg)`;
    this.cube.style.setProperty('--u', this.u);
  }
  spin() {
    let last = performance.now();
    const loop = (now) => {
      if (!this.el.isConnected && this.raf < 0) return;
      this.raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      if (this.auto && !this.unfolded) { this.rotY += dt * 14; this.apply(); }
    };
    this.raf = requestAnimationFrame(loop);
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = -1;
  }
  toggleUnfold() {
    if (!this.single) return;
    const { W, D, H } = this.dimsPx;
    const fit = Math.min((this.scene.clientHeight || 240) * 0.9 / (2 * (D + H)), (this.scene.clientWidth || 300) * 0.9 / (2 * D + W), 1);
    this.cube.style.setProperty('--fit', fit);
    const to = this.unfolded ? 1 : 0, from = this.u, t0 = performance.now(), dur = 1500;
    const rx0 = this.rotX, ry0 = this.rotY, rxT = to === 0 ? 0 : -24, ryT = to === 0 ? 0 : -32;
    let ry1 = ry0 % 360;
    if (ry1 > 180) ry1 -= 360;
    if (ry1 < -180) ry1 += 360;
    this.unfolded = !this.unfolded;
    this.auto = false;
    this.cube.classList.toggle('flat', this.unfolded);
    Snd.whoosh(0.9, 400, 1800, 0.06);
    const step = (now) => {
      const k = clamp((now - t0) / dur, 0, 1), e = easeInOut(k);
      this.u = lerp(from, to, e);
      this.rotX = lerp(rx0, rxT, e);
      this.rotY = lerp(ry1, ryT, e);
      this.apply();
      if (k < 1) requestAnimationFrame(step);
      else { if (this.unfolded) this.onEvent('unfold'); Snd.pop(); }
    };
    requestAnimationFrame(step);
  }
}

class Calc {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent; this.expr = ''; this.last = null; this.justEval = false; this.keys = {}; this.hist = [];
    this.el = h('div', { class: 'calc' });
    this.histEl = h('div', { class: 'calc-hist' }, h('div', { class: 'calc-empty' }, 'Aquí quedan tus cálculos, como en una hoja.'));
    this.line1 = h('div', { class: 'calc-l1' }), this.line2 = h('div', { class: 'calc-l2' }, '0');
    const screen = h('div', { class: 'calc-screen' }, this.line1, this.line2);
    const pad = h('div', { class: 'calc-pad' });
    const layout = [['C', '⌫', '(', ')'], ['7', '8', '9', '÷'], ['4', '5', '6', '×'], ['1', '2', '3', '−'], ['0', ',', 'x²', '+'], ['√', '^', 'Ans', '=']];
    for (const r of layout) for (const k of r) {
      const b = h('button', { class: 'ck ' + (/[0-9,]/.test(k) ? 'num' : k === '=' ? 'eq' : k === 'C' || k === '⌫' ? 'clr' : 'op'), 'data-k': k, type: 'button' }, k);
      b.addEventListener('click', () => { Snd.key(); this.press(k); });
      this.keys[k] = b; pad.append(b);
    }
    this.el.append(this.histEl, screen, pad); this.render();
  }
  pretty(e) { return e.replace(/\^2(?!\d)/g, '²').replace(/\./g, ',').replace(/\*/g, '×'); }
  insert(t) { if (this.justEval && /^[0-9.√(A]/.test(t)) this.expr = ''; this.justEval = false; this.expr += t; this.render(); }
  press(k) {
    if (/^[0-9]$/.test(k)) this.insert(k);
    else if (k === ',') this.insert('.');
    else if (['+', '−', '×', '÷'].includes(k)) { this.justEval = false; this.expr = this.expr.replace(/[+−×÷]$/, '') + k; if (!this.expr.replace(/[+−×÷]$/, '')) this.expr = ''; this.render(); }
    else if (k === '^') { this.justEval = false; this.expr += '^'; this.render(); }
    else if (k === 'x²') { this.justEval = false; this.expr += '^2'; this.render(); }
    else if (k === '√') this.insert('√(');
    else if (k === '(' || k === ')') this.insert(k);
    else if (k === 'Ans') { if (this.last != null) this.insert('Ans'); }
    else if (k === '⌫') { this.justEval = false; this.expr = this.expr.endsWith('Ans') ? this.expr.slice(0, -3) : this.expr.endsWith('√(') ? this.expr.slice(0, -2) : this.expr.slice(0, -1); this.render(); }
    else if (k === 'C') { this.expr = ''; this.justEval = false; this.render(); }
    else if (k === '=') this.commit();
  }
  evaluate(src) {
    if (!src) return NaN;
    const t = src.replace(/Ans/g, this.last == null ? '0' : String(this.last)).replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
    const toks = t.match(/\d+\.?\d*|\.\d+|[-+*/^()√]/g) || []; let i = 0, bad = toks.join('').length !== t.replace(/\s/g, '').length;
    const peek = () => toks[i], next = () => toks[i++];
    const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(), r = term(); v = o === '+' ? v + r : v - r; } return v; };
    const term = () => { let v = unary(); while (peek() === '*' || peek() === '/' || peek() === '(' || peek() === '√') { if (peek() === '*' || peek() === '/') { const o = next(), r = unary(); v = o === '*' ? v * r : v / r; } else v *= unary(); } return v; };
    const unary = () => { if (peek() === '-') { next(); return -unary(); } if (peek() === '+') { next(); return unary(); } return power(); };
    const power = () => { const b = primary(); if (peek() === '^') { next(); return Math.pow(b, unary()); } return b; };
    const primary = () => {
      const k = next();
      if (k === '(') { const v = expr(); if (next() !== ')') bad = true; return v; }
      if (k === '√') { if (next() !== '(') { bad = true; return NaN; } const v = expr(); if (next() !== ')') bad = true; return Math.sqrt(v); }
      if (k === undefined || !/^[\d.]/.test(k)) { bad = true; return NaN; }
      return parseFloat(k);
    };
    let v; try { v = expr(); } catch (_) { return NaN; }
    if (i < toks.length) bad = true;
    return bad || !isFinite(v) ? NaN : Math.round(v * 1e9) / 1e9;
  }
  commit() {
    if (!this.expr) return; const v = this.evaluate(this.expr);
    if (isNaN(v)) { this.line2.classList.remove('shake'); void this.line2.offsetWidth; this.line2.classList.add('shake'); Snd.fail(); return; }
    this.hist.push({ expr: this.expr, res: v }); this.last = v;
    this.histEl.querySelector('.calc-empty')?.remove();
    const row = h('div', { class: 'calc-row' }, h('span', { class: 'ce' }, this.pretty(this.expr) + ' ='), h('b', { class: 'cr', title: 'Tocar para usar' }, fmt(v)));
    row.querySelector('.cr').addEventListener('click', () => { this.insert(String(v)); });
    this.histEl.append(row); this.histEl.scrollTop = 1e6;
    this.line1.textContent = this.pretty(this.expr) + ' ='; this.expr = String(v); this.justEval = true; this.render(); Snd.pop(); this.onEvent('result', v);
  }
  render() {
    this.line2.textContent = this.expr ? this.pretty(this.expr) : '0';
    if (!this.justEval) { const v = this.evaluate(this.expr); this.line1.textContent = this.expr && !isNaN(v) && !/^\d+\.?\d*$/.test(this.expr) ? '= ' + fmt(v) : ''; }
  }
}

class Board {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent; this.strokes = []; this.cur = null; this.color = '#ffffff'; this.size = 3; this.eraser = false; this.count = 0;
    this.el = h('div', { class: 'board' });
    this.canvas = h('canvas', { class: 'board-cv' });
    const colors = ['#ffffff', '#d9a441', '#7f9db5', '#c1583f'];
    this.tools = h('div', { class: 'board-tools' });
    this.colorBtns = colors.map((c) => { const b = h('button', { class: 'bt-color', type: 'button', style: { background: c }, 'aria-label': 'Color' }); b.onclick = () => { this.color = c; this.eraser = false; this.sync(); Snd.click(); }; return b; });
    this.eraserBtn = h('button', { class: 'bt', type: 'button', onclick: () => { this.eraser = !this.eraser; this.sync(); Snd.click(); } }, '⌫ Borrador');
    this.undoBtn = h('button', { class: 'bt', type: 'button', onclick: () => { this.strokes.pop(); this.redraw(); Snd.click(); } }, 'Deshacer');
    this.clearBtn = h('button', { class: 'bt', type: 'button', onclick: () => { this.strokes = []; this.redraw(); Snd.click(); } }, 'Limpiar');
    this.tools.append(...this.colorBtns, this.eraserBtn, this.undoBtn, this.clearBtn);
    this.el.append(this.tools, h('div', { class: 'board-wrap' }, this.canvas));
    this.ctx = this.canvas.getContext('2d'); this.sync();
    const pos = (e) => { const r = this.canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    this.canvas.addEventListener('pointerdown', (e) => { this.canvas.setPointerCapture(e.pointerId); this.cur = { color: this.eraser ? null : this.color, size: this.eraser ? 18 : this.size, pts: [pos(e)] }; this.strokes.push(this.cur); this.redraw(); });
    this.canvas.addEventListener('pointermove', (e) => { if (!this.cur) return; this.cur.pts.push(pos(e)); this.redraw(); });
    const end = () => { if (this.cur && this.cur.color) { this.count++; this.onEvent('stroke', this.count); } this.cur = null; };
    this.canvas.addEventListener('pointerup', end); this.canvas.addEventListener('pointercancel', end);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.canvas);
  }
  sync() { this.colorBtns.forEach((b, i) => b.classList.toggle('on', !this.eraser && ['#ffffff', '#d9a441', '#7f9db5', '#c1583f'][i] === this.color)); this.eraserBtn.classList.toggle('on', this.eraser); }
  resize() { const r = this.canvas.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2); if (!r.width) return; this.canvas.width = Math.round(r.width * d); this.canvas.height = Math.round(r.height * d); this.redraw(); }
  redraw() {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height; c.clearRect(0, 0, W, H); c.lineCap = c.lineJoin = 'round';
    for (const s of this.strokes) {
      c.globalCompositeOperation = s.color ? 'source-over' : 'destination-out'; c.strokeStyle = s.color || '#000'; c.lineWidth = s.size * (W / 520 + 0.4);
      c.beginPath(); s.pts.forEach((p, i) => (i ? c.lineTo(p[0] * W, p[1] * H) : c.moveTo(p[0] * W, p[1] * H)));
      if (s.pts.length === 1) c.lineTo(s.pts[0][0] * W + 0.1, s.pts[0][1] * H); c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }
  destroy() { this.ro.disconnect(); }
}

const Panel = {
  root: null, ex: null, listeners: {}, refs: {}, hints: 0, attempts: 0, t0: 0, tutorial: false, open: false,
  on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
  off() { this.listeners = {}; },
  emit(name, data) { (this.listeners[name] || []).forEach((fn) => fn(data)); },

  show(ex, { tutorial = false, round = 1, streak = 0 } = {}) {
    this.ex = ex; this.tutorial = tutorial; this.hints = 0; this.attempts = 0; this.t0 = performance.now(); this.open = true;
    const R = (this.refs = {});
    const viewer = (R.viewer = new SolidViewer(ex.solids[0], { onEvent: (n, d) => this.emit(n, d) }));
    const calc = (R.calc = new Calc((n, d) => this.emit('calc' + n[0].toUpperCase() + n.slice(1), d)));
    const board = (R.board = new Board((n, d) => this.emit(n, d)));

    R.statement = h('div', { class: 'mp-statement', html: ex.prompt });
    R.hintBox = h('div', { class: 'mp-hints' });
    R.unfoldBtn = viewer.single ? h('button', { class: 'bt', type: 'button', onclick: () => { Snd.click(); viewer.toggleUnfold(); R.unfoldBtn.textContent = viewer.unfolded ? 'Plegar prisma' : 'Desplegar'; } }, 'Desplegar') : null;
    R.exposedBtn = !viewer.single ? h('button', { class: 'bt', type: 'button', onclick: () => { Snd.click(); viewer.setExposed(!viewer.exposed); R.exposedBtn.classList.toggle('on', viewer.exposed); this.emit('exposed'); } }, 'Resaltar exteriores') : null;
    R.viewerBox = h('div', { class: 'mp-viewer' }, viewer.el, h('div', { class: 'mp-vtools' }, R.unfoldBtn, R.exposedBtn, h('span', { class: 'mp-vhint' }, 'Arrastra para girar · toca una cara para marcarla')));
    R.chips = h('div', { class: 'mp-chips' }, ex.chips.map((c) => { const b = h('button', { class: 'chip', type: 'button', title: 'Tocar para usar en la calculadora' }, c.label); b.onclick = () => { calc.insert(String(c.value)); Snd.click(); b.classList.add('used'); this.emit('chip'); }; return b; }));
    const problem = h('section', { class: 'mp-sec mp-problem', 'data-sec': 'problem' }, R.statement, R.chips, R.viewerBox, R.hintBox);

    const calcSec = h('section', { class: 'mp-sec mp-calcsec', 'data-sec': 'calc' }, h('div', { class: 'mp-sectitle' }, 'Calculadora'), calc.el);
    R.calcSec = calcSec;
    const boardSec = h('section', { class: 'mp-sec mp-boardsec', 'data-sec': 'board' }, h('div', { class: 'mp-sectitle' }, 'Pizarra'), board.el);
    R.boardSec = boardSec;

    const card = (title, formula, ins) => {
      const c = h('div', { class: 'fcard' }, h('div', { class: 'ft' }, title), h('div', { class: 'ff', html: formula }));
      if (ins) {
        const b = h('button', { class: 'fb', type: 'button' }, 'usar');
        b.onclick = () => { Snd.click(); calc.insert(ins); this.showTab('calc'); };
        c.append(b);
      }
      return c;
    };
    const fsec = h('section', { class: 'mp-sec mp-formulas', 'data-sec': 'formulas' }, h('div', { class: 'mp-sectitle' }, 'Fórmulas'),
      card('Área de una cara', 'largo × ancho (o largo × alto…)', '×'),
      card('Área total del prisma', '2 × (a·b + a·c + b·c)', '2×('),
      card('Área lateral', 'perímetro de la base × alto<br><b>2 × (a + b) × c</b>', '2×('),
      card('Cubos pegados', 'cada unión esconde <b>2 caras</b><br>caras visibles = 6·n − 2·uniones'),
      card('Unidades', '1 m = 100 cm · 1 dm = 10 cm<br>1 m² = 10 000 cm²'),
      h('div', { class: 'ftip' }, 'Truco: busca los 3 pares de caras iguales, suma sus áreas y multiplica por 2.'));
    R.formulas = fsec;

    const tabs = [['problem', 'Problema'], ['calc', 'Calculadora'], ['board', 'Pizarra'], ['formulas', 'Fórmulas']];
    R.tabs = h('nav', { class: 'mp-tabs' }, tabs.map(([id, t]) => { const b = h('button', { type: 'button', 'data-tab': id, onclick: () => { Snd.click(); this.showTab(id); this.emit('tab', id); } }, t); return b; }));
    R.body = h('div', { class: 'mp-body' }, problem, calcSec, boardSec, fsec);

    R.input = h('input', { class: 'mp-input', type: 'text', inputmode: 'decimal', placeholder: 'Tu respuesta', autocomplete: 'off', enterkeyhint: 'done' });
    R.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.check(); } });
    R.input.addEventListener('input', () => this.emit('typing', R.input.value));
    R.useBtn = h('button', { class: 'bt use', type: 'button', onclick: () => { if (calc.last != null) { R.input.value = fmt(calc.last); Snd.pop(); R.input.focus(); this.emit('use'); } else Snd.fail(); } }, 'Usar resultado');
    R.hintBtn = h('button', { class: 'bt hint', type: 'button', onclick: () => this.giveHint() }, 'Pista (0/3)');
    R.checkBtn = h('button', { class: 'check', type: 'button', onclick: () => this.check() }, 'COMPROBAR');
    R.foot = h('footer', { class: 'mp-foot' }, h('div', { class: 'mp-answer' }, R.input, h('span', { class: 'mp-unit' }, ex.unit), R.useBtn), h('div', { class: 'mp-actions' }, R.hintBtn, R.checkBtn));

    const lvl = ex.level === 0 ? 'TUTORIAL' : `NIVEL ${ex.level}`;
    R.head = h('header', { class: 'mp-head' }, h('div', { class: 'mp-titles' }, h('div', { class: 'mp-t1' }, 'ÁREA DE PRISMAS'), h('div', { class: 'mp-t2' }, ex.title)), h('div', { class: 'mp-badges' }, h('span', { class: 'badge lvl' }, lvl), tutorial ? null : h('span', { class: 'badge' }, `Ronda ${round}`), !tutorial && streak > 1 ? h('span', { class: 'badge fire' }, `x${streak}`) : null));
    R.panel = h('div', { class: 'mp' }, R.head, R.tabs, R.body, R.foot);
    this.root = h('div', { class: 'mp-overlay' }, R.panel); document.body.append(this.root);
    this.showTab('problem');
    requestAnimationFrame(() => this.root.classList.add('in'));
    this._kd = (e) => {
      if (!this.open) return; e.stopImmediatePropagation();
      const inField = document.activeElement === R.input; if (inField) return;
      const m = { '+': '+', '-': '−', '*': '×', '/': '÷', '.': ',', ',': ',', '(': '(', ')': ')', '^': '^' }, k = e.key;
      if (/^[0-9]$/.test(k)) { calc.press(k); } else if (m[k]) calc.press(m[k]); else if (k === 'Enter' || k === '=') calc.press('='); else if (k === 'Backspace') calc.press('⌫'); else return; e.preventDefault();
    };
    window.addEventListener('keydown', this._kd, true);
    return new Promise((res) => { this._resolve = res; });
  },

  showTab(id) {
    const R = this.refs; this.activeTab = id; if (!R.body) return;
    $$('.mp-sec', R.body).forEach((s) => s.classList.toggle('active', s.dataset.sec === id));
    $$('button', R.tabs).forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
  },
  giveHint() {
    const R = this.refs, ex = this.ex; if (this.hints >= ex.hints.length) { Snd.fail(); return; }
    const t = ex.hints[this.hints++]; this.showTab('problem'); Snd.pop();
    R.hintBox.append(h('div', { class: 'hint-line', html: `<span>Pista ${this.hints}</span> ${t}` }));
    R.hintBtn.textContent = `Pista (${this.hints}/3)`; if (this.hints >= ex.hints.length) R.hintBtn.classList.add('off');
    this.emit('hint', this.hints);
  },
  parse(v) { const s = String(v).replace(/\s|\$/g, '').replace(',', '.'); return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN; },
  check() {
    const R = this.refs, v = this.parse(R.input.value);
    if (isNaN(v)) { R.input.classList.remove('shake'); void R.input.offsetWidth; R.input.classList.add('shake'); Snd.fail(); R.input.focus(); return; }
    this.attempts++; const ok = Math.abs(v - this.ex.answer) < 0.005; this.emit('submit', { ok, value: v });
    if (this.tutorial && !ok) { R.input.classList.remove('shake'); void R.input.offsetWidth; R.input.classList.add('shake'); Snd.fail(); this.flash('Casi. Revisa el cálculo de la calculadora e inténtalo otra vez.', 'warn'); return; }
    this.showResult(ok, v);
  },
  flash(text, kind = '') { const R = this.refs; const f = h('div', { class: 'mp-flash ' + kind }, text); R.panel.append(f); setTimeout(() => f.classList.add('out'), 2200); setTimeout(() => f.remove(), 2700); },
  async showResult(ok, value) {
    const R = this.refs, ex = this.ex, ms = performance.now() - this.t0;
    const points = ok ? Math.max(20, 100 + 20 * ex.level - 25 * this.hints) : 0;
    const box = h('div', { class: 'mp-result ' + (ok ? 'good' : 'bad') });
    const svg = ok ? '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="3"/><path d="M14 27l8 8 16-17" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="3"/><path d="M17 17l18 18M35 17L17 35" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    const ico = h('div', { class: 'res-ico', html: svg });
    const steps = h('div', { class: 'res-steps' });
    const btn = h('button', { class: 'check big', type: 'button' }, 'CONTINUAR');
    box.append(ico, h('div', { class: 'res-title' }, ok ? 'CORRECTO' : 'INCORRECTO'),
      h('div', { class: 'res-sub', html: ok ? `Tu respuesta: <b>${fmt(value)} ${ex.unit}</b>` : `Tu respuesta: <b>${fmt(value)} ${ex.unit}</b> · Correcta: <b>${fmt(ex.answer)} ${ex.unit}</b>` }),
      h('div', { class: 'res-stephead' }, 'Así se resuelve:'), steps,
      ok ? h('div', { class: 'res-pts' }, `+${points} puntos`) : h('div', { class: 'res-pts bad' }, 'Castigo en camino…'), btn);
    R.panel.append(box); requestAnimationFrame(() => box.classList.add('in')); ok ? Snd.chime() : Snd.fail(); this.emit('result', { ok });
    for (const s of ex.steps) { await sleep(520); steps.append(h('div', { class: 'res-step', html: s })); Snd.tick(); steps.scrollTop = 1e6; }
    btn.onclick = () => { Snd.click(); this.close({ correct: ok, hints: this.hints, attempts: this.attempts, ms, points }); };
    this.emit('resultReady');
  },
  close(result) {
    this.open = false; window.removeEventListener('keydown', this._kd, true);
    const root = this.root; root.classList.remove('in'); root.classList.add('out');
    this.refs.viewer && this.refs.viewer.destroy(); this.refs.board && this.refs.board.destroy();
    setTimeout(() => root.remove(), 380);
    const r = this._resolve; this._resolve = null; this.off(); this.refs = {}; r && r(result);
  },
};

const Confetti = {
  cv: null, ctx: null, parts: [], running: false,
  burst(n = 120, power = 1) {
    if (!this.cv) { this.cv = h('canvas', { class: 'mm-confetti' }); document.body.append(this.cv); this.ctx = this.cv.getContext('2d'); }
    this.cv.width = innerWidth; this.cv.height = innerHeight;
    const cols = ['#d9a441', '#6f93ad', '#c1583f', '#86a368', '#ffffff', '#8c7a9e'];
    for (let i = 0; i < n; i++) { const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), s = rand(400, 1100) * power; this.parts.push({ x: innerWidth / 2 + rand(-120, 120), y: innerHeight * 0.62, vx: Math.cos(a) * s * 0.7, vy: Math.sin(a) * s, r: rand(4, 9), c: pick(cols), rot: rand(0, 6), vr: rand(-9, 9), life: rand(1.6, 2.8) }); }
    if (!this.running) { this.running = true; let last = performance.now(); const loop = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; this.step(dt); if (this.parts.length) requestAnimationFrame(loop); else { this.running = false; this.ctx.clearRect(0, 0, this.cv.width, this.cv.height); } }; requestAnimationFrame(loop); }
  },
  step(dt) {
    const c = this.ctx; c.clearRect(0, 0, this.cv.width, this.cv.height);
    this.parts = this.parts.filter((p) => (p.life -= dt) > 0 && p.y < this.cv.height + 40);
    for (const p of this.parts) { p.vy += 1500 * dt; p.vx *= 0.992; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = Math.min(1, p.life); c.fillStyle = p.c; c.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); c.restore(); }
  },
};

const Hud = {
  el: null, r: {},
  build() {
    const r = this.r = {};
    r.icon = h('div', { class: 'mm-obj-ico' }); r.t = h('div', { class: 'mm-obj-t' }); r.s = h('div', { class: 'mm-obj-s' }); r.bar = h('i');
    r.obj = h('div', { class: 'mm-obj' }, r.icon, h('div', { class: 'mm-obj-body' }, r.t, r.s, h('div', { class: 'mm-obj-bar' }, r.bar)));
    r.boostNum = h('b'); r.boost = h('div', { class: 'mm-boost' }, h('div', { class: 'mm-boost-in' }, r.boostNum, h('small', {}, 'BOOST')));
    r.exit = h('button', { class: 'mm-btn', type: 'button', title: 'Volver al menú', onclick: () => { Snd.click(); location.href = location.pathname; } }, 'Menú');
    r.cam = h('button', { class: 'mm-btn', type: 'button', title: 'Cambiar cámara (C)', onclick: () => { Snd.click(); RS.cam.ballCam = !RS.cam.ballCam; this.sync(); } }, 'Cámara');
    r.mute = h('button', { class: 'mm-btn', type: 'button', title: 'Sonido', onclick: () => { r.mute.textContent = Snd.toggleMute() ? 'Silencio' : 'Sonido'; } }, 'Sonido');
    r.tools = h('div', { class: 'mm-tools' }, r.cam, r.mute, r.exit);
    r.marker = h('div', { class: 'mm-marker' }, h('div', { class: 'mm-marker-arrow' }), h('div', { class: 'mm-marker-txt' }));
    r.bars = h('div', { class: 'mm-bars' }, h('i'), h('i')); r.slow = h('div', { class: 'mm-slow' });
    r.toast = h('div', { class: 'mm-toast' });
    r.splash = h('div', { class: 'mm-splash' });
    r.status = h('div', { class: 'mm-status' });
    r.score = h('div', { class: 'mm-score' });
    this.el = h('div', { id: 'mm-hud' }, r.bars, r.obj, r.boost, r.tools, r.marker, r.slow, r.toast, r.splash, r.status, r.score);
    document.body.append(this.el); document.body.classList.add('mm-active'); this.sync();
  },
  sync() { if (this.r.cam) this.r.cam.classList.toggle('on', !!RS.cam.ballCam); },
  objective(icon, title, sub) { const r = this.r; r.icon.textContent = icon; r.t.textContent = title; r.s.innerHTML = sub || ''; r.obj.classList.remove('pop'); void r.obj.offsetWidth; r.obj.classList.add('pop'); r.obj.classList.remove('done'); r.obj.style.display = ''; },
  progress(p) { this.r.bar.style.transform = `scaleX(${clamp(p, 0, 1)})`; },
  done() { this.r.obj.classList.add('done'); this.progress(1); },
  boost(v, inf) { const r = this.r; r.boost.style.setProperty('--p', inf ? 100 : clamp(v, 0, 100)); r.boostNum.textContent = inf ? '∞' : Math.round(v); r.boost.classList.toggle('inf', !!inf); r.boost.classList.toggle('low', !inf && v < 15); },
  toast(msg, kind = '', ms = 2200) { const t = this.r.toast; t.className = 'mm-toast ' + kind; t.innerHTML = msg; void t.offsetWidth; t.classList.add('show'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), ms); },
  splash(small, big, ms = 1900) { const s = this.r.splash; s.innerHTML = `<div class="sp-s">${small}</div><div class="sp-b">${big}</div>`; s.classList.remove('show'); void s.offsetWidth; s.classList.add('show'); clearTimeout(this._st); this._st = setTimeout(() => s.classList.remove('show'), ms); },
  marker(x, y, z, label, color = '#6f93ad') {
    const m = this.r.marker; if (x == null) { m.style.display = 'none'; return; }
    const v = new THREE.Vector3(); U(x, y, z, v); const cam = RS.camera; v.project(cam);
    const behind = v.z > 1; let sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight; if (behind) { sx = innerWidth - sx; sy = innerHeight - sy; }
    const pad = 52, off = behind || sx < pad || sx > innerWidth - pad || sy < pad + 40 || sy > innerHeight - pad - 40;
    let rot = 0;
    if (off) { const cx = innerWidth / 2, cy = innerHeight / 2, dx = sx - cx, dy = sy - cy, k = Math.min((cx - pad) / Math.abs(dx || 1e-3), (cy - pad - 40) / Math.abs(dy || 1e-3)); sx = cx + dx * k; sy = cy + dy * k; rot = Math.atan2(dy, dx) * 180 / Math.PI + 90; }
    m.style.display = 'block'; m.style.transform = `translate(${sx}px, ${sy}px)`; m.style.setProperty('--c', color); m.classList.toggle('off', off);
    m.firstChild.style.transform = off ? `rotate(${rot}deg)` : 'rotate(180deg)'; m.lastChild.textContent = label;
  },
  destroy() { this.el && this.el.remove(); document.body.classList.remove('mm-active'); },
};

const G = {
  mode: null, slow: { target: 1, cur: 1, left: 0 }, camToggles: 0, lastCam: true, t: 0,
  car: () => RS.getState(),
  placeCar(x, y, yaw = Math.PI / 2, vx = 0, vy = 0) {
    RS.Module.setCarPose(RS.carId, x, y, 17, yaw, vx, vy, 0);
    const c = RS.cam; c.ready = false; c.hasYaw = false; c.hasLast = false;
  },
  placeBall(x, y, z = 93.15, vx = 0, vy = 0) { RS.Module.setBallState(x, y, z, vx, vy, 0); },
  boost(v) { RS.Module.setCarBoost(RS.carId, v); },
  slowmo(scale, secs, label) {
    this.slow.target = scale; this.slow.left = secs; Snd.slowIn();
    Hud.r.bars.classList.add('on'); Hud.r.slow.textContent = label || 'CÁMARA LENTA'; Hud.r.slow.classList.add('on'); document.body.classList.add('mm-slowmo');
  },
  endSlow() { this.slow.target = 1; this.slow.left = 0; Snd.slowOut(); Hud.r.bars.classList.remove('on'); Hud.r.slow.classList.remove('on'); document.body.classList.remove('mm-slowmo'); },
  frame(dt, st) {
    const g = G; g.t += dt;
    Fx.update(dt);
    const s = g.slow; s.cur += (s.target - s.cur) * Math.min(1, dt * 7); if (Math.abs(s.cur - s.target) < 0.004) s.cur = s.target; RS.sim.timeScale = s.cur;
    if (s.left > 0) { s.left -= Math.min(dt, 0.05); if (s.left <= 0) g.endSlow(); }
    if (RS.cam.ballCam !== g.lastCam) { g.lastCam = RS.cam.ballCam; g.camToggles++; Hud.sync(); }
    Hud.boost(st.boost, RS.getInfBoost());
    if (g.mode && g.mode.update) g.mode.update(dt, st);
  },
  controls(ctl, dt) { if (G.mode && G.mode.controls) G.mode.controls(ctl, dt); },
  resetBall() { if (G.mode && G.mode.resetRound) G.mode.resetRound(); else RS.Module.resetBall(); },
  start(modeObj) {
    Snd.init(); Hud.build(); Fx.init(); this.mode = modeObj;
    RS.sim.noGoal = true; RS.setInfBoost(false);
    RS.hooks.frame = this.frame; RS.hooks.controls = this.controls; RS.hooks.resetBall = this.resetBall;
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyB') e.stopImmediatePropagation(); }, true);
    modeObj.start();
  },
};

const CT = {
  accel: { name: 'Acelerar', kb: ['W'], pad: 'R2', touch: 'ACCEL', sel: '#btn-accel', act: () => RS.ctl.throttle > 0.2 },
  brake: { name: 'Frenar / reversa', kb: ['S'], pad: 'L2', touch: 'BRAKE', sel: '#btn-decel', act: () => RS.ctl.throttle < -0.2 },
  left: { name: 'Girar izq.', kb: ['A'], pad: 'Stick izq.', touch: 'Joystick izq.', sel: '#joystick-base', act: () => RS.ctl.steer > 0.25 },
  right: { name: 'Girar der.', kb: ['D'], pad: 'Stick der.', touch: 'Joystick der.', sel: '#joystick-base', act: () => RS.ctl.steer < -0.25 },
  boost: { name: 'Boost', kb: ['Shift'], pad: 'Círculo', touch: 'BOOST', sel: '#btn-boost', act: () => RS.ctl.boost },
  jump: { name: 'Saltar', kb: ['Espacio'], pad: 'X', touch: 'JUMP', sel: '#btn-jump', act: () => RS.ctl.jump },
  slide: { name: 'Powerslide', kb: ['Ctrl'], pad: 'Cuadrado', touch: 'SLIDE', sel: '#btn-powerslide', act: () => RS.ctl.handbrake },
  rollL: { name: 'Air roll izq.', kb: ['Q'], pad: 'L1', touch: 'AR L', sel: '#btn-airroll-l', act: () => RS.ctl.roll < -0.3 },
  rollR: { name: 'Air roll der.', kb: ['E'], pad: 'R1', touch: 'AR R', sel: '#btn-airroll-r', act: () => RS.ctl.roll > 0.3 },
  cam: { name: 'Cámara', kb: ['C'], pad: 'Triáng.', touch: 'CAM', sel: '#mm-hud .mm-tools button:first-child', act: () => false },
};
function ctrlRow(ids) {
  const el = h('div', { class: 'tc-row' }), items = [];
  for (const id of ids) {
    const c = CT[id];
    const caps = h('div', { class: 'tc-caps' }, c.kb.map((k) => h('kbd', { class: 'kc' + (k.length > 2 ? ' wide' : '') }, k)));
    const item = h('div', { class: 'tc-item', 'data-c': id }, caps, h('div', { class: 'tc-alt' }, h('span', {}, ' ' + c.pad), h('span', {}, ' ' + c.touch)), h('div', { class: 'tc-name' }, c.name));
    items.push({ el: item, c }); el.append(item);
  }
  el.update = () => items.forEach((i) => i.el.classList.toggle('down', !!i.c.act()));
  return el;
}
function wordsHtml(text) {
  let n = 0;
  return text.split(/(\*\*[^*]+\*\*)/).map((seg) => {
    const bold = seg.startsWith('**'), t = bold ? seg.slice(2, -2) : seg;
    return t.split(/(\s+)/).map((w) => (/^\s+$/.test(w) || !w ? w : `<span class="w${bold ? ' b' : ''}" style="animation-delay:${(n++) * 38}ms">${w}</span>`)).join('');
  }).join('');
}

const Tour = {
  el: null, target: null, raf: 0,
  show(getTarget, text, { button = null, onButton = null, skip = null } = {}) {
    this.hide(); this.getTarget = getTarget;
    const spot = h('div', { class: 'tour-spot' });
    const btns = h('div', { class: 'tour-btns' });
    if (button) { const b = h('button', { class: 'check small', type: 'button', onclick: () => { Snd.click(); onButton && onButton(); } }, button); btns.append(b); }
    if (skip) { const s = h('button', { class: 'bt', type: 'button', onclick: () => { Snd.click(); skip.fn(); } }, skip.label); btns.append(s); }
    const bubble = h('div', { class: 'tour-bubble' }, h('div', { class: 'tour-text', html: wordsHtml(text) }), btns);
    this.el = h('div', { class: 'tour' }, spot, bubble); document.body.append(this.el); this.spot = spot; this.bubble = bubble;
    const loop = () => { this.raf = requestAnimationFrame(loop); this.place(); }; loop(); Snd.step();
  },
  place() {
    if (!this.el) return; const t = this.getTarget && this.getTarget(); if (!t || !t.isConnected) return;
    const sec = t.closest && t.closest('.mp-sec'); if (sec && !sec.offsetParent && Panel.open) Panel.showTab(sec.dataset.sec);
    const r = t.getBoundingClientRect(); if (!r.width) return; const pad = 8;
    Object.assign(this.spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    const b = this.bubble, bw = b.offsetWidth, bh = b.offsetHeight; let x = clamp(r.left + r.width / 2 - bw / 2, 8, innerWidth - bw - 8), y;
    if (r.top - bh - 18 > 4) { y = r.top - bh - 18; b.classList.remove('below'); } else if (r.bottom + bh + 18 < innerHeight) { y = r.bottom + 18; b.classList.add('below'); } else { y = clamp(r.top + 12, 8, innerHeight - bh - 8); b.classList.add('below'); }
    b.style.transform = `translate(${x}px, ${y}px)`;
  },
  hide() { cancelAnimationFrame(this.raf); this.el && this.el.remove(); this.el = null; },
};

const AREA = { hx: 1500, hy: 2500 };
const T = {
  i: -1, objs: [], spawn: null, locked: false, lessonT: 0, idle: 0, arena: null, ballSpawn: null, ballCamOn: false, done: [], startT: 0, prism: null,
  keep(o) { this.objs.push(o.group || o); return o; },
  clear() { this.objs.forEach((o) => Fx.remove(o)); this.objs = []; },
  car(x, y, vx = 0, vy = 0, yaw = Math.PI / 2) { this.spawn = { x, y, vx, vy, yaw }; G.placeCar(x, y, yaw, vx, vy); },
  respawn() { const s = this.spawn; if (s) G.placeCar(s.x, s.y, s.yaw, s.vx, s.vy); },
  ball(x, y) { this.ballSpawn = x == null ? null : { x, y }; if (x == null) G.placeBall(3200, -4300); else G.placeBall(x, y); },
  dist2(p, o) { return Math.hypot(p.x - o.x, p.y - o.y); },
  start() {
    this.startT = performance.now();
    this.arena = makeArena(AREA.hx, AREA.hy); this.arena.visible = true;
    RS.cam.ballCam = false; Hud.sync(); G.placeCar(0, -2100, Math.PI / 2); this.ball(null);
    document.body.classList.add('tut-active');
    this.buildUi(); this.intro();
  },
  buildUi() {
    const r = this.ui = {};
    r.steps = h('div', { class: 'tut-steps' }, LESSONS.map((l, i) => h('div', { class: 'tut-step', title: l.name }, h('span', {}, l.icon))));
    r.coachText = h('div', { class: 'coach-text' }); r.coachName = h('div', { class: 'coach-name' }, 'Tu entrenador');
    r.skip = h('button', { class: 'bt', type: 'button', onclick: () => { Snd.click(); this.next(true); } }, 'Saltar lección');
    r.retry = h('button', { class: 'bt', type: 'button', onclick: () => { Snd.click(); this.enter(this.i); } }, 'Repetir');
    r.coach = h('div', { class: 'tut-coach' }, h('div', { class: 'coach-face' }, h('i', {}), h('i', {}), h('b', {})), h('div', { class: 'coach-body' }, r.coachName, r.coachText, h('div', { class: 'coach-btns' }, r.retry, r.skip)));
    r.ctrl = h('div', { class: 'tut-ctrl' });
    this.root = h('div', { id: 'tut-ui' }, r.steps, r.coach, r.ctrl); document.body.append(this.root);
    this.root.classList.add('hidden');
  },
  say(text) { this.ui.coachText.innerHTML = wordsHtml(text); this.ui.coach.classList.remove('talk'); void this.ui.coach.offsetWidth; this.ui.coach.classList.add('talk'); },
  setCtrls(ids) {
    const r = this.ui; r.ctrl.innerHTML = ''; $$('.tut-pulse').forEach((e) => e.classList.remove('tut-pulse')); this.ctrlRow = null;
    if (!ids || !ids.length) return; this.ctrlRow = ctrlRow(ids); r.ctrl.append(this.ctrlRow);
    ids.forEach((id) => $$(CT[id].sel).forEach((e) => e.classList.add('tut-pulse')));
  },
  intro() {
    this.lock = true; RS.sim.lockInput = true;
    const card = h('div', { class: 'tut-card intro' },
      h('div', { class: 'logo3d', html: '<svg viewBox="0 0 78 62"><path d="M8 24 L36 24 L36 54 L8 54 Z"/><path d="M8 24 L24 10 L52 10 L36 24"/><path d="M36 54 L52 40 L52 10"/><path class="d" d="M8 54 L24 40 L52 40"/><path class="d" d="M24 40 L24 10"/><path class="h" d="M8 60 L36 60 M8 57 L8 63 M36 57 L36 63"/><path class="h" d="M58 10 L58 40 M55 10 L61 10 M55 40 L61 40"/></svg>' }),
      h('div', { class: 'tc-title' }, 'ACADEMIA DEL PRISMA'), h('div', { class: 'tc-sub' }, 'Tutorial interactivo'),
      h('p', { html: 'Aprenderás a <b>conducir</b>, <b>llevar la bola</b> hasta el prisma y <b>resolver ejercicios de área de prismas</b> con todas las herramientas dentro del juego.' }),
      h('div', { class: 'tc-list' }, LESSONS.map((l) => h('span', {}, l.icon + ' ' + l.name))),
      h('div', { class: 'tc-btns' }, h('button', { class: 'check big', type: 'button', onclick: () => { Snd.init(); Snd.chime(); card.classList.add('out'); setTimeout(() => card.remove(), 400); RS.sim.lockInput = false; this.lock = false; this.root.classList.remove('hidden'); this.enter(0); } }, 'EMPEZAR'),
        h('button', { class: 'bt', type: 'button', onclick: () => { location.href = location.pathname; } }, 'Salir')));
    document.body.append(card); requestAnimationFrame(() => card.classList.add('in')); this.card = card;
    Hud.r.obj.style.display = 'none';
  },
  enter(i) {
    this.clear(); Tour.hide(); G.slow.left > 0 && G.endSlow(); RS.sim.timeScale = 1; G.slow.cur = G.slow.target = 1;
    this.i = i; this.locked = false; this.lessonT = 0; this.idle = 0; this.s = {}; G.camToggles = 0;
    const L = LESSONS[i]; RS.sim.paused = false;
    $$('.tut-step', this.ui.steps).forEach((e, k) => { e.classList.toggle('on', k === i); e.classList.toggle('done', k < i || this.done.includes(k)); });
    this.ui.skip.style.visibility = 'hidden';
    G.boost(100); this.ball(null);
    Hud.objective(L.icon, L.title, L.sub); Hud.progress(0); Hud.splash(`LECCIÓN ${i + 1} DE ${LESSONS.length}`, L.title);
    this.say(L.text); this.setCtrls(L.ctrls);
    L.enter(this); Snd.step();
  },
  next(skipped) {
    if (!skipped && !this.done.includes(this.i)) this.done.push(this.i);
    if (this.i + 1 >= LESSONS.length) return this.outro(); this.enter(this.i + 1);
  },
  completeLesson() {
    if (this.locked) return; this.locked = true; const st = RS.getState(); Hud.done();
    Snd.chime(); shock(st.carPos.x, st.carPos.y, 0x86a368, 900, 1); burst(st.carPos.x, st.carPos.y, 120, 0x86a368, 90, 26); Confetti.burst(90, 0.8);
    Hud.splash('¡MUY BIEN!', LESSONS[this.i].ok || 'LECCIÓN COMPLETADA', 1500); this.say(LESSONS[this.i].ok || '¡Lo lograste!');
    $$('.tut-step', this.ui.steps)[this.i].classList.add('done'); this.setCtrls(null);
    setTimeout(() => { if (G.mode === Tutorial) this.next(); }, 1900);
  },
  fail(msg) { Hud.toast(msg, 'warn', 2400); Snd.fail(); this.respawn(); },
  contain(st) {
    const p = st.carPos, v = st.carVel, mx = AREA.hx - 110, my = AREA.hy - 110; let x = p.x, y = p.y, vx = v.x, vy = v.y, ch = false;
    if (x > mx) { x = mx; vx = -Math.abs(vx) * 0.3; ch = true; } else if (x < -mx) { x = -mx; vx = Math.abs(vx) * 0.3; ch = true; }
    if (y > my) { y = my; vy = -Math.abs(vy) * 0.3; ch = true; } else if (y < -my) { y = -my; vy = Math.abs(vy) * 0.3; ch = true; }
    if (ch) { RS.Module.setCarState(RS.carId, x, y, p.z, vx, vy, v.z); if (!this.warnT || performance.now() - this.warnT > 2000) { this.warnT = performance.now(); Hud.toast('Límite del mapa de práctica', 'info', 1200); } }
    const b = st.ballPos;
    if (this.ballSpawn && (Math.abs(b.x) > AREA.hx + 80 || Math.abs(b.y) > AREA.hy + 80 || b.z > 1500)) { G.placeBall(this.ballSpawn.x, this.ballSpawn.y); Hud.toast('Bola recolocada', 'info', 1400); }
  },
  update(dt, st) {
    if (this.lock || this.i < 0) return;
    this.lessonT += dt; this.contain(st);
    if (this.ctrlRow) this.ctrlRow.update();
    const L = LESSONS[this.i], r = L.tick(this, dt, st);
    if (r === true) this.completeLesson(); else if (typeof r === 'number' && !this.locked) Hud.progress(r);
    if (this.lessonT > 18 && !this.locked) this.ui.skip.style.visibility = 'visible';
    if (L.marker && !this.locked) { const m = L.marker(this); Hud.marker(m[0], m[1], m[2], m[3], m[4]); } else Hud.marker(null);
  },
  outro() {
    this.lock = true; Tour.hide(); this.clear(); this.setCtrls(null); this.root.classList.add('hidden'); Hud.r.obj.style.display = 'none'; Hud.marker(null);
    Confetti.burst(240, 1.2); Snd.chime(); setTimeout(() => Snd.chime(), 500);
    const secs = Math.round((performance.now() - this.startT) / 1000);
    const card = h('div', { class: 'tut-card outro' },
      h('div', { class: 'tc-medal' }, ''), h('div', { class: 'tc-title' }, 'TUTORIAL COMPLETADO'), h('div', { class: 'tc-sub' }, `Tiempo: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} · Lecciones: ${this.done.length}/${LESSONS.length}`),
      h('div', { class: 'tc-badges' }, LESSONS.map((l, k) => h('div', { class: 'tc-badge' + (this.done.includes(k) ? ' got' : ''), style: { animationDelay: k * 90 + 'ms' } }, h('span', {}, l.icon), h('small', {}, l.name)))),
      h('p', { html: 'Ya sabes conducir, llevar la bola y resolver ejercicios. En el <b>Modo Matemáticas</b> llevarás la bola al prisma: si aciertas ganas <b>boost infinito</b>; si fallas, <b>pierdes el boost y vas más lento</b>.' }),
      h('div', { class: 'tc-btns' }, h('button', { class: 'check big', type: 'button', onclick: () => { location.href = location.pathname + '?mode=math'; } }, 'JUGAR MODO MATEMÁTICAS'),
        h('button', { class: 'bt', type: 'button', onclick: () => { location.href = location.pathname + '?mode=tutorial'; } }, 'Repetir tutorial'), h('button', { class: 'bt', type: 'button', onclick: () => { location.href = location.pathname; } }, 'Menú')));
    document.body.append(card); requestAnimationFrame(() => card.classList.add('in'));
  },
};
const Tutorial = { start: () => T.start(), update: (dt, st) => T.update(dt, st), resetRound: () => T.respawn(), controls: () => {} };

const LESSONS = [
  { icon: '01', name: 'Acelerar', title: 'ACELERA', sub: 'Llega al círculo azul', ok: 'Correcto',
    text: 'Bienvenido. Para avanzar **mantén pulsado el acelerador**. Conduce hasta el círculo azul de allí delante.', ctrls: ['accel'],
    enter(T) { T.car(0, -2100); T.s.z = T.keep(makeZone({ x: 0, y: -600, r: 300 })); },
    marker: (T) => [0, -600, 200, 'META'],
    tick(T, dt, st) { const d = T.dist2(st.carPos, T.s.z); const sp = Math.hypot(st.carVel.x, st.carVel.y); T.idle = sp < 60 ? T.idle + dt : 0; if (T.idle > 4.5) { T.idle = -3; Hud.toast('Mantén pulsado <b>W</b> / el botón ACCEL', 'info'); } return d < 300 ? true : clamp(1 - (d - 300) / 1500, 0, 0.97); } },
  { icon: '02', name: 'Girar', title: 'GIRA', sub: 'Pasa por los 3 círculos en orden', ok: 'Giro completado',
    text: 'Acelera y **gira con A / D** (o el stick izquierdo / joystick). Pasa por los tres círculos en orden: ¡el siguiente brilla!', ctrls: ['accel', 'left', 'right'],
    enter(T) { T.car(0, -2100); const P = [[-650, -1200], [650, -200], [0, 900]]; T.s.zs = P.map(([x, y], k) => T.keep(makeZone({ x, y, r: 280, text: String(k + 1) }))); T.s.n = 0; T.s.zs.forEach((z, k) => z.setColor(k === 0 ? 0x6f93ad : 0x4a5a6a)); },
    marker: (T) => { const z = T.s.zs[Math.min(T.s.n, 2)]; return [z.x, z.y, 200, String(T.s.n + 1)]; },
    tick(T, dt, st) { const z = T.s.zs[T.s.n]; if (z && T.dist2(st.carPos, z) < 280) { z.setColor(0x86a368); shock(z.x, z.y, 0x86a368, 600, 0.7); burst(z.x, z.y, 120, 0x86a368, 40, 16); Snd.step(); T.s.n++; if (T.s.n < 3) T.s.zs[T.s.n].setColor(0x6f93ad); } return T.s.n >= 3 ? true : T.s.n / 3; } },
  { icon: '03', name: 'Frenar', title: 'FRENA', sub: 'Detente dentro de la zona', ok: 'Frenada correcta',
    text: 'Vas muy rápido. **Frena con S** (o L2 / BRAKE) y detente por completo dentro de la zona naranja. ¡Frena con tiempo!', ctrls: ['brake'],
    enter(T) { T.car(0, -2300, 0, 1500); T.s.z = T.keep(makeZone({ x: 0, y: -150, r: 340, color: 0xd08a2e })); T.s.hold = 0; },
    marker: () => [0, -150, 200, 'FRENA', '#d08a2e'],
    tick(T, dt, st) { const sp = Math.hypot(st.carVel.x, st.carVel.y), d = T.dist2(st.carPos, T.s.z); if (d < 340 && sp < 120) T.s.hold += dt; else T.s.hold = Math.max(0, T.s.hold - dt); if (st.carPos.y > -150 + 800) { T.fail('¡Te pasaste! Frena antes'); T.s.hold = 0; } return T.s.hold >= 0.5 ? true : T.s.hold / 0.5 * 0.9; } },
  { icon: '04', name: 'Boost', title: 'USA EL BOOST', sub: 'Alcanza 2000 uu/s', ok: 'Boost correcto',
    text: 'Mantén **Shift** (Círculo / BOOST) para disparar el boost. Mira el medidor circular: ¡cada llama gasta boost! Llega a más de **2000 uu/s**.', ctrls: ['accel', 'boost'],
    enter(T) { T.car(0, -2300); G.boost(100); T.s.z = T.keep(makeZone({ x: 0, y: 1900, r: 330, color: 0xd08a2e })); T.s.slow = false; },
    marker: () => [0, 1900, 200, 'META', '#d08a2e'],
    tick(T, dt, st) { const sp = Math.hypot(st.carVel.x, st.carVel.y); if (RS.ctl.boost && st.boost > 0 && !T.s.slow) { T.s.slow = true; G.slowmo(0.3, 1.8, 'BOOST'); Hud.toast('¡Mira la llama! Cada llama gasta boost', 'info', 2200); } if (st.boost < 6 && sp < 1900) { G.boost(100); Hud.toast('Boost recargado', 'info', 1200); } return sp >= 2000 ? true : clamp(sp / 2000, 0, 0.97); } },
  { icon: '05', name: 'Saltar', title: 'SALTA', sub: 'Salta por encima de la barra', ok: 'Salto correcto',
    text: 'Pulsa **Espacio** (X / JUMP) para saltar. **Un toque corto salta poco; mantenlo un instante para saltar más alto.** Salta la barra naranja.', ctrls: ['accel', 'jump'],
    enter(T) {
      T.car(0, -1800, 0, 700); const w = AREA.hx * 2 * M, g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 150 * M, 80 * M), matAdd(0xb8691f, 0.2)), edge = new THREE.LineSegments(new THREE.EdgesGeometry(bar.geometry), new THREE.LineBasicMaterial({ color: 0xd9a441, toneMapped: false }));
      g.add(bar, edge); const lab = labelSprite('¡SALTA!', { size: 2, glow: '#d08a2e' }); lab.position.y = 4.5; g.add(lab); const p = U(0, -300, 75); g.position.set(p.x, p.y, p.z); T.keep(g); Fx.add(g, () => {});
      T.s.tap = false; T.s.first = false; T.s.passed = false;
    },
    marker: () => [0, -300, 120, 'SALTA', '#d08a2e'],
    tick(T, dt, st) {
      if (RS.ctl.jump && st.isOnGround && !T.s.first) { T.s.first = true; G.slowmo(0.25, 1.2, 'SALTO'); }
      if (Math.abs(st.carPos.y + 300) < 260 && st.carPos.z > 118) return true;
      if (st.carPos.y > -300 + 320) { T.fail('Mantén Espacio un instante para saltar más alto'); }
      return clamp((st.carPos.y + 1800) / 1500, 0, 0.9); } },
  { icon: '06', name: 'Doble salto', title: 'DOBLE SALTO', sub: 'Atraviesa el aro del aire', ok: 'Doble salto correcto',
    text: 'Pulsa **Espacio**, y **otra vez en el aire** para el doble salto: sube mucho más. Con una dirección (W/A/D) harás una voltereta. Atraviesa el aro.', ctrls: ['accel', 'jump'],
    enter(T) { T.car(0, -1700, 0, 900); T.s.g = T.keep(makeGate({ x: 0, y: 250, z: 340, r: 200, yaw: Math.PI / 2, color: 0x8c7a9e })); T.s.second = false; },
    marker: () => [0, 250, 380, 'AQUÍ', '#8c7a9e'],
    tick(T, dt, st) {
      if (!st.isOnGround && RS.ctl.jump && !T.s.prev && !T.s.second && T.s.lifted) { T.s.second = true; G.slowmo(0.2, 1.5, 'DOBLE SALTO'); }
      T.s.prev = RS.ctl.jump; if (!st.isOnGround && st.carPos.z > 60) T.s.lifted = true;
      const g = T.s.g, d = Math.hypot(st.carPos.x - g.x, st.carPos.y - g.y, st.carPos.z - g.z);
      if (Math.abs(st.carPos.y - g.y) < 200 && d < g.r) { if (T.s.second) return true; Hud.toast('Pulsa salto <b>otra vez en el aire</b>', 'info', 1800); }
      if (st.carPos.y > g.y + 500) T.fail('Salta, y otra vez en el aire. ¡Suelta y vuelve a pulsar!');
      return clamp((st.carPos.y + 1700) / 1900, 0, 0.9); } },
  { icon: '07', name: 'Air roll', title: 'AIR ROLL', sub: 'Gira en el aire 0,7 s', ok: 'Control en el aire',
    text: 'En el aire puedes girar el auto. Salta (mantén Espacio) y mientras vuelas **mantén Q o E** (L1 / R1, AR L / AR R) para hacer **air roll**.', ctrls: ['jump', 'rollL', 'rollR'],
    enter(T) { T.car(0, -1900, 0, 500); T.s.acc = 0; T.s.first = false; },
    tick(T, dt, st) { const air = !st.isOnGround && st.carPos.z > 60; if (air && Math.abs(RS.ctl.roll) > 0.5) { T.s.acc += dt; if (!T.s.first) { T.s.first = true; G.slowmo(0.3, 1.4, 'AIR ROLL'); } } return T.s.acc >= 0.7 ? true : T.s.acc / 0.7; } },
  { icon: '08', name: 'Powerslide', title: 'POWERSLIDE', sub: 'Derrapa 0,8 s a buena velocidad', ok: 'Derrape correcto',
    text: 'Para giros cerrados usa el **powerslide**: acelera, gira y mantén **Ctrl** (Cuadrado / SLIDE). Derrapa casi 1 segundo sin soltar.', ctrls: ['accel', 'left', 'right', 'slide'],
    enter(T) { T.car(0, -2200, 0, 1200); T.s.acc = 0; T.s.first = false; },
    tick(T, dt, st) { const sp = Math.hypot(st.carVel.x, st.carVel.y); if (RS.ctl.handbrake && st.isOnGround && sp > 600 && Math.abs(RS.ctl.steer) > 0.25) { T.s.acc += dt; if (!T.s.first) { T.s.first = true; G.slowmo(0.35, 1.4, 'POWERSLIDE'); } } if (sp < 150 && T.lessonT > 3) { T.respawn(); Hud.toast('Acelera para ganar velocidad', 'info', 1500); } return T.s.acc >= 0.8 ? true : T.s.acc / 0.8; } },
  { icon: '09', name: 'Cámara', title: 'CÁMARA', sub: 'Cambia de cámara 2 veces', ok: 'Cámara correcta',
    text: 'Pulsa **C** (Triángulo / el botón de cámara) para alternar entre la **cámara de balón** (siempre mira a la bola) y la **cámara libre** (sigue al auto). Cámbiala dos veces.', ctrls: ['cam'],
    enter(T) { T.car(0, -1500); T.ball(450, 300); T.s.lab = T.keep(labelSprite('BALÓN', { size: 1.7 })); const p = U(450, 300, 330); T.s.lab.position.set(p.x, p.y, p.z); Fx.add(T.s.lab, () => {}); },
    tick(T) { if (G.camToggles >= 2) { RS.cam.ballCam = true; Hud.sync(); return true; } return G.camToggles / 2 * 0.95; } },
  { icon: '10', name: 'Llevar la bola', title: 'LLEVA LA BOLA', sub: 'Empuja la bola hasta la zona naranja', ok: 'Bola controlada',
    text: 'Conduce hacia la bola y **empújala** hasta la zona naranja. Apunta al **centro de la bola**: con la cámara de balón siempre sabrás dónde está. Toques suaves = más control.', ctrls: ['accel', 'left', 'right', 'boost', 'cam'],
    enter(T) { RS.cam.ballCam = true; Hud.sync(); T.car(0, -1800); T.ball(0, -600); T.s.z = T.keep(makeZone({ x: 0, y: 1700, r: 400, color: 0xd08a2e })); T.s.touch = false; T.s.pv = { x: 0, y: 0 }; },
    marker: (T) => [0, 1700, 220, 'META', '#d08a2e'],
    tick(T, dt, st) {
      const bv = st.ballVel, dv = Math.hypot(bv.x - T.s.pv.x, bv.y - T.s.pv.y); T.s.pv = { x: bv.x, y: bv.y };
      if (!T.s.touch && dv > 250 && T.dist2(st.carPos, st.ballPos) < 320) { T.s.touch = true; G.slowmo(0.28, 1.6, 'CONTACTO'); Hud.toast('Golpea el <b>centro</b> de la bola para empujarla recta', 'info', 2600); burst(st.ballPos.x, st.ballPos.y, st.ballPos.z, 0xffffff, 40, 14); }
      const d = T.dist2(st.ballPos, T.s.z); return d < 340 ? true : clamp(1 - (d - 340) / 2400, 0, 0.95); } },
  { icon: '11', name: 'El prisma', title: 'EL PRISMA', sub: 'Toca el prisma con la bola', ok: 'Ejercicio resuelto',
    text: 'Este es el objetivo del modo: lleva la bola hasta el **prisma**. Cuando la **bola lo toque**, se abre un **ejercicio de área de prismas**. ¡Pruébalo!', ctrls: ['accel', 'boost'],
    enter(T) { RS.cam.ballCam = true; Hud.sync(); T.car(0, -1800); T.ball(0, -600); T.s.p = T.keep(makePrism()); T.s.p.setPos(0, 1900); T.prism = T.s.p; T.s.busy = false; },
    marker: () => [0, 1900, 900, 'PRISMA', '#d08a2e'],
    tick(T, dt, st) {
      if (T.s.busy) return 0.95; const b = st.ballPos;
      if (T.s.p.hit(b.x, b.y, b.z)) { T.s.busy = true; guidedExercise(T); }
      const d = T.dist2(b, T.s.p); return clamp(1 - d / 3000, 0, 0.9); } },
];

async function guidedExercise(T) {
  const p = T.s.p; p.flash = 1; shock(p.x, p.y, 0xd08a2e, 1100, 1); burst(p.x, p.y, 400, 0xd08a2e, 100, 28); Snd.boom();
  Hud.marker(null); T.setCtrls(null); G.slowmo(0.12, 0.9, '¡TOCASTE EL PRISMA!'); await sleep(900);
  RS.sim.paused = true; G.endSlow(); T.say('¡Se abre el ejercicio! Te voy a enseñar cada herramienta paso a paso. Haz lo que te indico.');
  const ex = Ex.tutorial(), done = Panel.show(ex, { tutorial: true });
  await sleep(700);
  const R = () => Panel.refs, once = (ev, pred) => new Promise((res) => { Panel.on(ev, (d) => { if (!pred || pred(d)) res(d); }); });
  let waiting = null;
  const stepBtn = (get, text, btn = 'Entendido') => new Promise((res) => Tour.show(get, text, { button: btn, onButton: res }));
  const stepWait = (get, text, ev, pred, skipLabel = 'Omitir este paso') => new Promise((res) => { Tour.show(get, text, { skip: { label: skipLabel, fn: res } }); Panel.on(ev, (d) => { if (!pred || pred(d)) res(); }); });
  try {
    await stepBtn(() => R().statement, 'Primero **lee el enunciado**. Aquí está el problema y los datos que necesitas.');
    await stepWait(() => R().viewerBox, '**Arrastra** el prisma con el ratón o el dedo para **girarlo** y verlo por todos lados.', 'rotate');
    await stepWait(() => R().viewer.el, '**Toca las caras** del prisma para marcarlas. Un prisma rectangular tiene **6 caras**: ¡márcalas todas!', 'mark', (n) => n >= 6);
    await stepWait(() => R().unfoldBtn, 'Pulsa **DESPLEGAR**: el prisma se abre y verás sus 6 caras planas con sus medidas. ¿Ves los **3 pares de caras iguales**?', 'unfold');
    await stepBtn(() => R().formulas, 'En **FÓRMULAS** tienes lo que necesitas: <b>Área total = 2 × (a·b + a·c + b·c)</b>.', 'Siguiente');
    await stepWait(() => R().chips, 'Toca un dato, por ejemplo **largo = 5**, para pasarlo a la calculadora.', 'chip');
    const seq = ['2', '×', '(', '2', '0', '+', '1', '5', '+', '1', '2', ')', '='], calc = () => R().calc;
    await new Promise((res) => {
      let k = 0;
      const show = () => Tour.show(() => calc().keys[seq[k]], `Las caras miden 5×4 = 20, 5×3 = 15 y 4×3 = 12. Pulsa **2 × ( 20 + 15 + 12 ) =** · ahora: <b>${seq[k]}</b>`, { skip: { label: 'Omitir este paso', fn: res } });
      calc().press('C');
      calc().justEval = false;
      calc().el.classList.add('guided');
      show();
      const poll = setInterval(() => {
        if (!Panel.open) { clearInterval(poll); return; }
        const typed = calc().expr, goal = seq.slice(0, -1).join('');
        if (!goal.startsWith(typed)) { calc().press('C'); k = 0; Hud.toast('Casi. Empecemos de nuevo', 'warn'); show(); return; }
        if (k < seq.length - 1 && typed === seq.slice(0, k + 1).join('')) { k++; show(); }
      }, 120);
      Panel.on('calcResult', (v) => { clearInterval(poll); if (Math.abs(v - 94) < 1e-9) res(); else { calc().press('C'); k = 0; Hud.toast('Casi. Empecemos de nuevo', 'warn'); show(); } });
    });
    $$('.guided', R().body || document).forEach((e) => e.classList.remove('guided'));
    await stepWait(() => R().hintBtn, '¿Atascado? Pulsa **PISTA**. Hay 3 pistas, cada una te resta algunos puntos en el modo real.', 'hint');
    await stepWait(() => R().boardSec, 'La **pizarra** reemplaza al papel: dibuja o anota con el dedo o el ratón. ¡Haz un garabato!', 'stroke');
    await stepWait(() => R().useBtn, 'Pulsa **Usar resultado** para copiar el resultado de la calculadora a tu respuesta.', 'use');
    await stepWait(() => R().checkBtn, 'Todo listo: pulsa **COMPROBAR**. (Aquí puedes equivocarte sin castigo; en el modo real, no.)', 'submit', (d) => d.ok, 'Omitir');
  } catch (e) { console.warn(e); }
  Tour.hide();
  await done;
  Tour.hide();
  Confetti.burst(160, 1);
  await explainRules(); RS.sim.paused = false; RS.keys.clear();
  T.s.busy = false; T.completeLesson();
}

function explainRules() {
  return new Promise((res) => {
    const card = h('div', { class: 'tut-card rules' }, h('div', { class: 'tc-title' }, 'RECOMPENSA Y CASTIGO'), h('div', { class: 'tc-sub' }, 'Así funciona el Modo Matemáticas'),
      h('div', { class: 'rules-grid' },
        h('div', { class: 'rule good' }, h('div', { class: 'ri' }, 'CORRECTA'), h('b', {}, 'Respuesta correcta'), h('ul', {}, h('li', {}, 'Boost infinito 20 s'), h('li', {}, 'Puntos (más con menos pistas)'), h('li', {}, 'Racha de aciertos: bonus'))),
        h('div', { class: 'rule bad' }, h('div', { class: 'ri' }, 'INCORRECTA'), h('b', {}, 'Respuesta incorrecta'), h('ul', {}, h('li', {}, 'Sin boost durante 12 s'), h('li', {}, 'Velocidad limitada'), h('li', {}, 'Pierdes la racha'))),
      ),
      h('div', { class: 'tc-btns' }, h('button', { class: 'check big', type: 'button', onclick: () => { Snd.click(); card.classList.add('out'); setTimeout(() => card.remove(), 350); res(); } }, 'ENTENDIDO')));
    document.body.append(card); requestAnimationFrame(() => card.classList.add('in'));
  });
}

const MathMode = {
  s: { score: 0, streak: 0, round: 1, correct: 0, rewardT: 0, punishT: 0, busy: false, accum: 0 },
  prism: null, start0: null, ball0: null,
  start() {
    const s = this.s; Object.assign(s, { score: 0, streak: 0, round: 1, correct: 0, rewardT: 0, punishT: 0, busy: false, accum: 0 });
    this.arena = null; this.prism = makePrism(); RS.cam.ballCam = true; Hud.sync(); document.body.classList.add('math-active');
    Hud.r.score.classList.add('on'); this.newRound(); Hud.splash('MODO MATEMÁTICAS', 'LLEVA LA BOLA AL PRISMA', 2600); Snd.step();
  },
  newRound() {
    const level = this.level(), x = Math.round(rand(-1700, 1700)), y = Math.round(rand(2900, 3800));
    this.prism.setPos(x, y); this.start0 = { x: 0, y: -2300 }; this.ball0 = { x: Math.round(rand(-500, 500)), y: -1300 };
    G.placeCar(this.start0.x, this.start0.y, Math.PI / 2); G.placeBall(this.ball0.x, this.ball0.y);
    if (this.s.punishT <= 0 && this.s.rewardT <= 0) G.boost(100);
    Hud.objective('AT', 'LLEVA LA BOLA AL PRISMA', `Ronda ${this.s.round} · Nivel ${level}`); Hud.progress(0); this.renderScore();
  },
  resetRound() { if (this.s.busy) return; G.placeCar(this.start0.x, this.start0.y, Math.PI / 2); G.placeBall(this.ball0.x, this.ball0.y); Hud.toast('Ronda reiniciada', 'info', 1200); },
  level() { return clamp(1 + Math.floor(this.s.correct / 2), 1, 4); },
  renderScore() { const s = this.s; Hud.r.score.innerHTML = `<b>${s.score}</b> <span>puntos</span> · Boost <b>${s.streak}</b> <span>racha</span> · <span>aciertos</span> <b>${s.correct}</b>`; },
  controls(ctl) { if (this.s.punishT > 0) ctl.boost = false; },
  update(dt, st) {
    const s = this.s;
    // Spectator: still show world but don't process hits / rewards
    const spec = typeof window.__mpIsSpectator === 'function' && window.__mpIsSpectator();
    if (s.busy || spec) {
      // Still update timers visually if needed
      if (s.rewardT > 0) s.rewardT -= dt;
      if (s.punishT > 0) s.punishT -= dt;
      return;
    }
    if (s.rewardT > 0) { s.rewardT -= dt; if (s.rewardT <= 0) { RS.setInfBoost(false); Hud.toast('Se acabó el boost infinito', 'info'); } }
    if (s.punishT > 0) {
      s.punishT -= dt; const v = st.carVel, sp = Math.hypot(v.x, v.y);
      if (sp > 1100) { const k = 1100 / sp; RS.Module.setCarState(RS.carId, st.carPos.x, st.carPos.y, st.carPos.z, v.x * k, v.y * k, v.z); }
      if (s.punishT <= 0) Hud.toast('Castigo terminado: boost disponible', 'good');
    }
    s.accum += dt; if (s.accum > 0.2) { s.accum = 0; this.renderStatus(); }
    const b = st.ballPos, p = this.prism, d = Math.hypot(b.x - p.x, b.y - p.y), dm = Math.round(d * M);
    Hud.progress(clamp(1 - d / 4600, 0, 0.95)); Hud.r.s.innerHTML = `Ronda ${s.round} · Nivel ${this.level()} · Distancia de la bola: <b>${dm} m</b>`;
    Hud.marker(p.x, p.y, p.sz * 0.6, 'PRISMA · ' + dm + ' m', '#d08a2e');
    if (Math.abs(b.x) > 4300 || Math.abs(b.y) > 4950 || b.z > 1900 || b.z < -100) { G.placeBall(this.ball0.x, this.ball0.y); Hud.toast('Bola fuera: recolocada', 'info', 1400); }
    if (p.hit(b.x, b.y, b.z)) this.onHit();
  },
  renderStatus() {
    const s = this.s, el = Hud.r.status; let html = '';
    if (s.rewardT > 0) html += `<div class="chip good">Boost BOOST INFINITO <b>${Math.ceil(s.rewardT)}s</b></div>`;
    if (s.punishT > 0) html += `<div class="chip bad">CASTIGO · sin boost y lento <b>${Math.ceil(s.punishT)}s</b></div>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  },
  async onHit() {
    const s = this.s, p = this.prism; s.busy = true; Hud.marker(null);
    p.flash = 1; shock(p.x, p.y, 0xd08a2e, 1100, 1); burst(p.x, p.y, 400, 0xd08a2e, 100, 28); Snd.boom();
    G.slowmo(0.12, 0.9, '¡TOCASTE EL PRISMA!'); await sleep(900); G.endSlow(); RS.sim.paused = true;
    const ex = Ex.generate(this.level()), r = await Panel.show(ex, { round: s.round, streak: s.streak });
    RS.sim.paused = false; RS.keys.clear(); this.apply(r);
  },
  apply(r) {
    const s = this.s, st = RS.getState();
    if (r.correct) {
      const pts = r.points + s.streak * 10; s.score += pts; s.streak++; s.correct++; s.rewardT = 20; s.punishT = 0; RS.setInfBoost(true); G.boost(100);
      Confetti.burst(160, 1); Snd.chime(); shock(st.carPos.x, st.carPos.y, 0x86a368, 1000, 1);
      Hud.toast(`<b>¡RECOMPENSA!</b> Boost infinito 20 s · +${pts} puntos`, 'good', 3200);
    } else {
      s.score = Math.max(0, s.score - 25); s.streak = 0; s.punishT = 12; s.rewardT = 0; RS.setInfBoost(false); G.boost(0);
      document.body.classList.add('mm-punish'); setTimeout(() => document.body.classList.remove('mm-punish'), 900); Snd.fail();
      Hud.toast('<b>CASTIGO</b> · Sin boost y velocidad limitada 12 s · −25 puntos', 'bad', 3400);
    }
    s.round++; s.busy = false; this.newRound(); this.renderStatus();
    // Report score to multiplayer if active
    if (typeof window.__mpReportScore === 'function') {
      window.__mpReportScore(s.score);
    }
  },
};

function startMode(mode) { Snd.init(); G.start(mode === 'tutorial' ? Tutorial : MathMode); }
// API global para multijugador
window.__startMathMode = startMode;
window.addEventListener('mp-start-math', () => startMode('math'));

function installMenu() {
  const menu = $('#start-menu'); if (!menu) return;
  const slot = $('#menu-modes') || menu;
  const mk = (id, label, mode) => h('button', {
    id, class: 'menu-btn', type: 'button',
    onclick: () => {
      if (mode === 'math' && window.__mpRole === 'host' && typeof window.__mpStartMathBoth === 'function') {
        window.__mpStartMathBoth();
        return;
      }
      menu.remove();
      startMode(mode);
    },
  }, h('span', {}, label));
  slot.append(mk('math-button', 'MODO MATEMÁTICAS', 'math'), mk('tutorial-button', 'TUTORIAL', 'tutorial'));
}
function waitLoaded() { return new Promise((res) => { const t = () => (window.__loaded ? res() : setTimeout(t, 120)); t(); }); }
function init() {
  RS = window.RS; THREE = RS.THREE; installMenu();
  const q = new URLSearchParams(location.search).get('mode');
  if (q === 'tutorial' || q === 'math') waitLoaded().then(() => { const m = $('#start-menu'); m && m.remove(); startMode(q); });
}
if (window.RS) init(); else window.addEventListener('rs-ready', init, { once: true });
})();
