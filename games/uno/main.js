// ============================================================================
// UNO – UI + Firebase szinkronizálás
// ============================================================================
// Ez a fájl köti össze a game-engine.js tiszta logikáját a Firestore
// adatbázissal és a képernyőn megjelenő elemekkel. Minden játékos böngészője
// ugyanazt a `rooms/{kód}` dokumentumot olvassa (onSnapshot) és írja
// (runTransaction) – így mindenki ugyanazt az állapotot látja valós időben.
// ============================================================================

import { doc, getDoc, setDoc, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-config.js';
import {
  applyMove, createInitialState, SETTINGS_META,
  cardColor, cardValue, isValidPlay,
} from './game-engine.js';

// ----------------------------------------------------------------------
// Állapot
// ----------------------------------------------------------------------
const myId = getOrCreatePlayerId();
let roomCode = null;
let latestState = null;
let unsubscribe = null;
let pendingPlay = null; // { card } – amíg a szín- vagy 7-es modál nyitva van

// ----------------------------------------------------------------------
// Segédfüggvények
// ----------------------------------------------------------------------
function getOrCreatePlayerId() {
  let id = localStorage.getItem('uno_player_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'p-' + Math.random().toString(36).slice(2, 10));
    localStorage.setItem('uno_player_id', id);
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

const VALUE_DISPLAY = { skip: '⊘', reverse: '⇄', draw2: '+2', wild: '★', draw4: '+4' };
function displayValue(value) {
  return VALUE_DISPLAY[value] !== undefined ? VALUE_DISPLAY[value] : value;
}
function cardInnerHtml(card) {
  const text = displayValue(cardValue(card));
  return `<span class="card-corner tl">${text}</span><span class="card-value">${text}</span><span class="card-corner br">${text}</span>`;
}
const COLOR_VAR = { red: 'var(--uno-red)', yellow: 'var(--uno-yellow)', green: 'var(--uno-green)', blue: 'var(--uno-blue)' };

// ----------------------------------------------------------------------
// Firestore: szoba létrehozása / csatlakozás / dispatch
// ----------------------------------------------------------------------
async function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // I, L, O, 0, 1 kihagyva (félreérthetők)
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const snap = await getDoc(doc(db, 'rooms', code));
    if (!snap.exists()) return code;
  }
  throw new Error('Nem sikerült szabad szobakódot találni, próbáld újra.');
}

async function dispatch(action) {
  if (!roomCode) throw new Error('Nincs aktív szoba.');
  const ref = doc(db, 'rooms', roomCode);
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
  const ref = doc(db, 'rooms', roomCode);
  unsubscribe = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        showToast('A szoba megszűnt.');
        roomCode = null;
        latestState = null;
        showScreen('screen-home');
        return;
      }
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
  const savedName = localStorage.getItem('uno_player_name');
  if (savedName) nameInput.value = savedName;
  const params = new URLSearchParams(location.search);
  const presetRoom = params.get('room');
  if (presetRoom) codeInput.value = presetRoom.toUpperCase();
})();

document.getElementById('btn-create-room').addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) return showHomeError('Adj meg egy nevet!');
  localStorage.setItem('uno_player_name', name);
  showHomeError('');
  try {
    const code = await generateRoomCode();
    const state = createInitialState();
    state.players.push({ id: myId, name, score: 0, connected: true });
    await setDoc(doc(db, 'rooms', code), state);
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
  localStorage.setItem('uno_player_name', name);
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
// Lobbi
// ----------------------------------------------------------------------
document.getElementById('btn-copy-code').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Colorcard szoba', text: url });
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
  showScreen('screen-home');
});

document.getElementById('btn-start-game').addEventListener('click', async () => {
  try { await dispatch({ type: 'startGame' }); } catch (e) { showToast(e.message); }
});

