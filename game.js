// ============================================================
//  NEON SURVIVOR 3.0 — игра на чистом JavaScript + Canvas
//  Управление: WASD / стрелки — движение
//              ПРОБЕЛ — рывок, Q — НОВА, E — замедление времени,
//              R — УЛЬТА (когда заряжена), P — пауза.
//  Стреляет сама по ближайшему врагу!
// ============================================================

const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W, H;
function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
addEventListener('resize', resize);
resize();

// ---------- Утилиты ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = 'Segoe UI, Arial, sans-serif';

// ---------- Звук (WebAudio, без файлов) ----------
let ac = null;
function initAudio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (ac && ac.state === 'suspended') ac.resume();
}
function snd(freq, dur = 0.08, type = 'square', vol = 0.04, slide = 0) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain();
  const t0 = ac.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(); o.stop(t0 + dur);
}

// ---------- Состояние игры ----------
let state = 'menu'; // menu | play | pause | levelup | over
let P, enemies, bullets, ebul, gems, parts, texts, missiles, drops, rings, bolts, debris;
let t, kills, shake, idleT = 0, bossAlive, bonus, pendingCards;
let wave, waveQ, waveAge, waveSpawnT, breakT, banner;
let slowmo = 0, hurtFlash = 0;
let cards = [], cardRects = [], cardTitle = '';
let best = 0;
try { best = +localStorage.getItem('neonBest') || 0; } catch (e) {}

// ---------- Ввод ----------
const keys = {};
let joy = null; // сенсорный джойстик
addEventListener('keydown', e => {
  initAudio();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (!keys[e.code]) onKeyPress(e.code);
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });

function onKeyPress(code) {
  if (state === 'menu' || state === 'over') {
    if (code === 'Enter' || code === 'Space') startGame();
  } else if (state === 'play') {
    if (code === 'Space') dash();
    if (code === 'KeyQ') nova();
    if (code === 'KeyE') timewarp();
    if (code === 'KeyR') ultimate();
    if (code === 'KeyP' || code === 'Escape') state = 'pause';
  } else if (state === 'pause') {
    if (code === 'KeyP' || code === 'Escape') state = 'play';
  } else if (state === 'levelup') {
    if (code === 'Digit1') pickCard(0);
    if (code === 'Digit2') pickCard(1);
    if (code === 'Digit3') pickCard(2);
  }
}

// Кнопки способностей внизу экрана (работают и мышкой, и пальцем)
function abilityRects() {
  const gap = 10, w = clamp((W - 24 - gap * 3) / 4, 56, 86), h = 62;
  const total = w * 4 + gap * 3, x0 = W / 2 - total / 2, y = H - h - 14;
  return [0, 1, 2, 3].map(i => ({ x: x0 + i * (w + gap), y, w, h }));
}

addEventListener('pointerdown', e => {
  initAudio();
  if (state === 'menu' || state === 'over') { startGame(); return; }
  if (state === 'levelup') {
    for (let i = 0; i < cardRects.length; i++) {
      const r = cardRects[i];
      if (e.clientX > r.x && e.clientX < r.x + r.w && e.clientY > r.y && e.clientY < r.y + r.h) { pickCard(i); return; }
    }
    return;
  }
  if (state === 'pause') { state = 'play'; return; }
  if (state === 'play') {
    const rs = abilityRects(), fns = [dash, nova, timewarp, ultimate];
    for (let i = 0; i < 4; i++) {
      const r = rs[i];
      if (e.clientX > r.x && e.clientX < r.x + r.w && e.clientY > r.y && e.clientY < r.y + r.h) { fns[i](); return; }
    }
    if (e.pointerType === 'touch' && !joy) joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
  }
});
addEventListener('pointermove', e => {
  if (joy && joy.id === e.pointerId) {
    joy.dx = clamp((e.clientX - joy.x0) / 60, -1, 1);
    joy.dy = clamp((e.clientY - joy.y0) / 60, -1, 1);
  }
});
addEventListener('pointerup', e => { if (joy && joy.id === e.pointerId) joy = null; });

function moveDir() {
  let x = 0, y = 0;
  if (keys.KeyA || keys.ArrowLeft) x--;
  if (keys.KeyD || keys.ArrowRight) x++;
  if (keys.KeyW || keys.ArrowUp) y--;
  if (keys.KeyS || keys.ArrowDown) y++;
  if (joy) { x = joy.dx; y = joy.dy; }
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return [x, y];
}

// ---------- Типы врагов ----------
const TYPES = {
  grunt:   { hp: 24,  spd: 88,  r: 12, col: '#ff3b6b', dmg: 10, xp: 1,  name: 'Пришелец' },
  fast:    { hp: 12,  spd: 165, r: 9,  col: '#ffd23b', dmg: 8,  xp: 1,  name: 'Оса' },
  shooter: { hp: 34,  spd: 75,  r: 13, col: '#3bb8ff', dmg: 8,  xp: 2,  name: 'Стрелок' },
  charger: { hp: 44,  spd: 70,  r: 14, col: '#4dff7a', dmg: 14, xp: 2,  name: 'Таран' },
  tank:    { hp: 110, spd: 55,  r: 21, col: '#b36bff', dmg: 18, xp: 4,  name: 'Крейсер' },
  boss:    { hp: 700, spd: 52,  r: 44, col: '#ff6a00', dmg: 28, xp: 25, name: 'Босс' }
};

// ---------- Улучшения (прокачка при новом уровне) ----------
const UPGRADES = [
  { id: 'rate',    max: 8,  name: 'Скорострельность', desc: '+25% скорость стрельбы',                icon: '⚡', apply: () => P.rate *= 1.25 },
  { id: 'dmg',     max: 10, name: 'Мощные пули',      desc: '+30% урона',                            icon: '💥', apply: () => P.dmg *= 1.3 },
  { id: 'multi',   max: 5,  name: 'Мульти-выстрел',   desc: '+1 пуля за выстрел',                    icon: '🔱', apply: () => P.bullets++ },
  { id: 'speed',   max: 5,  name: 'Турбо-ноги',       desc: '+12% скорость бега',                    icon: '👟', apply: () => P.speed *= 1.12 },
  { id: 'armor',   max: 8,  name: 'Броня',            desc: '+25 макс. HP и лечение на 50%',         icon: '🛡️', apply: () => { P.max += 25; P.hp = Math.min(P.max, P.hp + P.max * 0.5); } },
  { id: 'magnet',  max: 4,  name: 'Магнит',           desc: 'Радиус сбора ×1.6',                     icon: '🧲', apply: () => P.magnet *= 1.6 },
  { id: 'pierce',  max: 5,  name: 'Пробивание',       desc: 'Пули пробивают +1 врага',               icon: '🏹', apply: () => P.pierce++ },
  { id: 'dashcd',  max: 4,  name: 'Быстрый рывок',    desc: 'Рывок восстанавливается на 25% быстрее', icon: '🌀', apply: () => P.dashMax *= 0.75 },
  { id: 'orbs',    max: 5,  name: 'Орбитальный шар',  desc: '+1 шар вокруг тебя, бьёт врагов',       icon: '🪐', apply: () => P.orbs++ },
  { id: 'regen',   max: 5,  name: 'Регенерация',      desc: '+0.6 HP в секунду',                     icon: '💚', apply: () => P.regen += 0.6 },
  { id: 'missile', max: 4,  name: 'Ракеты',           desc: '+1 самонаводящаяся ракета каждые 1.8с', icon: '🚀', apply: () => P.missiles++ },
  { id: 'chain',   max: 4,  name: 'Цепная молния',    desc: 'Молния бьёт цепью по нескольким врагам', icon: '🌩️', apply: () => P.chain++ },
  { id: 'aura',    max: 4,  name: 'Огненная аура',    desc: 'Огонь жжёт всех рядом с тобой',         icon: '🔥', apply: () => P.aura++ },
  { id: 'shield',  max: 3,  name: 'Энергощит',        desc: 'Поглощает 1 удар, потом перезаряжается', icon: '🔰', apply: () => { P.shield = 1; P.shieldRech = Math.max(6, P.shieldRech - 3); P.shieldReady = true; } },
  { id: 'explode', max: 4,  name: 'Взрывные пули',    desc: 'Пули взрываются и бьют по площади',     icon: '💣', apply: () => P.explode++ },
  { id: 'slow',    max: 1,  name: 'Ледяные пули',     desc: 'Пули замедляют врагов',                 icon: '❄️', apply: () => P.slow = true },
  { id: 'knock',   max: 3,  name: 'Отдача',           desc: 'Пули сильно отбрасывают врагов',        icon: '🥊', apply: () => P.knock++ },
  { id: 'vamp',    max: 5,  name: 'Вампиризм',        desc: '+6% шанс лечения за убийство',          icon: '🧛', apply: () => P.lifesteal += 0.06 },
  { id: 'xp',      max: 4,  name: 'Жажда опыта',      desc: '+30% получаемого опыта',                icon: '📚', apply: () => P.xpMul += 0.3 },
  { id: 'crit',    max: 5,  name: 'Меткость',         desc: '+10% шанс крита, крит сильнее',         icon: '🎯', apply: () => { P.crit += 0.1; P.critMul += 0.25; } },
  { id: 'drone',   max: 4,  name: 'Дроны',            desc: '+1 дрон-помощник, стреляет сам',        icon: '🛸', apply: () => P.drones++ },
  { id: 'rear',    max: 1,  name: 'Задний выстрел',   desc: 'Стреляешь ещё и назад',                 icon: '↩️', apply: () => P.rear = true },
  { id: 'phoenix', max: 2,  name: 'Феникс',           desc: 'Воскрешение: вернёшься с 60% HP и взрывом', icon: '🦅', apply: () => P.revive++ },
  { id: 'novaup',  max: 4,  name: 'Усиленная нова',   desc: 'Нова [Q] сильнее, больше и быстрее',    icon: '✨', apply: () => { P.novaPow++; P.novaMax *= 0.78; } },
  { id: 'warpup',  max: 3,  name: 'Хроно-мастер',     desc: 'Замедление [E] длится дольше',          icon: '⏳', apply: () => { P.warpDur += 1.3; P.warpMax *= 0.8; } },
  { id: 'ultup',   max: 3,  name: 'Заряд ульты',      desc: 'Ульта [R] заряжается на 40% быстрее',   icon: '🔋', apply: () => P.ultRate += 0.4 },
  { id: 'berserk', max: 3,  name: 'Берсерк',          desc: 'Чем меньше HP, тем сильнее удары',      icon: '😡', apply: () => P.berserk++ },
  { id: 'thorns',  max: 3,  name: 'Шипы',             desc: 'Враги, коснувшиеся тебя, получают урон', icon: '🌵', apply: () => P.thorns++ }
];

