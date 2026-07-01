// ============================================================================
// GambleAnimal – UI + mentés (localStorage)
// ============================================================================
// Egyjátékos játék, NINCS Firebase/szoba – minden eszközön külön mentés
// (localStorage), mert a leírás alapján ez nem közös/multiplayer élmény.
// A tényleges szabálykönyv a game-engine.js-ben van, ez a fájl csak
// renderel és eseményeket kezel.
// ============================================================================
import {
  GAMES, GAME_IDS, MAX_VISIBLE_ANIMALS,
  createInitialState, migrateState,
  animalCount, totalAnimalCount, treatsToNextAnimal, quickBetAmount,
  applyPassiveIncome, feedAnimal,
  PLINKO_ROWS, PLINKO_MULTIPLIERS, plinkoIsWinSlot, playPlinko,
  handTotal, startBlackjack, hitBlackjack, resolveBust, standBlackjack,
  SLOTS_PAYOUTS, SLOTS_REEL_STRIP, slotsReelWindow, playSlots,
} from './game-engine.js';

// ─── Mentés ─────────────────────────────────────────────────────────────────
const SAVE_KEY = 'gambleanimal_save_v1';

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return migrateState(JSON.parse(raw));
  } catch (e) {
    console.warn('GambleAnimal: mentés betöltése sikertelen, friss kezdés.', e);
  }
  return createInitialState();
}

function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn('GambleAnimal: mentés sikertelen.', e); }
}

let state = loadState();

// ─── Apró segédfüggvények (közös minta a többi játékkal) ───────────────────
function goTo(id) {
  if (document.getElementById('screen-zoo')?.classList.contains('active') && id !== 'screen-zoo') {
    leaveZoo();
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function goToHub() { goTo('screen-hub'); renderHubExtras(); }

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function formatNum(n) { return Math.round(n).toLocaleString('hu-HU'); }

function setBalanceDisplays(amount) {
  document.querySelectorAll('.ga-balance .n').forEach(el => { el.textContent = formatNum(amount); });
}

function renderAllBalances(pulse = false) {
  setBalanceDisplays(state.treats);
  if (!pulse) return;
  document.querySelectorAll('.ga-balance').forEach(el => {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  });
}

// Tét-mező korlátozása az aktuális egyenlegre (pl. vesztés után ne maradjon
// egy már nem fedezett összeg a mezőben).
function capBetInput(input) {
  const balance = Math.max(0, Math.floor(state.treats));
  let val = Math.floor(Number(input.value));
  if (!Number.isFinite(val) || val < 1) val = Math.min(10, Math.max(1, balance || 1));
  if (val > balance) val = balance;
  input.value = balance > 0 ? val : 0;
}

function notifyNewAnimals(gameId, before, after) {
  if (after <= before) return;
  const gained = after - before;
  const emoji = GAMES[gameId].animalEmoji;
  showToast(gained === 1
    ? `Új ${emoji} érkezett az állatkertbe!`
    : `${gained} új ${emoji} érkezett az állatkertbe!`);
}

// ─── Passzív termelés ────────────────────────────────────────────────────────
function tickPassive() {
  const { state: next, earned } = applyPassiveIncome(state);
  if (earned <= 0) return;
  state = next;
  persist();
  renderAllBalances(true);
  renderHubExtras();
  showToast(`🦁 Az állataid +${earned} 🍪-t termeltek, amíg nem figyeltél!`);
}

// ─── HUB – 3D körhinta + állatkert-előnézet ─────────────────────────────────
const carouselGames = GAME_IDS.map(id => GAMES[id]);
let carouselIndex = 0;

function buildCarousel() {
  const track = document.getElementById('carousel-track');
  const dots = document.getElementById('carousel-dots');
  track.innerHTML = '';
  dots.innerHTML = '';
  carouselGames.forEach((g, i) => {
    const card = document.createElement('div');
    card.className = 'carousel-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${g.name} – ${i === carouselIndex ? 'megnyitás' : 'kiválasztás'}`);
    card.innerHTML = `
      <span class="cc-emoji">${g.animalEmoji}</span>
      <span class="cc-name">${g.name}</span>
      <span class="cc-tag">${g.tag}</span>
      <button class="cc-play" type="button" tabindex="-1">Játék ▸</button>
    `;
    const activate = () => { i === carouselIndex ? enterGame(g.id) : setCarouselIndex(i); };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    track.appendChild(card);

    const dot = document.createElement('span');
    dot.className = 'carousel-dot';
    dots.appendChild(dot);
  });
  updateCarousel();
}

function setCarouselIndex(i) {
  const n = carouselGames.length;
  carouselIndex = ((i % n) + n) % n;
  updateCarousel();
}

function updateCarousel() {
  const n = carouselGames.length;
  document.querySelectorAll('#carousel-track .carousel-card').forEach((card, i) => {
    let offset = i - carouselIndex;
    if (offset > n / 2) offset -= n;
    if (offset < -n / 2) offset += n;
    const abs = Math.abs(offset);
    const tx = offset * 132;
    const rot = offset * -32;
    const tz = -abs * 90;
    const scale = abs === 0 ? 1 : 0.82;
    card.style.transform = `translateX(${tx}px) translateZ(${tz}px) rotateY(${rot}deg) scale(${scale})`;
    card.style.opacity = abs > 2 ? '0' : String(1 - abs * 0.28);
    card.style.zIndex = String(100 - abs);
    card.style.pointerEvents = abs > 2 ? 'none' : 'auto';
    card.classList.toggle('is-active', offset === 0);
    card.setAttribute('aria-label', `${carouselGames[i].name} – ${offset === 0 ? 'megnyitás' : 'kiválasztás'}`);
  });
  document.querySelectorAll('#carousel-dots .carousel-dot').forEach((dot, i) => {
    dot.classList.toggle('is-active', i === carouselIndex);
  });
}

function setupCarouselControls() {
  document.getElementById('carousel-prev').addEventListener('click', () => setCarouselIndex(carouselIndex - 1));
  document.getElementById('carousel-next').addEventListener('click', () => setCarouselIndex(carouselIndex + 1));

  const wrap = document.querySelector('.carousel-wrap');
  let startX = null;
  wrap.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  wrap.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) setCarouselIndex(carouselIndex + (dx < 0 ? 1 : -1));
    startX = null;
  });
}

