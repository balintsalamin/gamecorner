// ============================================================================
// Pew! – Főlogika (Firebase + UI)
// ============================================================================
import { db } from './firebase-config.js';
import { doc, runTransaction, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  applyMove, createInitialState, CARD_DEFS, CHARACTERS,
  ROLE_NAMES, ROLE_EMOJIS, ROLE_GOALS, ROLE_DISTRIBUTION,
  cardType, cardName, cardEmoji, cardRS,
  getValidTargets, canPlayCard, whoNeedsToRespond
} from './game-engine.js';

// ─── Globális állapot ─────────────────────────────────────────────────────────
let myId = localStorage.getItem('pewId');
if (!myId) {
  myId = 'p' + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
  localStorage.setItem('pewId', myId);
}
let myName = '', roomCode = '', latestState = null, unsubscribe = null;
let prevPlayerIndex = -1, startTurnSent = false;
let pendingPlay = null; // { cardId, stage: 'target'|'tablecards', targetIdx, action }
let selectedDiscardIds = [], docHealIds = [];

// ─── Firebase ─────────────────────────────────────────────────────────────────
const COL = 'pewRooms';

async function dispatch(action) {
  if (!roomCode) return;
  const ref = doc(db, COL, roomCode);
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const state = snap.exists() ? snap.data().state : createInitialState();
      const next = applyMove(state, { ...action, playerId: myId });
      tx.set(ref, { state: next, updatedAt: Date.now() });
    });
  } catch (e) {
    console.error('dispatch error', e);
    showToast('Hiba: ' + e.message, 'danger');
  }
}

function subscribeRoom(code) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  const ref = doc(db, COL, code);
  unsubscribe = onSnapshot(ref, snap => {
    if (!snap.exists()) return;
    latestState = snap.data().state;
    render(latestState);
  });
}

// ─── Képernyőváltás ───────────────────────────────────────────────────────────
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
function openOverlay(id)  { document.getElementById(id)?.classList.add('visible'); }
function closeOverlay(id) { document.getElementById(id)?.classList.remove('visible'); }

// ─── Toast értesítés ──────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'toast';
    t.style.cssText = `position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);
      background:var(--surface);border:1px solid var(--border);border-radius:10px;
      padding:.65rem 1.2rem;font-size:.82rem;z-index:999;transition:opacity .3s;max-width:90vw;text-align:center;`;
    document.body.appendChild(t);
  }
  if (type === 'danger') t.style.borderColor = 'var(--danger)';
  else if (type === 'safe') t.style.borderColor = 'var(--safe)';
  else t.style.borderColor = 'var(--border)';
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

// ─── Főrenderer ───────────────────────────────────────────────────────────────
function render(state) {
  if (!state) return;

  // Körváltás animáció kiváltása
  if (state.phase === 'playing') {
    if (state.currentPlayerIndex !== prevPlayerIndex) {
      if (prevPlayerIndex !== -1) {
        startTurnSent = false;
        pendingPlay = null;
        selectedDiscardIds = []; docHealIds = [];
        showTurnOverlay(state);
      } else {
        // Első betöltés, játék már fut
        startTurnSent = false;
        setTimeout(() => maybeAutoStartTurn(state), 800);
      }
      prevPlayerIndex = state.currentPlayerIndex;
    }
  } else {
    prevPlayerIndex = -1;
  }

  switch (state.phase) {
    case 'lobby':     goTo('screen-lobby');      renderLobby(state);     break;
    case 'charSelect':goTo('screen-charselect'); renderCharSelect(state);break;
    case 'playing':   goTo('screen-game');       renderGame(state);      break;
    case 'gameOver':  goTo('screen-gameover');   renderGameOver(state);  break;
  }

  maybeScheduleBotMoves(state);
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function renderLobby(state) {
  document.getElementById('lbl-room-code').textContent = roomCode;
  const el = document.getElementById('lobby-players');
  el.innerHTML = '';
  state.players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'lobby-player' + (p.id === myId ? ' me' : '');
    row.innerHTML = `<div class="lp-avatar">👤</div>
      <span style="font-weight:600">${esc(p.name)}</span>
      ${p.id === myId ? '<span class="pr-you-tag">Te</span>' : ''}`;
    el.appendChild(row);
  });
  const n = state.players.length;
  const canStart = n >= 4;
  const isHost = state.players[0]?.id === myId;
  const btn = document.getElementById('btn-start');
  btn.style.display = isHost && canStart ? '' : 'none';
  document.querySelector('#screen-lobby .lobby-info').textContent =
    n < 4 ? `Várakozás… (${n}/4 játékos szükséges)` :
    isHost ? 'Elég játékos! Indítsd el a játékot.' :
    `${n} játékos – a hosztot várjuk.`;
}

// ─── Karakterválasztás ────────────────────────────────────────────────────────
function renderCharSelect(state) {
  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  // Szerep megjelenítése
  const roleEl = document.getElementById('role-reveal');
  const rn = ROLE_NAMES[me.role] || me.role;
  const ri = ROLE_EMOJIS[me.role] || '';
  const rc = `role-${me.role}`;
  roleEl.innerHTML = `<div class="role-name ${rc}">${ri} ${rn}</div>
    <div class="role-goal">${ROLE_GOALS[me.role] || ''}</div>`;

  if (me.character) {
    // Már választott
    document.getElementById('char-options').innerHTML = '';
    document.getElementById('charselect-waiting').classList.remove('hidden');
    return;
  }
  document.getElementById('charselect-waiting').classList.add('hidden');

  const container = document.getElementById('char-options');
  if (container.childElementCount > 0) return; // Ne újrarenderelje feleslegesen

  container.innerHTML = '';
  (me.charOptions || []).forEach(key => {
    const ch = CHARACTERS[key];
    if (!ch) return;
    const card = document.createElement('div');
    card.className = 'char-card'; card.dataset.charKey = key;
    card.innerHTML = `<div class="char-card-name">${esc(ch.name)}</div>
      <div class="char-card-hp">${'❤️'.repeat(ch.hp)} (${ch.hp} HP)</div>
      <div class="char-card-ability">${esc(ch.ability)}</div>`;
    card.addEventListener('click', () => {
      container.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      setTimeout(() => dispatch({ type:'chooseChar', charKey:key }), 200);
    });
    container.appendChild(card);
  });
}