function startGame() {
  P = {
    x: W / 2, y: H / 2, r: 14, hp: 110, max: 110, speed: 262,
    dmg: 15, rate: 3.6, cd: 0, bullets: 1, pierce: 0, magnet: 110,
    xp: 0, lvl: 1, xpNext: 4, dashT: 0, dashCd: 0, dashMax: 1.6,
    dvx: 0, dvy: 0, inv: 0, orbs: 0, regen: 0, ang: 0, lastDir: [1, 0],
    // активные способности
    novaCd: 0, novaMax: 12, novaPow: 0,
    warpCd: 0, warpMax: 20, warpT: 0, warpDur: 3.5,
    ult: 0, ultRate: 1,
    // пассивки
    crit: 0.15, critMul: 2, lifesteal: 0, xpMul: 1, berserk: 0, thorns: 0,
    missiles: 0, missileCd: 0, chain: 0, chainCd: 0, aura: 0, auraT: 0,
    shield: 0, shieldReady: false, shieldT: 0, shieldRech: 14,
    explode: 0, slow: false, knock: 0, drones: 0, droneCd: 0, rear: false, revive: 0,
    combo: 0, comboT: 0, taken: {}
  };
  enemies = []; bullets = []; ebul = []; gems = []; parts = []; texts = [];
  missiles = []; drops = []; rings = []; bolts = []; debris = [];
  t = 0; kills = 0; shake = 0; bossAlive = false; bonus = 0; pendingCards = 0;
  wave = 0; waveQ = []; waveAge = 0; waveSpawnT = 0; breakT = 2; banner = null;
  slowmo = 0; hurtFlash = 0;
  state = 'play';
  snd(300, 0.25, 'sawtooth', 0.05, 500);
}

// ---------- Эффекты ----------
function burst(x, y, col, n = 12, spd = 220, size = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rnd(spd * 0.3, spd);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.7), max: 0.7, col, size: rnd(size * 0.5, size) });
  }
}
function floatText(x, y, str, col = '#fff') {
  texts.push({ x, y, str, col, life: 0.8 });
}
function nearestEnemy(x, y, range, skip) {
  let bestE = null, bd = range;
  for (const e of enemies) {
    if (e.dead || e.born > 0 || (skip && skip.includes(e))) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; bestE = e; }
  }
  return bestE;
}

// ---------- Волны ----------
function buildWave(n) {
  const w = { grunt: 10, fast: n >= 2 ? 4 : 0, shooter: n >= 3 ? 3 : 0, charger: n >= 4 ? 3 : 0, tank: n >= 5 ? 2 : 0 };
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  const isBoss = n % 5 === 0;
  let total = Math.min(6 + n * 2, 26);
  if (isBoss) total = Math.ceil(total * 0.5);
  const q = [];
  for (let i = 0; i < total; i++) {
    let r = Math.random() * sum;
    for (const k in w) { r -= w[k]; if (r <= 0) { q.push(k); break; } }
  }
  if (isBoss) q.unshift('boss');
  return q;
}
function startWave() {
  if (wave > 0) {
    P.hp = Math.min(P.max, P.hp + P.max * 0.1);
    floatText(P.x, P.y - 50, 'ВОЛНА ПРОЙДЕНА', '#4dff9d');
    if (wave % 3 === 0) spawnDrop(W / 2 + rnd(-80, 80), H / 2 + rnd(-60, 60));
  }
  wave++;
  waveQ = buildWave(wave); waveAge = 0; waveSpawnT = 0.3; breakT = 2.5;
  const boss = wave % 5 === 0;
  banner = { str: 'ВОЛНА ' + wave, sub: boss ? '⚠ ПРИШЁЛ БОСС ⚠' : '', col: boss ? '#ff6a00' : '#4df3ff', life: 2.2, dur: 2.2 };
  snd(boss ? 90 : 400, 0.5, 'sawtooth', 0.06, boss ? 40 : 300);
}

// ---------- Спавн (враги появляются из порталов прямо на поле) ----------
function spawn(type, px, py) {
  let x = px, y = py;
  if (x === undefined) {
    for (let i = 0; i < 14; i++) {
      x = rnd(50, W - 50); y = rnd(50, H - 50);
      if (Math.hypot(x - P.x, y - P.y) > 260) break;
    }
  }
  const d = TYPES[type];
  const hpMul = 1 + (wave - 1) * 0.22;
  const e = {
    type, x, y, r: d.r, hp: d.hp * hpMul * (type === 'boss' ? 1 + wave * 0.12 : 1), max: 0,
    spd: d.spd * (1 + Math.min((wave - 1) * 0.03, 0.35)),
    dmg: d.dmg, col: d.col, xp: d.xp, hitCd: 0, flash: 0, slowT: 0, cd: 0, thornT: 0,
    rot: Math.random() * 6, shootT: rnd(1.2, 2.4), volley: 0, born: 0.6,
    strafe: Math.random() < 0.5 ? 1 : -1, cs: 'walk', ct: rnd(1, 2.2), ca: 0, raged: false
  };
  e.max = e.hp;
  enemies.push(e);
  if (type === 'boss') { bossAlive = true; snd(80, 0.8, 'sawtooth', 0.08, 40); shake = 14; }
}

// ---------- Способности ----------
function dash() {
  if (state !== 'play' || P.dashCd > 0) return;
  let [x, y] = moveDir();
  if (x === 0 && y === 0) [x, y] = P.lastDir;
  P.dvx = x * 950; P.dvy = y * 950;
  P.dashT = 0.17; P.inv = Math.max(P.inv, 0.35); P.dashCd = P.dashMax;
  burst(P.x, P.y, '#4df3ff', 14, 200, 4);
  snd(200, 0.18, 'sawtooth', 0.05, 600);
}

// НОВА: взрыв вокруг игрока — урон, отбрасывание, чистит вражеские пули
function nova(free) {
  if (state !== 'play') return;
  if (!free) { if (P.novaCd > 0) return; P.novaCd = P.novaMax; }
  const R = 270 + 35 * P.novaPow, dmg = P.dmg * (4 + 1.5 * P.novaPow);
  rings.push({ x: P.x, y: P.y, max: R, life: 0.5, dur: 0.5, col: '#4df3ff' });
  rings.push({ x: P.x, y: P.y, max: R * 0.6, life: 0.35, dur: 0.35, col: '#ffffff' });
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy) || 1;
    if (d < R + e.r) {
      hurtEnemy(e, dmg, false);
      if (!e.dead) {
        const k = (e.type === 'boss' ? 0.25 : 1) * Math.max(0, R - d) * 0.9 + 40;
        e.x += dx / d * k; e.y += dy / d * k; e.slowT = 1.5;
        if (e.type === 'charger') { e.cs = 'walk'; e.ct = 1.5; }
      }
    }
  }
  ebul = ebul.filter(b => Math.hypot(b.x - P.x, b.y - P.y) > R);
  P.inv = Math.max(P.inv, 0.5); shake = Math.max(shake, 10);
  burst(P.x, P.y, '#4df3ff', 40, 420, 4);
  snd(120, 0.5, 'sawtooth', 0.08, 300);
}

