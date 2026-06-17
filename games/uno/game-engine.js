// ============================================================================
// UNO – játékmotor (tiszta logika, Firebase-független)
// ============================================================================
// Ez a fájl tartalmazza a teljes UNO szabálykönyvet és a testreszabható
// szabályok listáját. A main.js ezt importálja, és minden lépést (kártya
// lerakás, húzás, UNO bemondás stb.) az applyMove() függvényen keresztül hív
// meg egy Firestore tranzakción belül.
//
// Új szabály hozzáadásához:
//  1) vegyél fel egy mezőt a DEFAULT_SETTINGS-be,
//  2) írj le egy bejegyzést a SETTINGS_META tömbbe (ez generálja a lobbi UI-t),
//  3) használd fel a mezőt a megfelelő apply* függvényben.
// ============================================================================

export const COLORS = ['red', 'yellow', 'green', 'blue'];
const ACTION_VALUES = ['skip', 'reverse', 'draw2'];

// ----------------------------------------------------------------------
// Alapértelmezett szabályok + leírásuk a lobbi UI számára
// ----------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  startingHandSize: 7,
  stackDrawTwo: false,
  stackDrawFour: false,
  crossStack: false,
  jumpIn: false,
  sevenZero: false,
  drawUntilPlayable: false,
  mustPlayDrawn: false,
  drawFourChallenge: true,
  unoPenalty: 2,
  multiPlay: false,
  scoringMode: 'single',
  targetScore: 500,
  customDrawCards: [],   // [{ amount: 6, copies: 2 }, ...]
};

export const SETTINGS_META = [
  {
    key: 'startingHandSize', label: 'Kezdő lapok száma', type: 'number', min: 3, max: 10,
    hint: 'Hány lapot kap mindenki a kör elején (alap: 7).',
  },
  {
    key: 'stackDrawTwo', label: '+2 lapok halmozhatók', type: 'bool',
    hint: 'Húzás helyett rárakható egy másik +2, és a húzás összeadódik a következőnek.',
  },
  {
    key: 'stackDrawFour', label: '+4 lapok halmozhatók', type: 'bool',
    hint: 'Húzás helyett rárakható egy másik +4.',
  },
  {
    key: 'crossStack', label: 'Vegyes halmozás (+2 ↔ +4)', type: 'bool',
    hint: '+4-re +2 is rakható és fordítva (csak ha mindkét halmozás be van kapcsolva).',
  },
  {
    key: 'jumpIn', label: 'Beugrás (jump-in)', type: 'bool',
    hint: 'Ha valakinek pont olyan lapja van, mint a dobott (szín ÉS érték egyezik), bármikor lerakhatja, és onnantól ő jön.',
  },
  {
    key: 'sevenZero', label: '7-es / 0-s szabály', type: 'bool',
    hint: '7-es lerakásakor lapot cserélsz egy választott játékossal. 0-s lerakásakor mindenki továbbadja a teljes kézkártyáját.',
  },
  {
    key: 'drawUntilPlayable', label: 'Húzás lerakható lapig', type: 'bool',
    hint: 'Ha nem tudsz lerakni, addig húzol, amíg nem lesz lerakható lapod (vagy elfogy a pakli).',
  },
  {
    key: 'mustPlayDrawn', label: 'Kötelező lerakni a húzott lapot', type: 'bool',
    hint: 'Ha a húzott lapod lerakható, azt kell lerakni (nem tehető félre).',
  },
  {
    key: 'drawFourChallenge', label: '+4 megkérdőjelezhető', type: 'bool',
    hint: 'A célzott játékos kihívhatja a +4-et. Ha a kijátszónak volt érvényes lapja, ő kapja a büntetőlapokat helyette.',
  },
  {
    key: 'unoPenalty', label: 'Büntetőlapok elfelejtett UNO-ért', type: 'number', min: 0, max: 6,
    hint: 'Ha valaki 1 lapnál nem mond UNO-t, és más rajtakapja, ennyi lapot kell húznia.',
  },
  {
    key: 'multiPlay', label: 'Több egyforma szám egyszerre', type: 'bool',
    hint: 'Ugyanolyan számú lapokból (pl. három 5-ös) egyszerre több is lerakható. Akció lapok és vad lapok nem kombinálhatók.',
  },
  {
    key: 'scoringMode', label: 'Játékmód', type: 'select',
    options: [['single', 'Egy kör (ki kiürül, nyer)'], ['target', 'Pontverseny (cél pontig)']],
  },
  {
    key: 'targetScore', label: 'Cél pontszám', type: 'number', min: 50, max: 1000, step: 50,
    hint: 'Pontverseny módban eddig a pontszámig mennek a körök.',
    showIf: (s) => s.scoringMode === 'target',
  },
  {
    key: 'customDrawCards',
    label: 'Egyéni húzós lapok',
    type: 'drawCardsList',
    hint: 'Extra vad lapok: a következő játékosnak annyit kell húznia, amennyi be van állítva. Megadható, hány példány kerüljön a pakliba (ritkaság).',
  },
];