function enterGame(id) {
  if (id === 'plinko')    { goTo('screen-plinko');    prepPlinkoScreen();    }
  else if (id === 'blackjack') { goTo('screen-blackjack'); prepBlackjackScreen(); }
  else if (id === 'slots')     { goTo('screen-slots');     prepSlotsScreen();     }
}

function renderHubExtras() {
  const animals = totalAnimalCount(state);
  const info = document.getElementById('passive-info');
  info.innerHTML = animals > 0
    ? `🦁 <b>${animals}</b> állat termel: <b>+${animals} 🍪</b> / 10 perc`
    : 'Nyerj a játékokban, hogy állatokat gyűjts az állatkertedbe!';
  document.getElementById('zoo-mini').textContent =
    GAME_IDS.map(id => `${GAMES[id].animalEmoji}${animalCount(state, id)}`).join('   ');
}

// ============================================================================
// PIG-PLINKO
// ============================================================================
function renderPlinkoSlots() {
  const wrap = document.getElementById('plinko-slots');
  wrap.innerHTML = '';
  PLINKO_MULTIPLIERS.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'plinko-slot' + (plinkoIsWinSlot(i) ? ' win-slot' : '');
    el.dataset.index = String(i);
    el.textContent = (Number.isInteger(m) ? m : m.toFixed(1)) + 'x';
    wrap.appendChild(el);
  });
}

function buildPlinkoPegs() {
  const board = document.getElementById('plinko-board');
  board.querySelectorAll('.plinko-peg').forEach(p => p.remove());
  for (let r = 0; r < PLINKO_ROWS; r++) {
    const count = r + 3;
    const y = 10 + (r / (PLINKO_ROWS - 1)) * 76;
    for (let c = 0; c < count; c++) {
      const x = 50 + (c - (count - 1) / 2) * (80 / (PLINKO_ROWS + 2));
      const peg = document.createElement('div');
      peg.className = 'plinko-peg';
      peg.style.left = x + '%';
      peg.style.top = y + '%';
      board.appendChild(peg);
    }
  }
}

function prepPlinkoScreen() {
  capBetInput(document.getElementById('plinko-bet-input'));
  if (!document.getElementById('plinko-bet-input').value) {
    document.getElementById('plinko-bet-input').value = Math.min(10, Math.max(1, state.treats));
  }
  renderPlinkoProgress();
  document.getElementById('plinko-result').textContent = '';
  document.getElementById('plinko-result').className = 'result-line';
}

