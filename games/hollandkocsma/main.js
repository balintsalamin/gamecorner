// ============================================================================
// Holland kocsma – UI + Firebase szinkronizálás
// ============================================================================
// Ugyanaz a minta, mint a Colorcards-nál (games/uno/main.js): minden
// játékos böngészője a `hkRooms/{kód}` Firestore dokumentumot olvassa
// (onSnapshot) és írja (runTransaction), így mindenki ugyanazt az
// állapotot látja valós időben.
// ============================================================================

import { doc, getDoc, setDoc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';
import {
  applyMove, createInitialState, SETTINGS_META, DEFAULT_SETTINGS,
  cardRank, cardSuit, isRedSuit, SUIT_SYMBOL, rankDisplay,
  isValidPlay, getActiveZone, hasAnyValidPlay,
} from './game-engine.js';

const ROOMS_COLLECTION = 'hkRooms';

// ----------------------------------------------------------------------
// Állapot
// ----------------------------------------------------------------------
const myId = getOrCreatePlayerId();
let roomCode = null;
let latestState = null;
let previousState = null;
let unsubscribe = null;

let selectedZone = null;     // 'hand' | 'faceUp' | null – melyik zónából válogatunk
let selectedIndices = [];    // indexek a kiválasztott zónán belül (egyforma értékű lapok)
let armedSetup = null;       // { zone: 'hand' | 'faceUp', index } – felkészülési csere első fele
let lastFlashedPickupTs;     // melyik "felvette a paklit" eseményt villantottuk már fel (undefined = még nincs alapérték)

// ----------------------------------------------------------------------
// Segédfüggvények
// ----------------------------------------------------------------------
function getOrCreatePlayerId() {
  let id = localStorage.getItem('hk_player_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'p-' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('hk_player_id', id);
  }
  return id;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function showHomeError(msg) {
  document.getElementById('home-error').textContent = msg || '';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ----------------------------------------------------------------------
// Kártya megjelenítés
// ----------------------------------------------------------------------
function cardInnerHtml(card) {
  const rank = cardRank(card);
  const symbol = SUIT_SYMBOL[cardSuit(card)];
  return `<span class="card-corner tl">${rank}<br>${symbol}</span>` +
    `<span class="card-pip">${symbol}</span>` +
    `<span class="card-corner br">${rank}<br>${symbol}</span>`;
}
function cardClass(card) {
  return 'card' + (isRedSuit(cardSuit(card)) ? ' suit-red' : '');
}
function tinyCardHtml(card) {
  return `${cardRank(card)}${SUIT_SYMBOL[cardSuit(card)]}`;
}

// ----------------------------------------------------------------------
// Firestore: szoba létrehozása / csatlakozás / dispatch
// ----------------------------------------------------------------------
async function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // I, L, O, 0, 1 kihagyva (félreérthetők)
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const snap = await getDoc(doc(db, ROOMS_COLLECTION, code));
    if (!snap.exists()) return code;
  }
  throw new Error('Nem sikerült szabad szobakódot találni, próbáld újra.');
}

async function dispatch(action) {
  if (!roomCode) throw new Error('Nincs aktív szoba.');
  const ref = doc(db, ROOMS_COLLECTION, roomCode);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('A szoba már nem létezik.');
    const state = snap.data();
    const newState = applyMove(state, action);
    tx.set(ref, newState);
  });
}

function subscribeRoom() {
  if (unsubscribe) unsubscribe();
  lastFlashedPickupTs = undefined;
  const ref = doc(db, ROOMS_COLLECTION, roomCode);
  unsubscribe = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        showToast('A szoba megszűnt.');
        roomCode = null;
        latestState = null;
        previousState = null;
        showScreen('screen-home');
        return;
      }
      previousState = latestState;
      latestState = snap.data();
      render();
    },
    (err) => showToast('Kapcsolati hiba: ' + err.message)
  );
}

// ----------------------------------------------------------------------
// Kezdőképernyő
// ----------------------------------------------------------------------
const nameInput = document.getElementById('input-name');
const codeInput = document.getElementById('input-room-code');

(function initHome() {
  const savedName = localStorage.getItem('hk_player_name');
  if (savedName) nameInput.value = savedName;
  const params = new URLSearchParams(location.search);
  const presetRoom = params.get('room');
  if (presetRoom) codeInput.value = presetRoom.toUpperCase();
})();

document.getElementById('btn-create-room').addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) return showHomeError('Adj meg egy nevet!');
  localStorage.setItem('hk_player_name', name);
  showHomeError('');
  try {
    const code = await generateRoomCode();
    const state = createInitialState();
    state.players.push({ id: myId, name, connected: true, lossCount: 0 });
    await setDoc(doc(db, ROOMS_COLLECTION, code), state);
    roomCode = code;
    subscribeRoom();
  } catch (e) {
    showHomeError(e.message);
  }
});

document.getElementById('btn-join-room').addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) return showHomeError('Adj meg egy nevet!');
  if (code.length !== 4) return showHomeError('A szoba kódja 4 karakter hosszú.');
  localStorage.setItem('hk_player_name', name);
  showHomeError('');
  roomCode = code;
  try {
    await dispatch({ type: 'join', playerId: myId, name });
    subscribeRoom();
  } catch (e) {
    roomCode = null;
    showHomeError(e.message);
  }
});