// ----------------------------------------------------------------------
// Kártya segédfüggvények. Egy lap kódolása: "szín-érték", pl. "red-5",
// "blue-skip", "green-reverse", "yellow-draw2", "wild-wild", "wild-draw4".
// ----------------------------------------------------------------------
export function cardColor(card) {
  return card.split('-')[0];
}
export function cardValue(card) {
  return card.split('-')[1];
}
export function isWildCard(card) {
  return cardColor(card) === 'wild';
}
// Egyéni húzós lapok: "wild-cdrawN" formátum (pl. "wild-cdraw6")
export function isCustomDrawCard(card) {
  return cardColor(card) === 'wild' && cardValue(card).startsWith('cdraw');
}
export function customDrawAmount(card) {
  const v = cardValue(card);
  return v.startsWith('cdraw') ? Number(v.slice(5)) : 0;
}
export function cardPoints(card) {
  const v = cardValue(card);
  if (/^[0-9]$/.test(v)) return Number(v);
  if (ACTION_VALUES.includes(v)) return 20;
  return 50; // wild / wild draw four
}

export function createDeck(settings) {
  const deck = [];
  for (const color of COLORS) {
    deck.push(`${color}-0`);
    for (let n = 1; n <= 9; n++) {
      deck.push(`${color}-${n}`, `${color}-${n}`);
    }
    for (const action of ACTION_VALUES) {
      deck.push(`${color}-${action}`, `${color}-${action}`);
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push('wild-wild', 'wild-draw4');
  }
  // Egyéni húzós lapok hozzáadása
  if (settings && Array.isArray(settings.customDrawCards)) {
    for (const entry of settings.customDrawCards) {
      const amount = Number(entry.amount);
      const copies = Number(entry.copies);
      if (amount >= 1 && copies >= 1) {
        for (let i = 0; i < copies; i++) {
          deck.push(`wild-cdraw${amount}`);
        }
      }
    }
  }
  return deck;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function nextIndex(idx, direction, n, steps = 1) {
  let i = idx;
  for (let s = 0; s < steps; s++) {
    i = (i + direction + n) % n;
  }
  return i;
}

// Lerakható-e a `card` a jelenlegi állásban?
export function isValidPlay(card, state, settings) {
  const top = state.discard[state.discard.length - 1];
  const color = cardColor(card);
  const value = cardValue(card);

  if (state.drawStack > 0) {
    const topValue = cardValue(top);
    const topIsCustom = topValue.startsWith('cdraw');
    const isD2 = value === 'draw2';
    const isD4 = value === 'draw4';
    const isCustom = value.startsWith('cdraw');

    // Egyéni húzós lap tetején csak egyéni húzós lap rakható
    if (topIsCustom) return isCustom;

    if (topValue === 'draw2') {
      if (isD2 && settings.stackDrawTwo) return true;
      if (isD4 && settings.stackDrawFour && settings.crossStack) return true;
      return false;
    }
    if (topValue === 'draw4') {
      if (isD4 && settings.stackDrawFour) return true;
      if (isD2 && settings.stackDrawTwo && settings.crossStack) return true;
      return false;
    }
    return false;
  }

  if (color === 'wild') return true;
  if (color === state.currentColor) return true;
  if (value === cardValue(top)) return true;
  return false;
}

function nameOf(players, id) {
  const p = players.find((x) => x.id === id);
  return p ? p.name : '???';
}

function pushLog(log, text) {
  const next = [...(log || []), { text, ts: Date.now() }];
  return next.slice(-30);
}

function ensureDeck(state) {
  if (state.deck.length === 0) {
    if (state.discard.length <= 1) return;
    const top = state.discard[state.discard.length - 1];
    const rest = state.discard.slice(0, -1);
    state.deck = shuffle(rest);
    state.discard = [top];
  }
}

function drawCards(state, playerId, count) {
  for (let i = 0; i < count; i++) {
    ensureDeck(state);
    if (state.deck.length === 0) break;
    state.hands[playerId].push(state.deck.pop());
  }
}

function rotateHands(state) {
  const n = state.players.length;
  const dir = state.direction;
  const oldHands = state.hands;
  const newHands = {};
  for (let i = 0; i < n; i++) {
    const fromIdx = ((i - dir) % n + n) % n;
    newHands[state.players[i].id] = oldHands[state.players[fromIdx].id];
  }
  state.hands = newHands;
}

function finishRound(state, winnerId) {
  state.status = 'roundEnd';
  state.winnerId = winnerId;
  state.unoCalls = {};
  state.pendingForcedCard = null;
  state.drawStack = 0;
  state.lastWild4 = null;
  state.roundPoints = 0;

  if (state.settings.scoringMode === 'target') {
    let roundPoints = 0;
    for (const p of state.players) {
      if (p.id !== winnerId) {
        roundPoints += state.hands[p.id].reduce((sum, c) => sum + cardPoints(c), 0);
      }
    }
    const winner = state.players.find((p) => p.id === winnerId);
    winner.score = (winner.score || 0) + roundPoints;
    state.roundPoints = roundPoints;
    if (winner.score >= state.settings.targetScore) {
      state.status = 'finished';
    }
  } else {
    state.status = 'finished';
  }

  state.log = pushLog(state.log, `${nameOf(state.players, winnerId)} kiürült – kör vége!`);
  return state;
}

// ----------------------------------------------------------------------
// Kör indítása / újraindítása
// ----------------------------------------------------------------------
function startRound(stateIn) {
  const state = structuredClone(stateIn);
  const settings = state.settings;
  const n = state.players.length;
  if (n < 2) throw new Error('Legalább 2 játékos kell a kezdéshez.');

  let deck = shuffle(createDeck(settings));
  const hands = {};
  for (const p of state.players) {
    hands[p.id] = deck.splice(0, settings.startingHandSize);
  }

  let first;
  do {
    if (deck.length === 0) deck = shuffle(createDeck(settings));
    first = deck.pop();
    if (cardValue(first) === 'draw4') {
      deck.unshift(first);
      deck = shuffle(deck);
      first = null;
    }
  } while (!first);

  state.deck = deck;
  state.discard = [first];
  state.hands = hands;
  state.direction = 1;
  state.drawStack = 0;
  state.lastWild4 = null;
  state.pendingForcedCard = null;
  state.unoCalls = {};
  state.winnerId = null;
  state.roundPoints = 0;

  const startIndex = (state.dealerIndex || 0) % n;
  state.currentPlayerIndex = startIndex;

  const color = cardColor(first);
  const value = cardValue(first);
  state.currentColor = color === 'wild' ? COLORS[Math.floor(Math.random() * 4)] : color;

  if (value === 'skip') {
    state.currentPlayerIndex = nextIndex(startIndex, state.direction, n, 1);
  } else if (value === 'reverse' && n > 2) {
    state.direction = -1;
  } else if (value === 'draw2') {
    state.drawStack = 2;
  }

  state.status = 'playing';
  state.log = pushLog(state.log, 'Új kör kezdődik – jó játékot!');
  return state;
}

// ----------------------------------------------------------------------
// Több ugyanolyan számú lap egyszerre (multi-play)
// ----------------------------------------------------------------------
function applyPlayMultiple(stateIn, action) {
  const { playerId, cards } = action;
  if (!Array.isArray(cards) || cards.length < 2) {
    throw new Error('Legalább 2 lapot kell megadni egyszerre lerakáshoz.');
  }

  const players = stateIn.players;
  const n = players.length;
  const playerIndex = players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) throw new Error('Ismeretlen játékos.');
  if (playerIndex !== stateIn.currentPlayerIndex) throw new Error('Most nem te jössz.');
  if (stateIn.drawStack > 0) throw new Error('Húzós lapra nem lehet több lapot egyszerre lerakni.');
  if (stateIn.pendingForcedCard) throw new Error('Előbb le kell rakni a húzott lapot.');

  const firstValue = cardValue(cards[0]);
  if (!/^[0-9]$/.test(firstValue)) {
    throw new Error('Egyszerre csak számkártyákat (0-9) lehet lerakni.');
  }
  if (stateIn.settings.sevenZero && (firstValue === '7' || firstValue === '0')) {
    throw new Error('A 7/0 szabály miatt ezt a számot nem lehet egyszerre több lappal lerakni.');
  }
  for (const c of cards) {
    if (cardColor(c) === 'wild') throw new Error('Vad lapokat nem lehet egyszerre lerakni.');
    if (cardValue(c) !== firstValue) throw new Error('Minden lapnak ugyanolyan számúnak kell lennie.');
  }

  if (!isValidPlay(cards[0], stateIn, stateIn.settings)) {
    throw new Error('Ez a lap most nem rakható le.');
  }

  const state = structuredClone(stateIn);
  const hand = [...state.hands[playerId]];
  for (const c of cards) {
    const idx = hand.indexOf(c);
    if (idx === -1) throw new Error('Ez a lap nincs a kezedben.');
    hand.splice(idx, 1);
  }
  state.hands[playerId] = hand;

  for (const c of cards) state.discard.push(c);
  state.currentColor = cardColor(cards[cards.length - 1]);
  state.lastWild4 = null;

  if (hand.length === 1) {
    state.unoCalls[playerId] = false;
  } else {
    delete state.unoCalls[playerId];
  }

  if (hand.length === 0) return finishRound(state, playerId);

  state.currentPlayerIndex = nextIndex(playerIndex, state.direction, n, 1);
  state.log = pushLog(state.log, `${nameOf(players, playerId)} lerakott ${cards.length}× ${firstValue}-est egyszerre.`);
  return state;
}

// ----------------------------------------------------------------------
// Lap lerakása
// ----------------------------------------------------------------------
function applyPlay(stateIn, action) {
  const state = structuredClone(stateIn);
  const { playerId, card, chosenColor, sevenTarget } = action;
  const settings = state.settings;
  const players = state.players;
  const n = players.length;
  const playerIndex = players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) throw new Error('Ismeretlen játékos.');

  const hand = state.hands[playerId];
  if (!hand || !hand.includes(card)) throw new Error('Ez a lap nincs a kezedben.');

  const isCurrentTurn = playerIndex === state.currentPlayerIndex;

  if (isCurrentTurn && state.pendingForcedCard && card !== state.pendingForcedCard) {
    throw new Error('A most húzott lapot kell lejátszanod.');
  }

  const top = state.discard[state.discard.length - 1];
  let jumpIn = false;

  if (!isCurrentTurn) {
    if (!settings.jumpIn) throw new Error('Most nem te jössz.');
    if (card !== top) throw new Error('Beugráshoz pontosan ugyanolyan lap kell (szín és érték).');
    jumpIn = true;
  } else if (!isValidPlay(card, state, settings)) {
    throw new Error('Ez a lap most nem rakható le.');
  }

  state.pendingForcedCard = null;

  // Lap eltávolítása a kézből, dobópakli tetejére
  hand.splice(hand.indexOf(card), 1);
  state.discard.push(card);

  const color = cardColor(card);
  const value = cardValue(card);
  const priorColor = stateIn.currentColor;

  const actingIndex = jumpIn ? playerIndex : state.currentPlayerIndex;
  state.currentPlayerIndex = actingIndex;

  if (color === 'wild') {
    if (!chosenColor || !COLORS.includes(chosenColor)) throw new Error('Válassz színt a vad lap kijátszásához!');
    state.currentColor = chosenColor;
  } else {
    state.currentColor = color;
  }

  let advance = 1;

  if (value === 'skip') {
    advance = 2;
  } else if (value === 'reverse') {
    if (n === 2) {
      advance = 2;
    } else {
      state.direction *= -1;
      advance = 1;
    }
  } else if (value === 'draw2') {
    state.drawStack += 2;
  } else if (value === 'draw4') {
    state.drawStack += 4;
    state.lastWild4 = { playerId, priorColor };
  } else if (value.startsWith('cdraw')) {
    // Egyéni húzós lap
    state.drawStack += Number(value.slice(5));
  } else if (value === '0' && settings.sevenZero) {
    rotateHands(state);
  } else if (value === '7' && settings.sevenZero) {
    if (!sevenTarget || sevenTarget === playerId || !players.find((p) => p.id === sevenTarget)) {
      throw new Error('Válassz egy játékost, akivel lapot cserélsz!');
    }
    const tmp = state.hands[playerId];
    state.hands[playerId] = state.hands[sevenTarget];
    state.hands[sevenTarget] = tmp;
  }

  if (value !== 'draw2' && value !== 'draw4' && !value.startsWith('cdraw')) {
    state.lastWild4 = null;
  }

  // UNO bemondás nyomon követése
  const finalHand = state.hands[playerId];
  if (finalHand.length === 1) {
    state.unoCalls[playerId] = false;
  } else {
    delete state.unoCalls[playerId];
  }

  if (finalHand.length === 0) {
    return finishRound(state, playerId);
  }

  state.currentPlayerIndex = nextIndex(actingIndex, state.direction, n, advance);
  state.log = pushLog(state.log, `${nameOf(players, playerId)} lerakta: ${describeCard(card)}${jumpIn ? ' (beugrás!)' : ''}`);
  return state;
}