function renderPlinkoProgress() {
  document.getElementById('plinko-progress').textContent =
    `${treatsToNextAnimal(state, 'plinko')} 🍪 a következő 🐷-ig (eddig: ${animalCount(state, 'plinko')} 🐷)`;
}

function setPlinkoControlsEnabled(enabled) {
  document.getElementById('plinko-play').disabled = !enabled;
  document.getElementById('plinko-bet-input').disabled = !enabled;
  document.querySelectorAll('#screen-plinko .bet-quick').forEach(b => { b.disabled = !enabled; });
}

async function animatePlinkoBall(path) {
  const ball = document.getElementById('plinko-ball');
  ball.style.transition = 'none';
  ball.style.left = '50%';
  ball.style.top = '4%';
  void ball.offsetWidth;
  ball.style.transition = '';

  let posUnits = 0;
  for (let i = 0; i < path.length; i++) {
    posUnits += path[i] === 'R' ? 0.5 : -0.5;
    const xPct = 50 + posUnits * (84 / PLINKO_ROWS);
    const yPct = 4 + ((i + 1) / PLINKO_ROWS) * 88;
    ball.style.left = xPct + '%';
    ball.style.top = yPct + '%';
    ball.classList.remove('bounce');
    void ball.offsetWidth;
    ball.classList.add('bounce');
    await wait(190);
  }
}

function highlightPlinkoSlot(index) {
  document.querySelectorAll('.plinko-slot').forEach(el => el.classList.remove('hit'));
  const el = document.querySelector(`.plinko-slot[data-index="${index}"]`);
  el?.classList.add('hit');
  setTimeout(() => el?.classList.remove('hit'), 1500);
}

async function handlePlinkoPlay() {
  const input = document.getElementById('plinko-bet-input');
  const stake = Math.floor(Number(input.value));
  if (!Number.isFinite(stake) || stake <= 0) { showToast('Adj meg egy érvényes tétet!'); return; }
  if (stake > state.treats) { showToast('Nincs ennyi jutalomfalatod.'); return; }

  let result;
  try { result = playPlinko(state, stake); }
  catch (e) { showToast(e.message); return; }

  setPlinkoControlsEnabled(false);
  document.getElementById('plinko-result').textContent = '';
  document.getElementById('plinko-result').className = 'result-line';

  await animatePlinkoBall(result.path);
  highlightPlinkoSlot(result.slot);

  const beforeAnimals = animalCount(state, 'plinko');
  state = result.state;
  persist();
  renderAllBalances(true);
  renderPlinkoProgress();
  renderHubExtras();
  capBetInput(input);
  notifyNewAnimals('plinko', beforeAnimals, animalCount(state, 'plinko'));

  const resEl = document.getElementById('plinko-result');
  const sign = result.profit > 0 ? `+${result.profit}` : String(result.profit);
  resEl.textContent = `${result.multiplier}x  →  ${sign} 🍪`;
  resEl.className = 'result-line ' + (result.profit > 0 ? 'win' : result.profit === 0 ? 'push' : 'lose');

  setPlinkoControlsEnabled(true);
}

// ============================================================================
// BIRD-BLACKJACK
// ============================================================================
let bjHand = null;

function prepBlackjackScreen() {
  bjHand = null;
  document.getElementById('bj-actions').classList.remove('active');
  document.getElementById('bj-bet-panel').style.display = '';
  document.getElementById('bj-result').textContent = '';
  document.getElementById('bj-result').className = 'result-line';
  document.getElementById('bj-dealer-cards').innerHTML = '';
  document.getElementById('bj-player-cards').innerHTML = '';
  document.getElementById('bj-dealer-total').textContent = '';
  document.getElementById('bj-player-total').textContent = '';
  capBetInput(document.getElementById('bj-bet-input'));
  if (!document.getElementById('bj-bet-input').value) {
    document.getElementById('bj-bet-input').value = Math.min(10, Math.max(1, state.treats));
  }
  renderBjProgress();
}

function renderBjProgress() {
  document.getElementById('bj-progress').textContent =
    `${treatsToNextAnimal(state, 'blackjack')} 🍪 a következő 🐦-ig (eddig: ${animalCount(state, 'blackjack')} 🐦)`;
}