// ----------------------------------------------------------------------
// "Gyorstalpaló" szabálymodál – bármikor megnyitható (home / lobbi / setup / játék)
// ----------------------------------------------------------------------
function renderRulesSummary(settings) {
  const el = document.getElementById('rules-summary');
  el.innerHTML = '';
  for (const meta of SETTINGS_META) {
    let valueText;
    if (meta.type === 'bool') valueText = settings[meta.key] ? 'Be' : 'Ki';
    else valueText = settings[meta.key];
    const row = document.createElement('div');
    row.className = 'chalk-rule-row' + (meta.type === 'bool' && !settings[meta.key] ? ' is-off' : '');
    row.innerHTML = `<span>${escapeHtml(meta.label)}</span><span class="chalk-val">${escapeHtml(String(valueText))}</span>`;
    el.appendChild(row);
  }
}
function openRulesModal() {
  renderRulesSummary(latestState ? latestState.settings : DEFAULT_SETTINGS);
  openModal('modal-rules');
}
['btn-show-rules-home', 'btn-show-rules-lobby', 'btn-show-rules-setup', 'btn-show-rules-game'].forEach((id) => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', openRulesModal);
});
document.getElementById('btn-close-rules').addEventListener('click', () => closeModal('modal-rules'));

// ----------------------------------------------------------------------
// Lobbi
// ----------------------------------------------------------------------
document.getElementById('btn-copy-code').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Holland kocsma szoba', text: url });
    } else {
      await navigator.clipboard.writeText(url);
      showToast('Link a vágólapra másolva!');
    }
  } catch (e) { /* megszakította a felhasználó – nem gond */ }
});

document.getElementById('btn-leave-lobby').addEventListener('click', async () => {
  try { await dispatch({ type: 'leave', playerId: myId }); } catch (e) { /* mindegy */ }
  if (unsubscribe) unsubscribe();
  roomCode = null;
  latestState = null;
  previousState = null;
  showScreen('screen-home');
});

document.getElementById('btn-start-game').addEventListener('click', async () => {
  try { await dispatch({ type: 'startGame' }); } catch (e) { showToast(e.message); }
});

function renderSettingsPanel(settings) {
  const panel = document.getElementById('settings-panel');
  const active = document.activeElement;
  if (panel.contains(active) && active.tagName === 'INPUT' && active.type === 'number') return;

  panel.innerHTML = '';
  for (const meta of SETTINGS_META) {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const head = document.createElement('div');
    head.className = 'setting-head';
    const label = document.createElement('label');
    label.className = 'setting-label';
    label.textContent = meta.label;
    head.appendChild(label);

    let control;
    if (meta.type === 'bool') {
      control = document.createElement('label');
      control.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!settings[meta.key];
      input.addEventListener('change', () => updateSetting(meta.key, input.checked));
      const slider = document.createElement('span');
      slider.className = 'slider';
      control.append(input, slider);
    } else if (meta.type === 'number') {
      control = document.createElement('input');
      control.type = 'number';
      control.min = meta.min;
      control.max = meta.max;
      control.value = settings[meta.key];
      control.addEventListener('change', () => {
        let v = Number(control.value);
        if (Number.isNaN(v)) v = settings[meta.key];
        v = Math.min(meta.max, Math.max(meta.min, v));
        control.value = v;
        updateSetting(meta.key, v);
      });
    }

    head.appendChild(control);
    row.appendChild(head);

    if (meta.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = meta.hint;
      row.appendChild(hint);
    }
    panel.appendChild(row);
  }
}

async function updateSetting(key, value) {
  try {
    await dispatch({ type: 'updateSettings', settings: { [key]: value } });
  } catch (e) {
    showToast(e.message);
  }
}

function renderLobby(state) {
  document.getElementById('room-code-display').textContent = roomCode;

  const list = document.getElementById('player-list');
  list.innerHTML = '';
  state.players.forEach((p, i) => {
    const li = document.createElement('li');
    let tags = '';
    if (i === 0) tags += '<span class="tag">szoba létrehozója</span>';
    if (p.id === myId) tags += '<span class="tag">Te</span>';
    li.innerHTML = `<span>${escapeHtml(p.name)}</span><span>${tags}</span>`;
    list.appendChild(li);
  });

  renderSettingsPanel(state.settings);

  const btnStart = document.getElementById('btn-start-game');
  const hint = document.getElementById('lobby-hint');
  btnStart.disabled = state.players.length < 2;
  hint.textContent = state.players.length < 2
    ? 'Várj még legalább egy másik játékosra...'
    : 'Bárki elindíthatja a játékot, ha mindenki készen áll.';
}

// ----------------------------------------------------------------------
// Felkészülés (lapok rendezése a kör elején)
// ----------------------------------------------------------------------
function buildSetupCardEl(card, index, zone) {
  const el = document.createElement('div');
  el.className = cardClass(card);
  el.innerHTML = cardInnerHtml(card);
  const ready = !!latestState.readySetup[myId];
  if (armedSetup && armedSetup.zone === zone && armedSetup.index === index) {
    el.classList.add('selected');
  } else if (ready) {
    el.classList.add('disabled');
  }
  el.addEventListener('click', () => onSetupCardClick(zone, index));
  return el;
}