function describeCard(card) {
  const color = cardColor(card);
  const value = cardValue(card);
  const colorNames = { red: 'piros', yellow: 'sárga', green: 'zöld', blue: 'kék', wild: 'vad' };
  const valueNames = { skip: 'kihagyás', reverse: 'irányváltás', draw2: '+2', wild: 'szín-választó', draw4: '+4 szín-választó' };
  const c = colorNames[color] || color;
  if (value.startsWith('cdraw')) return `${c} +${value.slice(5)} szín-választó`;
  const v = valueNames[value] || value;
  return `${c} ${v}`;
}

// ----------------------------------------------------------------------
// Húzás
// ----------------------------------------------------------------------
function applyDraw(stateIn, action) {
  const state = structuredClone(stateIn);
  const { playerId } = action;
  const settings = state.settings;
  const players = state.players;
  const n = players.length;
  const playerIndex = players.findIndex((p) => p.id === playerId);
  if (playerIndex !== state.currentPlayerIndex) throw new Error('Most nem te jössz.');
  if (state.pendingForcedCard) throw new Error('A húzott lapot kell lejátszanod.');

  const hand = state.hands[playerId];

  if (state.drawStack > 0) {
    const amount = state.drawStack;
    drawCards(state, playerId, amount);
    state.log = pushLog(state.log, `${nameOf(players, playerId)} húzott ${amount} lapot.`);
    state.drawStack = 0;
    state.lastWild4 = null;
    state.currentPlayerIndex = nextIndex(state.currentPlayerIndex, state.direction, n, 1);
    return state;
  }

  let drawnCard = null;
  let drawnCount = 0;

  if (settings.drawUntilPlayable) {
    const maxAttempts = 200; // biztonsági korlát, hogy ne ragadjon be
    while (drawnCount < maxAttempts) {
      ensureDeck(state);
      if (state.deck.length === 0) break;
      const c = state.deck.pop();
      hand.push(c);
      drawnCount++;
      if (isValidPlay(c, state, settings)) { drawnCard = c; break; }
    }
    state.log = pushLog(state.log, `${nameOf(players, playerId)} húzott ${drawnCount} lapot.`);
  } else {
    ensureDeck(state);
    if (state.deck.length > 0) {
      drawnCard = state.deck.pop();
      hand.push(drawnCard);
      drawnCount = 1;
      state.log = pushLog(state.log, `${nameOf(players, playerId)} húzott egy lapot.`);
    }
  }

  const playableDrawn = drawnCard && isValidPlay(drawnCard, state, settings);

  if (settings.mustPlayDrawn && playableDrawn) {
    state.pendingForcedCard = drawnCard;
  } else {
    state.pendingForcedCard = null;
    state.currentPlayerIndex = nextIndex(state.currentPlayerIndex, state.direction, n, 1);
  }

  return state;
}