// ─── Játékképernyő ────────────────────────────────────────────────────────────
function renderGame(state) {
  renderTurnBanner(state);
  renderPlayerList(state);
  renderBoard(state);
  renderMyArea(state);
  renderActionBar(state);
  renderReactOverlay(state);
}

function renderTurnBanner(state) {
  const curr = state.players[state.currentPlayerIndex];
  const isMe = curr?.id === myId;
  const banner = document.getElementById('turn-banner');
  banner.className = 'turn-banner' + (isMe ? ' my-turn' : '');
  const nameEl = document.getElementById('turn-banner-name');
  nameEl.className = 'turn-name' + (isMe ? ' my' : '');
  nameEl.textContent = isMe ? '⭐ TE JÖSSZ' : (curr ? curr.name + ' köre' : '');

  const phaseMap = { startOfTurn:'Kör kezdése', draw:'Húzás', play:'Játék', discard:'Dobás' };
  document.getElementById('turn-banner-phase').textContent =
    state.pending ? pendingLabel(state.pending) : (phaseMap[state.turnPhase] || '');
}

function pendingLabel(pend) {
  if (!pend) return '';
  if (pend.type === 'pew')            return '⏳ Reakció várható…';
  if (pend.type === 'duel')           return '⚔️ Párbaj folyamatban…';
  if (pend.type === 'massAttack')     return '💥 Tömegtámadás…';
  if (pend.type === 'plaza')          return '🛍️ Plázatúra…';
  if (pend.type === 'ceosDraw')       return '🎯 CéosCili húz…';
  if (pend.type === 'hackerFirstDraw')return '🔓 HackerHansi…';
  if (pend.type === 'smiLuckyFate')   return '🎲 Sors dönt…';
  return '';
}

function renderPlayerList(state) {
  const el = document.getElementById('player-list');
  el.innerHTML = '';
  state.players.forEach((p, i) => {
    const isMe = p.id === myId;
    const isCurr = i === state.currentPlayerIndex;
    const row = document.createElement('div');
    row.className = ['player-row', isMe?'is-me':'', isCurr?'is-current':'', !p.alive?'dead':''].filter(Boolean).join(' ');

    const hpStr = hpHearts(p.hp, p.maxHp);
    const charDef = p.character ? CHARACTERS[p.character] : null;
    const charName = charDef ? charDef.name : '?';
    const roleLbl = (p.role === 'sheriff' || !p.alive) ? `<span class="pr-role">${ROLE_EMOJIS[p.role]||''}</span>` : '';
    const tableEmojis = p.tableCards.map(c => `<span class="pr-table-card" title="${cardName(c)}">${cardEmoji(c)}</span>`).join('');

    row.innerHTML = `
      <div class="pr-left">
        ${isCurr ? '<span class="current-indicator">▶</span>' : ''}
        <div>
          <div class="pr-name">${esc(p.name)}${isMe ? ' <span class="pr-you-tag">Te</span>' : ''}</div>
          <div class="pr-char">${esc(charName)}</div>
        </div>
      </div>
      <div class="pr-hp">${hpStr} ${roleLbl}</div>
      <div class="pr-table">${tableEmojis}</div>`;
    el.appendChild(row);
  });
}

function hpHearts(hp, maxHp) {
  let s = '';
  for (let i = 0; i < maxHp; i++) {
    s += i < hp ? '<span class="hp-full">❤️</span>' : '<span class="hp-empty">🖤</span>';
  }
  return s;
}

function renderBoard(state) {
  document.getElementById('deck-count').textContent = state.deck.length;
  const top = state.discard[state.discard.length - 1];
  document.getElementById('discard-top').textContent = top ? `${cardEmoji(top)} ${cardName(top)}` : '—';

  const logEl = document.getElementById('game-log');
  logEl.innerHTML = [...(state.log || [])].reverse().slice(0, 8).map(m =>
    `<div class="log-entry">${esc(m)}</div>`).join('');
}

function renderMyArea(state) {
  const me = state.players.find(p => p.id === myId);
  if (!me) return;

  const charDef = me.character ? CHARACTERS[me.character] : null;
  document.getElementById('my-char-label').textContent =
    charDef ? `${charDef.name}  •  ${charDef.ability}` : '';
  document.getElementById('my-hp-display').innerHTML = hpHearts(me.hp, me.maxHp);

  const isMyTurn = state.players[state.currentPlayerIndex]?.id === myId;
  const isPlay   = state.turnPhase === 'play';
  const handEl   = document.getElementById('my-hand');
  handEl.innerHTML = '';

  me.hand.forEach(cardId => {
    const t   = cardType(cardId);
    const def = CARD_DEFS[t];
    if (!def) return;

    const playable = isMyTurn && isPlay && canPlayCard(state, state.currentPlayerIndex, cardId);
    const isDocHeal = docHealIds.includes(cardId);

    const card = document.createElement('div');
    card.className = ['card', playable ? 'playable' : isMyTurn && isPlay ? 'unplayable' : '', isDocHeal ? 'selected' : ''].filter(Boolean).join(' ');
    card.dataset.type = t;
    card.dataset.cardId = cardId;
    card.title = def.desc || '';
    card.innerHTML = `
      <div class="card-emoji">${def.emoji}</div>
      <div class="card-name">${def.name}</div>
      <div class="card-rs">${cardRS(cardId)}</div>`;

    if (playable) {
      card.addEventListener('click', () => onCardClick(cardId, state));
    } else if (isMyTurn && isPlay && charDef?.abilityKey === 'healByDiscard' && me.hp < me.maxHp) {
      // DocDani: bármely lap kattintható a gyógyításhoz
      card.addEventListener('click', () => onDocHealCardClick(cardId, state));
    }
    handEl.appendChild(card);
  });
}