async function onSetupCardClick(zone, index) {
  if (!latestState || latestState.status !== 'setup') return;
  if (latestState.readySetup[myId]) {
    showToast('Vond vissza a "Kész vagyok"-ot, ha még cserélnél lapot.');
    return;
  }
  if (!armedSetup) {
    armedSetup = { zone, index };
    renderSetup(latestState);
    return;
  }
  if (armedSetup.zone === zone && armedSetup.index === index) {
    armedSetup = null;
    renderSetup(latestState);
    return;
  }
  if (armedSetup.zone === zone) {
    armedSetup = { zone, index };
    renderSetup(latestState);
    return;
  }
  const handIndex = zone === 'hand' ? index : armedSetup.index;
  const faceUpIndex = zone === 'faceUp' ? index : armedSetup.index;
  armedSetup = null;
  try {
    await dispatch({ type: 'swapSetupCard', playerId: myId, handIndex, faceUpIndex });
  } catch (e) {
    showToast(e.message);
  }
}

function renderSetup(state) {
  const hand = state.hands[myId] || [];
  const faceUp = state.faceUp[myId] || [];
  const faceDownCount = (state.faceDown[myId] || []).length;
  const ready = !!state.readySetup[myId];

  const handEl = document.getElementById('setup-hand');
  handEl.innerHTML = '';
  hand.forEach((c, i) => handEl.appendChild(buildSetupCardEl(c, i, 'hand')));

  const faceUpEl = document.getElementById('setup-faceup');
  faceUpEl.innerHTML = '';
  faceUp.forEach((c, i) => faceUpEl.appendChild(buildSetupCardEl(c, i, 'faceUp')));

  const faceDownEl = document.getElementById('setup-facedown');
  faceDownEl.innerHTML = '';
  for (let i = 0; i < faceDownCount; i++) {
    const el = document.createElement('div');
    el.className = 'card card-back';
    faceDownEl.appendChild(el);
  }

  const btnReady = document.getElementById('btn-setup-ready');
  btnReady.textContent = ready ? 'Mégsem készülök' : 'Kész vagyok';
  document.getElementById('setup-status').textContent = ready
    ? 'Készen állsz – várakozás a többiekre...'
    : 'Rendezd a lapjaid (kéz ↔ felfordított), majd nyomd meg a gombot.';

  const readyList = document.getElementById('ready-list');
  readyList.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    const isReady = !!state.readySetup[p.id];
    li.innerHTML = `<span>${escapeHtml(p.name)}${p.id === myId ? ' (Te)' : ''}</span><span class="ready-badge">${isReady ? '✅' : '⏳'}</span>`;
    readyList.appendChild(li);
  }
}

document.getElementById('btn-setup-ready').addEventListener('click', async () => {
  if (!latestState) return;
  const ready = !latestState.readySetup[myId];
  armedSetup = null;
  try { await dispatch({ type: 'setReady', playerId: myId, ready }); } catch (e) { showToast(e.message); }
});

// ----------------------------------------------------------------------
// Játék képernyő
// ----------------------------------------------------------------------
function isMyTurn(state) {
  const current = state.players[state.currentPlayerIndex];
  return !!current && current.id === myId && !state.finishedOrder.includes(myId);
}

function renderModifierBadges(state) {
  const el = document.getElementById('modifier-badges');
  el.innerHTML = '';
  if (state.resetActive) {
    const b = document.createElement('div');
    b.className = 'modifier-badge reset';
    b.textContent = '🔄 Bármi jöhet';
    el.appendChild(b);
  }
  if (state.reverseCap) {
    const b = document.createElement('div');
    b.className = 'modifier-badge reverse';
    b.textContent = `≤ ${rankDisplay(state.reverseCap)} kell`;
    el.appendChild(b);
  }
  if (state.burnedCount > 0) {
    const b = document.createElement('div');
    b.className = 'modifier-badge burned';
    b.textContent = `🔥 ${state.burnedCount} elégetve`;
    el.appendChild(b);
  }
}

function renderOpponents(state) {
  const container = document.getElementById('opponents-list');
  container.innerHTML = '';
  const players = state.players;
  const myIndex = players.findIndex((p) => p.id === myId);

  const order = [];
  for (let i = 1; i < players.length; i++) {
    order.push(players[(myIndex + i + players.length) % players.length]);
  }

  for (const p of order) {
    const chip = document.createElement('div');
    chip.className = 'opponent-chip';
    chip.dataset.playerId = p.id;
    const idx = players.indexOf(p);
    const finished = state.finishedOrder.includes(p.id);
    if (idx === state.currentPlayerIndex) chip.classList.add('active-turn');
    if (finished) chip.classList.add('finished');

    const handLen = (state.hands[p.id] || []).length;
    const faceUp = state.faceUp[p.id] || [];
    const faceDownLen = (state.faceDown[p.id] || []).length;

    let html = `<div class="name">${escapeHtml(p.name)}</div>`;
    if (finished) {
      const place = state.finishedOrder.indexOf(p.id) + 1;
      html += `<div class="finished-tag">🏁 ${place}. hely</div>`;
    } else {
      html += `<div class="zone-row mini-faceup">`;
      html += faceUp.map((c) => `<span class="card tiny-card ${isRedSuit(cardSuit(c)) ? 'suit-red' : ''}">${tinyCardHtml(c)}</span>`).join('');
      html += `</div>`;
      html += `<div class="zone-row" style="gap:10px; margin-top:4px;"><span>✋ ${handLen}</span><span>🔒 ${faceDownLen}</span></div>`;
    }
    if (!p.connected) html += '<div class="offline-tag">lecsatlakozott</div>';
    chip.innerHTML = html;
    container.appendChild(chip);
  }
}

