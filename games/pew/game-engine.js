// ============================================================================
// Pew! – Játékmotor (tiszta logika, Firebase-független)
// ============================================================================
// Emiliano Sciarra Bang! kártyajátékának modernizált, online multiplayer
// változata. Szerepek titkosak (kivéve a Főnök). 4–7 fő játszhatja.
// ============================================================================

// ─── Kártyatípusok ───────────────────────────────────────────────────────────
export const CARD_DEFS = {
  // Akció lapok (egyszer használatos)
  pew:         { name:'Pew!',          emoji:'🔫', type:'action',   count:25, desc:'Rálősz egy hatótávolságon belüli játékosra. Körönként 1× (hacsak karaktered másképp nem mondja).' },
  kiteri:      { name:'Kitért!',       emoji:'🛡️', type:'reaction', count:15, desc:'Kivéded a feléd irányuló Pew!-t vagy Géppuska tüzét.' },
  energiaital: { name:'Energiaital',   emoji:'⚡',  type:'action',   count:6,  desc:'+1 HP (max. életerőig). 2 vagy kevesebb játékos esetén nem használható.' },
  taxi:        { name:'Taxi',          emoji:'🚕', type:'action',   count:2,  desc:'Azonnal húzz 2 lapot a pakliból.' },
  helikopter:  { name:'Helikopter',    emoji:'🚁', type:'action',   count:3,  desc:'Azonnal húzz 3 lapot a pakliból.' },
  zsebmetsz:   { name:'Zsebmetszés',   emoji:'🔓', type:'action',   count:4,  desc:'Elveszel 1 lapot egy 1 távolságra lévő játékostól (kezéből véletlenszerűen, vagy asztaláról).' },
  lefegyverz:  { name:'Lefegyverzés',  emoji:'🚫', type:'action',   count:4,  desc:'Bármely játékos 1 lapját eldobatod (kezéből véletlenszerűen, vagy asztaláról).' },
  parbaj:      { name:'Párbaj',        emoji:'⚔️', type:'action',   count:3,  desc:'Párbaj bárki ellen (táv mindegy): felváltva dob Pew!-t. Aki nem tud, -1 HP.' },
  drone:       { name:'Dróncsapás',    emoji:'🤖', type:'action',   count:2,  desc:'Mindenki más dob egy Pew!-t, különben -1 HP.' },
  gepuska:     { name:'Géppuska',      emoji:'💥', type:'action',   count:1,  desc:'Mindenki más dob egy Kitért!-et, különben -1 HP.' },
  buli:        { name:'Buli',          emoji:'🎉', type:'action',   count:1,  desc:'Mindenki +1 HP-t kap (max. életerőig).' },
  plaza:       { name:'Plázatúra',     emoji:'🛍️', type:'action',   count:2,  desc:'Annyi lapot terítesz le, ahányan élnek; mindenki (körben) vesz egyet.' },
  // Felszerelés (az asztalon maradnak)
  sportauto:   { name:'Sportautó',     emoji:'🏎️', type:'equip',    count:2,  desc:'Mások +1-gyel messzebb látnak téged (nehezebb célponttá válsz).' },
  gps:         { name:'GPS',           emoji:'📍', type:'equip',    count:2,  desc:'Te -1-gyel közelebb látsz mindenkit (könnyebb célozni).' },
  letar:       { name:'Letartóztatás', emoji:'🔒', type:'jail',     count:2,  desc:'Célzott játékos asztalára kerül. Kör elején lap húzás: piros=szabad, fekete=kimarad a kör.' },
  bomba:       { name:'Bomba',         emoji:'💣', type:'bomb',     count:1,  desc:'Minden kör elején továbbadjuk. Pikk 2–9 esetén: -3 HP az aktuális gazdának!' },
  // Fegyverek (egyszerre 1 fegyver az asztalon)
  golyoszoro:  { name:'Golyószóró',    emoji:'🌀', type:'weapon', range:1, unlimited:true, count:2, desc:'Fegyver. Korlátlan Pew! per kör, de csak 1-es hatótávolság.' },
  snajper:     { name:'Mesterlövész',  emoji:'🎯', type:'weapon', range:2, count:3, desc:'Fegyver. Hatótávolság: 2.' },
  karabely:    { name:'Karabély',      emoji:'⚙️', type:'weapon', range:3, count:1, desc:'Fegyver. Hatótávolság: 3.' },
  automat:     { name:'Automata',      emoji:'🤖', type:'weapon', range:5, count:1, desc:'Fegyver. Hatótávolság: 5.' },
};

const WEAPON_TYPES  = new Set(['golyoszoro','snajper','karabely','automat']);
const EQUIP1_TYPES  = new Set(['sportauto','gps']); // csak 1 rakható le belőlük