function renderSettingsPanel(settings) {
  const panel = document.getElementById('settings-panel');
  const active = document.activeElement;
  // Ne rajzoljuk újra, ha épp egy számmezőbe ír valaki (elveszne a fókusz/gépelés)
  if (panel.contains(active) && active.tagName === 'INPUT' && active.type === 'number') return;

  panel.innerHTML = '';
  for (const meta of SETTINGS_META) {
    if (meta.showIf && !meta.showIf(settings)) continue;
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
      if (meta.step) control.step = meta.step;
      control.value = settings[meta.key];
      control.addEventListener('change', () => {
        let v = Number(control.value);
        if (Number.isNaN(v)) v = settings[meta.key];
        v = Math.min(meta.max, Math.max(meta.min, v));
        control.value = v;
        updateSetting(meta.key, v);
      });
    } else if (meta.type === 'select') {
      control = document.createElement('select');
      for (const [val, text] of meta.options) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = text;
        if (settings[meta.key] === val) opt.selected = true;
        control.appendChild(opt);
      }
      control.addEventListener('change', () => updateSetting(meta.key, control.value));
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
// Játék képernyő
// ----------------------------------------------------------------------
function isCardPlayable(card, state) {
  const players = state.players;
  const myIndex = players.findIndex((p) => p.id === myId);
  const isMyTurn = myIndex === state.currentPlayerIndex;

  if (state.pendingForcedCard) {
    return isMyTurn && card === state.pendingForcedCard;
  }
  if (isMyTurn) {
    return isValidPlay(card, state, state.settings);
  }
  if (state.settings.jumpIn) {
    const top = state.discard[state.discard.length - 1];
    return card === top;
  }
  return false;
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
    const idx = players.indexOf(p);
    if (idx === state.currentPlayerIndex) chip.classList.add('active-turn');
    const handLen = (state.hands[p.id] || []).length;

    let html = `<div class="name">${escapeHtml(p.name)}</div><div class="count">${handLen} lap</div>`;
    if (!p.connected) html += '<div class="offline-tag">lecsatlakozott</div>';
    chip.innerHTML = html;

    if (handLen === 1 && !state.unoCalls[p.id]) {
      const warn = document.createElement('div');
      warn.className = 'uno-warn';
      warn.textContent = '⚠️ Nincs ONECARD! bemondva';
      chip.appendChild(warn);

      const catchBtn = document.createElement('button');
      catchBtn.className = 'btn btn-small catch-btn';
      catchBtn.textContent = 'Rajtakapom!';
      catchBtn.addEventListener('click', async () => {
        try { await dispatch({ type: 'catchUno', playerId: myId, targetId: p.id }); }
        catch (e) { showToast(e.message); }
      });
      chip.appendChild(catchBtn);
    }
    container.appendChild(chip);
  }
}