function clearSelectionIfStale(state) {
  const zoneInfo = getActiveZone(state, myId);
  if (!isMyTurn(state) || (selectedZone && selectedZone !== zoneInfo.zone)) {
    selectedZone = null;
    selectedIndices = [];
  }
  return zoneInfo;
}

// Mennyit kell mozdulni ahhoz, hogy koppintás helyett húzásnak számítson,
// illetve hogy a húzás végén tényleg lerakja a lapot.
const SWIPE_TAP_THRESHOLD = 8;
const SWIPE_PLAY_THRESHOLD = 78;

function buildZoneCardEl(card, index, zoneName, isActiveZone, cardsArr, small) {
  const el = document.createElement('div');
  el.className = cardClass(card);
  el.innerHTML = cardInnerHtml(card);
  const rank = cardRank(card);
  const validHere = isActiveZone && isValidPlay(rank, latestState, latestState.settings);
  const isSelected = selectedZone === zoneName && selectedIndices.includes(index);

  if (isSelected) {
    el.classList.add('selected');
  } else if (!isActiveZone) {
    el.classList.add('disabled');
  } else if (selectedIndices.length > 0) {
    const selRank = cardRank(cardsArr[selectedIndices[0]]);
    el.classList.add(rank === selRank ? 'playable' : 'cant-select');
  } else {
    el.classList.add(validHere ? 'playable' : 'disabled');
  }

  attachSwipeToPlay(el, {
    enabled: isActiveZone,
    valid: validHere,
    onTap: () => onZoneCardClick(zoneName, index, cardsArr),
    onPlay: () => playSingleCard(zoneName, index),
    onRejected: () => showToast('Ez a lap most nem rakható le.'),
  });
  return el;
}