// ─── Karakterek ──────────────────────────────────────────────────────────────
export const CHARACTERS = {
  vilvili: { name:'ViralVili',        hp:4, abilityKey:'unlimitedBang',  ability:'Körönként korlátlan Pew!-t játszhat ki.' },
  hackhan: { name:'HackerHansi',      hp:4, abilityKey:'hackerDraw',     ability:'Az első lapot húzhatja bármely játékos kezéből.' },
  mobbm:   { name:'MobbMóni',         hp:3, abilityKey:'drawOnHit',      ability:'Ha eltalálják, húz 1 lapot az eltalálótól.' },
  infliz:  { name:'InfluencerIzolda', hp:4, abilityKey:'swapPewKiteri',  ability:'Pew! és Kitért! tetszőlegesen felcserélhető.' },
  snipers: { name:'SniperSanya',      hp:4, abilityKey:'closerShot',     ability:'Mindig 1-gyel közelebb lő.' },
  testort: { name:'TestőrTamás',      hp:3, abilityKey:'fartherTarget',  ability:'Mások mindig 1-gyel messzebb lőnek rá.' },
  bergbel: { name:'BérgyilkosBéla',  hp:4, abilityKey:'doubleDefense',  ability:'Pew!-tól csak 2 Kitért! véd.' },
  vlogvi:  { name:'VloggerVinni',     hp:4, abilityKey:'drawOnHitDeck',  ability:'Ha eltalálják, húz 1 lapot a pakliból.' },
  tradet:  { name:'TraderTibor',      hp:4, abilityKey:'redCardBonus',   ability:'Ha a 2. húzott lapja piros, húz még egyet.' },
  docdani: { name:'DocDani',          hp:4, abilityKey:'healByDiscard',  ability:'Körönként egyszer: 2 lapot eldobva visszanyer 1 HP-t.' },
  ceoscil: { name:'CéosCili',         hp:4, abilityKey:'pickFromThree',  ability:'Húzáskor a felső 3 lapból 2-t választ ki.' },
  smiladk: { name:'SzerencsésSimi',   hp:4, abilityKey:'luckyFate',      ability:'Bomba és börtön sorshúzásnál 2 lapból választ.' },
};

// ─── Szerepek ─────────────────────────────────────────────────────────────────
export const ROLE_NAMES  = { sheriff:'Főnök', deputy:'Titkos Ügynök', outlaw:'Terrorista', renegade:'Anarchista' };
export const ROLE_EMOJIS = { sheriff:'⭐', deputy:'🤝', outlaw:'💀', renegade:'🎭' };
export const ROLE_GOALS  = {
  sheriff:  'Tedd el láb alól az összes terroristát és anarchistát.',
  deputy:   'Segítsd a Főnököt. Titkos szereped a főnök haláláig.',
  outlaw:   'Öld meg a Főnököt – a helyetteseket nem muszáj.',
  renegade: 'Legyél az utolsó élő. A Főnököt öld meg utoljára.',
};
export const ROLE_DISTRIBUTION = {
  4: ['sheriff','outlaw','outlaw','renegade'],
  5: ['sheriff','outlaw','outlaw','deputy','renegade'],
  6: ['sheriff','outlaw','outlaw','outlaw','deputy','renegade'],
  7: ['sheriff','outlaw','outlaw','outlaw','deputy','deputy','renegade'],
};

// ─── Kártya-segédfüggvények ───────────────────────────────────────────────────
// Kártyakód: "${type}:${rank}${suit}", pl. "pew:5H", "bomba:2S"
export function cardType(card)     { return card ? card.split(':')[0] : ''; }
export function cardRS(card)       { return card ? (card.split(':')[1] || '') : ''; }
export function cardRank(card)     { const rs = cardRS(card); return rs ? rs.slice(0,-1) : ''; }
export function cardSuitChar(card) { const rs = cardRS(card); return rs ? rs.slice(-1) : ''; }
export function isRedCard(card)    { return ['H','D'].includes(cardSuitChar(card)); }
export function isBombTrigger(card) {
  const s = cardSuitChar(card), r = cardRank(card);
  const n = r === 'T' ? 10 : parseInt(r);
  return s === 'S' && !isNaN(n) && n >= 2 && n <= 9;
}
export function cardName(card)  { const d = CARD_DEFS[cardType(card)]; return d ? d.name : cardType(card); }
export function cardEmoji(card) { const d = CARD_DEFS[cardType(card)]; return d ? d.emoji : '?'; }
export function isWeapon(card)  { return WEAPON_TYPES.has(cardType(card)); }

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// ─── Pakli létrehozása (82 lap, mindegyikhez véletlenszerű szín/szám) ─────────
export function createDeck() {
  const suits = ['H','D','C','S'], ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
  const combos = [];
  for (const s of suits) for (const r of ranks) combos.push(r+s);
  const pool = shuffle([...combos, ...combos]); // 104 elem a 82-höz
  const deck = []; let idx = 0;
  for (const [type, def] of Object.entries(CARD_DEFS)) {
    for (let i = 0; i < def.count; i++) { deck.push(`${type}:${pool[idx++ % pool.length]}`); }
  }
  return shuffle(deck);
}

// ─── Kezdeti állapot ─────────────────────────────────────────────────────────
export function createInitialState() {
  return { phase:'lobby', players:[], deck:[], discard:[], currentPlayerIndex:0,
    turnPhase:'startOfTurn', pending:null, log:[], winner:null };
}

// ─── Belső segédfüggvények ────────────────────────────────────────────────────
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function addLog(state, msg) { state.log = [...(state.log||[]).slice(-29), msg]; }

function drawCard(state) {
  if (!state.deck.length) {
    if (state.discard.length <= 1) return null;
    const top = state.discard[state.discard.length-1];
    state.deck = shuffle(state.discard.slice(0,-1));
    state.discard = [top];
    addLog(state, '♻️ Pakli újrakeverve.');
  }
  return state.deck.pop() || null;
}

function aliveCount(state) { return state.players.filter(p => p.alive).length; }

function nextAlive(state, fromIdx) {
  const n = state.players.length;
  for (let i = 1; i < n; i++) {
    const idx = (fromIdx+i) % n;
    if (state.players[idx].alive) return idx;
  }
  return fromIdx;
}

function ability(player) { return player.character ? (CHARACTERS[player.character]?.abilityKey||null) : null; }

// ─── Távolság és hatótávolság ─────────────────────────────────────────────────
function circularDist(state, a, b) {
  if (a === b) return 0;
  const alive = state.players.map((p,i) => ({...p, orig:i})).filter(p => p.alive);
  const fi = alive.findIndex(p => p.orig === a), ti = alive.findIndex(p => p.orig === b);
  if (fi < 0 || ti < 0) return Infinity;
  const n = alive.length, cw = ((ti-fi)+n)%n;
  return Math.min(cw, n-cw);
}