function renderActionBar(state) {
  const isMyTurn = state.players[state.currentPlayerIndex]?.id === myId;
  const show = (id, vis) => { document.getElementById(id).classList.toggle('hidden', !vis); };

  show('btn-start-turn', isMyTurn && state.turnPhase === 'startOfTurn' && !state.pending);
  show('btn-draw',       isMyTurn && state.turnPhase === 'draw');
  show('btn-end-turn',   isMyTurn && state.turnPhase === 'play' && !state.pending);

  const me = state.players.find(p => p.id === myId);
  const charDef = me?.character ? CHARACTERS[me.character] : null;
  show('btn-doc-heal', isMyTurn && state.turnPhase === 'play' && !state.pending &&
       charDef?.abilityKey === 'healByDiscard' && (me?.hp || 0) < (me?.maxHp || 0));
}

// ─── Reakció overlay ─────────────────────────────────────────────────────────
function renderReactOverlay(state) {
  const info = whoNeedsToRespond(state, myId);
  if (!info) {
    closeOverlay('overlay-react');
    checkSpecialPending(state);
    return;
  }

  // Speciális pending-ek kezelése (CéosCili, HackerHansi, SzerencsésSimi, Plaza)
  if (['ceosDraw','hackerFirstDraw','smiLuckyFate','plaza'].includes(info.type)) {
    closeOverlay('overlay-react');
    checkSpecialPending(state);
    return;
  }

  openOverlay('overlay-react');
  const me = state.players.find(p => p.id === myId);

  let title = '', desc = '', validCards = [];
  if (info.type === 'pew') {
    title = `🔫 ${esc(info.attacker)} rálőtt!`;
    desc  = state.pending?.neededMisses === 2
      ? `BérgyilkosBéla képessége: 2 Kitért! szükséges! (${state.pending?.missesUsed||0}/2)`
      : 'Kivéded Kitért!-tel, vagy elviseled a találatot.';
    validCards = (me?.hand || []).filter(c => {
      const ct = cardType(c);
      const charDef = me?.character ? CHARACTERS[me.character] : null;
      return ct === 'kiteri' || (ct === 'pew' && charDef?.abilityKey === 'swapPewKiteri');
    });
  } else if (info.type === 'duel') {
    title = `⚔️ Párbaj – ${esc(info.opponent)} ellen!`;
    desc  = 'Dobj egy Pew!-t, vagy elveszíted a párbajt (-1 HP).';
    validCards = (me?.hand || []).filter(c => {
      const ct = cardType(c);
      const charDef = me?.character ? CHARACTERS[me.character] : null;
      return ct === 'pew' || (ct === 'kiteri' && charDef?.abilityKey === 'swapPewKiteri');
    });
  } else if (info.type === 'massAttack') {
    const need = info.neededCard;
    title = need === 'pew' ? '🤖 Dróncsapás!' : '💥 Géppuska tüze!';
    desc  = need === 'pew' ? 'Dobj egy Pew!-t, vagy -1 HP.' : 'Dobj egy Kitért!-et, vagy -1 HP.';
    validCards = (me?.hand || []).filter(c => {
      const ct = cardType(c), other = need === 'pew' ? 'kiteri' : 'pew';
      const charDef = me?.character ? CHARACTERS[me.character] : null;
      return ct === need || (ct === other && charDef?.abilityKey === 'swapPewKiteri');
    });
  }

  document.getElementById('react-title').innerHTML = title;
  document.getElementById('react-desc').textContent  = desc;

  const cardsEl = document.getElementById('react-cards');
  cardsEl.innerHTML = '';
  validCards.forEach(cardId => {
    const def = CARD_DEFS[cardType(cardId)];
    const btn = document.createElement('div');
    btn.className = 'card playable'; btn.style.cursor = 'pointer';
    btn.dataset.type = cardType(cardId);
    btn.innerHTML = `<div class="card-emoji">${def.emoji}</div>
      <div class="card-name">${def.name}</div>
      <div class="card-rs">${cardRS(cardId)}</div>`;
    btn.addEventListener('click', () => {
      closeOverlay('overlay-react');
      dispatch({ type:'respond', cardId });
    });
    cardsEl.appendChild(btn);
  });
  document.getElementById('btn-react-take').style.display = validCards.length > 0 ? '' : 'none';
}

function checkSpecialPending(state) {
  const info = whoNeedsToRespond(state, myId);
  if (!info) {
    closeOverlay('overlay-cardpick');
    return;
  }
  if (info.type === 'ceosDraw')      showCeosDraw(info.options, state);
  if (info.type === 'hackerFirstDraw') showHackerDraw(state);
  if (info.type === 'smiLuckyFate')  showSmiPick(info.fateType, info.options);
  if (info.type === 'plaza')         showPlazaPick(info.revealed);
}

// ─── Speciális pending overlays ───────────────────────────────────────────────
function showCeosDraw(options, state) {
  document.getElementById('cp-title').textContent = '🎯 CéosCili – Válassz 2 lapot!';
  document.getElementById('cp-desc').textContent  = 'Tartsd az ujjad a megtartandó 2 lapra, a harmadikat eldobjuk.';
  document.getElementById('cp-players').classList.add('hidden');
  document.getElementById('btn-cp-cancel').classList.add('hidden');
  const cardsEl = document.getElementById('cp-cards');
  cardsEl.innerHTML = '';

  let selected = [];
  options.forEach((cardId, i) => {
    const def = CARD_DEFS[cardType(cardId)];
    const card = document.createElement('div');
    card.className = 'card'; card.dataset.type = cardType(cardId);
    card.innerHTML = `<div class="card-emoji">${def.emoji}</div>
      <div class="card-name">${def.name}</div><div class="card-rs">${cardRS(cardId)}</div>`;
    card.addEventListener('click', () => {
      if (selected.includes(i)) { selected = selected.filter(x=>x!==i); card.classList.remove('selected'); }
      else if (selected.length < 2) { selected.push(i); card.classList.add('selected'); }
      const btn = document.getElementById('btn-cp-confirm');
      btn.disabled = selected.length !== 2;
    });
    cardsEl.appendChild(card);
  });

  const btn = document.getElementById('btn-cp-confirm');
  btn.textContent = '✓ Megtartás'; btn.disabled = true;
  btn.classList.remove('hidden');
  btn.onclick = () => {
    closeOverlay('overlay-cardpick');
    dispatch({ type:'ceosPick', keepIndices: selected });
  };
  openOverlay('overlay-cardpick');
}