// Koppintás = a meglévő kijelölős logika (onTap). Felfelé húzás, kellő
// távolságra = azonnali, önálló lerakás (onPlay), a gombos több-lapos
// kijelöléstől függetlenül. Kis mozdulatok (remegés, véletlen érintés)
// nem váltanak ki sem kijelölést, sem lerakást.
function attachSwipeToPlay(el, { enabled, valid, onTap, onPlay, onRejected }) {
  if (!enabled) return;
  let pointerId = null;
  let startX = 0, startY = 0;
  let dx = 0, dy = 0;
  let dragging = false;
  let captured = false;

  function snapBack() {
    el.classList.remove('dragging');
    el.style.transition = 'transform 0.25s cubic-bezier(.22,.7,.3,1)';
    el.style.transform = '';
    el.style.opacity = '';
    setTimeout(() => { el.style.transition = ''; }, 260);
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0; dy = 0;
    dragging = false;
    captured = false;
  });

  el.addEventListener('pointermove', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;

    if (!dragging) {
      if (Math.hypot(dx, dy) < SWIPE_TAP_THRESHOLD) return;
      // Csak akkor "vegyük át" a gesztust kártyahúzásként, ha inkább
      // függőleges, mint vízszintes – a vízszintes maradjon a kéz natív
      // görgetéséé (touch-action: pan-x a CSS-ben).
      if (Math.abs(dy) <= Math.abs(dx)) return;
      dragging = true;
      el.classList.add('dragging');
      try { el.setPointerCapture(pointerId); captured = true; } catch (err) { /* mindegy */ }
    }

    e.preventDefault();
    const rotate = Math.max(-18, Math.min(18, dx * 0.12));
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`;
  });

  function finish(e) {
    if (pointerId === null || e.pointerId !== pointerId) return;
    if (captured) { try { el.releasePointerCapture(pointerId); } catch (err) { /* mindegy */ } }
    const wasDragging = dragging;
    const upDistance = -dy;
    pointerId = null;
    dragging = false;
    captured = false;

    if (!wasDragging) {
      onTap();
      return;
    }

    if (upDistance >= SWIPE_PLAY_THRESHOLD) {
      if (valid) {
        el.classList.remove('dragging');
        el.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
        el.style.transform = `translate(${dx}px, ${dy - 140}px) rotate(${Math.max(-18, Math.min(18, dx * 0.12))}deg)`;
        el.style.opacity = '0';
        onPlay();
      } else {
        onRejected();
        snapBack();
      }
    } else {
      snapBack();
    }
  }

  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
}

// Önálló, egyetlen lap lerakása húzással (a kijelölős több-lapos logikától
// függetlenül – ha közben volt aktív kijelölés, azt töröljük).
async function playSingleCard(zoneName, index) {
  selectedZone = null;
  selectedIndices = [];
  try { await dispatch({ type: 'playCards', playerId: myId, zone: zoneName, indices: [index] }); }
  catch (e) { showToast(e.message); renderGame(latestState); }
}

function onZoneCardClick(zoneName, index, cardsArr) {
  if (!latestState) return;
  const zoneInfo = getActiveZone(latestState, myId);
  if (!isMyTurn(latestState) || zoneInfo.zone !== zoneName) return;

  if (selectedZone === zoneName && selectedIndices.includes(index)) {
    selectedIndices = selectedIndices.filter((i) => i !== index);
    if (selectedIndices.length === 0) selectedZone = null;
    renderGame(latestState);
    return;
  }

  const rank = cardRank(cardsArr[index]);
  if (selectedIndices.length === 0) {
    if (!isValidPlay(rank, latestState, latestState.settings)) {
      showToast('Ez a lap most nem rakható le.');
      return;
    }
    selectedZone = zoneName;
    selectedIndices = [index];
  } else {
    const selRank = cardRank(cardsArr[selectedIndices[0]]);
    if (rank !== selRank) {
      showToast(`Csak ${rankDisplay(selRank)} értékű lapot adhatsz hozzá egyszerre.`);
      return;
    }
    selectedIndices.push(index);
  }
  renderGame(latestState);
}

async function onFaceDownClick(index) {
  if (!latestState) return;
  const zoneInfo = getActiveZone(latestState, myId);
  if (!isMyTurn(latestState) || zoneInfo.zone !== 'faceDown') {
    showToast('Most nem ezt a lapot kell lejátszanod.');
    return;
  }
  try { await dispatch({ type: 'flipFaceDown', playerId: myId, index }); } catch (e) { showToast(e.message); }
}

function diffNewCards(prevHand, nextHand) {
  const counts = {};
  for (const c of (prevHand || [])) counts[c] = (counts[c] || 0) + 1;
  return nextHand.map((c) => {
    if (counts[c] > 0) { counts[c]--; return false; }
    return true;
  });
}

// Rövid piros villanás egy elemen (pl. amikor valaki felveszi a teljes
// dobott paklit) – az osztály eltávolítása + reflow kényszerítése teszi
// lehetővé, hogy ismételt eseményeknél is újrainduljon az animáció.
function flashRed(el) {
  if (!el) return;
  el.classList.remove('flash-pickup');
  void el.offsetWidth;
  el.classList.add('flash-pickup');
}

function applyHandOverlap(el, count) {
  if (count <= 1) {
    el.classList.remove('overlapping');
    el.style.removeProperty('--card-step');
    el.style.removeProperty('--card-w');
    return;
  }
  const firstCard = el.querySelector('.card');
  if (!firstCard) return;
  const cardW = firstCard.offsetWidth;
  const containerW = el.offsetWidth;
  if (!containerW || !cardW) return;

  const naturalWidth = count * cardW + (count - 1) * 8;
  if (naturalWidth <= containerW) {
    el.classList.remove('overlapping');
    el.style.removeProperty('--card-step');
    el.style.removeProperty('--card-w');
    return;
  }

  const minVisible = 20;
  const step = Math.max(minVisible, Math.floor((containerW - cardW) / (count - 1)));
  el.classList.add('overlapping');
  el.style.setProperty('--card-w', cardW + 'px');
  el.style.setProperty('--card-step', step + 'px');
}

window.addEventListener('resize', () => {
  const handEl = document.getElementById('hand-container');
  if (handEl && latestState?.hands[myId]) {
    requestAnimationFrame(() => applyHandOverlap(handEl, latestState.hands[myId].length));
  }
});

function renderGame(state) {
  document.getElementById('game-room-code').textContent = roomCode;
  document.getElementById('round-pill').textContent = `${state.roundNumber || 1}. kör`;

  renderOpponents(state);
  renderModifierBadges(state);

  const discardEl = document.getElementById('discard-pile');
  const top = state.discard[state.discard.length - 1];
  if (top) {
    discardEl.className = cardClass(top);
    discardEl.innerHTML = cardInnerHtml(top);
  } else {
    discardEl.className = 'card';
    discardEl.innerHTML = '<span style="font-size:0.65rem;color:var(--text-dim);">üres</span>';
  }
  document.getElementById('discard-count').textContent = state.discard.length;

  document.getElementById('deck-count').textContent = state.deck.length;

  const myTurn = isMyTurn(state);
  const zoneInfo = clearSelectionIfStale(state);
  const current = state.players[state.currentPlayerIndex];

  const turnEl = document.getElementById('turn-indicator');
  if (myTurn && zoneInfo.zone === 'faceDown') {
    turnEl.textContent = 'Te jössz! Fordíts fel egy lapot.';
  } else if (myTurn && zoneInfo.zone === 'faceUp') {
    turnEl.textContent = 'Te jössz! (a felfordított lapjaidból)';
  } else if (myTurn) {
    turnEl.textContent = 'Te jössz!';
  } else {
    turnEl.textContent = current ? `${current.name} jön...` : '';
  }

  const canPlaySomething = myTurn && hasAnyValidPlay(state, myId);

  const btnPickup = document.getElementById('btn-pickup-pile');
  const showPickup = myTurn && state.discard.length > 0 && zoneInfo.zone !== 'none' &&
    (!canPlaySomething || state.settings.voluntaryPickup);
  btnPickup.classList.toggle('hidden', !showPickup);
  btnPickup.textContent = canPlaySomething ? 'Pakli felvétele (blöff)' : 'Pakli felvétele';

  const btnBlind = document.getElementById('btn-blind-draw');
  const showBlind = myTurn && zoneInfo.zone === 'hand' && state.settings.blindDrawAttempt &&
    state.deck.length > 0 && !canPlaySomething && (state.hands[myId] || []).length > 0;
  btnBlind.classList.toggle('hidden', !showBlind);

  const btnForceSkip = document.getElementById('btn-force-skip');
  btnForceSkip.classList.toggle('hidden', !(current && !current.connected));

  const logEl = document.getElementById('game-log');
  logEl.innerHTML = '';
  for (const entry of state.log.slice(-6)) {
    const div = document.createElement('div');
    div.textContent = entry.text;
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;

  // --- saját zónák ---
  const myHand = state.hands[myId] || [];
  const myFaceUp = state.faceUp[myId] || [];
  const myFaceDown = state.faceDown[myId] || [];

  document.getElementById('my-facedown-count').textContent = myFaceDown.length;
  document.getElementById('my-facedown-label').classList.toggle('is-active', myTurn && zoneInfo.zone === 'faceDown');
  const facedownEl = document.getElementById('my-facedown');
  facedownEl.innerHTML = '';
  for (let i = 0; i < myFaceDown.length; i++) {
    const el = document.createElement('div');
    el.className = 'card card-back';
    el.classList.add(myTurn && zoneInfo.zone === 'faceDown' ? 'playable' : 'disabled');
    el.addEventListener('click', () => onFaceDownClick(i));
    facedownEl.appendChild(el);
  }

  document.getElementById('my-faceup-label').classList.toggle('is-active', myTurn && zoneInfo.zone === 'faceUp');
  const faceupEl = document.getElementById('my-faceup');
  faceupEl.innerHTML = '';
  const faceUpIsActive = myTurn && zoneInfo.zone === 'faceUp';
  myFaceUp.forEach((c, i) => faceupEl.appendChild(buildZoneCardEl(c, i, 'faceUp', faceUpIsActive, myFaceUp)));

  document.getElementById('my-hand-label').classList.toggle('is-active', myTurn && zoneInfo.zone === 'hand');
  document.getElementById('my-hand-count').textContent = `${myHand.length} lap`;

  let newFlags = null;
  if (previousState && previousState.status === 'playing' && state.status === 'playing' && !prefersReducedMotion()) {
    newFlags = diffNewCards(previousState.hands[myId] || [], myHand);
  }

  const handEl = document.getElementById('hand-container');
  handEl.innerHTML = '';
  const handIsActive = myTurn && zoneInfo.zone === 'hand';
  myHand.forEach((c, i) => {
    const el = buildZoneCardEl(c, i, 'hand', handIsActive, myHand);
    if (newFlags && newFlags[i]) el.classList.add('card-enter');
    handEl.appendChild(el);
  });
  requestAnimationFrame(() => applyHandOverlap(handEl, myHand.length));

  // Dobott lap "landolása", ha változott a tetejen lévő lap
  if (!prefersReducedMotion() && previousState && (previousState.discard || []).length !== state.discard.length) {
    discardEl.classList.remove('discard-landing');
    requestAnimationFrame(() => discardEl.classList.add('discard-landing'));
  }

  // Valaki felvette a teljes dobott paklit -> rövid piros villanás nála.
  // (lastFlashedPickupTs követi, melyik eseményt villantottuk már fel, hogy
  // egy puszta lapkijelölés – ami szintén renderGame()-et hív – ne indítsa
  // újra ugyanazt az animációt.)
  if (lastFlashedPickupTs === undefined) {
    lastFlashedPickupTs = state.lastPickup ? state.lastPickup.ts : null;
  } else if (state.lastPickup && state.lastPickup.ts !== lastFlashedPickupTs) {
    lastFlashedPickupTs = state.lastPickup.ts;
    if (!prefersReducedMotion()) {
      if (state.lastPickup.playerId === myId) {
        flashRed(document.getElementById('hand-wrap'));
      } else {
        flashRed(document.querySelector(`.opponent-chip[data-player-id="${state.lastPickup.playerId}"]`));
      }
    }
  }

  const btnPlay = document.getElementById('btn-play-selected');
  if (selectedIndices.length > 0) {
    btnPlay.textContent = selectedIndices.length > 1 ? `Lerakás (${selectedIndices.length} lap)` : 'Lerakás';
    btnPlay.classList.remove('hidden');
  } else {
    btnPlay.classList.add('hidden');
  }
}

document.getElementById('btn-play-selected').addEventListener('click', async () => {
  if (!selectedZone || selectedIndices.length === 0) return;
  const zone = selectedZone;
  const indices = [...selectedIndices];
  selectedZone = null;
  selectedIndices = [];
  try { await dispatch({ type: 'playCards', playerId: myId, zone, indices }); }
  catch (e) { showToast(e.message); }
});

document.getElementById('btn-pickup-pile').addEventListener('click', async () => {
  try { await dispatch({ type: 'pickupPile', playerId: myId }); } catch (e) { showToast(e.message); }
});
document.getElementById('btn-blind-draw').addEventListener('click', async () => {
  try { await dispatch({ type: 'blindDraw', playerId: myId }); } catch (e) { showToast(e.message); }
});
document.getElementById('btn-force-skip').addEventListener('click', async () => {
  try { await dispatch({ type: 'forceSkip' }); } catch (e) { showToast(e.message); }
});

// ----------------------------------------------------------------------
// Kör vége
// ----------------------------------------------------------------------
document.getElementById('btn-next-round').addEventListener('click', async () => {
  try { await dispatch({ type: 'nextRound' }); } catch (e) { showToast(e.message); }
});
document.getElementById('btn-new-game').addEventListener('click', async () => {
  try { await dispatch({ type: 'returnToLobby' }); } catch (e) { showToast(e.message); }
});

function renderEnd(state) {
  const winner = state.players.find((p) => p.id === state.winnerId);
  const loser = state.players.find((p) => p.id === state.loserId);

  document.getElementById('end-title').textContent = winner ? `🏆 ${winner.name} nyerte a kört!` : 'Kör vége';
  document.getElementById('end-subtitle').textContent = loser ? `🍻 ${loser.name} a holland kocsma vesztese ezúttal.` : '';

  const ranking = [...state.finishedOrder];
  if (state.loserId) ranking.push(state.loserId);

  const listEl = document.getElementById('placement-list');
  listEl.innerHTML = '';
  ranking.forEach((id, i) => {
    const p = state.players.find((pl) => pl.id === id);
    if (!p) return;
    const li = document.createElement('li');
    if (id === state.loserId) li.classList.add('is-loser');
    if (id === myId) li.classList.add('me');
    const crown = i === 0 ? ' 🏆' : '';
    const loserTag = id === state.loserId ? ' 🍻 vesztes' : '';
    li.innerHTML = `<span class="place-rank">${i + 1}.</span><span>${escapeHtml(p.name)}${crown}${loserTag}</span>`;
    listEl.appendChild(li);
  });

  const scoresEl = document.getElementById('end-scores');
  scoresEl.innerHTML = '';
  const header = document.createElement('tr');
  header.innerHTML = '<th>Játékos</th><th>Vesztések</th>';
  scoresEl.appendChild(header);
  const sorted = [...state.players].sort((a, b) => (b.lossCount || 0) - (a.lossCount || 0));
  for (const p of sorted) {
    const row = document.createElement('tr');
    if (p.id === myId) row.classList.add('me');
    row.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.lossCount || 0}</td>`;
    scoresEl.appendChild(row);
  }
}