// ВРЕМЯ: все враги и их пули двигаются в 3 раза медленнее
function timewarp() {
  if (state !== 'play' || P.warpCd > 0) return;
  P.warpCd = P.warpMax; P.warpT = P.warpDur;
  rings.push({ x: P.x, y: P.y, max: 340, life: 0.6, dur: 0.6, col: '#8fb8ff' });
  snd(500, 0.5, 'sine', 0.06, -380);
}

// УЛЬТА: кольцо пробивающих лазеров + ракеты (заряжается убийствами)
function ultimate() {
  if (state !== 'play' || P.ult < 100) return;
  P.ult = 0; P.inv = Math.max(P.inv, 1.2);
  const n = 40, off = t * 2;
  for (let i = 0; i < n; i++) fireBullet(P.x, P.y, off + i * Math.PI * 2 / n, 2.5, 4);
  for (let i = 0; i < 6; i++) missiles.push({ x: P.x, y: P.y, a: i * Math.PI / 3, sp: 260, life: 3.2, tgt: null });
  rings.push({ x: P.x, y: P.y, max: 420, life: 0.7, dur: 0.7, col: '#ff7ad9' });
  rings.push({ x: P.x, y: P.y, max: 260, life: 0.5, dur: 0.5, col: '#ffffff' });
  rings.push({ x: P.x, y: P.y, max: 140, life: 0.35, dur: 0.35, col: '#ffe14d' });
  burst(P.x, P.y, '#ff7ad9', 50, 500, 5);
  shake = Math.max(shake, 16); slowmo = 0.35;
  floatText(P.x, P.y - 50, 'УЛЬТА!', '#ff7ad9');
  snd(200, 0.7, 'sawtooth', 0.09, 700);
}

function explode(x, y, r, dmg, skip) {
  rings.push({ x, y, max: r, life: 0.3, dur: 0.3, col: '#ffb347' });
  burst(x, y, '#ffb347', 10, 200, 3);
  for (const e of enemies) {
    if (e.dead || e === skip) continue;
    if (Math.hypot(e.x - x, e.y - y) < r + e.r) hurtEnemy(e, dmg, false);
  }
  snd(100 + Math.random() * 40, 0.1, 'sawtooth', 0.03, -40);
}

function bombBlast() {
  rings.push({ x: P.x, y: P.y, max: Math.max(W, H), life: 0.7, dur: 0.7, col: '#ff9d3b' });
  for (const e of enemies) if (!e.dead) hurtEnemy(e, P.dmg * 8, false);
  ebul = [];
  shake = 20;
  snd(70, 0.7, 'sawtooth', 0.09, -30);
}

// ---------- Бонусы, которые падают с врагов ----------
function spawnDrop(x, y) {
  const r = Math.random();
  drops.push({ x, y, type: r < 0.4 ? 'heart' : r < 0.65 ? 'magnet' : r < 0.8 ? 'bomb' : 'star', life: 14 });
}
function applyDrop(type) {
  if (type === 'heart') {
    P.hp = Math.min(P.max, P.hp + P.max * 0.3);
    floatText(P.x, P.y - 30, '+HP', '#ff6a9a');
    snd(600, 0.2, 'sine', 0.05, 500);
  } else if (type === 'magnet') {
    for (const g of gems) g.pull = true;
    floatText(P.x, P.y - 30, 'МАГНИТ!', '#6db3ff');
    snd(400, 0.3, 'sine', 0.05, 600);
  } else if (type === 'star') {
    P.ult = Math.min(100, P.ult + 40);
    floatText(P.x, P.y - 30, '+УЛЬТА', '#ff7ad9');
    snd(800, 0.25, 'triangle', 0.05, 500);
  } else {
    floatText(P.x, P.y - 30, 'БОМБА!', '#ffb347');
    bombBlast();
  }
}

// ---------- Урон ----------
function hurtEnemy(e, dmg, crit, quiet) {
  if (e.dead) return;
  e.hp -= dmg; e.flash = 0.08;
  if (!quiet) {
    floatText(e.x, e.y - e.r, Math.round(dmg) + (crit ? '!' : ''), crit ? '#ffe14d' : '#fff');
    burst(e.x, e.y, '#ffffff', 3, 150, 2);
  }
  if (e.hp <= 0) killEnemy(e);
  else if (!quiet) snd(180 + Math.random() * 60, 0.04, 'square', 0.02);
}
function killEnemy(e) {
  if (e.dead) return;
  e.dead = true; kills++;
  const big = e.type === 'boss';
  P.combo++; P.comboT = 2.5; bonus += Math.min(P.combo, 40);
  P.ult = Math.min(100, P.ult + (big ? 40 : 2.5) * P.ultRate);
  if (P.combo % 10 === 0) {
    P.hp = Math.min(P.max, P.hp + 2);
    floatText(P.x, P.y - 40, 'КОМБО x' + P.combo, '#ffe14d');
  }
  if (P.lifesteal && Math.random() < P.lifesteal) P.hp = Math.min(P.max, P.hp + 2);
  burst(e.x, e.y, e.col, big ? 60 : 14, big ? 400 : 240, big ? 6 : 3.5);
  rings.push({ x: e.x, y: e.y, max: e.r * (big ? 5 : 2.6), life: big ? 0.6 : 0.3, dur: big ? 0.6 : 0.3, col: e.col });
  // осколки корабля
  const nd = big ? 26 : e.type === 'tank' ? 10 : 6;
  for (let i = 0; i < nd; i++) {
    const a = Math.random() * 6.283, s = rnd(80, big ? 380 : 260);
    debris.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: Math.random() * 6, vr: rnd(-12, 12), size: rnd(3, big ? 10 : 6), col: e.col, life: rnd(0.5, 1), max: 1 });
  }
  const gn = big ? 12 : 1;
  for (let i = 0; i < gn; i++) {
    const a = Math.random() * 6.283, s = rnd(60, 200);
    gems.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, v: e.xp / gn });
  }
  const chance = big ? 1 : (e.type === 'tank' || e.type === 'shooter' || e.type === 'charger') ? 0.12 : 0.035;
  if (Math.random() < chance) {
    const n = big ? 3 : 1;
    for (let i = 0; i < n; i++) spawnDrop(e.x + (n > 1 ? rnd(-30, 30) : 0), e.y + (n > 1 ? rnd(-30, 30) : 0));
  }
  if (big) {
    bossAlive = false; shake = 20; slowmo = 0.7; P.hp = Math.min(P.max, P.hp + 40);
    pendingCards++; // награда: бесплатное улучшение
    floatText(e.x, e.y, 'БОСС ПОВЕРЖЕН!', '#ff9d3b');
    snd(120, 0.6, 'sawtooth', 0.09, -60);
  } else {
    snd(420, 0.07, 'triangle', 0.03, -250);
  }
}
// возвращает true, если удар прошёл (или был поглощён щитом)
function hurtPlayer(d) {
  if (P.inv > 0) return false;
  if (P.shield && P.shieldReady) {
    P.shieldReady = false; P.shieldT = P.shieldRech; P.inv = 0.6;
    rings.push({ x: P.x, y: P.y, max: 80, life: 0.35, dur: 0.35, col: '#4df3ff' });
    burst(P.x, P.y, '#4df3ff', 18, 260, 3);
    floatText(P.x, P.y - 30, 'ЩИТ!', '#4df3ff');
    snd(700, 0.2, 'triangle', 0.05, -300);
    return true;
  }
  P.hp -= d; P.inv = 0.3; shake = Math.max(shake, 8); hurtFlash = 0.5;
  burst(P.x, P.y, '#ff3b6b', 16, 260, 4);
  snd(110, 0.2, 'sawtooth', 0.07, -50);
  if (P.hp <= 0) {
    if (P.revive > 0) {
      P.revive--; P.hp = P.max * 0.6; P.inv = 2.5; slowmo = 0.5;
      floatText(P.x, P.y - 40, 'ФЕНИКС!', '#ff9d3b');
      nova(true);
      snd(300, 0.6, 'triangle', 0.08, 600);
    } else gameOver();
  }
  return true;
}
function gameOver() {
  state = 'over';
  const s = score();
  if (s > best) { best = s; try { localStorage.setItem('neonBest', best); } catch (e) {} }
  snd(200, 0.8, 'sawtooth', 0.08, -150);
}
function score() { return Math.floor(kills * 10 + wave * 100 + bonus); }

// ---------- Прокачка ----------
function levelUp(free) {
  if (!free) P.lvl++;
  const pool = UPGRADES.filter(u => (P.taken[u.id] || 0) < u.max).sort(() => Math.random() - 0.5);
  cards = pool.slice(0, 3);
  if (!cards.length) return;
  cardTitle = free ? 'НАГРАДА ЗА БОССА!' : 'НОВЫЙ УРОВЕНЬ!';
  state = 'levelup';
  snd(500, 0.3, 'triangle', 0.06, 700);
}
function pickCard(i) {
  const c = cards[i];
  if (!c) return;
  P.taken[c.id] = (P.taken[c.id] || 0) + 1;
  c.apply();
  state = 'play';
  rings.push({ x: P.x, y: P.y, max: 110, life: 0.5, dur: 0.5, col: '#4dff9d' });
  burst(P.x, P.y, '#4dff9d', 22, 300, 3.5);
  snd(700, 0.12, 'square', 0.04, 300);
}