// ----------------------------------------------------------------------
// UNO bemondás / rajtakapás
// ----------------------------------------------------------------------
function applyCallUno(stateIn, action) {
  const state = structuredClone(stateIn);
  const { playerId } = action;
  const hand = state.hands[playerId];
  if (!hand || hand.length !== 1) throw new Error('Csak akkor mondhatsz UNO-t, ha pontosan 1 lapod van.');
  state.unoCalls[playerId] = true;
  state.log = pushLog(state.log, `${nameOf(state.players, playerId)}: UNO!`);
  return state;
}

function applyCatchUno(stateIn, action) {
  const state = structuredClone(stateIn);
  const { playerId, targetId } = action;
  const targetHand = state.hands[targetId];
  if (!targetHand || targetHand.length !== 1) throw new Error('Ennek a játékosnak most nincs 1 lapja.');
  if (state.unoCalls[targetId]) throw new Error('Ez a játékos már bemondta az UNO-t.');
  const penalty = state.settings.unoPenalty;
  drawCards(state, targetId, penalty);
  state.unoCalls[targetId] = true;
  state.log = pushLog(
    state.log,
    `${nameOf(state.players, targetId)} elfelejtette az UNO-t! ${nameOf(state.players, playerId)} rajtakapta – húz ${penalty} lapot.`
  );
  return state;
}