// ----------------------------------------------------------------------
// Fő render
// ----------------------------------------------------------------------
function render() {
  if (!latestState) return;
  if (latestState.status !== 'setup') armedSetup = null;

  if (latestState.status === 'lobby') {
    showScreen('screen-lobby');
    renderLobby(latestState);
  } else if (latestState.status === 'setup') {
    showScreen('screen-setup');
    renderSetup(latestState);
  } else if (latestState.status === 'playing') {
    showScreen('screen-game');
    renderGame(latestState);
  } else {
    showScreen('screen-end');
    renderEnd(latestState);
  }
  maybeScheduleBotMoves(latestState);
}

// ----------------------------------------------------------------------
// Kapcsolat állapot jelzése (best effort – lapváltáskor / bezáráskor)
// ----------------------------------------------------------------------
window.addEventListener('pagehide', () => {
  if (roomCode) dispatch({ type: 'setConnected', playerId: myId, connected: false }).catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && roomCode) dispatch({ type: 'setConnected', playerId: myId, connected: true }).catch(() => {});
});

// ============================================================
// Dev mód – fejlesztői eszközök (ugyanaz a minta, mint a Colorcardsnál)
// ============================================================
const activeBots = new Map();
const scheduledBots = new Set();

function getBotAction(state, botId) {
  const players = state.players;
  const botIdx = players.findIndex((p) => p.id === botId);
  if (botIdx === -1 || botIdx !== state.currentPlayerIndex) return null;
  if (state.finishedOrder.includes(botId)) return null;

  const zoneInfo = getActiveZone(state, botId);

  if (zoneInfo.zone === 'faceDown') {
    const fd = state.faceDown[botId] || [];
    if (fd.length === 0) return null;
    return { type: 'flipFaceDown', playerId: botId, index: Math.floor(Math.random() * fd.length) };
  }

  if (zoneInfo.zone === 'hand' || zoneInfo.zone === 'faceUp') {
    const cards = zoneInfo.cards;
    const playableIdx = cards.map((c, i) => i).filter((i) => isValidPlay(cardRank(cards[i]), state, state.settings));
    if (playableIdx.length > 0) {
      const chosenIdx = playableIdx[Math.floor(Math.random() * playableIdx.length)];
      const chosenRank = cardRank(cards[chosenIdx]);
      let group = cards.map((c, i) => i).filter((i) => cardRank(cards[i]) === chosenRank);
      if (state.settings.restrictPairPlay && group.length === 2) group = [chosenIdx];
      else if (group.length > 1 && Math.random() < 0.4) group = [chosenIdx];
      return { type: 'playCards', playerId: botId, zone: zoneInfo.zone, indices: group };
    }
    if (zoneInfo.zone === 'hand' && state.settings.blindDrawAttempt && state.deck.length > 0 && Math.random() < 0.6) {
      return { type: 'blindDraw', playerId: botId };
    }
    return { type: 'pickupPile', playerId: botId };
  }
  return null;
}