function showHackerDraw(state) {
  document.getElementById('cp-title').textContent = '🔓 HackerHansi – Kitől húzod az első lapot?';
  document.getElementById('cp-desc').textContent  = 'Választhatsz egy játékost – az ő kezéből veszel 1 lapot. A másodikat a pakliból kapod.';
  document.getElementById('cp-cards').innerHTML = '';
  document.getElementById('btn-cp-confirm').classList.add('hidden');
  document.getElementById('btn-cp-cancel').classList.remove('hidden');

  const playersEl = document.getElementById('cp-players');
  playersEl.classList.remove('hidden');
  playersEl.innerHTML = '';
  state.players.forEach(p => {
    if (!p.alive || p.id === myId || p.hand.length === 0) return;
    const item = document.createElement('div');
    item.className = 'target-item';
    item.innerHTML = `<span class="ti-name">${esc(p.name)}</span>
      <span class="ti-detail">${p.hand.length} lap a kezében</span>`;
    item.addEventListener('click', () => {
      closeOverlay('overlay-cardpick');
      dispatch({ type:'hackerFrom', targetId: p.id });
    });
    playersEl.appendChild(item);
  });

  // Ha nincs kit választani, húz pakliból
  const hasCandidates = state.players.some(p => p.alive && p.id !== myId && p.hand.length > 0);
  if (!hasCandidates) {
    closeOverlay('overlay-cardpick');
    dispatch({ type:'drawCards' });
    return;
  }
  openOverlay('overlay-cardpick');
}

function showSmiPick(fateType, options) {
  const label = fateType === 'bomb' ? '💣 Bomba sorshúzás' : '🔒 Börtön sorshúzás';
  const desc  = fateType === 'bomb'
    ? 'Válaszd a lapot amelyiket akarod a bomba ellenőrzéséhez. Pikk 2–9 = robbanás!'
    : 'Válaszd a lapot amelyiket akarod a börtönből szabaduláshoz. Piros = szabad!';
  document.getElementById('cp-title').textContent = label;
  document.getElementById('cp-desc').textContent  = desc;
  document.getElementById('cp-players').classList.add('hidden');
  document.getElementById('btn-cp-confirm').classList.add('hidden');
  document.getElementById('btn-cp-cancel').classList.add('hidden');

  const cardsEl = document.getElementById('cp-cards');
  cardsEl.innerHTML = '';
  options.forEach((cardId, i) => {
    const def = CARD_DEFS[cardType(cardId)];
    const card = document.createElement('div');
    card.className = 'card'; card.dataset.type = cardType(cardId);
    card.innerHTML = `<div class="card-emoji">${def.emoji}</div>
      <div class="card-name">${def.name}</div><div class="card-rs">${cardRS(cardId)}</div>`;
    card.addEventListener('click', () => {
      closeOverlay('overlay-cardpick');
      dispatch({ type:'smiPick', keepIndex: i });
    });
    cardsEl.appendChild(card);
  });
  openOverlay('overlay-cardpick');
}

function showPlazaPick(revealed) {
  document.getElementById('cp-title').textContent = '🛍️ Plázatúra – Válassz 1 lapot!';
  document.getElementById('cp-desc').textContent  = 'A maradék lapokat eldobjuk.';
  document.getElementById('cp-players').classList.add('hidden');
  document.getElementById('btn-cp-confirm').classList.add('hidden');
  document.getElementById('btn-cp-cancel').classList.add('hidden');

  const cardsEl = document.getElementById('cp-cards');
  cardsEl.innerHTML = '';
  revealed.forEach(cardId => {
    const def = CARD_DEFS[cardType(cardId)];
    const card = document.createElement('div');
    card.className = 'card playable'; card.dataset.type = cardType(cardId);
    card.innerHTML = `<div class="card-emoji">${def.emoji}</div>
      <div class="card-name">${def.name}</div><div class="card-rs">${cardRS(cardId)}</div>`;
    card.addEventListener('click', () => {
      closeOverlay('overlay-cardpick');
      dispatch({ type:'pickPlaza', cardId });
    });
    cardsEl.appendChild(card);
  });
  openOverlay('overlay-cardpick');
}

// ─── Kártya kattintás – kijátszás ─────────────────────────────────────────────
function onCardClick(cardId, state) {
  const t = cardType(cardId);
  const def = CARD_DEFS[t];
  if (!def) return;

  const needsTarget = ['pew','kiteri','zsebmetsz','lefegyverz','parbaj','letar'].includes(t);
  const myIdx = state.players.findIndex(p => p.id === myId);

  if (t === 'kiteri') {
    const charDef = state.players[myIdx]?.character ? CHARACTERS[state.players[myIdx].character] : null;
    if (charDef?.abilityKey !== 'swapPewKiteri') return; // cannot play actively
  }

  if (needsTarget) {
    const targets = getValidTargets(state, myIdx, cardId);
    if (targets.length === 0) { showToast('Nincs érvényes célpont!', 'danger'); return; }
    pendingPlay = { cardId, stage: 'target', action: t };
    showTargetOverlay(cardId, targets, state);
  } else {
    dispatch({ type:'playCard', cardId });
  }
}