function effectiveDist(state, shooterIdx, targetIdx) {
  let d = circularDist(state, shooterIdx, targetIdx);
  const sh = state.players[shooterIdx], tg = state.players[targetIdx];
  if (sh.tableCards.some(c => cardType(c)==='gps')) d--;
  if (ability(sh) === 'closerShot') d--;
  if (tg.tableCards.some(c => cardType(c)==='sportauto')) d++;
  if (ability(tg) === 'fartherTarget') d++;
  return Math.max(1, d);
}

function shootRange(state, playerIdx) {
  const p = state.players[playerIdx];
  const w = p.tableCards.find(c => WEAPON_TYPES.has(cardType(c)));
  return w ? (CARD_DEFS[cardType(w)]?.range || 1) : 1;
}

function canShoot(state, from, to) {
  if (from === to || !state.players[to].alive) return false;
  return shootRange(state, from) >= effectiveDist(state, from, to);
}

// ─── Sebzés & kiesés ─────────────────────────────────────────────────────────
function dealDamage(state, targetIdx, amount, killerIdx) {
  const t = state.players[targetIdx];
  t.hp = Math.max(0, t.hp - amount);
  addLog(state, `💥 ${t.name} -${amount} HP (maradt: ${t.hp})`);

  if (t.hp > 0) {
    // MobbMóni: húz az eltalálótól
    if (ability(t) === 'drawOnHit' && killerIdx != null) {
      const k = state.players[killerIdx];
      if (k?.alive && k.hand.length > 0) {
        const ri = Math.floor(Math.random()*k.hand.length);
        t.hand.push(k.hand.splice(ri,1)[0]);
        addLog(state, `🔄 ${t.name} lapot húzott ${k.name}től (MobbMóni).`);
      }
    }
    // VloggerVinni: húz a pakliból
    if (ability(t) === 'drawOnHitDeck') {
      const c = drawCard(state);
      if (c) { t.hand.push(c); addLog(state, `📦 ${t.name} lapot húzott (VloggerVinni).`); }
    }
    return;
  }

  // Kiesés
  t.alive = false;
  addLog(state, `💀 ${t.name} kiesett! [${ROLE_NAMES[t.role]}]`);

  // Bandita kiejtéséért +3 lap jutalom
  if (t.role === 'outlaw' && killerIdx != null) {
    const k = state.players[killerIdx];
    if (k?.alive) {
      for (let i = 0; i < 3; i++) { const c = drawCard(state); if (c) k.hand.push(c); }
      addLog(state, `🎁 ${k.name} +3 lap jutalmat kapott.`);
    }
  }
  // Helyettes megölte a Főnököt → helyettes elveszíti lapjait
  if (t.role === 'sheriff' && killerIdx != null) {
    const k = state.players[killerIdx];
    if (k?.role === 'deputy') {
      k.hand = []; k.tableCards = [];
      addLog(state, `⚠️ ${k.name} elveszítette lapjait (Főnököt ölt).`);
    }
  }
  // Kieső lapjait dobóba
  [...t.hand, ...t.tableCards].forEach(c => state.discard.push(c));
  t.hand = []; t.tableCards = [];

  checkWinner(state);
}

function checkWinner(state) {
  if (state.winner) return;
  const sheriff = state.players.find(p => p.role === 'sheriff');
  if (!sheriff?.alive) {
    const outAlive = state.players.some(p => p.role === 'outlaw' && p.alive);
    const renAlive = state.players.some(p => p.role === 'renegade' && p.alive);
    if (renAlive && !outAlive && aliveCount(state) === 1) {
      state.winner = 'renegade'; state.phase = 'gameOver';
      addLog(state, '🏆 Az Anarchista győzött!');
    } else {
      state.winner = 'outlaws'; state.phase = 'gameOver';
      addLog(state, '🏆 A Terroristák győztek!');
    }
    return;
  }
  if (!state.players.some(p => (p.role==='outlaw'||p.role==='renegade') && p.alive)) {
    state.winner = 'law'; state.phase = 'gameOver';
    addLog(state, '🏆 A Főnök csapata győzött!');
  }
}

function advanceTurn(state) {
  if (state.winner) return;
  state.currentPlayerIndex = nextAlive(state, state.currentPlayerIndex);
  state.turnPhase = 'startOfTurn'; state.pending = null;
  state.players[state.currentPlayerIndex].bangsThisTurn = 0;
}