// ---------- Стрельба ----------
function fireBullet(x, y, a, mul = 1, pierce = P.pierce) {
  const crit = Math.random() < P.crit;
  const bers = 1 + P.berserk * 0.5 * (1 - P.hp / P.max);
  bullets.push({
    x, y, vx: Math.cos(a) * 650, vy: Math.sin(a) * 650, life: 1.1,
    dmg: P.dmg * mul * bers * (crit ? P.critMul : 1), crit, pierce, hit: []
  });
}
function dronePos(i) {
  const a = t * 1.7 + i * Math.PI * 2 / P.drones;
  return { x: P.x + Math.cos(a) * 46, y: P.y + Math.sin(a) * 46 };
}

// ---------- Обновление ----------
function update(dt) {
  t += dt;
  shake = Math.max(0, shake - dt * 30);
  const edt = P.warpT > 0 ? dt * 0.3 : dt; // время врагов
  P.warpT -= dt; P.novaCd -= dt; P.warpCd -= dt; P.dashCd -= dt; P.inv -= dt;
  if (P.comboT > 0) { P.comboT -= dt; if (P.comboT <= 0) P.combo = 0; }
  if (P.shield && !P.shieldReady) { P.shieldT -= dt; if (P.shieldT <= 0) P.shieldReady = true; }
  if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; }

  // Движение игрока
  const [mx, my] = moveDir();
  if (mx || my) {
    P.lastDir = [mx, my];
    if (Math.random() < 0.7) parts.push({ x: P.x - mx * 16 + rnd(-3, 3), y: P.y - my * 16 + rnd(-3, 3), vx: -mx * 70, vy: -my * 70, life: 0.35, max: 0.35, col: '#4df3ff', size: 3 });
  }
  P.x += mx * P.speed * dt; P.y += my * P.speed * dt;
  if (P.dashT > 0) {
    P.dashT -= dt; P.x += P.dvx * dt; P.y += P.dvy * dt;
    parts.push({ x: P.x, y: P.y, vx: 0, vy: 0, life: 0.3, max: 0.3, col: '#4df3ff', size: 9 });
  }
  P.x = clamp(P.x, P.r, W - P.r); P.y = clamp(P.y, P.r, H - P.r);
  if (P.regen) P.hp = Math.min(P.max, P.hp + P.regen * dt);

  // Автоприцел и стрельба
  P.cd -= dt;
  const target = nearestEnemy(P.x, P.y, 650);
  if (target) P.ang = Math.atan2(target.y - P.y, target.x - P.x);
  if (target && P.cd <= 0) {
    P.cd = 1 / P.rate;
    for (let i = 0; i < P.bullets; i++) {
      fireBullet(P.x, P.y, P.ang + (i - (P.bullets - 1) / 2) * 0.16);
    }
    if (P.rear) fireBullet(P.x, P.y, P.ang + Math.PI, 0.8);
    // вспышка у ствола
    for (let i = 0; i < 3; i++) parts.push({ x: P.x + Math.cos(P.ang) * 24, y: P.y + Math.sin(P.ang) * 24, vx: Math.cos(P.ang + rnd(-0.6, 0.6)) * 220, vy: Math.sin(P.ang + rnd(-0.6, 0.6)) * 220, life: 0.15, max: 0.15, col: '#bff', size: 3 });
    snd(620, 0.05, 'square', 0.015, -300);
  }

  // Дроны-помощники
  if (P.drones) {
    P.droneCd -= dt;
    if (P.droneCd <= 0) {
      P.droneCd = 0.7;
      for (let i = 0; i < P.drones; i++) {
        const dp = dronePos(i), tg = nearestEnemy(dp.x, dp.y, 480);
        if (tg) fireBullet(dp.x, dp.y, Math.atan2(tg.y - dp.y, tg.x - dp.x), 0.55);
      }
    }
  }

  // Ракеты
  if (P.missiles) {
    P.missileCd -= dt;
    if (P.missileCd <= 0 && enemies.length) {
      P.missileCd = 1.8;
      for (let i = 0; i < P.missiles; i++) {
        missiles.push({ x: P.x, y: P.y, a: Math.random() * Math.PI * 2, sp: 200, life: 3.2, tgt: null });
      }
      snd(260, 0.12, 'sawtooth', 0.03, 300);
    }
  }
  for (const m of missiles) {
    if (!m.tgt || m.tgt.dead) m.tgt = nearestEnemy(m.x, m.y, 1400);
    if (m.tgt) {
      const want = Math.atan2(m.tgt.y - m.y, m.tgt.x - m.x);
      let diff = want - m.a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      m.a += clamp(diff, -7 * dt, 7 * dt);
    }
    m.sp = Math.min(440, m.sp + 500 * dt);
    m.x += Math.cos(m.a) * m.sp * dt; m.y += Math.sin(m.a) * m.sp * dt; m.life -= dt;
    parts.push({ x: m.x, y: m.y, vx: 0, vy: 0, life: 0.25, max: 0.25, col: '#ffb347', size: 3 });
    if (m.tgt && !m.tgt.dead && Math.hypot(m.tgt.x - m.x, m.tgt.y - m.y) < m.tgt.r + 8) {
      explode(m.x, m.y, 75, P.dmg * 3.2);
      m.life = 0;
    }
  }
  missiles = missiles.filter(m => m.life > 0);

  // Цепная молния
  if (P.chain) {
    P.chainCd -= dt;
    if (P.chainCd <= 0 && enemies.length) {
      P.chainCd = 1.3;
      const used = [], pts = [{ x: P.x, y: P.y }];
      let cur = nearestEnemy(P.x, P.y, 520, used);
      for (let i = 0; cur && i < 2 + P.chain; i++) {
        used.push(cur); pts.push({ x: cur.x, y: cur.y });
        const cx = cur.x, cy = cur.y;
        hurtEnemy(cur, P.dmg * 1.6, false);
        cur = nearestEnemy(cx, cy, 240, used);
      }
      if (pts.length > 1) { bolts.push({ pts, life: 0.2 }); snd(900, 0.1, 'sawtooth', 0.03, -500); }
    }
  }

  // Огненная аура
  if (P.aura) {
    P.auraT -= dt;
    if (P.auraT <= 0) {
      P.auraT = 0.3;
      const R = 75 + 16 * P.aura;
      for (const e of enemies) {
        if (!e.dead && Math.hypot(e.x - P.x, e.y - P.y) < R + e.r) hurtEnemy(e, P.dmg * 0.2 * P.aura, false, true);
      }
    }
  }

  // Волны: враги выходят из порталов по очереди
  if (waveQ.length) {
    waveSpawnT -= dt;
    if (waveSpawnT <= 0) { waveSpawnT = 0.45; spawn(waveQ.shift()); }
  }
  waveAge += dt;
  if (!waveQ.length && (enemies.length <= 1 || waveAge > 34)) {
    breakT -= dt;
    if (breakT <= 0) startWave();
  } else if (waveQ.length || enemies.length > 1) {
    breakT = 2.5;
  }

  // Пули игрока
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    for (const e of enemies) {
      if (e.dead || e.born > 0 || b.hit.includes(e)) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 5) {
        hurtEnemy(e, b.dmg, b.crit);
        b.hit.push(e);
        const kb = 0.012 * (1 + P.knock * 2) * (e.type === 'boss' ? 0.2 : 1);
        e.x += b.vx * kb; e.y += b.vy * kb;
        if (P.slow) e.slowT = 2;
        if (P.explode) explode(b.x, b.y, 36 + P.explode * 14, P.dmg * 0.5 * P.explode, e);
        if (b.pierce-- <= 0) { b.life = 0; break; }
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50);

  // Орбитальные шары
  if (P.orbs) {
    for (let i = 0; i < P.orbs; i++) {
      const a = t * 3.2 + i * Math.PI * 2 / P.orbs;
      const ox = P.x + Math.cos(a) * 70, oy = P.y + Math.sin(a) * 70;
      for (const e of enemies) {
        if (e.dead || e.born > 0 || e.hitCd > 0) continue;
        if (Math.hypot(e.x - ox, e.y - oy) < e.r + 10) { hurtEnemy(e, P.dmg * 1.2, false); e.hitCd = 0.35; }
      }
    }
  }

  // Враги
  for (const e of enemies) {
    if (e.dead) continue;
    e.hitCd -= dt; e.flash -= dt; e.slowT -= dt; e.cd -= dt; e.thornT -= dt;
    if (e.born > 0) { e.born -= dt; continue; } // выходит из портала
    e.rot += edt * 2;
    const dx = P.x - e.x, dy = P.y - e.y, dd = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx);
    const sp = e.spd * (e.slowT > 0 ? 0.5 : 1);

    if (e.type === 'shooter') {
      // держится на расстоянии и стреляет
      let mvx, mvy;
      if (dd > 320) { mvx = dx / dd; mvy = dy / dd; }
      else if (dd < 230) { mvx = -dx / dd; mvy = -dy / dd; }
      else { mvx = -dy / dd * e.strafe; mvy = dx / dd * e.strafe; }
      e.x = clamp(e.x + mvx * sp * edt, 20, W - 20); e.y = clamp(e.y + mvy * sp * edt, 20, H - 20);
      e.shootT -= edt;
      if (e.shootT <= 0) {
        e.shootT = 2.4;
        ebul.push({ x: e.x, y: e.y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, life: 5, dmg: 9 });
        burst(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, '#9fe0ff', 5, 140, 2.5);
        snd(330, 0.08, 'square', 0.02, -150);
      }
    } else if (e.type === 'charger') {
      // замирает, краснеет и таранит по прямой
      e.ct -= edt;
      if (e.cs === 'walk') {
        e.x += Math.cos(a) * sp * edt; e.y += Math.sin(a) * sp * edt;
        if (e.ct <= 0) { e.cs = 'wind'; e.ct = 0.75; e.ca = a; }
      } else if (e.cs === 'wind') {
        if (e.ct > 0.25) e.ca = a;
        if (e.ct <= 0) { e.cs = 'dash'; e.ct = 0.55; snd(200, 0.25, 'sawtooth', 0.04, 300); }
      } else {
        e.x += Math.cos(e.ca) * 560 * edt; e.y += Math.sin(e.ca) * 560 * edt;
        parts.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.25, max: 0.25, col: '#4dff7a', size: 6 });
        if (e.ct <= 0) { e.cs = 'walk'; e.ct = 2.2; }
      }
      e.x = clamp(e.x, -20, W + 20); e.y = clamp(e.y, -20, H + 20);
    } else {
      e.x += Math.cos(a) * sp * edt; e.y += Math.sin(a) * sp * edt;
      if (e.type === 'boss') {
        const rage = e.hp < e.max * 0.5;
        if (rage && !e.raged) {
          e.raged = true; shake = 14;
          floatText(e.x, e.y - 60, 'ЯРОСТЬ!', '#ff2b2b');
          for (let i = 0; i < 3; i++) spawn('grunt', e.x + rnd(-60, 60), e.y + rnd(-60, 60));
          snd(70, 0.6, 'sawtooth', 0.08, 30);
        }
        e.shootT -= edt;
        if (e.shootT <= 0) {
          e.shootT = rage ? 1.5 : 2;
          e.volley++;
          if (e.volley % 2) {
            const n = rage ? 16 : 12, off = Math.random() * 6;
            for (let i = 0; i < n; i++) {
              const aa = off + i * Math.PI * 2 / n;
              ebul.push({ x: e.x, y: e.y, vx: Math.cos(aa) * 150, vy: Math.sin(aa) * 150, life: 5 });
            }
          } else {
            for (let i = -2; i <= 2; i++) {
              const aa = a + i * 0.22;
              ebul.push({ x: e.x, y: e.y, vx: Math.cos(aa) * 210, vy: Math.sin(aa) * 210, life: 5 });
            }
          }
          snd(150, 0.2, 'sawtooth', 0.05, 200);
        }
      }
    }

    // касание игрока: у каждого врага свой откат, поэтому толпа бьёт сильнее
    if (Math.hypot(e.x - P.x, e.y - P.y) < e.r + P.r) {
      if (P.thorns && e.thornT <= 0) { hurtEnemy(e, P.dmg * 1.5 * P.thorns, false); e.thornT = 0.4; }
      if (!e.dead && e.cd <= 0 && hurtPlayer(e.type === 'charger' && e.cs === 'dash' ? e.dmg * 1.5 : e.dmg)) {
        e.cd = 0.6; e.x -= Math.cos(a) * 18; e.y -= Math.sin(a) * 18;
      }
    }
  }
  // Расталкивание врагов друг от друга
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
      if (d > 0 && d < m) {
        const push = (m - d) / 2 / d;
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
      }
    }
  }
  enemies = enemies.filter(e => !e.dead);
  bossAlive = enemies.some(e => e.type === 'boss');

  // Пули врагов
  for (const b of ebul) {
    b.x += b.vx * edt; b.y += b.vy * edt; b.life -= dt;
    if (Math.hypot(b.x - P.x, b.y - P.y) < P.r + 5) { if (hurtPlayer(b.dmg || 12)) b.life = 0; }
  }
  ebul = ebul.filter(b => b.life > 0 && b.x > -50 && b.x < W + 50 && b.y > -50 && b.y < H + 50);

  // Бонусы
  for (const d of drops) {
    d.life -= dt;
    if (Math.hypot(d.x - P.x, d.y - P.y) < P.r + 16) { d.life = 0; applyDrop(d.type); }
  }
  drops = drops.filter(d => d.life > 0);

  // Кристаллы опыта
  for (const g of gems) {
    if (g.vx) { g.x += g.vx * dt; g.y += g.vy * dt; g.vx *= 0.9; g.vy *= 0.9; }
    const d = Math.hypot(P.x - g.x, P.y - g.y) || 1;
    if (g.pull || d < P.magnet) {
      const s = g.pull ? 900 : 520;
      g.x += (P.x - g.x) / d * s * dt; g.y += (P.y - g.y) / d * s * dt;
    }
    if (d < P.r + 8) {
      g.got = true; P.xp += g.v * P.xpMul;
      snd(900 + Math.min(P.xp, 10) * 40, 0.05, 'sine', 0.025);
    }
  }
  gems = gems.filter(g => !g.got);

  // Новый уровень или награда за босса
  if (state === 'play' && P.xp >= P.xpNext) {
    P.xp -= P.xpNext; P.xpNext = Math.floor(P.xpNext * 1.22 + 2);
    levelUp(false);
  } else if (state === 'play' && pendingCards > 0) {
    pendingCards--;
    levelUp(true);
  }

  // Частицы, осколки, кольца, молнии, тексты
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  for (const d of debris) { d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.95; d.vy *= 0.95; d.rot += d.vr * dt; d.life -= dt; }
  debris = debris.filter(d => d.life > 0);
  for (const r of rings) r.life -= dt;
  rings = rings.filter(r => r.life > 0);
  for (const b of bolts) b.life -= dt;
  bolts = bolts.filter(b => b.life > 0);
  for (const tx of texts) { tx.y -= 40 * dt; tx.life -= dt; }
  texts = texts.filter(tx => tx.life > 0);
}