function showTargetOverlay(cardId, targetIndices, state) {
  const def = CARD_DEFS[cardType(cardId)];
  document.getElementById('target-title').textContent = `${def.emoji} ${def.name} – Kit célzol?`;
  const list = document.getElementById('target-list');
  list.innerHTML = '';
  targetIndices.forEach(i => {
    const p = state.players[i];
    const item = document.createElement('div');
    item.className = 'target-item';
    item.innerHTML = `<span class="ti-name">${esc(p.name)}</span>
      <span class="ti-detail">${hpHearts(p.hp, p.maxHp)} | ${p.hand.length} lap a kézben</span>`;
    item.addEventListener('click', () => {
      closeOverlay('overlay-target');
      onTargetChosen(i, state);
    });
    list.appendChild(item);
  });
  openOverlay('overlay-target');
}

function onTargetChosen(targetIdx, state) {
  if (!pendingPlay) return;
  const { cardId, action } = pendingPlay;
  const t = cardType(cardId);

  if (t === 'zsebmetsz' || t === 'lefegyverz') {
    // Asztali kártyák választása
    pendingPlay.targetIdx = targetIdx;
    showTableCardOverlay(targetIdx, t, state);
  } else {
    const targetPlayer = state.players[targetIdx];
    dispatch({ type:'playCard', cardId, targetId: targetPlayer.id });
    pendingPlay = null;
  }
}

function showTableCardOverlay(targetIdx, action, state) {
  const tgt = state.players[targetIdx];
  const verb = action === 'zsebmetsz' ? 'ellopod' : 'eldobatod';
  document.getElementById('tc-title').textContent = `${esc(tgt.name)} lapjai közül melyiket ${verb}?`;

  const el = document.getElementById('tc-cards');
  el.innerHTML = '';

  tgt.tableCards.forEach(cid => {
    const item = document.createElement('div');
    item.className = 'target-item';
    item.innerHTML = `<span class="ti-name">${cardEmoji(cid)} ${cardName(cid)}</span>
      <span class="ti-detail">asztalon</span>`;
    item.addEventListener('click', () => {
      closeOverlay('overlay-tablecards');
      if (!pendingPlay) return;
      dispatch({ type:'playCard', cardId: pendingPlay.cardId,
                 targetId: state.players[targetIdx].id,
                 targetCardId: cid, zone:'table' });
      pendingPlay = null;
    });
    el.appendChild(item);
  });

  // Véletlenszerű kézből gomb
  const randBtn = document.getElementById('btn-tc-random');
  randBtn.style.display = tgt.hand.length > 0 ? '' : 'none';
  randBtn.onclick = () => {
    closeOverlay('overlay-tablecards');
    if (!pendingPlay) return;
    dispatch({ type:'playCard', cardId: pendingPlay.cardId,
               targetId: state.players[targetIdx].id, zone:'hand' });
    pendingPlay = null;
  };

  if (tgt.tableCards.length === 0 && tgt.hand.length > 0) {
    // Nincs asztali kártya → azonnal véletlenszerű
    if (!pendingPlay) return;
    dispatch({ type:'playCard', cardId: pendingPlay.cardId,
               targetId: tgt.id, zone:'hand' });
    pendingPlay = null;
    return;
  }
  openOverlay('overlay-tablecards');
}

// DocDani gyógyítás kártyajelölés
function onDocHealCardClick(cardId, state) {
  const me = state.players.find(p => p.id === myId);
  if (!me) return;
  if (docHealIds.includes(cardId)) {
    docHealIds = docHealIds.filter(c => c !== cardId);
  } else if (docHealIds.length < 2) {
    docHealIds.push(cardId);
  }
  if (docHealIds.length === 2) {
    const ids = [...docHealIds]; docHealIds = [];
    dispatch({ type:'docHeal', cardIds: ids });
  } else {
    renderMyArea(state); // re-render to show selection
  }
}

// ─── Kör vége + dobás ────────────────────────────────────────────────────────
function showDiscardOverlay(state) {
  const me = state.players.find(p => p.id === myId);
  if (!me) return;
  const excess = me.hand.length - me.hp;
  document.getElementById('discard-title').textContent = `Dobj lapokat!`;
  document.getElementById('discard-desc').textContent  = `${excess} lapot kell eldobni (max. ${me.hp} tartható meg).`;
  selectedDiscardIds = [];

  const handEl = document.getElementById('discard-hand');
  handEl.innerHTML = '';
  me.hand.forEach(cardId => {
    const def = CARD_DEFS[cardType(cardId)];
    const card = document.createElement('div');
    card.className = 'card'; card.dataset.type = cardType(cardId); card.dataset.cardId = cardId;
    card.innerHTML = `<div class="card-emoji">${def.emoji}</div>
      <div class="card-name">${def.name}</div><div class="card-rs">${cardRS(cardId)}</div>`;
    card.addEventListener('click', () => {
      if (selectedDiscardIds.includes(cardId)) {
        selectedDiscardIds = selectedDiscardIds.filter(c => c !== cardId);
        card.classList.remove('selected');
      } else if (selectedDiscardIds.length < excess) {
        selectedDiscardIds.push(cardId);
        card.classList.add('selected');
      }
      const btn = document.getElementById('btn-discard-confirm');
      btn.disabled = selectedDiscardIds.length !== excess;
    });
    handEl.appendChild(card);
  });

  document.getElementById('btn-discard-confirm').disabled = true;
  document.getElementById('btn-discard-confirm').onclick = () => {
    closeOverlay('overlay-discard');
    dispatch({ type:'discardToLimit', cardIds: selectedDiscardIds });
    selectedDiscardIds = [];
  };
  openOverlay('overlay-discard');
}