// ─── applyMove – főfüggvény ───────────────────────────────────────────────────
export function applyMove(state, action) {
  state = clone(state);
  switch (action.type) {
    case 'join':          return applyJoin(state, action);
    case 'leave':         return applyLeave(state, action);
    case 'startGame':     return applyStartGame(state, action);
    case 'chooseChar':    return applyChooseChar(state, action);
    case 'startTurn':     return applyStartTurn(state, action);
    case 'drawCards':     return applyDrawCards(state, action);
    case 'hackerFrom':    return applyHackerFrom(state, action);
    case 'ceosPick':      return applyCeosPick(state, action);
    case 'smiPick':       return applySmiPick(state, action);
    case 'playCard':      return applyPlayCard(state, action);
    case 'respond':       return applyRespond(state, action);
    case 'pickPlaza':     return applyPickPlaza(state, action);
    case 'docHeal':       return applyDocHeal(state, action);
    case 'endTurn':       return applyEndTurn(state, action);
    case 'discardToLimit':return applyDiscardToLimit(state, action);
    default: throw new Error('Unknown action: ' + action.type);
  }
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
function applyJoin(state, { playerId, playerName }) {
  if (state.phase !== 'lobby' || state.players.find(p => p.id===playerId) || state.players.length >= 7) return state;
  state.players.push({ id:playerId, name:playerName, role:null, character:null, charOptions:null,
    maxHp:4, hp:4, hand:[], tableCards:[], alive:true, bangsThisTurn:0 });
  return state;
}
function applyLeave(state, { playerId }) {
  if (state.phase !== 'lobby') return state;
  state.players = state.players.filter(p => p.id !== playerId);
  return state;
}

// ─── Játék indítása ───────────────────────────────────────────────────────────
function applyStartGame(state, action) {
  if (state.phase !== 'lobby') return state;
  const n = state.players.length;
  if (n < 4 || n > 7) return state;

  const roles = shuffle([...ROLE_DISTRIBUTION[n]]);
  const charKeys = Object.keys(CHARACTERS); // 12 kulcs
  const pool = shuffle([...charKeys, ...charKeys]); // 24 elem
  state.players.forEach((p, i) => {
    p.role = roles[i];
    const a = pool[i*2 % pool.length];
    let b = pool[(i*2+1) % pool.length];
    if (a === b) b = charKeys.find(k => k !== a) || charKeys[0];
    p.charOptions = [a, b];
  });
  state.phase = 'charSelect';
  addLog(state, '🎮 A játék elindult! Válasszatok karaktert.');
  return state;
}

// ─── Karakterválasztás ────────────────────────────────────────────────────────
function applyChooseChar(state, { playerId, charKey }) {
  if (state.phase !== 'charSelect') return state;
  const p = state.players.find(pl => pl.id === playerId);
  if (!p || !p.charOptions?.includes(charKey) || p.character) return state;
  p.character = charKey;
  if (!state.players.every(pl => pl.character)) return state;

  // Mindenki választott → induljon a játék
  state.phase = 'playing'; state.deck = createDeck(); state.discard = [];
  state.players.forEach(p => {
    const def = CHARACTERS[p.character];
    const base = def ? def.hp : 4;
    p.maxHp = p.role === 'sheriff' ? base+1 : base;
    p.hp = p.maxHp; p.hand = []; p.tableCards = []; p.bangsThisTurn = 0;
    for (let i = 0; i < p.maxHp; i++) { const c = drawCard(state); if (c) p.hand.push(c); }
  });
  state.currentPlayerIndex = state.players.findIndex(p => p.role === 'sheriff');
  state.turnPhase = 'startOfTurn'; state.pending = null;
  addLog(state, '🃏 Lapok kiosztva. A Főnök kezd!');
  return state;
}

// ─── Kör kezdete (bomba + börtön automatikusan, Lucky Duke kivétel) ──────────
function applyStartTurn(state, action) {
  if (state.phase !== 'playing' || state.turnPhase !== 'startOfTurn') return state;
  const pIdx = state.currentPlayerIndex;
  const p = state.players[pIdx];
  if (!p.alive) { advanceTurn(state); return state; }

  // Bomba ellenőrzés
  const bombIdx = p.tableCards.findIndex(c => cardType(c) === 'bomba');
  if (bombIdx !== -1) {
    if (ability(p) === 'luckyFate') {
      const opts = [drawCard(state), drawCard(state)].filter(Boolean);
      state.pending = { type:'smiLuckyFate', player:pIdx, fateType:'bomb', options:opts };
      return state;
    }
    const fc = drawCard(state);
    if (fc) state.discard.push(fc);
    const rsStr = fc ? `${cardRank(fc)}${cardSuitChar(fc)}` : '?';
    if (fc && isBombTrigger(fc)) {
      state.discard.push(p.tableCards.splice(bombIdx,1)[0]);
      addLog(state, `💥 ROBBANÁS! ${p.name} -3 HP! [${rsStr}]`);
      dealDamage(state, pIdx, 3, null);
      if (state.winner) return state;
    } else {
      const bomb = p.tableCards.splice(bombIdx,1)[0];
      const ni = nextAlive(state, pIdx);
      if (!state.players[ni].tableCards.some(c => cardType(c)==='bomba')) {
        state.players[ni].tableCards.push(bomb);
        addLog(state, `💣 Bomba → ${state.players[ni].name} [${rsStr}]`);
      } else { state.discard.push(bomb); }
    }
  }

  // Börtön ellenőrzés
  const jailIdx = p.tableCards.findIndex(c => cardType(c) === 'letar');
  if (jailIdx !== -1) {
    if (ability(p) === 'luckyFate') {
      const opts = [drawCard(state), drawCard(state)].filter(Boolean);
      state.pending = { type:'smiLuckyFate', player:pIdx, fateType:'jail', options:opts };
      return state;
    }
    const fc = drawCard(state);
    if (fc) state.discard.push(fc);
    const rsStr = fc ? `${cardRank(fc)}${cardSuitChar(fc)}` : '?';
    p.tableCards.splice(jailIdx, 1);
    if (!fc || !isRedCard(fc)) {
      addLog(state, `🔒 ${p.name} börtönben marad – kimarad. [${rsStr}]`);
      advanceTurn(state); return state;
    }
    addLog(state, `🔓 ${p.name} kiszabadult! [${rsStr}]`);
  }

  return beginDraw(state, pIdx);
}

function beginDraw(state, pIdx) {
  const p = state.players[pIdx];
  if (ability(p) === 'pickFromThree') {
    const opts = [drawCard(state), drawCard(state), drawCard(state)].filter(Boolean);
    if (opts.length < 3) { opts.forEach(c => p.hand.push(c)); state.turnPhase = 'play'; return state; }
    state.pending = { type:'ceosDraw', player:pIdx, options:opts };
    return state;
  }
  if (ability(p) === 'hackerDraw') {
    state.pending = { type:'hackerFirstDraw', player:pIdx };
    return state;
  }
  state.turnPhase = 'draw';
  return state;
}

// ─── Lap húzás ────────────────────────────────────────────────────────────────
function applyDrawCards(state, action) {
  if (state.turnPhase !== 'draw') return state;
  const p = state.players[state.currentPlayerIndex];
  const c1 = drawCard(state); if (c1) p.hand.push(c1);
  const c2 = drawCard(state);
  if (c2) {
    p.hand.push(c2);
    if (ability(p) === 'redCardBonus' && isRedCard(c2)) {
      const c3 = drawCard(state);
      if (c3) { p.hand.push(c3); addLog(state, `🃏 ${p.name} +1 lap (piros, TraderTibor).`); }
    }
  }
  state.turnPhase = 'play';
  return state;
}

function applyHackerFrom(state, { playerId, targetId }) {
  if (!state.pending || state.pending.type !== 'hackerFirstDraw') return state;
  const p = state.players[state.currentPlayerIndex];
  if (p.id !== playerId) return state;
  const ti = state.players.findIndex(pl => pl.id === targetId);
  const t = state.players[ti];
  if (t?.alive && t.hand.length > 0) {
    const ri = Math.floor(Math.random()*t.hand.length);
    p.hand.push(t.hand.splice(ri,1)[0]);
    addLog(state, `🔓 ${p.name} lapot húzott ${t.name}től (HackerHansi).`);
  }
  const c2 = drawCard(state); if (c2) p.hand.push(c2);
  state.pending = null; state.turnPhase = 'play';
  return state;
}

function applyCeosPick(state, { playerId, keepIndices }) {
  if (!state.pending || state.pending.type !== 'ceosDraw') return state;
  const p = state.players[state.pending.player];
  if (p.id !== playerId) return state;
  state.pending.options.forEach((c,i) => {
    if (keepIndices.includes(i)) p.hand.push(c); else state.discard.push(c);
  });
  state.pending = null; state.turnPhase = 'play';
  return state;
}

function applySmiPick(state, { playerId, keepIndex }) {
  if (!state.pending || state.pending.type !== 'smiLuckyFate') return state;
  const pIdx = state.pending.player;
  const p = state.players[pIdx];
  if (p.id !== playerId) return state;
  const opts = state.pending.options;
  const chosen = opts[keepIndex] || opts[0];
  opts.forEach((c,i) => { if (i !== keepIndex) state.discard.push(c); });
  if (chosen) state.discard.push(chosen);
  const { fateType } = state.pending;
  state.pending = null;

  if (fateType === 'bomb') {
    const bi = p.tableCards.findIndex(c => cardType(c) === 'bomba');
    if (bi !== -1) {
      if (chosen && isBombTrigger(chosen)) {
        p.tableCards.splice(bi,1);
        addLog(state, `💥 ROBBANÁS (SzerencsésSimi)! ${p.name} -3 HP`);
        dealDamage(state, pIdx, 3, null);
        if (state.winner) return state;
      } else {
        const bomb = p.tableCards.splice(bi,1)[0];
        const ni = nextAlive(state, pIdx);
        if (!state.players[ni].tableCards.some(c => cardType(c)==='bomba')) {
          state.players[ni].tableCards.push(bomb);
          addLog(state, `💣 Bomba → ${state.players[ni].name} (SzerencsésSimi)`);
        } else { state.discard.push(bomb); }
      }
    }
    // Folytatás: börtön ellenőrzés
    const ji = p.tableCards.findIndex(c => cardType(c) === 'letar');
    if (ji !== -1) {
      if (ability(p) === 'luckyFate') {
        const opts2 = [drawCard(state), drawCard(state)].filter(Boolean);
        state.pending = { type:'smiLuckyFate', player:pIdx, fateType:'jail', options:opts2 };
        return state;
      }
      const fc = drawCard(state); if (fc) state.discard.push(fc);
      p.tableCards.splice(ji,1);
      if (!fc || !isRedCard(fc)) {
        addLog(state, `🔒 ${p.name} börtönben marad.`);
        advanceTurn(state); return state;
      }
      addLog(state, `🔓 ${p.name} kiszabadult!`);
    }
  }

  if (fateType === 'jail') {
    const ji = p.tableCards.findIndex(c => cardType(c) === 'letar');
    if (ji !== -1) p.tableCards.splice(ji,1);
    if (!chosen || !isRedCard(chosen)) {
      addLog(state, `🔒 ${p.name} börtönben marad (SzerencsésSimi).`);
      advanceTurn(state); return state;
    }
    addLog(state, `🔓 ${p.name} kiszabadult (SzerencsésSimi)!`);
  }

  return beginDraw(state, pIdx);
}

// ─── Kártya kijátszása ────────────────────────────────────────────────────────
function applyPlayCard(state, action) {
  const { playerId, cardId, targetId, targetCardId, zone } = action;
  if (state.phase !== 'playing' || state.turnPhase !== 'play') return state;
  const pIdx = state.players.findIndex(p => p.id === playerId);
  if (pIdx !== state.currentPlayerIndex) return state;
  const p = state.players[pIdx];
  const ci = p.hand.indexOf(cardId);
  if (ci < 0) return state;
  const t = cardType(cardId);

  // Pew! limit ellenőrzés
  const isAttack = t === 'pew' || (t === 'kiteri' && ability(p) === 'swapPewKiteri' && targetId);
  if (isAttack) {
    const canBang = ability(p) === 'unlimitedBang' ||
      p.tableCards.some(c => cardType(c) === 'golyoszoro') || p.bangsThisTurn === 0;
    if (!canBang) { addLog(state,'⚠️ Már lőttél ezen a körön!'); return state; }
  }

  p.hand.splice(ci, 1);

  switch (t) {
    case 'pew': {
      if (!targetId) { p.hand.push(cardId); return state; }
      return doShoot(state, pIdx, targetId, cardId);
    }
    case 'kiteri': {
      if (ability(p) === 'swapPewKiteri' && targetId) return doShoot(state, pIdx, targetId, cardId);
      p.hand.push(cardId); return state; // Aktívan nem játszható
    }
    case 'energiaital': {
      if (aliveCount(state) <= 2) { p.hand.push(cardId); addLog(state,'⚠️ Energiaital ≤2 játékosnál nem működik!'); return state; }
      state.discard.push(cardId); p.hp = Math.min(p.maxHp, p.hp+1);
      addLog(state, `⚡ ${p.name} +1 HP (Energiaital).`); return state;
    }
    case 'taxi': {
      state.discard.push(cardId);
      for (let i=0;i<2;i++) { const c=drawCard(state); if(c) p.hand.push(c); }
      addLog(state,`🚕 ${p.name} +2 lap (Taxi).`); return state;
    }
    case 'helikopter': {
      state.discard.push(cardId);
      for (let i=0;i<3;i++) { const c=drawCard(state); if(c) p.hand.push(c); }
      addLog(state,`🚁 ${p.name} +3 lap (Helikopter).`); return state;
    }
    case 'zsebmetsz': {
      if (!targetId) { p.hand.push(cardId); return state; }
      const ti = state.players.findIndex(pl => pl.id===targetId);
      if (ti<0||!state.players[ti].alive||effectiveDist(state,pIdx,ti)>1) { p.hand.push(cardId); return state; }
      state.discard.push(cardId);
      const tgt = state.players[ti];
      if (zone==='table' && targetCardId && tgt.tableCards.includes(targetCardId)) {
        const tci = tgt.tableCards.indexOf(targetCardId);
        p.hand.push(tgt.tableCards.splice(tci,1)[0]);
        addLog(state,`🔓 ${p.name} elvette ${tgt.name}tól: ${cardName(targetCardId)}`);
      } else if (tgt.hand.length > 0) {
        const ri = Math.floor(Math.random()*tgt.hand.length);
        p.hand.push(tgt.hand.splice(ri,1)[0]);
        addLog(state,`🔓 ${p.name} zsebelt ${tgt.name}től.`);
      }
      return state;
    }
    case 'lefegyverz': {
      if (!targetId) { p.hand.push(cardId); return state; }
      const ti = state.players.findIndex(pl => pl.id===targetId);
      if (ti<0||!state.players[ti].alive) { p.hand.push(cardId); return state; }
      state.discard.push(cardId);
      const tgt = state.players[ti];
      if (zone==='table' && targetCardId && tgt.tableCards.includes(targetCardId)) {
        const tci = tgt.tableCards.indexOf(targetCardId);
        state.discard.push(tgt.tableCards.splice(tci,1)[0]);
        addLog(state,`🚫 ${p.name} eldobatta ${tgt.name}tól: ${cardName(targetCardId)}`);
      } else if (tgt.hand.length > 0) {
        const ri = Math.floor(Math.random()*tgt.hand.length);
        state.discard.push(tgt.hand.splice(ri,1)[0]);
        addLog(state,`🚫 ${p.name} eldobatta ${tgt.name} egy lapját.`);
      }
      return state;
    }
    case 'parbaj': {
      if (!targetId) { p.hand.push(cardId); return state; }
      const ti = state.players.findIndex(pl => pl.id===targetId);
      if (ti<0||!state.players[ti].alive) { p.hand.push(cardId); return state; }
      state.discard.push(cardId);
      addLog(state,`⚔️ ${p.name} párbajra hívta ${state.players[ti].name}t!`);
      state.pending = { type:'duel', initiator:pIdx, target:ti, currentTurn:ti };
      return state;
    }
    case 'drone':   return doMassAttack(state, pIdx, cardId, 'pew');
    case 'gepuska': return doMassAttack(state, pIdx, cardId, 'kiteri');
    case 'buli': {
      state.discard.push(cardId);
      state.players.forEach(pl => { if(pl.alive) pl.hp = Math.min(pl.maxHp, pl.hp+1); });
      addLog(state,`🎉 ${p.name} Bulit rendezett – mindenki +1 HP!`); return state;
    }
    case 'plaza': {
      state.discard.push(cardId);
      const alive = state.players.filter(pl => pl.alive);
      const revealed = [];
      for (let i=0;i<alive.length;i++) { const c=drawCard(state); if(c) revealed.push(c); }
      const rem = []; let idx = pIdx;
      for (let i=0;i<alive.length;i++) { rem.push(idx); idx=nextAlive(state,idx); }
      addLog(state,`🛍️ ${p.name} Plázatúrát indított!`);
      state.pending = { type:'plaza', source:pIdx, revealed, remaining:rem };
      return state;
    }
    case 'sportauto':
    case 'gps': {
      if (EQUIP1_TYPES.has(t) && p.tableCards.some(c => cardType(c)===t)) { p.hand.push(cardId); return state; }
      p.tableCards.push(cardId);
      addLog(state,`${cardEmoji(cardId)} ${p.name}: ${cardName(cardId)}`); return state;
    }
    case 'letar': {
      if (!targetId || targetId===playerId) { p.hand.push(cardId); return state; }
      const ti = state.players.findIndex(pl => pl.id===targetId);
      if (ti<0||!state.players[ti].alive||state.players[ti].tableCards.some(c=>cardType(c)==='letar')) { p.hand.push(cardId); return state; }
      state.players[ti].tableCards.push(cardId);
      addLog(state,`🔒 ${p.name} letartóztatta ${state.players[ti].name}t!`); return state;
    }
    case 'bomba': {
      if (p.tableCards.some(c => cardType(c)==='bomba')) { p.hand.push(cardId); return state; }
      p.tableCards.push(cardId);
      addLog(state,`💣 ${p.name} letette a Bombát!`); return state;
    }
    case 'golyoszoro': case 'snajper': case 'karabely': case 'automat': {
      const owi = p.tableCards.findIndex(c => WEAPON_TYPES.has(cardType(c)));
      if (owi !== -1) state.discard.push(p.tableCards.splice(owi,1)[0]);
      p.tableCards.push(cardId);
      addLog(state,`${cardEmoji(cardId)} ${p.name}: ${cardName(cardId)}`); return state;
    }
    default: p.hand.push(cardId); return state;
  }
}

function doShoot(state, pIdx, targetId, cardId) {
  const p = state.players[pIdx];
  const ti = state.players.findIndex(pl => pl.id===targetId);
  if (ti<0||!state.players[ti].alive||!canShoot(state,pIdx,ti)) { p.hand.push(cardId); return state; }
  p.bangsThisTurn = (p.bangsThisTurn||0)+1;
  state.discard.push(cardId);
  const neededMisses = ability(state.players[ti])==='doubleDefense' ? 2 : 1;
  addLog(state,`🔫 ${p.name} → ${state.players[ti].name}!`);
  state.pending = { type:'pew', attacker:pIdx, target:ti, neededMisses, missesUsed:0 };
  return state;
}

function doMassAttack(state, pIdx, cardId, neededCard) {
  state.discard.push(cardId);
  const p = state.players[pIdx];
  const rem = []; let idx = nextAlive(state,pIdx);
  const total = aliveCount(state)-1;
  for (let i=0;i<total;i++) { rem.push(idx); idx=nextAlive(state,idx); }
  addLog(state,`${cardEmoji(cardId)} ${p.name}: ${cardName(cardId)}!`);
  state.pending = { type:'massAttack', source:pIdx, neededCard, remaining:rem };
  return state;
}

// ─── Reagálás ─────────────────────────────────────────────────────────────────
function applyRespond(state, { playerId, cardId }) {
  if (!state.pending) return state;
  const { type } = state.pending;
  if (type==='pew')        return respondPew(state, playerId, cardId);
  if (type==='duel')       return respondDuel(state, playerId, cardId);
  if (type==='massAttack') return respondMassAttack(state, playerId, cardId);
  return state;
}

function respondPew(state, responderId, cardId) {
  const pend = state.pending;
  const tgt = state.players[pend.target];
  if (tgt.id !== responderId) return state;
  if (cardId) {
    const ci = tgt.hand.indexOf(cardId);
    if (ci < 0) return state;
    const ct = cardType(cardId);
    const valid = ct==='kiteri' || (ct==='pew' && ability(tgt)==='swapPewKiteri');
    if (!valid) return state;
    tgt.hand.splice(ci,1); state.discard.push(cardId);
    pend.missesUsed = (pend.missesUsed||0)+1;
    addLog(state,`🛡️ ${tgt.name} kivédte! (${pend.missesUsed}/${pend.neededMisses})`);
    if (pend.missesUsed >= pend.neededMisses) state.pending = null;
  } else {
    addLog(state,`💥 ${tgt.name} eltalálva!`);
    state.pending = null;
    dealDamage(state, pend.target, 1, pend.attacker);
  }
  return state;
}

function respondDuel(state, responderId, cardId) {
  const pend = state.pending;
  const curr = state.players[pend.currentTurn];
  if (curr.id !== responderId) return state;
  if (cardId) {
    const ci = curr.hand.indexOf(cardId);
    if (ci < 0) return state;
    const ct = cardType(cardId);
    const valid = ct==='pew' || (ct==='kiteri' && ability(curr)==='swapPewKiteri');
    if (!valid) return state;
    curr.hand.splice(ci,1); state.discard.push(cardId);
    addLog(state,`⚔️ ${curr.name} dob Pew!-t.`);
    pend.currentTurn = pend.currentTurn===pend.initiator ? pend.target : pend.initiator;
  } else {
    addLog(state,`💥 ${curr.name} veszített a párbajban!`);
    const ki = pend.currentTurn===pend.target ? pend.initiator : pend.target;
    state.pending = null;
    dealDamage(state, pend.currentTurn, 1, ki);
  }
  return state;
}

function respondMassAttack(state, responderId, cardId) {
  const pend = state.pending;
  if (!pend.remaining.length) { state.pending=null; return state; }
  const currIdx = pend.remaining[0];
  const curr = state.players[currIdx];
  if (curr.id !== responderId) return state;
  if (cardId) {
    const ci = curr.hand.indexOf(cardId);
    if (ci < 0) return state;
    const ct = cardType(cardId), need = pend.neededCard, other = need==='pew'?'kiteri':'pew';
    const valid = ct===need || (ct===other && ability(curr)==='swapPewKiteri');
    if (!valid) return state;
    curr.hand.splice(ci,1); state.discard.push(cardId);
    addLog(state,`✅ ${curr.name} kivédte.`);
    pend.remaining.shift();
  } else {
    addLog(state,`💥 ${curr.name} eltalálva! -1 HP`);
    const src = pend.source;
    pend.remaining.shift();
    if (!pend.remaining.length) state.pending = null;
    dealDamage(state, currIdx, 1, src);
    return state;
  }
  if (!pend.remaining.length) state.pending = null;
  return state;
}

function applyPickPlaza(state, { playerId, cardId }) {
  if (!state.pending||state.pending.type!=='plaza') return state;
  const pend = state.pending;
  if (!pend.remaining.length) { state.pending=null; return state; }
  const currIdx = pend.remaining[0];
  if (state.players[currIdx].id !== playerId) return state;
  const ri = pend.revealed.indexOf(cardId);
  if (ri < 0) return state;
  pend.revealed.splice(ri,1);
  state.players[currIdx].hand.push(cardId);
  addLog(state,`🛍️ ${state.players[currIdx].name}: ${cardName(cardId)}`);
  pend.remaining.shift();
  if (!pend.remaining.length) { pend.revealed.forEach(c=>state.discard.push(c)); state.pending=null; }
  return state;
}

function applyDocHeal(state, { playerId, cardIds }) {
  if (state.turnPhase !== 'play') return state;
  const pIdx = state.players.findIndex(p => p.id===playerId);
  if (pIdx !== state.currentPlayerIndex) return state;
  const p = state.players[pIdx];
  if (ability(p) !== 'healByDiscard' || p.hp >= p.maxHp) return state;
  if (!cardIds||cardIds.length!==2||!cardIds.every(c=>p.hand.includes(c))) return state;
  cardIds.forEach(c => { p.hand.splice(p.hand.indexOf(c),1); state.discard.push(c); });
  p.hp = Math.min(p.maxHp, p.hp+1);
  addLog(state,`💊 ${p.name} +1 HP (DocDani).`);
  return state;
}

function applyEndTurn(state, { playerId }) {
  if (state.turnPhase !== 'play') return state;
  const pIdx = state.currentPlayerIndex;
  if (state.players[pIdx].id !== playerId) return state;
  const p = state.players[pIdx];
  if (p.hand.length > p.hp) { state.turnPhase='discard'; return state; }
  advanceTurn(state);
  return state;
}

function applyDiscardToLimit(state, { playerId, cardIds }) {
  if (state.turnPhase !== 'discard') return state;
  const pIdx = state.currentPlayerIndex;
  if (state.players[pIdx].id !== playerId) return state;
  const p = state.players[pIdx];
  for (const cid of cardIds) {
    const i = p.hand.indexOf(cid);
    if (i !== -1) { p.hand.splice(i,1); state.discard.push(cid); }
  }
  if (p.hand.length <= p.hp) advanceTurn(state);
  return state;
}

// ─── UI-nak szükséges export-ok ───────────────────────────────────────────────
export function getValidTargets(state, playerIdx, cardId) {
  const t = cardType(cardId), p = state.players[playerIdx];
  const others = state.players.map((_,i)=>i).filter(i=>i!==playerIdx&&state.players[i].alive);
  if (t==='pew'||(t==='kiteri'&&ability(p)==='swapPewKiteri')) return others.filter(i=>canShoot(state,playerIdx,i));
  if (t==='zsebmetsz') return others.filter(i=>effectiveDist(state,playerIdx,i)<=1);
  if (t==='lefegyverz'||t==='parbaj'||t==='letar') return others;
  return [];
}

export function canPlayCard(state, playerIdx, cardId) {
  if (state.turnPhase!=='play'||playerIdx!==state.currentPlayerIndex) return false;
  const p = state.players[playerIdx]; if (!p.alive) return false;
  const t = cardType(cardId); const def = CARD_DEFS[t]; if (!def) return false;
  if (t==='kiteri'&&ability(p)!=='swapPewKiteri') return false;
  if (t==='energiaital'&&aliveCount(state)<=2) return false;
  if (EQUIP1_TYPES.has(t)&&p.tableCards.some(c=>cardType(c)===t)) return false;
  if (t==='bomba'&&p.tableCards.some(c=>cardType(c)==='bomba')) return false;
  if (t==='pew'||(t==='kiteri'&&ability(p)==='swapPewKiteri')) {
    const canBang=ability(p)==='unlimitedBang'||p.tableCards.some(c=>cardType(c)==='golyoszoro')||p.bangsThisTurn===0;
    if (!canBang) return false;
    if (getValidTargets(state,playerIdx,cardId).length===0) return false;
  }
  if (['zsebmetsz','lefegyverz','parbaj','letar'].includes(t)) {
    if (getValidTargets(state,playerIdx,cardId).length===0) return false;
  }
  return true;
}

export function whoNeedsToRespond(state, myId) {
  if (!state.pending) return null;
  const { type } = state.pending;
  if (type==='pew') {
    const tgt = state.players[state.pending.target];
    return tgt.id===myId ? { type:'pew', attacker:state.players[state.pending.attacker].name } : null;
  }
  if (type==='duel') {
    const curr = state.players[state.pending.currentTurn];
    return curr.id===myId ? { type:'duel', opponent:state.players[state.pending.currentTurn===state.pending.initiator?state.pending.target:state.pending.initiator].name } : null;
  }
  if (type==='massAttack') {
    if (!state.pending.remaining.length) return null;
    const curr = state.players[state.pending.remaining[0]];
    return curr.id===myId ? { type:'massAttack', neededCard:state.pending.neededCard } : null;
  }
  if (type==='plaza') {
    if (!state.pending.remaining.length) return null;
    const curr = state.players[state.pending.remaining[0]];
    return curr.id===myId ? { type:'plaza', revealed:state.pending.revealed } : null;
  }
  if (type==='ceosDraw') {
    const p = state.players[state.pending.player];
    return p.id===myId ? { type:'ceosDraw', options:state.pending.options } : null;
  }
  if (type==='hackerFirstDraw') {
    const p = state.players[state.pending.player];
    return p.id===myId ? { type:'hackerFirstDraw' } : null;
  }
  if (type==='smiLuckyFate') {
    const p = state.players[state.pending.player];
    return p.id===myId ? { type:'smiLuckyFate', fateType:state.pending.fateType, options:state.pending.options } : null;
  }
  return null;
}