// ---------- Отрисовка ----------
function poly(x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i * Math.PI * 2 / n;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function text(str, x, y, size, col = '#fff', align = 'center', glow = null) {
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 20; }
  ctx.fillStyle = col; ctx.fillText(str, x, y);
  ctx.shadowBlur = 0;
}

// ---------- Звёзды и туманности ----------
const stars = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random(), s: rnd(0.6, 2.2), v: rnd(8, 40) }));
const nebulas = [
  { x: 0.2, y: 0.3, r: 0.55, c: '110,50,220', v: 0.02 },
  { x: 0.8, y: 0.7, r: 0.6,  c: '30,130,220', v: 0.015 },
  { x: 0.5, y: 0.95, r: 0.5, c: '220,50,150', v: 0.025 }
];

function drawBackground() {
  ctx.fillStyle = '#06060f'; ctx.fillRect(0, 0, W, H);
  const tm = state === 'play' ? t : idleT;
  for (const n of nebulas) {
    const nx = (n.x + Math.sin(tm * n.v * 3 + n.x * 9) * 0.07) * W, ny = (n.y + Math.cos(tm * n.v * 3 + n.y * 7) * 0.07) * H;
    const rr = n.r * Math.max(W, H);
    const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, rr);
    g.addColorStop(0, `rgba(${n.c},0.16)`); g.addColorStop(1, `rgba(${n.c},0)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  for (const s of stars) {
    ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(tm * s.s + s.x * 20));
    ctx.fillStyle = '#cfe3ff';
    ctx.fillRect(s.x * W, (s.y * H + tm * s.v) % H, s.s, s.s);
  }
  ctx.globalAlpha = 1;
  const pulse = 0.5 + 0.5 * Math.sin(tm * 2);
  ctx.strokeStyle = `rgba(80,60,255,${0.08 + pulse * 0.05})`;
  ctx.lineWidth = 1;
  const s = 50;
  ctx.beginPath();
  for (let x = 0; x < W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y < H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ---------- Истребитель игрока ----------
function drawShip(x, y, ang) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  // огонь двигателя
  const fl = 14 + Math.random() * 10;
  const fg = ctx.createLinearGradient(-12, 0, -12 - fl, 0);
  fg.addColorStop(0, '#fff'); fg.addColorStop(0.35, '#4df3ff'); fg.addColorStop(1, 'rgba(77,243,255,0)');
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.moveTo(-11, -5); ctx.lineTo(-12 - fl, 0); ctx.lineTo(-11, 5); ctx.closePath(); ctx.fill();
  ctx.shadowColor = '#4df3ff'; ctx.shadowBlur = 22;
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#4df3ff';
  // крылья
  ctx.fillStyle = '#1b4a8a';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(8, s * 3); ctx.lineTo(-8, s * 22); ctx.lineTo(-17, s * 20); ctx.lineTo(-9, s * 4);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // корпус
  ctx.fillStyle = '#e4f8ff';
  ctx.beginPath();
  ctx.moveTo(24, 0); ctx.lineTo(6, -6); ctx.lineTo(-14, -5); ctx.lineTo(-14, 5); ctx.lineTo(6, 6);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // пушки на крыльях
  ctx.shadowBlur = 0; ctx.fillStyle = '#ff3b9d';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(-10, s * 19, 2.6, 0, 7); ctx.fill(); }
  // кабина
  ctx.fillStyle = '#ff3b9d';
  ctx.beginPath(); ctx.ellipse(5, 0, 7, 3.2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(7, -1, 2.5, 1, 0, 0, 7); ctx.fill();
  ctx.restore();
}

// ---------- Лазер игрока ----------
function drawLaser(b) {
  const a = Math.atan2(b.vy, b.vx);
  const len = b.crit ? 28 : 21, w = b.crit ? 5 : 3.5;
  const col = b.crit ? '#ffe14d' : '#4df3ff';
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
  ctx.shadowColor = col; ctx.shadowBlur = 16;
  const g = ctx.createLinearGradient(-len, 0, 7, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, -w); ctx.lineTo(8, 0); ctx.lineTo(0, w); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(1, 0, 5, w * 0.4, 0, 0, 7); ctx.fill();
  ctx.restore();
}

// ---------- Плазма врагов ----------
function drawPlasma(b) {
  const p = 1 + 0.2 * Math.sin(t * 20 + b.x * 0.05);
  ctx.save(); ctx.translate(b.x, b.y);
  ctx.shadowColor = '#ff6a00'; ctx.shadowBlur = 16;
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 8 * p);
  g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#ffb347'); g.addColorStop(1, 'rgba(255,60,0,0.2)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 8 * p, 0, 7); ctx.fill();
  ctx.restore();
}

// ---------- Орбитальный энергошар ----------
function drawOrb(x, y) {
  ctx.save(); ctx.translate(x, y);
  ctx.shadowColor = '#c04dff'; ctx.shadowBlur = 24;
  const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 11);
  g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#d27bff'); g.addColorStop(1, '#7a1fd1');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = '#f0c8ff'; ctx.lineWidth = 1.5;
  ctx.rotate(t * 6); ctx.beginPath(); ctx.ellipse(0, 0, 16, 5, 0, 0, 7); ctx.stroke();
  ctx.restore();
}

// ---------- Ракета ----------
function drawMissile(m) {
  ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a);
  ctx.shadowColor = '#ff9d3b'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#ffb347';
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-17 - Math.random() * 6, 0); ctx.lineTo(-9, 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8eef8';
  ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(4, -3.5); ctx.lineTo(-9, -3.5); ctx.lineTo(-9, 3.5); ctx.lineTo(4, 3.5); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#ff3b6b';
  ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(5, -3.5); ctx.lineTo(5, 3.5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- Дрон ----------
function drawDrone(x, y, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.shadowColor = '#8ff7ff'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#8ff7ff';
  ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#12307a';
  ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill();
  ctx.restore();
}

// ---------- Бонус с врага ----------
function drawDrop(d) {
  const bob = Math.sin(t * 5 + d.x) * 3;
  const col = d.type === 'heart' ? '#ff4d7a' : d.type === 'magnet' ? '#4d9bff' : d.type === 'star' ? '#ff7ad9' : '#ff9d3b';
  const em = d.type === 'heart' ? '❤️' : d.type === 'magnet' ? '🧲' : d.type === 'star' ? '⭐' : '💣';
  ctx.globalAlpha = d.life < 3 && Math.floor(d.life * 8) % 2 ? 0.3 : 1;
  ctx.shadowColor = col; ctx.shadowBlur = 20;
  ctx.fillStyle = col + '55'; ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(d.x, d.y + bob, 15, 0, 7); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  text(em, d.x, d.y + bob + 1, 16);
  ctx.globalAlpha = 1;
}

// ---------- Захватчики ----------
function drawEnemy(e) {
  const c = e.flash > 0 ? '#fff' : e.col;
  const r = e.r;
  const toP = Math.atan2(P.y - e.y, P.x - e.x);
  ctx.save(); ctx.translate(e.x, e.y);
  if (e.born > 0) {
    // выходит из портала: растёт и проявляется
    const s = 1 - e.born / 0.6;
    ctx.globalAlpha = s;
    ctx.scale(0.3 + 0.7 * s, 0.3 + 0.7 * s);
  }
  ctx.shadowColor = e.slowT > 0 ? '#8fd8ff' : e.col; ctx.shadowBlur = 18;

  if (e.type === 'grunt') {
    // пришелец-инопланетянин с антеннами
    const bob = Math.sin(e.rot * 2) * 2, leg = Math.sin(e.rot * 3) * 3;
    ctx.translate(0, bob);
    ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -r * 0.1, r, Math.PI, 0);
    ctx.lineTo(r * 1.15, r * 0.45); ctx.lineTo(-r * 1.15, r * 0.45); ctx.closePath(); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * r * 0.55, r * 0.45); ctx.lineTo(s * r * 0.85 + leg * s, r * 1.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * r * 0.4, -r * 0.9); ctx.lineTo(s * r * 0.7, -r * 1.4); ctx.stroke();
      ctx.beginPath(); ctx.arc(s * r * 0.7, -r * 1.4, 2.5, 0, 7); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#14001c';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * 0.38, -r * 0.2, r * 0.2, r * 0.28, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#fff';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * 0.38 + Math.cos(toP) * 2, -r * 0.2 + Math.sin(toP) * 2, r * 0.09, 0, 7); ctx.fill(); }

  } else if (e.type === 'fast') {
    // острый истребитель-оса
    ctx.rotate(toP);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r * 0.6, -r * 1.2); ctx.lineTo(-r * 0.2, 0); ctx.lineTo(-r * 0.6, r * 1.2); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#3a2a00';
    ctx.beginPath(); ctx.moveTo(r * 0.6, 0); ctx.lineTo(-r * 0.1, -r * 0.35); ctx.lineTo(-r * 0.1, r * 0.35); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 0.14, 0, 7); ctx.fill();

  } else if (e.type === 'shooter') {
    // турель-стрелок с пушкой, которая целится в тебя
    const bob = Math.sin(e.rot * 2) * 2;
    ctx.translate(0, bob);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, 7); ctx.stroke();
    ctx.save(); ctx.rotate(toP);
    ctx.fillStyle = e.flash > 0 ? '#fff' : '#9fe0ff'; ctx.fillRect(r * 0.4, -3, r * 0.95, 6);
    ctx.restore();
    ctx.fillStyle = '#001a33'; ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, 7); ctx.fill();
    ctx.fillStyle = '#3bb8ff'; ctx.beginPath(); ctx.arc(Math.cos(toP) * r * 0.12, Math.sin(toP) * r * 0.12, r * 0.2, 0, 7); ctx.fill();
    if (e.shootT < 0.5) { // заряд перед выстрелом
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#9fe0ff'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(Math.cos(toP) * r * 1.4, Math.sin(toP) * r * 1.4, 2 + (0.5 - e.shootT) * 8, 0, 7); ctx.fill();
    }

  } else if (e.type === 'charger') {
    // таран: замирает, краснеет и пробивает по прямой
    const ang = e.cs === 'walk' ? toP : e.ca;
    ctx.rotate(ang);
    const wind = e.cs === 'wind', dash = e.cs === 'dash';
    if (dash) {
      ctx.fillStyle = 'rgba(120,255,160,0.55)';
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.5); ctx.lineTo(-r * 2.6, 0); ctx.lineTo(-r, r * 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = wind && Math.floor(t * 20) % 2 ? '#fff' : c;
    ctx.beginPath();
    ctx.moveTo(r * 1.5, 0); ctx.lineTo(r * 0.3, -r * 0.9); ctx.lineTo(-r, -r * 0.7); ctx.lineTo(-r * 0.7, 0); ctx.lineTo(-r, r * 0.7); ctx.lineTo(r * 0.3, r * 0.9);
    ctx.closePath(); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-r * 0.6, s * r * 0.75); ctx.lineTo(-r * 1.4, s * r * 1.05); ctx.lineTo(-r * 0.9, s * r * 0.4); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.fillStyle = '#002a10';
    ctx.beginPath(); ctx.moveTo(r * 0.9, 0); ctx.lineTo(r * 0.1, -r * 0.35); ctx.lineTo(r * 0.1, r * 0.35); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wind || dash ? '#ff2b2b' : '#fff';
    ctx.beginPath(); ctx.arc(r * 0.3, 0, r * 0.13, 0, 7); ctx.fill();

  } else if (e.type === 'tank') {
    // бронированный крейсер с шипами и ядром
    ctx.fillStyle = c;
    for (let i = 0; i < 6; i++) {
      const a = e.rot * 0.3 + i * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.2) * r, Math.sin(a - 0.2) * r);
      ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
      ctx.lineTo(Math.cos(a + 0.2) * r, Math.sin(a + 0.2) * r);
      ctx.closePath(); ctx.fill();
    }
    poly(0, 0, r, 6, e.rot * 0.3); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(10,0,30,0.6)'; poly(0, 0, r * 0.72, 6, -e.rot * 0.3); ctx.fill();
    ctx.fillStyle = e.flash > 0 ? '#fff' : '#ffb3ff';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.3 * (1 + 0.15 * Math.sin(e.rot * 5)), 0, 7); ctx.fill();

  } else {
    // БОСС: огромный корабль-матка с глазом
    const rage = e.raged;
    ctx.fillStyle = rage && !e.flash ? '#ff3b2b' : c;
    for (let i = 0; i < 8; i++) {
      const a = e.rot * 0.2 + i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.14) * r, Math.sin(a - 0.14) * r);
      ctx.lineTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
      ctx.lineTo(Math.cos(a + 0.14) * r, Math.sin(a + 0.14) * r);
      ctx.closePath(); ctx.fill();
    }
    poly(0, 0, r, 8, e.rot * 0.2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#2a1000'; poly(0, 0, r * 0.78, 8, -e.rot * 0.2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = e.rot * 0.2 + i * Math.PI / 4 + Math.PI / 8;
      ctx.fillStyle = (i + Math.floor(e.rot * 3)) % 2 ? '#ffe14d' : '#ff3b6b';
      ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.89, Math.sin(a) * r * 0.89, 3.5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = e.flash > 0 ? '#ffd0d0' : '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, 7); ctx.fill();
    const ex = Math.cos(toP) * r * 0.13, ey = Math.sin(toP) * r * 0.13;
    ctx.fillStyle = '#ff1744'; ctx.beginPath(); ctx.arc(ex, ey, r * 0.23, 0, 7); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ex, ey, r * 0.1, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawWorld() {
  // огненная аура
  if (P.aura) {
    const R = 75 + 16 * P.aura, pu = 0.5 + 0.5 * Math.sin(t * 6);
    const g = ctx.createRadialGradient(P.x, P.y, R * 0.3, P.x, P.y, R);
    g.addColorStop(0, 'rgba(255,120,30,0)'); g.addColorStop(1, `rgba(255,100,20,${0.25 + 0.12 * pu})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, R, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,170,60,0.6)'; ctx.lineWidth = 2; ctx.stroke();
  }

  // порталы появления врагов
  for (const e of enemies) {
    if (e.born > 0) {
      const s = 1 - e.born / 0.6;
      ctx.strokeStyle = e.col; ctx.globalAlpha = 1 - s * 0.5; ctx.lineWidth = 3;
      ctx.shadowColor = e.col; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (2.6 - 1.4 * s), 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1.6 - 0.6 * s), 0, 7); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    // предупреждение о таране
    if (e.type === 'charger' && e.cs === 'wind') {
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = `rgba(77,255,122,${0.35 + 0.35 * Math.sin(t * 30)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.ca) * 420, e.y + Math.sin(e.ca) * 420); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // кристаллы
  for (const g of gems) {
    ctx.shadowColor = '#4dff9d'; ctx.shadowBlur = 12; ctx.fillStyle = '#4dff9d';
    poly(g.x, g.y, 6, 4, t * 3); ctx.fill();
  }
  ctx.shadowBlur = 0;

  // бонусы
  for (const d of drops) drawDrop(d);

  // орбитальные шары
  for (let i = 0; i < P.orbs; i++) {
    const a = t * 3.2 + i * Math.PI * 2 / P.orbs;
    drawOrb(P.x + Math.cos(a) * 70, P.y + Math.sin(a) * 70);
  }

  // пули игрока и ракеты
  for (const b of bullets) drawLaser(b);
  for (const m of missiles) drawMissile(m);

  // враги
  for (const e of enemies) {
    drawEnemy(e);
    if (e.born <= 0 && (e.type === 'tank' || e.type === 'boss')) {
      const w = e.r * 2;
      ctx.fillStyle = '#000a'; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w, 5);
      ctx.fillStyle = e.col; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * Math.max(0, e.hp / e.max), 5);
    }
  }

  // осколки уничтоженных кораблей
  for (const d of debris) {
    ctx.globalAlpha = Math.max(0, d.life / d.max);
    ctx.fillStyle = d.col;
    poly(d.x, d.y, d.size, 3, d.rot); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // пули врагов
  for (const b of ebul) drawPlasma(b);

  // дроны
  for (let i = 0; i < P.drones; i++) { const dp = dronePos(i); drawDrone(dp.x, dp.y, P.ang); }

  // игрок
  const blink = P.inv > 0 && Math.floor(P.inv * 20) % 2 === 0;
  if (!blink) drawShip(P.x, P.y, P.ang);
  if (P.shield && P.shieldReady) {
    ctx.shadowColor = '#4df3ff'; ctx.shadowBlur = 16;
    ctx.strokeStyle = `rgba(77,243,255,${0.5 + 0.3 * Math.sin(t * 8)})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(P.x, P.y, 30, 0, 7); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // частицы и кольца взрывов
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
  }
  for (const r of rings) {
    const p = 1 - r.life / r.dur;
    ctx.globalAlpha = Math.max(0, 1 - p);
    ctx.strokeStyle = r.col; ctx.lineWidth = 2 + 8 * (1 - p);
    ctx.beginPath(); ctx.arc(r.x, r.y, r.max * p, 0, 7); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

  // молнии
  ctx.shadowColor = '#7ab8ff'; ctx.shadowBlur = 14;
  ctx.strokeStyle = '#d6efff'; ctx.lineWidth = 3;
  for (const b of bolts) {
    ctx.beginPath();
    ctx.moveTo(b.pts[0].x, b.pts[0].y);
    for (let i = 1; i < b.pts.length; i++) {
      const a = b.pts[i - 1], c = b.pts[i];
      for (let k = 1; k < 4; k++) {
        const f = k / 4;
        ctx.lineTo(a.x + (c.x - a.x) * f + rnd(-10, 10), a.y + (c.y - a.y) * f + rnd(-10, 10));
      }
      ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // цифры урона
  for (const tx of texts) {
    ctx.globalAlpha = Math.min(1, tx.life * 2);
    text(tx.str, tx.x, tx.y, tx.str.length > 5 ? 28 : 16, tx.col);
  }
  ctx.globalAlpha = 1;
}

// красные края экрана: тревога от босса и вспышка при уроне, синий оттенок при замедлении
function drawOverlays() {
  if (P.warpT > 0) { ctx.fillStyle = 'rgba(70,110,255,0.12)'; ctx.fillRect(0, 0, W, H); }
  let a = 0;
  if (bossAlive) a = 0.12 + 0.08 * Math.sin(t * 5);
  if (hurtFlash > 0) a = Math.max(a, hurtFlash * 0.9);
  if (P.hp < P.max * 0.3) a = Math.max(a, 0.18 + 0.1 * Math.sin(t * 8));
  if (a > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,0,40,0)'); g.addColorStop(1, `rgba(255,0,40,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function drawHUD() {
  // HP
  const bw = Math.min(300, W * 0.4);
  ctx.fillStyle = '#0008'; ctx.fillRect(16, 16, bw, 18);
  ctx.fillStyle = '#ff3b6b'; ctx.fillRect(16, 16, bw * clamp(P.hp / P.max, 0, 1), 18);
  text(`HP ${Math.ceil(P.hp)}/${P.max}`, 16 + bw / 2, 25, 13);
  // XP
  ctx.fillStyle = '#0008'; ctx.fillRect(16, 40, bw, 10);
  ctx.fillStyle = '#4dff9d'; ctx.fillRect(16, 40, bw * clamp(P.xp / P.xpNext, 0, 1), 10);
  text(`Уровень ${P.lvl}`, 16, 66, 15, '#4dff9d', 'left');
  if (P.revive) text(`🦅 x${P.revive}`, 16 + bw, 66, 14, '#ff9d3b', 'right');

  // Собранные улучшения
  let ix = 16, iy = 90, n = 0;
  for (const u of UPGRADES) {
    const c = P.taken[u.id];
    if (!c) continue;
    text(u.icon, ix + 10, iy + 8, 17);
    if (c > 1) text('x' + c, ix + 19, iy + 20, 10, '#9fe', 'left');
    ix += 36;
    if (++n % 8 === 0) { ix = 16; iy += 30; }
  }

  // справа
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  text(`${m}:${String(s).padStart(2, '0')}`, W - 16, 26, 26, '#fff', 'right');
  text(`Убийств: ${kills}`, W - 16, 52, 15, '#ff9db4', 'right');
  text(`Счёт: ${score()}`, W - 16, 72, 15, '#ffe14d', 'right');
  if (P.combo >= 3) {
    text(`КОМБО x${P.combo}`, W - 16, 98, 20, '#ffe14d', 'right', '#ff9d3b');
    ctx.fillStyle = '#ffe14d'; ctx.fillRect(W - 16 - 90 * (P.comboT / 2.5), 112, 90 * (P.comboT / 2.5), 3);
  }

  // сверху по центру
  if (wave > 0) {
    const left = enemies.length + waveQ.length;
    text(bossAlive ? '⚠ БОСС НА ПОЛЕ ⚠' : `ВОЛНА ${wave}`, W / 2, 24, 17, bossAlive ? '#ff6a00' : '#4df3ff');
    if (!bossAlive) text(left > 0 ? `Врагов: ${left}` : 'Чисто!', W / 2, 44, 13, '#9ab');
  }
  if (P.warpT > 0) text(`⏳ ВРЕМЯ ЗАМЕДЛЕНО ${P.warpT.toFixed(1)}`, W / 2, 68, 15, '#8fb8ff', 'center', '#4d7bff');

  // баннер волны
  if (banner) {
    const p = 1 - banner.life / banner.dur;
    ctx.globalAlpha = clamp(Math.min(banner.life * 2.5, p * 8), 0, 1);
    const sz = Math.min(64, W / 9) * (1 + 0.25 * (1 - Math.min(1, p * 4)));
    text(banner.str, W / 2, H * 0.28, sz, banner.col, 'center', banner.col);
    if (banner.sub) text(banner.sub, W / 2, H * 0.28 + sz * 0.8, 22, '#fff');
    ctx.globalAlpha = 1;
  }

  // кнопки способностей
  const rs = abilityRects();
  const info = [
    { name: 'РЫВОК', key: 'ПРОБЕЛ', frac: P.dashCd <= 0 ? 1 : 1 - P.dashCd / P.dashMax, sub: P.dashCd.toFixed(1) + 'с', col: '#4df3ff' },
    { name: 'НОВА',  key: 'Q', frac: P.novaCd <= 0 ? 1 : 1 - P.novaCd / P.novaMax, sub: P.novaCd.toFixed(1) + 'с', col: '#ffe14d' },
    { name: 'ВРЕМЯ', key: 'E', frac: P.warpCd <= 0 ? 1 : 1 - P.warpCd / P.warpMax, sub: P.warpCd.toFixed(1) + 'с', col: '#8fb8ff' },
    { name: 'УЛЬТА', key: 'R', frac: P.ult / 100, sub: Math.floor(P.ult) + '%', col: '#ff7ad9' }
  ];
  for (let i = 0; i < 4; i++) {
    const r = rs[i], f = info[i], ready = f.frac >= 1;
    ctx.fillStyle = '#0b0b2acc'; ctx.strokeStyle = ready ? f.col : '#445'; ctx.lineWidth = 2;
    if (ready) { ctx.shadowColor = f.col; ctx.shadowBlur = 14 + (i === 3 ? 8 * Math.sin(t * 8) : 0); }
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 10); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = f.col + (ready ? '33' : '22');
    ctx.fillRect(r.x + 3, r.y + r.h - 3 - (r.h - 6) * f.frac, r.w - 6, (r.h - 6) * f.frac);
    text(f.name, r.x + r.w / 2, r.y + 20, 13, ready ? '#fff' : '#889');
    text(ready ? f.key : f.sub, r.x + r.w / 2, r.y + 44, 13, ready ? f.col : '#889');
  }

  // джойстик
  if (joy) {
    ctx.strokeStyle = '#fff6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(joy.x0, joy.y0, 60, 0, 7); ctx.stroke();
    ctx.fillStyle = '#fff5'; ctx.beginPath(); ctx.arc(joy.x0 + joy.dx * 60, joy.y0 + joy.dy * 60, 24, 0, 7); ctx.fill();
  }
}

function dim(a = 0.65) { ctx.fillStyle = `rgba(3,3,12,${a})`; ctx.fillRect(0, 0, W, H); }

function drawCards() {
  dim();
  text(cardTitle, W / 2, H / 2 - 190, Math.min(44, W / 12), '#4dff9d', 'center', '#4dff9d');
  text('Выбери улучшение (клик или клавиши 1 / 2 / 3)', W / 2, H / 2 - 145, 17, '#cde');
  const cw = Math.min(230, (W - 60) / 3), ch = 200, gap = 20;
  const total = cw * 3 + gap * 2;
  cardRects = [];
  cards.forEach((c, i) => {
    const x = W / 2 - total / 2 + i * (cw + gap), y = H / 2 - 105;
    cardRects.push({ x, y, w: cw, h: ch });
    const lvl = (P.taken[c.id] || 0) + 1;
    ctx.fillStyle = '#12123a'; ctx.strokeStyle = '#7a6bff'; ctx.lineWidth = 2;
    ctx.shadowColor = '#7a6bff'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 14); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    text(c.icon, x + cw / 2, y + 40, 38);
    text(c.name, x + cw / 2, y + 88, 18, '#fff');
    if (c.max > 1) text(`ур. ${lvl}/${c.max}`, x + cw / 2, y + 110, 12, '#7a6bff');
    wrap(c.desc, x + cw / 2, y + 134, cw - 24, 14, '#b9c3ff');
    text(`[${i + 1}]`, x + cw / 2, y + ch - 16, 14, '#7a6bff');
  });
}
function wrap(str, x, y, maxW, size, col) {
  ctx.font = `${size}px ${FONT}`; ctx.fillStyle = col; ctx.textAlign = 'center';
  const words = str.split(' '); let line = '', yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += size + 4; }
    else line = test;
  }
  ctx.fillText(line, x, yy);
}