function cardRank(card) { return card.slice(0, -1); }
function cardSuit(card) { return card.slice(-1); }
function isRedSuit(card) { return cardSuit(card) === '♥' || cardSuit(card) === '♦'; }

function renderCardEl(card) {
  const el = document.createElement('div');
  el.className = 'bj-card deal-in' + (isRedSuit(card) ? ' red' : '');
  el.innerHTML = `<span>${cardRank(card)}</span><span class="suit">${cardSuit(card)}</span>`;
  return el;
}

function renderHoleCardEl() {
  const el = document.createElement('div');
  el.className = 'bj-card back deal-in';
  el.textContent = '🐦';
  return el;
}

function renderBjHands(hand, { hideHole, flipReveal }) {
  const dealerWrap = document.getElementById('bj-dealer-cards');
  const playerWrap = document.getElementById('bj-player-cards');
  dealerWrap.innerHTML = '';
  playerWrap.innerHTML = '';

  hand.player.forEach(c => playerWrap.appendChild(renderCardEl(c)));
  hand.dealer.forEach((c, i) => {
    if (i === 1 && hideHole) { dealerWrap.appendChild(renderHoleCardEl()); return; }
    const el = renderCardEl(c);
    if (i === 1 && flipReveal) el.classList.add('flip');
    dealerWrap.appendChild(el);
  });

  document.getElementById('bj-player-total').textContent = String(handTotal(hand.player));
  document.getElementById('bj-dealer-total').textContent = hideHole
    ? `${handTotal([hand.dealer[0]])} + ?`
    : String(handTotal(hand.dealer));
}

function showBjOutcome(outcome, profit, label) {
  const el = document.getElementById('bj-result');
  el.className = 'result-line ' + outcome;
  const sign = profit > 0 ? `+${profit}` : String(profit);
  el.textContent = `${label}  (${sign} 🍪)`;
}

function finishBjRound(result, { flipReveal, naturalLabel }) {
  const beforeAnimals = animalCount(state, 'blackjack');
  state = result.state;
  persist();
  renderBjHands(result.hand, { hideHole: false, flipReveal });
  const label = naturalLabel || (result.outcome === 'win' ? 'Nyertél!' : result.outcome === 'push' ? 'Döntetlen' : 'Vesztettél');
  showBjOutcome(result.outcome, result.profit, label);
  document.getElementById('bj-actions').classList.remove('active');
  document.getElementById('bj-bet-panel').style.display = '';
  renderAllBalances(true);
  renderBjProgress();
  renderHubExtras();
  capBetInput(document.getElementById('bj-bet-input'));
  notifyNewAnimals('blackjack', beforeAnimals, animalCount(state, 'blackjack'));
  bjHand = null;
}

function handleBjDeal() {
  const input = document.getElementById('bj-bet-input');
  const stake = Math.floor(Number(input.value));
  if (!Number.isFinite(stake) || stake <= 0) { showToast('Adj meg egy érvényes tétet!'); return; }
  if (stake > state.treats) { showToast('Nincs ennyi jutalomfalatod.'); return; }

  let result;
  try { result = startBlackjack(state, stake); }
  catch (e) { showToast(e.message); return; }

  if (result.outcome) {
    finishBjRound(result, { flipReveal: false, naturalLabel: result.outcome === 'win' ? 'Bird-Blackjack! 🎉' : undefined });
    return;
  }

  bjHand = result.hand;
  renderBjHands(bjHand, { hideHole: true });
  document.getElementById('bj-bet-panel').style.display = 'none';
  document.getElementById('bj-actions').classList.add('active');
  document.getElementById('bj-result').textContent = '';
  document.getElementById('bj-result').className = 'result-line';
}

function handleBjHit() {
  if (!bjHand || bjHand.resolved) return;
  bjHand = hitBlackjack(bjHand);
  renderBjHands(bjHand, { hideHole: true });
  if (bjHand.resolved) {
    const r = resolveBust(state, bjHand);
    finishBjRound(r, { flipReveal: false, naturalLabel: undefined });
  }
}

function handleBjStand() {
  if (!bjHand || bjHand.resolved) return;
  const r = standBlackjack(state, bjHand);
  finishBjRound(r, { flipReveal: true, naturalLabel: undefined });
}