// ─── Körváltás overlay ───────────────────────────────────────────────────────
let turnOverlayTimer = null;
function showTurnOverlay(state) {
  const curr = state.players[state.currentPlayerIndex];
  if (!curr) return;
  const isMe = curr.id === myId;

  document.getElementById('ot-name').textContent = curr.name;
  document.getElementById('ot-myturn').classList.toggle('hidden', !isMe);

  const roleEl = document.getElementById('ot-role');
  if (isMe) {
    roleEl.classList.remove('hidden');
    const rn = ROLE_NAMES[curr.role] || '';
    const ri = ROLE_EMOJIS[curr.role] || '';
    roleEl.innerHTML = `${ri} ${rn}`;
  } else {
    roleEl.classList.add('hidden');
  }

  openOverlay('overlay-turn');

  if (turnOverlayTimer) clearTimeout(turnOverlayTimer);
  turnOverlayTimer = setTimeout(() => {
    closeOverlay('overlay-turn');
    maybeAutoStartTurn(latestState);
  }, 2500);
}

function maybeAutoStartTurn(state) {
  if (!state || state.phase !== 'playing') return;
  if (state.turnPhase !== 'startOfTurn' || state.pending) return;
  if (startTurnSent) return;
  const myIdx = state.players.findIndex(p => p.id === myId);
  if (myIdx !== state.currentPlayerIndex) return;
  startTurnSent = true;
  dispatch({ type:'startTurn' });
}

// ─── GameOver ────────────────────────────────────────────────────────────────
function renderGameOver(state) {
  const icons = { law:'🏆', outlaws:'💀', renegade:'🎭' };
  const titles = { law:'A Főnök csapata győzött!', outlaws:'A Terroristák győztek!', renegade:'Az Anarchista győzött!' };
  document.getElementById('gameover-icon').textContent  = icons[state.winner] || '🏁';
  document.getElementById('gameover-title').textContent = titles[state.winner] || 'Játék vége';
  document.getElementById('gameover-desc').textContent  = state.log?.slice(-1)[0] || '';

  const el = document.getElementById('gameover-players');
  el.innerHTML = '';
  state.players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'gp-row';
    row.innerHTML = `<span style="font-weight:600">${esc(p.name)} ${p.id===myId?'(Te)':''}</span>
      <span class="gp-role">${ROLE_EMOJIS[p.role]||''} ${ROLE_NAMES[p.role]||''}</span>
      <span>${p.alive ? '✅' : '💀'}</span>`;
    el.appendChild(row);
  });
}