// ----------------------------------------------------------------------
// +4 kihívás
// ----------------------------------------------------------------------
function applyChallenge(stateIn, action) {
  const state = structuredClone(stateIn);
  const { playerId } = action;
  const players = state.players;
  const n = players.length;
  const playerIndex = players.findIndex((p) => p.id === playerId);
  if (playerIndex !== state.currentPlayerIndex) throw new Error('Most nem te jössz.');
  if (!state.settings.drawFourChallenge || !state.lastWild4) throw new Error('Most nincs mit kihívni.');

  const { playerId: accusedId, priorColor } = state.lastWild4;
  const accusedHand = state.hands[accusedId];
  const hadMatch = accusedHand.some((c) => cardColor(c) === priorColor);
  const stack = state.drawStack;

  if (hadMatch) {
    drawCards(state, accusedId, stack);
    state.log = pushLog(
      state.log,
      `${nameOf(players, playerId)} sikeresen kihívta ${nameOf(players, accusedId)} +4-ét – ő húz ${stack} lapot!`
    );
    state.drawStack = 0;
    state.lastWild4 = null;
  } else {
    const penalty = stack + 2;
    drawCards(state, playerId, penalty);
    state.log = pushLog(
      state.log,
      `${nameOf(players, playerId)} sikertelenül kihívta ${nameOf(players, accusedId)} +4-ét – húz ${penalty} lapot!`
    );
    state.drawStack = 0;
    state.lastWild4 = null;
    state.currentPlayerIndex = nextIndex(state.currentPlayerIndex, state.direction, n, 1);
  }

  return state;
}