function drawMenu() {
  dim(0.5);
  text('NEON SURVIVOR', W / 2, H / 2 - 120, Math.min(72, W / 9), '#4df3ff', 'center', '#4df3ff');
  text('Отбивай волны пришельцев. Прокачайся. Победи боссов.', W / 2, H / 2 - 65, 20, '#cde');
  const a = 0.5 + 0.5 * Math.sin(idleT * 4);
  ctx.globalAlpha = 0.5 + a * 0.5;
  text('Нажми ENTER / ПРОБЕЛ или тапни, чтобы начать', W / 2, H / 2 - 5, 22, '#ffe14d');
  ctx.globalAlpha = 1;
  text('WASD / стрелки — движение   •   P — пауза', W / 2, H / 2 + 45, 15, '#9ab');
  text('ПРОБЕЛ — рывок   •   Q — нова   •   E — замедление времени   •   R — ульта', W / 2, H / 2 + 70, 15, '#9ab');
  text('Не стой на месте: в толпе тебя быстро разорвут! Стреляешь автоматически.', W / 2, H / 2 + 95, 15, '#9ab');
  text('Врагов убиваешь — ульта заряжается. С них падают ❤️ 🧲 💣 ⭐', W / 2, H / 2 + 120, 15, '#9ab');
  if (best) text(`Рекорд: ${best}`, W / 2, H / 2 + 165, 20, '#ffe14d');
}