// ============================================================================
// SLOTH-SLOTS
// ============================================================================
const SLOTS_STOP_DELAYS  = [900, 1450, 2000]; // ms – egy-egy tárcsa megáll
const SLOTS_SPIN_MS      = 65;                // pörgési ticker intervallum

let slotsSpinning      = false;
let _slotsInterval     = null;
let _slotsSpinPos      = [0, 7, 14];         // kezdő fáziskülönbség tárcsánként
let _reelStopped       = [false, false, false];

function slotsSetReel(reelIdx, symbols) {
  // symbols = [felső, közép, alsó]
  for (let row = 0; row < 3; row++) {
    document.getElementById(`reel-${reelIdx}-${row}`).textContent = symbols[row];
  }
}

function prepSlotsScreen() {
  capBetInput(document.getElementById('slots-bet-input'));
  const inp = document.getElementById('slots-bet-input');
  if (!inp.value || inp.value === '0') inp.value = String(Math.min(10, Math.max(1, state.treats)));
  renderSlotsProgress();
  document.getElementById('slots-result').textContent = '';
  document.getElementById('slots-result').className = 'result-line';
  // Alapállapot: 3× 🦥 a payline-on (csak vizuális fogadtatás)
  for (let i = 0; i < 3; i++) slotsSetReel(i, slotsReelWindow(18)); // 18 = 🦥 pozíció
  // Kifizetési táblázat (csak egyszer töltjük be)
  const grid = document.getElementById('slots-paytable-grid');
  if (grid && !grid.children.length) {
    for (const [sym, mult] of Object.entries(SLOTS_PAYOUTS)) {
      grid.insertAdjacentHTML('beforeend',
        `<span>${sym}${sym}${sym}</span><span class="pt-mult">${mult}×${mult === 100 ? ' 🎉' : ''}</span>`);
    }
  }
}

function renderSlotsProgress() {
  document.getElementById('slots-progress').textContent =
    `${treatsToNextAnimal(state, 'slots')} 🍪 a következő 🦥-ig (eddig: ${animalCount(state, 'slots')} 🦥)`;
}

async function handleSlotsSpin() {
  if (slotsSpinning) return;

  const input = document.getElementById('slots-bet-input');
  const stake = Math.floor(Number(input.value));
  if (!Number.isFinite(stake) || stake <= 0) { showToast('Adj meg egy érvényes tétet!'); return; }
  if (stake > state.treats)                   { showToast('Nincs ennyi jutalomfalatod.'); return; }

  let result;
  try { result = playSlots(state, stake); }
  catch (e) { showToast(e.message); return; }

  slotsSpinning = true;
  document.getElementById('slots-spin').disabled = true;
  document.getElementById('slots-result').textContent = '';
  document.getElementById('slots-result').className = 'result-line';

  // Véletlen fázisból indítjuk a tárcsákat
  _reelStopped  = [false, false, false];
  _slotsSpinPos = [
    Math.floor(Math.random() * SLOTS_REEL_STRIP.length),
    Math.floor(Math.random() * SLOTS_REEL_STRIP.length),
    Math.floor(Math.random() * SLOTS_REEL_STRIP.length),
  ];
  for (let i = 0; i < 3; i++) {
    document.getElementById(`reel-col-${i}`).classList.add('spinning');
    slotsSetReel(i, slotsReelWindow(_slotsSpinPos[i]));
  }

  // Pörgési ticker: a szalag szimbólumain lép végig sequentially
  _slotsInterval = setInterval(() => {
    for (let i = 0; i < 3; i++) {
      if (!_reelStopped[i]) {
        _slotsSpinPos[i] = (_slotsSpinPos[i] + 1) % SLOTS_REEL_STRIP.length;
        slotsSetReel(i, slotsReelWindow(_slotsSpinPos[i]));
      }
    }
  }, SLOTS_SPIN_MS);

  // Megálló-animáció – tárcsánként eltérő késleltetéssel
  const stopPromises = result.stopPositions.map((stopPos, i) =>
    new Promise(resolve => setTimeout(() => {
      _reelStopped[i] = true; // először állítjuk le, aztán renderelünk
      const col = document.getElementById(`reel-col-${i}`);
      col.classList.remove('spinning');
      slotsSetReel(i, slotsReelWindow(stopPos));
      col.classList.add('land');
      setTimeout(() => { col.classList.remove('land'); resolve(); }, 480);
    }, SLOTS_STOP_DELAYS[i]))
  );

  await Promise.all(stopPromises);
  clearInterval(_slotsInterval);

  // Állapot frissítése
  const beforeAnimals = animalCount(state, 'slots');
  state = result.state;
  persist();
  renderAllBalances(true);
  renderSlotsProgress();
  renderHubExtras();
  capBetInput(input);
  notifyNewAnimals('slots', beforeAnimals, animalCount(state, 'slots'));

  // Eredmény megjelenítése
  const resEl = document.getElementById('slots-result');
  if (result.isJackpot) {
    resEl.textContent = '🎰 JACKPOT!! 100× 🦥🦥🦥 🎰';
    resEl.className = 'result-line win';
    // Tárcsák csillognak egymás után
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const col = document.getElementById(`reel-col-${i}`);
        col.classList.add('jackpot');
        setTimeout(() => col.classList.remove('jackpot'), 2600);
      }, i * 130);
    }
    const machine = document.getElementById('slots-machine');
    machine.classList.add('jackpot');
    setTimeout(() => machine.classList.remove('jackpot'), 3500);
  } else if (result.profit > 0) {
    resEl.textContent = `${result.multiplier}×  →  +${result.profit} 🍪`;
    resEl.className = 'result-line win';
  } else {
    resEl.textContent = `Nem nyertél.  (−${Math.abs(result.profit)} 🍪)`;
    resEl.className = 'result-line lose';
  }

  slotsSpinning = false;
  document.getElementById('slots-spin').disabled = false;
}