// ----------------------------------------------------------------------
// Kezdeti állapot egy új szobához
// ----------------------------------------------------------------------
export function createInitialState(settingsOverrides) {
  return {
    status: 'lobby',
    settings: { ...DEFAULT_SETTINGS, ...(settingsOverrides || {}) },
    players: [],
    dealerIndex: 0,
    currentPlayerIndex: 0,
    direction: 1,
    deck: [],
    discard: [],
    hands: {},
    currentColor: null,
    drawStack: 0,
    lastWild4: null,
    pendingForcedCard: null,
    unoCalls: {},
    winnerId: null,
    roundPoints: 0,
    log: [],
  };
}

// ----------------------------------------------------------------------
// Fő reducer – minden lépés ezen megy keresztül
// ----------------------------------------------------------------------
export function applyMove(stateIn, action) {
  switch (action.type) {
    case 'join': {
      const state = structuredClone(stateIn);
      const existing = state.players.find((p) => p.id === action.playerId);
      if (existing) {
        existing.name = action.name;
        existing.connected = true;
        return state;
      }
      if (state.status !== 'lobby') throw new Error('A játék már elkezdődött, most nem lehet csatlakozni.');
      if (state.players.length >= 8) throw new Error('A szoba tele van (max. 8 játékos).');
      state.players.push({ id: action.playerId, name: action.name, score: 0, connected: true });
      return state;
    }

    case 'leave': {
      const state = structuredClone(stateIn);
      const idx = state.players.findIndex((p) => p.id === action.playerId);
      if (idx === -1) return state;
      if (state.status === 'lobby') {
        state.players.splice(idx, 1);
      } else {
        state.players[idx].connected = false;
      }
      return state;
    }

    case 'updateSettings': {
      if (stateIn.status !== 'lobby') throw new Error('A szabályok csak a lobbiban módosíthatók.');
      const state = structuredClone(stateIn);
      state.settings = { ...state.settings, ...action.settings };
      return state;
    }

    case 'startGame': {
      const state = structuredClone(stateIn);
      state.dealerIndex = 0;
      for (const p of state.players) p.score = 0;
      return startRound(state);
    }

    case 'nextRound': {
      if (stateIn.status !== 'roundEnd') throw new Error('A kör még nem ért véget.');
      const state = structuredClone(stateIn);
      const n = state.players.length;
      state.dealerIndex = ((state.dealerIndex || 0) + 1) % n;
      return startRound(state);
    }

    case 'playMultiple':
      return applyPlayMultiple(stateIn, action);

    case 'play':
      return applyPlay(stateIn, action);

    case 'draw':
      return applyDraw(stateIn, action);

    case 'callUno':
      return applyCallUno(stateIn, action);

    case 'catchUno':
      return applyCatchUno(stateIn, action);

    case 'challenge':
      return applyChallenge(stateIn, action);

    case 'setConnected': {
      const state = structuredClone(stateIn);
      const p = state.players.find((x) => x.id === action.playerId);
      if (p) p.connected = action.connected;
      return state;
    }

    case 'returnToLobby': {
      const state = structuredClone(stateIn);
      state.status = 'lobby';
      state.dealerIndex = 0;
      for (const p of state.players) p.score = 0;
      state.hands = {};
      state.deck = [];
      state.discard = [];
      state.currentColor = null;
      state.drawStack = 0;
      state.lastWild4 = null;
      state.pendingForcedCard = null;
      state.unoCalls = {};
      state.winnerId = null;
      state.roundPoints = 0;
      state.currentPlayerIndex = 0;
      state.direction = 1;
      state.log = [];
      return state;
    }

    case 'forceSkip': {
      if (stateIn.status !== 'playing') throw new Error('Nincs aktív játék.');
      const state = structuredClone(stateIn);
      const n = state.players.length;
      state.drawStack = 0;
      state.lastWild4 = null;
      state.pendingForcedCard = null;
      state.currentPlayerIndex = nextIndex(state.currentPlayerIndex, state.direction, n, 1);
      state.log = pushLog(state.log, 'A kör átugorva (lecsatlakozott vagy inaktív játékos).');
      return state;
    }

    default:
      throw new Error('Ismeretlen lépés: ' + action.type);
  }
}