function maybeScheduleBotMoves(state) {
  if (!state || activeBots.size === 0) return;

  if (state.status === 'setup') {
    for (const [botId] of activeBots) {
      if (state.readySetup[botId] || scheduledBots.has(botId)) continue;
      scheduledBots.add(botId);
      setTimeout(async () => {
        scheduledBots.delete(botId);
        try { await dispatch({ type: 'setReady', playerId: botId, ready: true }); } catch (e) { /* mindegy */ }
      }, 500 + Math.random() * 800);
    }
    return;
  }

  if (state.status !== 'playing') return;

  for (const [botId] of activeBots) {
    if (scheduledBots.has(botId)) continue;
    if (state.currentPlayerIndex !== state.players.findIndex((p) => p.id === botId)) continue;

    scheduledBots.add(botId);
    const delay = 800 + Math.random() * 1200;

    setTimeout(async () => {
      scheduledBots.delete(botId);
      const current = latestState;
      if (!current || current.status !== 'playing') return;
      if (current.currentPlayerIndex !== current.players.findIndex((p) => p.id === botId)) return;

      try {
        const action = getBotAction(current, botId);
        if (action) await dispatch(action);
      } catch (e) {
        console.log(`[Bot ${botId}]`, e.message);
      }
    }, delay);
  }
}