// ============================================================================
// ÁLLATKERT
// ============================================================================
let zooSprites = [];
let zooInterval = null;
const ZOO_MOVE_MS = 2600;
const ZOO_FADE_MS = 300;

function renderZooCounts() {
  const wrap = document.getElementById('zoo-counts');
  wrap.innerHTML = '';
  GAME_IDS.forEach(id => {
    const badge = document.createElement('div');
    badge.className = 'zoo-badge';
    badge.innerHTML = `<span>${GAMES[id].animalEmoji}</span><span class="n">×${animalCount(state, id)}</span>`;
    wrap.appendChild(badge);
  });
}

function randomStagePoint(stage) {
  const w = stage.clientWidth, h = stage.clientHeight;
  const pad = 20, size = 30;
  return {
    x: pad + Math.random() * Math.max(1, w - pad * 2 - size),
    y: pad + Math.random() * Math.max(1, h - pad * 2 - size),
  };
}

function doorPoint(stage) {
  return { x: stage.clientWidth - 30, y: stage.clientHeight / 2 - 14 };
}

function moveSprite(sprite, point) {
  sprite.x = point.x;
  sprite.y = point.y;
  sprite.el.style.transform = `translate(${point.x}px, ${point.y}px)`;
}

function buildZooSprites() {
  const stage = document.getElementById('zoo-stage');
  zooSprites.forEach(s => s.el.remove());
  zooSprites = [];
  stage.querySelector('.zoo-empty')?.remove();

  const counts = GAME_IDS.map(id => ({ id, emoji: GAMES[id].animalEmoji, count: animalCount(state, id) }));
  const total = counts.reduce((s, c) => s + c.count, 0);

  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'zoo-empty';
    empty.textContent = 'Még nincs állatod – nyerj jutalomfalatot a játékokban, és minden 100 nyereményért kapsz egy újat!';
    stage.appendChild(empty);
    return;
  }

  const visibleTotal = Math.min(total, MAX_VISIBLE_ANIMALS);
  const exact = counts.map(c => (c.count / total) * visibleTotal);
  const allocated = exact.map(Math.floor);
  let used = allocated.reduce((s, n) => s + n, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - allocated[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; used < visibleTotal && k < order.length; k++, used++) allocated[order[k].i]++;
  counts.forEach((c, i) => { if (c.count === 0) allocated[i] = 0; });

  counts.forEach((c, i) => {
    for (let n = 0; n < allocated[i]; n++) {
      const el = document.createElement('span');
      el.className = 'zoo-sprite';
      el.textContent = c.emoji;
      stage.appendChild(el);
      const sprite = { el, type: c.id, leaving: false, x: 0, y: 0 };
      el.style.transitionProperty = 'opacity';
      moveSprite(sprite, randomStagePoint(stage));
      void el.offsetWidth;
      el.style.transitionProperty = '';
      zooSprites.push(sprite);
    }
  });
}