// ─── Eseménykezelők ───────────────────────────────────────────────────────────
function setupEventHandlers() {
  // Home – Csatlakozás
  document.getElementById('btn-join').addEventListener('click', async () => {
    const nameInput = document.getElementById('inp-name').value.trim();
    const roomInput = document.getElementById('inp-room').value.trim().toUpperCase();
    if (!nameInput) { showToast('Add meg a nevedet!', 'danger'); return; }
    myName = nameInput;

    let code = roomInput;
    if (!code) {
      code = Math.random().toString(36).slice(2,6).toUpperCase();
      const ref = doc(db, COL, code);
      const init = createInitialState();
      await setDoc(ref, { state: init, updatedAt: Date.now() });
    }
    roomCode = code;
    await dispatch({ type:'join', playerName: myName });
    goTo('screen-lobby');
    subscribeRoom(code);
  });

  // Lobby – Kilépés
  document.getElementById('btn-lobby-back').addEventListener('click', async () => {
    await dispatch({ type:'leave' });
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    goTo('screen-home');
  });

  // Lobby – Játék indítása
  document.getElementById('btn-start').addEventListener('click', () => {
    dispatch({ type:'startGame' });
  });

  // Kör kezdése
  document.getElementById('btn-start-turn').addEventListener('click', () => {
    startTurnSent = true;
    dispatch({ type:'startTurn' });
  });

  // Lapok húzása
  document.getElementById('btn-draw').addEventListener('click', () => {
    dispatch({ type:'drawCards' });
  });

  // Kör vége
  document.getElementById('btn-end-turn').addEventListener('click', () => {
    if (!latestState) return;
    const me = latestState.players.find(p => p.id === myId);
    if (!me) return;
    if (me.hand.length > me.hp) {
      showDiscardOverlay(latestState);
    } else {
      dispatch({ type:'endTurn' });
    }
  });

  // DocDani gomb megnyomása
  document.getElementById('btn-doc-heal').addEventListener('click', () => {
    if (!latestState) return;
    const me = latestState.players.find(p => p.id === myId);
    if (!me || me.hand.length < 2) { showToast('Nincs elég lap!', 'danger'); return; }
    showToast('Érintsd meg a 2 eldobandó lapot a kezedből!', 'info');
    docHealIds = [];
  });

  // Reakció: eltaláltak
  document.getElementById('btn-react-take').addEventListener('click', () => {
    closeOverlay('overlay-react');
    dispatch({ type:'respond', cardId: null });
  });

  // Célpont mégse
  document.getElementById('btn-target-cancel').addEventListener('click', () => {
    closeOverlay('overlay-target');
    pendingPlay = null;
  });

  // Asztali kártya mégse
  document.getElementById('btn-tc-cancel').addEventListener('click', () => {
    closeOverlay('overlay-tablecards');
    pendingPlay = null;
  });

  // Kártyaválasztás mégse
  document.getElementById('btn-cp-cancel').addEventListener('click', () => {
    closeOverlay('overlay-cardpick');
    pendingPlay = null;
  });

  // Körváltás overlay – koppintásra bezár
  document.getElementById('overlay-turn').addEventListener('click', () => {
    if (turnOverlayTimer) { clearTimeout(turnOverlayTimer); turnOverlayTimer = null; }
    closeOverlay('overlay-turn');
    maybeAutoStartTurn(latestState);
  });

  // Újraindítás
  document.getElementById('btn-restart').addEventListener('click', async () => {
    prevPlayerIndex = -1; startTurnSent = false;
    if (!latestState || !roomCode) return;
    const ref = doc(db, COL, roomCode);
    const init = createInitialState();
    latestState.players.forEach(p => {
      init.players.push({ id:p.id, name:p.name, role:null, character:null, charOptions:null,
        maxHp:4, hp:4, hand:[], tableCards:[], alive:true, bangsThisTurn:0 });
    });
    await setDoc(ref, { state: init, updatedAt: Date.now() });
  });

  // Input: Enter billentyű
  document.getElementById('inp-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
  document.getElementById('inp-room').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
  document.getElementById('inp-room').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
}

// ─── Bot rendszer ─────────────────────────────────────────────────────────────
const activeBots    = new Map();  // botId → displayName
const scheduledBots = new Set();  // botId-k, amelyeknek már van ütemezett lépése

/** Mit tegyen a bot ebben az állapotban? Null = semmi. */
function getBotAction(state, botId) {
  if (!state) return null;
  const botIdx = state.players.findIndex(p => p.id === botId);
  if (botIdx === -1) return null;
  const bot = state.players[botIdx];

  // ── Karakterválasztás ──
  if (state.phase === 'charSelect') {
    if (bot.character || !bot.charOptions?.length) return null;
    return { type:'chooseChar', playerId:botId, charKey:bot.charOptions[0] };
  }

  if (state.phase !== 'playing') return null;
  if (!bot.alive) return null;

  // ── Pending állapotokra reagálás (bármely játékos köre lehet) ──
  const pend = state.pending;
  if (pend) {
    // Pew! ellen védekezés
    if (pend.type === 'pew' && state.players[pend.target]?.id === botId) {
      const miss = bot.hand.find(c => cardType(c) === 'kiteri');
      return { type:'respond', playerId:botId, cardId: miss || null };
    }
    // Párbaj: Pew!-t dob, vagy feladja
    if (pend.type === 'duel' && state.players[pend.currentTurn]?.id === botId) {
      const pew = bot.hand.find(c => cardType(c) === 'pew');
      return { type:'respond', playerId:botId, cardId: pew || null };
    }
    // Tömegtámadás (drone / gepuska)
    if (pend.type === 'massAttack' && pend.remaining.length > 0 &&
        state.players[pend.remaining[0]]?.id === botId) {
      const need = pend.neededCard;
      const card = bot.hand.find(c => cardType(c) === need);
      return { type:'respond', playerId:botId, cardId: card || null };
    }
    // Plázatúra: első elérhető lapot veszi
    if (pend.type === 'plaza' && pend.remaining.length > 0 &&
        state.players[pend.remaining[0]]?.id === botId) {
      return { type:'pickPlaza', playerId:botId, cardId: pend.revealed[0] };
    }
    // CéosCili: első 2 lapot tartja meg
    if (pend.type === 'ceosDraw' && state.players[pend.player]?.id === botId) {
      return { type:'ceosPick', playerId:botId, keepIndices:[0,1] };
    }
    // HackerHansi: random célpontot választ (vagy pakliból húz)
    if (pend.type === 'hackerFirstDraw' && state.players[pend.player]?.id === botId) {
      const tgt = state.players.find(p => p.alive && p.id !== botId && p.hand.length > 0);
      return tgt
        ? { type:'hackerFrom', playerId:botId, targetId:tgt.id }
        : { type:'drawCards',  playerId:botId };
    }
    // SzerencsésSimi: első lapot választja
    if (pend.type === 'smiLuckyFate' && state.players[pend.player]?.id === botId) {
      return { type:'smiPick', playerId:botId, keepIndex:0 };
    }
    return null; // valaki más van soron
  }

  // ── Csak a bot körén ──
  if (state.currentPlayerIndex !== botIdx) return null;

  if (state.turnPhase === 'startOfTurn') return { type:'startTurn', playerId:botId };
  if (state.turnPhase === 'draw')        return { type:'drawCards',  playerId:botId };

  if (state.turnPhase === 'play') {
    // Ellenséges célpontok listája (próbálja a főnököt vagy az outlawkat célozni)
    const enemies = state.players
      .map((_,i) => i)
      .filter(i => i !== botIdx && state.players[i].alive);

    // 1. Pew! – ha van célpont lőtávolságon belül
    const pewCard = bot.hand.find(c => cardType(c)==='pew' && canPlayCard(state,botIdx,c));
    if (pewCard) {
      const tgts = getValidTargets(state, botIdx, pewCard);
      if (tgts.length > 0) {
        const ti = tgts[Math.floor(Math.random() * tgts.length)];
        return { type:'playCard', playerId:botId, cardId:pewCard, targetId:state.players[ti].id };
      }
    }

    // 2. Dróncsapás / Géppuska
    const massCard = bot.hand.find(c => (cardType(c)==='drone'||cardType(c)==='gepuska') && canPlayCard(state,botIdx,c));
    if (massCard) return { type:'playCard', playerId:botId, cardId:massCard };

    // 3. Párbaj – bármely élő ellen
    const duelCard = bot.hand.find(c => cardType(c)==='parbaj' && canPlayCard(state,botIdx,c));
    if (duelCard && enemies.length > 0) {
      const ti = enemies[Math.floor(Math.random() * enemies.length)];
      return { type:'playCard', playerId:botId, cardId:duelCard, targetId:state.players[ti].id };
    }

    // 4. Gyógyítás ha alacsony HP
    if (bot.hp < bot.maxHp) {
      const beer = bot.hand.find(c => cardType(c)==='energiaital' && canPlayCard(state,botIdx,c));
      if (beer) return { type:'playCard', playerId:botId, cardId:beer };
    }

    // 5. Lap húzás ha kevés lap van
    if (bot.hand.length < 3) {
      const draw = bot.hand.find(c => (cardType(c)==='taxi'||cardType(c)==='helikopter') && canPlayCard(state,botIdx,c));
      if (draw) return { type:'playCard', playerId:botId, cardId:draw };
    }

    // 6. Fegyver felszerelése ha nincs
    const hasWeapon = bot.tableCards.some(c => ['golyoszoro','snajper','karabely','automat'].includes(cardType(c)));
    if (!hasWeapon) {
      const weap = bot.hand.find(c => ['snajper','karabely','automat'].includes(cardType(c)) && canPlayCard(state,botIdx,c));
      if (weap) return { type:'playCard', playerId:botId, cardId:weap };
    }

    // 7. Kör vége
    return { type:'endTurn', playerId:botId };
  }

  if (state.turnPhase === 'discard') {
    const excess = bot.hand.length - bot.hp;
    if (excess <= 0) return { type:'endTurn', playerId:botId };
    // Dobja el a "legkevésbé hasznos" lapokat: Kitért! → Buli → többi
    const ranked = [...bot.hand].sort((a,b) => {
      const score = c => {
        const t = cardType(c);
        if (t==='kiteri') return 0;
        if (t==='buli'||t==='plaza') return 1;
        if (t==='energiaital') return 2;
        return 3; // Pew! és mások maradjanak
      };
      return score(a) - score(b);
    });
    return { type:'discardToLimit', playerId:botId, cardIds: ranked.slice(0, excess).map(c=>c) };
  }

  return null;
}

/** Minden state-frissítés után meghívódik – ütemezi a bot lépéseket. */
function maybeScheduleBotMoves(state) {
  if (!state || activeBots.size === 0) return;

  for (const [botId] of activeBots) {
    if (scheduledBots.has(botId)) continue;
    if (!getBotAction(state, botId)) continue; // nincs teendő

    scheduledBots.add(botId);
    const delay = 600 + Math.random() * 800;

    setTimeout(async () => {
      scheduledBots.delete(botId);
      if (!latestState) return;
      const action = getBotAction(latestState, botId);
      if (!action) return;
      try { await dispatch(action); }
      catch(e) { console.warn(`[Bot ${botId}]`, e.message); }
    }, delay);
  }
}

// ─── Dev panel ────────────────────────────────────────────────────────────────
function updateDevPanel() {
  const el = document.getElementById('dev-bot-status');
  if (!el) return;
  el.textContent = activeBots.size === 0
    ? 'Nincs aktív bot.'
    : `${activeBots.size} bot: ${[...activeBots.values()].join(', ')}`;
}

function initDevMode() {
  // Aktiválás: URL-ben ?dev=1 VAGY localStorage 'pew_dev' === '1'
  const active = new URLSearchParams(location.search).get('dev') === '1'
    || localStorage.getItem('pew_dev') === '1';
  if (active) localStorage.setItem('pew_dev', '1');

  // Lebegő 🛠️ gomb
  const devBtn = document.createElement('button');
  devBtn.id = 'dev-btn';
  devBtn.textContent = '🛠️';
  devBtn.title = 'Dev mód';
  devBtn.style.cssText = `position:fixed;bottom:1rem;right:1rem;z-index:500;
    background:var(--surface2);border:1px solid var(--border);border-radius:50%;
    width:42px;height:42px;font-size:1.1rem;cursor:pointer;
    display:${active?'flex':'none'};align-items:center;justify-content:center;`;
  document.body.appendChild(devBtn);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'dev-panel';
  panel.style.cssText = `display:none;position:fixed;bottom:4.5rem;right:1rem;z-index:501;
    background:var(--surface);border:1.5px solid var(--border);border-radius:14px;
    padding:1rem;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,.5);`;
  panel.innerHTML = `
    <div style="font-family:Fredoka,sans-serif;font-size:1rem;font-weight:600;margin-bottom:.8rem;color:var(--accent)">🛠️ Dev mód</div>
    <button id="dev-add-bot"   style="width:100%;margin-bottom:.5rem" class="btn btn-secondary">🤖 Bot hozzáadása</button>
    <button id="dev-clear-bot" style="width:100%" class="btn btn-secondary">🗑️ Botok törlése</button>
    <div id="dev-bot-status" style="margin-top:.6rem;font-size:.75rem;color:var(--text-mute)">Nincs aktív bot.</div>`;
  document.body.appendChild(panel);

  devBtn.addEventListener('click', e => {
    e.stopPropagation();
    updateDevPanel();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => { panel.style.display = 'none'; });
  panel.addEventListener('click', e => e.stopPropagation());

  // Bot hozzáadása
  document.getElementById('dev-add-bot').addEventListener('click', async () => {
    if (!roomCode) { showToast('Előbb csatlakozz szobához!', 'danger'); return; }
    if (latestState?.phase !== 'lobby') { showToast('Csak lobbiban lehet botot hozzáadni.', 'danger'); return; }
    if (activeBots.size >= 6) { showToast('Maximum 6 bot adható hozzá.', 'danger'); return; }
    const n    = activeBots.size + 1;
    const name = `🤖 Bot ${n}`;
    const id   = 'bot_' + Math.random().toString(36).slice(2,8);
    try {
      await dispatch({ type:'join', playerId:id, playerName:name });
      activeBots.set(id, name);
      updateDevPanel();
      showToast(`${name} csatlakozott.`, 'safe');
    } catch(e) { showToast('Hiba: ' + e.message, 'danger'); }
  });

  // Botok törlése (csak lobbyban)
  document.getElementById('dev-clear-bot').addEventListener('click', async () => {
    if (latestState?.phase !== 'lobby') { showToast('Csak lobbiban törölhető bot.', 'danger'); return; }
    for (const [id] of activeBots) {
      try { await dispatch({ type:'leave', playerId:id }); } catch(_) {}
    }
    activeBots.clear(); scheduledBots.clear();
    updateDevPanel();
    showToast('Botok eltávolítva.', 'safe');
  });

  // Titkos aktiválás: 5× koppintás a kód-mezőre
  let tapCount = 0, tapTimer = null;
  document.addEventListener('click', () => {
    if (active) return;
    tapCount++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 800);
    if (tapCount >= 5) {
      localStorage.setItem('pew_dev', '1');
      devBtn.style.display = 'flex';
      showToast('Dev mód aktiválva! 🛠️');
      tapCount = 0;
    }
  });
}

// ─── Segédfüggvény ────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
setupEventHandlers();
initDevMode();
goTo('screen-home');