function updateDevPanel() {
  const statusEl = document.getElementById('dev-bot-status');
  if (!statusEl) return;
  statusEl.textContent = activeBots.size === 0
    ? 'Nincs aktív bot.'
    : `Aktív (${activeBots.size}): ${[...activeBots.values()].join(', ')}`;
}

function initDevMode() {
  const isActive = localStorage.getItem('hk_dev_mode') === '1';

  const devBtn = document.createElement('button');
  devBtn.id = 'dev-btn';
  devBtn.title = 'Dev mód';
  devBtn.textContent = '🛠️';
  if (!isActive) devBtn.classList.add('hidden');
  document.body.appendChild(devBtn);

  const devPanel = document.createElement('div');
  devPanel.id = 'dev-panel';
  devPanel.classList.add('hidden');
  devPanel.innerHTML = `
    <h3>🛠️ Dev mód</h3>
    <button id="dev-add-bot" class="btn btn-secondary">🤖 Buta bot hozzáadása</button>
    <button id="dev-clear-bots" class="btn btn-text">🗑️ Összes bot eltávolítása</button>
    <div id="dev-bot-status" class="dev-bot-status">Nincs aktív bot.</div>
  `;
  document.body.appendChild(devPanel);

  devBtn.addEventListener('click', (e) => { e.stopPropagation(); devPanel.classList.toggle('hidden'); });
  document.addEventListener('click', () => devPanel.classList.add('hidden'));
  devPanel.addEventListener('click', (e) => e.stopPropagation());

  document.getElementById('dev-add-bot').addEventListener('click', async () => {
    if (!roomCode) { showToast('Előbb csatlakozz egy szobához!'); return; }
    if (latestState?.status !== 'lobby') { showToast('Csak lobbiban lehet botot hozzáadni.'); return; }
    if (activeBots.size >= 5) { showToast('Maximum 5 bot adható hozzá.'); return; }
    const n = activeBots.size + 1;
    const name = `🤖 Bot ${n}`;
    const id = 'bot-' + Math.random().toString(36).slice(2, 8);
    try {
      await dispatch({ type: 'join', playerId: id, name });
      activeBots.set(id, name);
      updateDevPanel();
      showToast(`${name} csatlakozott a szobához.`);
    } catch (e) {
      showToast('Bot hozzáadása sikertelen: ' + e.message);
    }
  });

  document.getElementById('dev-clear-bots').addEventListener('click', async () => {
    for (const [id] of activeBots) {
      try { await dispatch({ type: 'leave', playerId: id }); } catch (e) { /* mindegy */ }
    }
    activeBots.clear();
    scheduledBots.clear();
    updateDevPanel();
    showToast('Összes bot eltávolítva.');
    devPanel.classList.add('hidden');
  });

  let clickCount = 0;
  let clickTimer = null;
  const titleEl = document.querySelector('#screen-home .title');
  if (titleEl) {
    titleEl.addEventListener('click', () => {
      clickCount++;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { clickCount = 0; }, 2500);
      if (clickCount >= 10) {
        clickCount = 0;
        localStorage.setItem('hk_dev_mode', '1');
        devBtn.classList.remove('hidden');
        showToast('🛠️ Dev mód aktiválva!');
      }
    });
  }
}

initDevMode();