function tickZooMovement() {
  const stage = document.getElementById('zoo-stage');
  if (!stage || zooSprites.length === 0) return;
  const overflow = totalAnimalCount(state) > MAX_VISIBLE_ANIMALS;

  zooSprites.forEach(sprite => {
    if (sprite.leaving) return;
    if (Math.random() >= 0.22) return;

    if (overflow && Math.random() < 0.3) {
      sprite.leaving = true;
      moveSprite(sprite, doorPoint(stage));
      setTimeout(() => {
        sprite.el.style.opacity = '0';
        setTimeout(() => {
          sprite.el.style.transitionProperty = 'opacity';
          moveSprite(sprite, randomStagePoint(stage));
          void sprite.el.offsetWidth;
          sprite.el.style.transitionProperty = '';
          sprite.el.style.opacity = '1';
          sprite.leaving = false;
        }, ZOO_FADE_MS);
      }, ZOO_MOVE_MS);
    } else {
      moveSprite(sprite, randomStagePoint(stage));
    }
  });
}

function enterZoo() {
  renderZooCounts();
  buildZooSprites();
  if (zooInterval) clearInterval(zooInterval);
  zooInterval = setInterval(tickZooMovement, 900);
}

function leaveZoo() {
  if (zooInterval) { clearInterval(zooInterval); zooInterval = null; }
}

function spawnFeedHeart() {
  const stage = document.getElementById('zoo-stage');
  const candidates = zooSprites.filter(s => !s.leaving);
  const target = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  const heart = document.createElement('span');
  heart.className = 'zoo-feed-heart';
  heart.textContent = '💖';
  heart.style.left = (target ? target.x : stage.clientWidth / 2 - 8) + 'px';
  heart.style.top = (target ? target.y : stage.clientHeight / 2 - 8) + 'px';
  stage.appendChild(heart);
  setTimeout(() => heart.remove(), 1200);
}

function handleFeed() {
  if (totalAnimalCount(state) === 0) { showToast('Még nincs állatod, akit etethetnél.'); return; }
  const r = feedAnimal(state, 1);
  if (!r.ok) { showToast('Nincs elég jutalomfalatod az eteséshez.'); return; }
  state = r.state;
  persist();
  renderAllBalances(true);
  spawnFeedHeart();
}