function drawOver() {
  dim(0.7);
  text('ТЫ ПОГИБ', W / 2, H / 2 - 100, 60, '#ff3b6b', 'center', '#ff3b6b');
  text(`Счёт: ${score()}`, W / 2, H / 2 - 35, 32, '#ffe14d');
  text(`Волна: ${wave}   •   Убийств: ${kills}   •   Уровень: ${P.lvl}   •   Время: ${Math.floor(t)}с`, W / 2, H / 2 + 10, 18, '#cde');
  text(`Рекорд: ${best}`, W / 2, H / 2 + 45, 18, '#ffe14d');
  const a = 0.5 + 0.5 * Math.sin(idleT * 4);
  ctx.globalAlpha = 0.5 + a * 0.5;
  text('ENTER / тап — сыграть ещё раз', W / 2, H / 2 + 100, 22, '#4df3ff');
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.save();
  if (shake > 0 && state === 'play') ctx.translate(rnd(-shake, shake) * 0.5, rnd(-shake, shake) * 0.5);
  drawBackground();
  if (P && state !== 'menu') drawWorld();
  ctx.restore();
  if (P && state !== 'menu') { drawOverlays(); drawHUD(); }
  if (state === 'menu') drawMenu();
  if (state === 'levelup') drawCards();
  if (state === 'pause') { dim(); text('ПАУЗА', W / 2, H / 2, 56, '#fff', 'center', '#7a6bff'); text('нажми P, чтобы продолжить', W / 2, H / 2 + 50, 18, '#cde'); }
  if (state === 'over') drawOver();
}

// ---------- Главный цикл ----------
let last = performance.now();
function loop(now) {
  const real = Math.min(0.033, (now - last) / 1000);
  last = now;
  slowmo -= real; hurtFlash = Math.max(0, hurtFlash - real * 2);
  const dt = slowmo > 0 ? real * 0.3 : real; // замедленное время при больших событиях
  if (state === 'play') update(dt); else idleT += real;
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// Разворачивает игру на весь экран при первом тапе по экрану
document.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => {
            console.log(`Ошибка перехода в полноэкранный режим: ${err.message}`);
        });
    }
});