function renderGame(state) {
  document.getElementById('game-room-code').textContent = roomCode;
  document.getElementById('direction-indicator').textContent = state.direction === 1 ? '➡️' : '⬅️';

  renderOpponents(state);

  // Dobott lap
  const top = state.discard[state.discard.length - 1];
  const discardEl = document.getElementById('discard-pile');
  discardEl.className = 'card card-' + cardColor(top);
  discardEl.innerHTML = cardInnerHtml(top);

  // Pakli
  document.getElementById('deck-count').textContent = state.deck.length;

  // Aktuális szín
  document.getElementById('current-color-badge').style.background = COLOR_VAR[state.currentColor] || '#888';

  // Halmozott húzás
  const stackBadge = document.getElementById('draw-stack-badge');
  if (state.drawStack > 0) {
    stackBadge.textContent = `+${state.drawStack}`;
    stackBadge.classList.remove('hidden');
  } else {
    stackBadge.classList.add('hidden');
  }

  // Kinek a köre
  const current = state.players[state.currentPlayerIndex];
  const isMyTurn = current && current.id === myId;
  const turnEl = document.getElementById('turn-indicator');
  if (isMyTurn && state.pendingForcedCard) {
    turnEl.textContent = 'Játszd le a húzott lapot!';
  } else if (isMyTurn) {
    turnEl.textContent = state.drawStack > 0
      ? `Te jössz! Húzhatsz ${state.drawStack} lapot, vagy felülüthetsz.`
      : 'Te jössz!';
  } else {
    turnEl.textContent = current ? `${current.name} jön...` : '';
  }

  // Gombok
  const btnDraw = document.getElementById('btn-draw');
  btnDraw.disabled = !isMyTurn || !!state.pendingForcedCard;
  btnDraw.textContent = state.drawStack > 0 ? `Húzás (+${state.drawStack})` : 'Húzás';

  const btnChallenge = document.getElementById('btn-challenge');
  const showChallenge = isMyTurn && state.drawStack > 0 && state.lastWild4 && state.settings.drawFourChallenge;
  btnChallenge.classList.toggle('hidden', !showChallenge);

  const btnForceSkip = document.getElementById('btn-force-skip');
  if (btnForceSkip) {
    btnForceSkip.classList.toggle('hidden', !(current && !current.connected));
  }

  const myHand = state.hands[myId] || [];
  document.getElementById('btn-call-uno').classList.toggle('hidden', !(myHand.length === 1 && !state.unoCalls[myId]));

  // Napló
  const logEl = document.getElementById('game-log');
  logEl.innerHTML = '';
  for (const entry of state.log.slice(-6)) {
    const div = document.createElement('div');
    div.textContent = entry.text;
    logEl.appendChild(div);
  }
  logEl.scrollTop = logEl.scrollHeight;

  // Kezem
  document.getElementById('my-name-label').textContent = 'A kezed';
  document.getElementById('my-hand-count').textContent = `${myHand.length} lap`;
  const handEl = document.getElementById('hand-container');
  handEl.innerHTML = '';
  for (const card of myHand) {
    const el = document.createElement('div');
    el.className = 'card card-' + cardColor(card);
    el.innerHTML = cardInnerHtml(card);
    const forced = isMyTurn && state.pendingForcedCard === card;
    const playable = isCardPlayable(card, state);
    if (forced) el.classList.add('forced');
    else if (playable) el.classList.add('playable');
    else el.classList.add('disabled');
    el.addEventListener('click', () => onCardClick(card, state));
    handEl.appendChild(el);
  }
}

function onCardClick(card, state) {
  if (state.status !== 'playing') return;
  if (!isCardPlayable(card, state)) {
    showToast('Ez a lap most nem rakható le.');
    return;
  }
  const color = cardColor(card);
  const value = cardValue(card);
  if (color === 'wild') {
    pendingPlay = { card };
    openModal('modal-color');
  } else if (value === '7' && state.settings.sevenZero) {
    pendingPlay = { card };
    openSevenModal(state);
  } else {
    sendPlay(card, {});
  }
}

async function sendPlay(card, extra) {
  try { await dispatch({ type: 'play', playerId: myId, card, ...extra }); }
  catch (e) { showToast(e.message); }
}

function openSevenModal(state) {
  const list = document.getElementById('seven-target-list');
  list.innerHTML = '';
  for (const p of state.players) {
    if (p.id === myId) continue;
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      closeModal('modal-seven');
      if (pendingPlay) { sendPlay(pendingPlay.card, { sevenTarget: p.id }); pendingPlay = null; }
    });
    list.appendChild(btn);
  }
  openModal('modal-seven');
}

document.querySelectorAll('.color-choice').forEach((btn) => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    closeModal('modal-color');
    if (pendingPlay) { sendPlay(pendingPlay.card, { chosenColor: color }); pendingPlay = null; }
  });
});

document.getElementById('btn-draw').addEventListener('click', async () => {
  try { await dispatch({ type: 'draw', playerId: myId }); } catch (e) { showToast(e.message); }
});

document.getElementById('draw-pile').addEventListener('click', async () => {
  if (document.getElementById('btn-draw').disabled) return;
  try { await dispatch({ type: 'draw', playerId: myId }); } catch (e) { showToast(e.message); }
});

document.getElementById('btn-challenge').addEventListener('click', async () => {
  try { await dispatch({ type: 'challenge', playerId: myId }); } catch (e) { showToast(e.message); }
});