// ─── Dev mód (mint a többi játéknál) ────────────────────────────────────────
function initDevMode() {
  const isActive = localStorage.getItem('ga_dev_mode') === '1';

  const devBtn = document.createElement('button');
  devBtn.id = 'dev-btn';
  devBtn.title = 'Dev mód';
  devBtn.textContent = '🛠️';
  if (isActive) devBtn.classList.add('show');
  document.body.appendChild(devBtn);

  const devPanel = document.createElement('div');
  devPanel.id = 'dev-panel';
  devPanel.innerHTML = `
    <h3>🛠️ Dev mód</h3>
    <div class="dev-row">
      <label>🐷 Pig-Plinko nyerési esély <span id="dev-plinko-val"></span></label>
      <input type="range" id="dev-plinko-prob" min="0" max="100" step="1">
    </div>
    <div class="dev-row">
      <label>🐦 Bird-Blackjack nyerési esély <span id="dev-bj-val"></span></label>
      <input type="range" id="dev-bj-prob" min="0" max="100" step="1">
    </div>
    <div class="dev-row">
      <label>🦥 Sloth-Slots nyerési esély <span id="dev-slots-val"></span></label>
      <input type="range" id="dev-slots-prob" min="0" max="100" step="1">
    </div>
    <button class="btn btn-secondary" id="dev-add-treats" type="button">+1000 🍪 (teszteléshez)</button>
    <button class="btn btn-danger" id="dev-reset" type="button">🗑️ Mentés törlése</button>
  `;
  document.body.appendChild(devPanel);

  devBtn.addEventListener('click', e => { e.stopPropagation(); devPanel.classList.toggle('show'); });
  document.addEventListener('click', () => devPanel.classList.remove('show'));
  devPanel.addEventListener('click', e => e.stopPropagation());

  const plinkoSlider = document.getElementById('dev-plinko-prob');
  const bjSlider     = document.getElementById('dev-bj-prob');
  const slotsSlider  = document.getElementById('dev-slots-prob');
  const plinkoVal    = document.getElementById('dev-plinko-val');
  const bjVal        = document.getElementById('dev-bj-val');
  const slotsVal     = document.getElementById('dev-slots-val');

  function syncDevSliders() {
    plinkoSlider.value = String(Math.round(state.dev.plinko.winProb * 100));
    bjSlider.value     = String(Math.round(state.dev.blackjack.winProb * 100));
    slotsSlider.value  = String(Math.round(state.dev.slots.winProb * 100));
    plinkoVal.textContent = plinkoSlider.value + '%';
    bjVal.textContent     = bjSlider.value + '%';
    slotsVal.textContent  = slotsSlider.value + '%';
  }
  syncDevSliders();

  plinkoSlider.addEventListener('input', () => {
    state.dev.plinko.winProb = Number(plinkoSlider.value) / 100;
    plinkoVal.textContent = plinkoSlider.value + '%';
    persist();
  });
  bjSlider.addEventListener('input', () => {
    state.dev.blackjack.winProb = Number(bjSlider.value) / 100;
    bjVal.textContent = bjSlider.value + '%';
    persist();
  });
  slotsSlider.addEventListener('input', () => {
    state.dev.slots.winProb = Number(slotsSlider.value) / 100;
    slotsVal.textContent = slotsSlider.value + '%';
    persist();
  });

  document.getElementById('dev-add-treats').addEventListener('click', () => {
    state.treats += 1000;
    persist();
    renderAllBalances(true);
    showToast('+1000 🍪 hozzáadva (csak dev módban).');
  });

  document.getElementById('dev-reset').addEventListener('click', () => {
    if (!confirm('Biztosan törlöd az ÖSSZES GambleAnimal mentést (egyenleg, állatok)? Ez nem visszavonható.')) return;
    localStorage.removeItem(SAVE_KEY);
    state = createInitialState();
    persist();
    renderAllBalances(true);
    renderHubExtras();
    syncDevSliders();
    showToast('Mentés törölve, friss kezdés.');
  });

  let tapCount = 0, tapTimer = null;
  document.getElementById('ga-title').addEventListener('click', () => {
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 2500);
    if (tapCount >= 10) {
      tapCount = 0;
      localStorage.setItem('ga_dev_mode', '1');
      devBtn.classList.add('show');
      showToast('🛠️ Dev mód aktiválva!');
    }
  });
}

// ─── Eseménykötések ──────────────────────────────────────────────────────────
function setupEventHandlers() {
  document.getElementById('btn-goto-zoo').addEventListener('click', () => { goTo('screen-zoo'); enterZoo(); });
  document.getElementById('plinko-back').addEventListener('click', goToHub);
  document.getElementById('bj-back').addEventListener('click', goToHub);
  document.getElementById('slots-back').addEventListener('click', goToHub);
  document.getElementById('zoo-back').addEventListener('click', goToHub);

  document.querySelectorAll('#plinko-bet-panel .bet-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('plinko-bet-input').value = String(quickBetAmount(state.treats, Number(btn.dataset.pct)));
    });
  });
  document.querySelectorAll('#bj-bet-panel .bet-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('bj-bet-input').value = String(quickBetAmount(state.treats, Number(btn.dataset.pct)));
    });
  });
  document.querySelectorAll('#slots-bet-panel .bet-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('slots-bet-input').value = String(quickBetAmount(state.treats, Number(btn.dataset.pct)));
    });
  });

  document.getElementById('plinko-play').addEventListener('click', handlePlinkoPlay);
  document.getElementById('bj-deal').addEventListener('click', handleBjDeal);
  document.getElementById('bj-hit').addEventListener('click', handleBjHit);
  document.getElementById('bj-stand').addEventListener('click', handleBjStand);
  document.getElementById('slots-spin').addEventListener('click', handleSlotsSpin);
  document.getElementById('btn-feed').addEventListener('click', handleFeed);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
{
  const { state: caughtUpState, earned } = applyPassiveIncome(state);
  state = caughtUpState;
  persist();

  buildCarousel();
  setupCarouselControls();
  renderPlinkoSlots();
  buildPlinkoPegs();
  setupEventHandlers();
  renderAllBalances();
  renderHubExtras();
  goTo('screen-hub');
  initDevMode();

  if (earned > 0) showToast(`Amíg távol voltál, az állataid +${earned} 🍪-t termeltek! 🦁`);

  setInterval(tickPassive, 20000);
}