document.getElementById('btn-call-uno').addEventListener('click', async () => {
  try { await dispatch({ type: 'callUno', playerId: myId }); } catch (e) { showToast(e.message); }
});

const btnForceSkipEl = document.getElementById('btn-force-skip');
if (btnForceSkipEl) {
  btnForceSkipEl.addEventListener('click', async () => {
    try { await dispatch({ type: 'forceSkip' }); } catch (e) { showToast(e.message); }
  });
}

// ----------------------------------------------------------------------
// Szabályok modál
// ----------------------------------------------------------------------
document.getElementById('btn-show-rules').addEventListener('click', () => {
  if (!latestState) return;
  const el = document.getElementById('rules-summary');
  el.innerHTML = '';
  for (const meta of SETTINGS_META) {
    if (meta.showIf && !meta.showIf(latestState.settings)) continue;
    let valueText;
    if (meta.type === 'bool') valueText = latestState.settings[meta.key] ? 'Be' : 'Ki';
    else if (meta.type === 'select') {
      const found = meta.options.find(([v]) => v === latestState.settings[meta.key]);
      valueText = found ? found[1] : latestState.settings[meta.key];
    } else valueText = latestState.settings[meta.key];
    const row = document.createElement('div');
    row.innerHTML = `<span class="rule-name">${escapeHtml(meta.label)}:</span> <span class="rule-value">${escapeHtml(String(valueText))}</span>`;
    el.appendChild(row);
  }
  openModal('modal-rules');
});
document.getElementById('btn-close-rules').addEventListener('click', () => closeModal('modal-rules'));

// ----------------------------------------------------------------------
// Kör / játék vége
// ----------------------------------------------------------------------
document.getElementById('btn-next-round').addEventListener('click', async () => {
  try { await dispatch({ type: 'nextRound' }); } catch (e) { showToast(e.message); }
});
document.getElementById('btn-new-game').addEventListener('click', async () => {
  try { await dispatch({ type: 'returnToLobby' }); } catch (e) { showToast(e.message); }
});

function renderEnd(state) {
  const titleEl = document.getElementById('end-title');
  const subEl = document.getElementById('end-subtitle');
  const scoresEl = document.getElementById('end-scores');
  const btnNext = document.getElementById('btn-next-round');
  const btnNew = document.getElementById('btn-new-game');

  const winner = state.players.find((p) => p.id === state.winnerId);
  const winnerName = winner ? winner.name : '???';
  const targetMode = state.settings.scoringMode === 'target';

  if (state.status === 'finished') {
    titleEl.textContent = `🏆 ${winnerName} nyert!`;
    subEl.textContent = targetMode
      ? `Elérte vagy túllépte a ${state.settings.targetScore} pontot.`
      : 'Elsőként kiürítette a kezét.';
    btnNext.classList.add('hidden');
    btnNew.classList.remove('hidden');
  } else {
    titleEl.textContent = `${winnerName} nyerte ezt a kört!`;
    subEl.textContent = targetMode ? `+${state.roundPoints} pontot kapott a többiek kézben maradt lapjaiért.` : '';
    btnNext.classList.remove('hidden');
    btnNew.classList.add('hidden');
  }

  scoresEl.innerHTML = '';
  if (targetMode) {
    const header = document.createElement('tr');
    header.innerHTML = '<th>Játékos</th><th>Pont</th>';
    scoresEl.appendChild(header);
    const sorted = [...state.players].sort((a, b) => (b.score || 0) - (a.score || 0));
    for (const p of sorted) {
      const row = document.createElement('tr');
      if (p.id === myId) row.classList.add('me');
      row.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.score || 0}</td>`;
      scoresEl.appendChild(row);
    }
  }
}

// ----------------------------------------------------------------------
// Fő render
// ----------------------------------------------------------------------
function render() {
  if (!latestState) return;
  if (latestState.status === 'lobby') {
    showScreen('screen-lobby');
    renderLobby(latestState);
  } else if (latestState.status === 'playing') {
    showScreen('screen-game');
    renderGame(latestState);
  } else {
    showScreen('screen-end');
    renderEnd(latestState);
  }
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
