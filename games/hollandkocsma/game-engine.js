// ============================================================================
// Holland kocsma – játékmotor (tiszta logika, Firebase-független)
// ============================================================================
// A szabályok forrása: https://hu.wikipedia.org/wiki/Holland_kocsma_(kártyajáték)
// Nemzetközi nevein: Shithead / Karma / Palace / Shed.
//
// A játék lényege: mindenki elé kerül 52 lapos francia kártyából N lap
// lefordítva, ugyanennyi rájuk felfordítva, és kap N lapot is a kezébe.
// Felváltva lapot kell rakni a középső dobott paklira (egyenlő vagy nagyobb
// értékkel, hacsak nincs "vad" lap), amíg el nem fogy a kezünkből, majd a
// felfordított, végül a lefordított (vakon kijátszott) lapjainkból is.
// Aki elsőként kiürül, megússza a kört – aki utoljára marad lapokkal, veszít.
//
// Ez a fájl a main.js-től függetlenül tesztelhető (lásd a gyökérben lévő
// test-hollandkocsma-engine.mjs fájlt).
//
// Új szabály hozzáadásához:
//  1) vegyél fel egy mezőt a DEFAULT_SETTINGS-be,
//  2) írj le egy bejegyzést a SETTINGS_META tömbbe (ez generálja a lobbi UI-t
//     ÉS a játék közben bármikor megnyitható "Gyorstalpaló" szabály-modált),
//  3) használd fel a mezőt a megfelelő apply*/resolve* függvényben.
// ============================================================================

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];

export const SUIT_SYMBOL = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
export const RANK_DISPLAY = { J: 'Bubi', Q: 'Dáma', K: 'Király', A: 'Ász' };

// ----------------------------------------------------------------------
// Alapértelmezett szabályok + leírásuk a lobbi UI / gyorstalpaló számára
// ----------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  tableCardCount: 3,
  startingHandSize: 3,
  twoIsWildReset: true,
  tenBurns: true,
  fiveReverse: false,
  quadBurn: true,
  restrictPairPlay: false,
  blindDrawAttempt: true,
  voluntaryPickup: true,
};

export const SETTINGS_META = [
  {
    key: 'tableCardCount', label: 'Lapok az asztalon (le / fel)', type: 'number', min: 2, max: 6,
    hint: 'Ennyi lapot kap mindenki lefordítva, és ugyanennyit rájuk felfordítva (alap: 3).',
  },
  {
    key: 'startingHandSize', label: 'Kezdő lapok a kézben', type: 'number', min: 2, max: 7,
    hint: 'Ennyi lapot kapsz kezdéskor, és a húzópakliból mindig ennyire egészíted ki, amíg az tart (alap: 3).',
  },
  {
    key: 'twoIsWildReset', label: 'Kettes = újraindító', type: 'bool',
    hint: 'A 2-es bármilyen lapra lerakható, és utána a következő lap bármi lehet.',
  },
  {
    key: 'tenBurns', label: 'Tízes = égető lap', type: 'bool',
    hint: 'A 10-es bármilyen lapra lerakható; elégeti (kiveszi a játékból) a teljes dobott paklit, és újra te jössz.',
  },
  {
    key: 'fiveReverse', label: 'Ötös = visszafordító', type: 'bool',
    hint: 'Az 5-ös bármilyen lapra lerakható; utána a következő lapnak legfeljebb ötösnek kell lennie. (Eredetileg opcionális szabály.)',
  },
  {
    key: 'quadBurn', label: 'Négy egyforma lap éget', type: 'bool',
    hint: 'Ha a dobott pakli tetején (akár több lépésben) összegyűlik 4 egyforma értékű lap, a pakli automatikusan elég.',
  },
  {
    key: 'restrictPairPlay', label: 'Páros lerakás tiltása', type: 'bool',
    hint: 'Két egyforma lapot nem rakhatsz le együtt – csak egyesével, vagy hárommal/többel egyszerre. (Eredetileg opcionális nehezítés.)',
  },
  {
    key: 'blindDrawAttempt', label: 'Vak húzás megengedett', type: 'bool',
    hint: 'Ha nincs lerakható lapod, húzhatsz vakon a pakli tetejéről, és megpróbálhatod azonnal lejátszani – ha nem jó, az egész dobott paklit fel kell venned.',
  },
  {
    key: 'voluntaryPickup', label: 'Pakli bármikor felvehető', type: 'bool',
    hint: 'Akkor is felveheted a teljes dobott paklit, ha lenne lerakható lapod – néha taktikus döntés lehet (blöff).',
  },
];

// ----------------------------------------------------------------------
// Kártya segédfüggvények. Egy lap kódolása: "érték-szín", pl. "10-hearts",
// "A-spades", "2-clubs". A szín (suit) a játék szabályait nem befolyásolja,
// csak vizuális elem.
// ----------------------------------------------------------------------
export function cardRank(card) {
  return card.split('-')[0];
}
export function cardSuit(card) {
  return card.split('-')[1];
}
export function isRedSuit(suit) {
  return suit === 'hearts' || suit === 'diamonds';
}
export function rankPower(rank) {
  return RANKS.indexOf(rank) + 2; // '2' -> 2, ... 'A' -> 14
}
export function rankDisplay(rank) {
  return RANK_DISPLAY[rank] || rank;
}

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push(`${rank}-${suit}`);
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

// Hány 52 lapos pakli kell, hogy mindenkinek kijöjjön a lapja?
function decksNeeded(playerCount, settings) {
  const total = playerCount * (settings.tableCardCount * 2 + settings.startingHandSize);
  return Math.max(1, Math.ceil(total / 52));
}

// Lerakható-e most a `rank` érték? (Az aktuális dobott pakli / újraindítás /
// visszafordítás állapota alapján.)
export function isValidPlay(rank, state, settings) {
  if (rank === '2' && settings.twoIsWildReset) return true;
  if (rank === '10' && settings.tenBurns) return true;
  if (rank === '5' && settings.fiveReverse) return true;
  if (state.resetActive) return true;
  if (state.reverseCap) return rankPower(rank) <= rankPower(state.reverseCap);
  const top = state.discard[state.discard.length - 1];
  if (!top) return true;
  return rankPower(rank) >= rankPower(cardRank(top));
}

// Melyik "zóna" (kéz / felfordított / lefordított) játszható éppen az adott
// játékosnak, a szabályos sorrend szerint (kéz -> felfordított -> lefordított,
// csak akkor léphetünk tovább, ha az előző elfogyott ÉS a húzópakli is üres).
export function getActiveZone(state, playerId) {
  const hand = state.hands[playerId] || [];
  if (hand.length > 0 || state.deck.length > 0) return { zone: 'hand', cards: hand };
  const faceUp = state.faceUp[playerId] || [];
  if (faceUp.length > 0) return { zone: 'faceUp', cards: faceUp };
  const faceDown = state.faceDown[playerId] || [];
  if (faceDown.length > 0) return { zone: 'faceDown', cards: faceDown };
  return { zone: 'none', cards: [] };
}

// Van-e épp lerakható lapja a játékosnak a saját aktív zónájában? (A
// lefordított zónában ismeretlen a tartalom, ezért ott mindig false.)
export function hasAnyValidPlay(state, playerId) {
  const { zone, cards } = getActiveZone(state, playerId);
  if (zone !== 'hand' && zone !== 'faceUp') return false;
  return cards.some((c) => isValidPlay(cardRank(c), state, state.settings));
}

function nameOf(players, id) {
  const p = players.find((x) => x.id === id);
  return p ? p.name : '???';
}

function pushLog(log, text) {
  const next = [...(log || []), { text, ts: Date.now() }];
  return next.slice(-30);
}

// Pakli "elégetése": a dobott pakli kikerül a játékból.
function burnPile(state) {
  state.burnedCount = (state.burnedCount || 0) + state.discard.length;
  state.discard = [];
  state.resetActive = false;
  state.reverseCap = null;
}

// Egy sikeres lerakás után frissíti az újraindítás/visszafordítás jelzőket,
// és ellenőrzi az égetést (10-es, illetve 4 egyforma egymás után).
// Visszaadja, hogy történt-e égetés (ilyenkor ugyanaz a játékos jön újra).
function resolvePostPlay(state, rank, settings) {
  if (rank === '2' && settings.twoIsWildReset) {
    state.resetActive = true;
    state.reverseCap = null;
  } else if (rank === '5' && settings.fiveReverse) {
    state.resetActive = false;
    state.reverseCap = '5';
  } else {
    state.resetActive = false;
    state.reverseCap = null;
  }

  let burned = false;
  if (rank === '10' && settings.tenBurns) {
    burnPile(state);
    burned = true;
  } else if (settings.quadBurn && state.discard.length >= 4) {
    const topFour = state.discard.slice(-4);
    if (topFour.every((c) => cardRank(c) === cardRank(topFour[0]))) {
      burnPile(state);
      burned = true;
    }
  }
  return burned;
}

function refillHand(state, playerId) {
  const target = state.settings.startingHandSize;
  const hand = state.hands[playerId];
  while (hand.length < target && state.deck.length > 0) {
    hand.push(state.deck.pop());
  }
}

// Következő olyan játékos indexe, aki ebben a körben még nem ürült ki.
export function nextActiveIndex(state, fromIndex) {
  const n = state.players.length;
  let i = fromIndex;
  for (let guard = 0; guard < n + 1; guard++) {
    i = (i + 1) % n;
    if (!state.finishedOrder.includes(state.players[i].id)) return i;
  }
  return fromIndex; // biztonsági fallback (nem fordulhat elő)
}

// Egy játékos kiürül (kéz + felfordított + lefordított is üres).
function finishPlayer(state, playerId) {
  state.finishedOrder.push(playerId);
  if (state.finishedOrder.length === 1) state.winnerId = playerId;
  const place = state.finishedOrder.length;
  state.log = pushLog(state.log, `${nameOf(state.players, playerId)} kiürült – ${place}. hely!`);

  const stillIn = state.players.filter((p) => !state.finishedOrder.includes(p.id));
  if (stillIn.length <= 1) {
    state.status = 'roundEnd';
    if (stillIn.length === 1) {
      const loser = stillIn[0];
      state.loserId = loser.id;
      loser.lossCount = (loser.lossCount || 0) + 1;
      state.log = pushLog(state.log, `${loser.name} maradt utoljára lapokkal ezúttal.`);
    } else {
      state.loserId = null;
    }
  }
}

// ----------------------------------------------------------------------
// Új kör kiosztása (startGame és nextRound is ezt hívja)
// ----------------------------------------------------------------------
function dealNewRound(state) {
  const settings = state.settings;
  const n = state.players.length;
  const count = decksNeeded(n, settings);
  let deck = [];
  for (let i = 0; i < count; i++) deck = deck.concat(createDeck());
  deck = shuffle(deck);

  const hands = {}, faceUp = {}, faceDown = {}, readySetup = {};
  for (const p of state.players) {
    faceDown[p.id] = deck.splice(0, settings.tableCardCount);
    faceUp[p.id] = deck.splice(0, settings.tableCardCount);
    hands[p.id] = deck.splice(0, settings.startingHandSize);
    readySetup[p.id] = false;
  }

  state.deck = deck;
  state.hands = hands;
  state.faceUp = faceUp;
  state.faceDown = faceDown;
  state.readySetup = readySetup;
  state.discard = [];
  state.burnedCount = 0;
  state.resetActive = false;
  state.reverseCap = null;
  state.finishedOrder = [];
  state.winnerId = null;
  state.loserId = null;
  state.status = 'setup';
  state.currentPlayerIndex = (state.dealerIndex || 0) % n;
  state.log = pushLog(state.log, 'Új kör – mindenki rendezheti a lapjait, mielőtt kezdünk.');
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
    roundNumber: 0,
    currentPlayerIndex: 0,
    deck: [],
    discard: [],
    burnedCount: 0,
    hands: {},
    faceUp: {},
    faceDown: {},
    readySetup: {},
    resetActive: false,
    reverseCap: null,
    finishedOrder: [],
    winnerId: null,
    loserId: null,
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
      state.players.push({ id: action.playerId, name: action.name, connected: true, lossCount: 0 });
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
      if (state.players.length < 2) throw new Error('Legalább 2 játékos kell a kezdéshez.');
      state.dealerIndex = 0;
      state.roundNumber = 1;
      for (const p of state.players) p.lossCount = 0;
      return dealNewRound(state);
    }

    case 'nextRound': {
      if (stateIn.status !== 'roundEnd') throw new Error('A kör még nem ért véget.');
      const state = structuredClone(stateIn);
      const n = state.players.length;
      state.dealerIndex = ((state.dealerIndex || 0) + 1) % n;
      state.roundNumber = (state.roundNumber || 1) + 1;
      return dealNewRound(state);
    }

    case 'setReady': {
      if (stateIn.status !== 'setup') throw new Error('Most nincs felkészülési szakasz.');
      const state = structuredClone(stateIn);
      const p = state.players.find((x) => x.id === action.playerId);
      if (!p) throw new Error('Ismeretlen játékos.');
      state.readySetup[action.playerId] = !!action.ready;
      state.log = pushLog(state.log, action.ready ? `${p.name} készen áll.` : `${p.name} még rendezi a lapjait.`);
      const allReady = state.players.every((pl) => state.readySetup[pl.id]);
      if (allReady) {
        state.status = 'playing';
        state.log = pushLog(state.log, 'Mindenki készen áll – kezdődik a parti!');
      }
      return state;
    }

    case 'swapSetupCard': {
      if (stateIn.status !== 'setup') throw new Error('Csak a felkészülési szakaszban cserélhetsz lapot.');
      if (stateIn.readySetup[action.playerId]) throw new Error('Már jelezted, hogy készen állsz – vond vissza, ha még cserélnél.');
      const state = structuredClone(stateIn);
      const hand = state.hands[action.playerId];
      const faceUp = state.faceUp[action.playerId];
      const { handIndex, faceUpIndex } = action;
      if (!hand || !faceUp) throw new Error('Ismeretlen játékos.');
      if (handIndex < 0 || handIndex >= hand.length || faceUpIndex < 0 || faceUpIndex >= faceUp.length) {
        throw new Error('Érvénytelen lapválasztás.');
      }
      const tmp = hand[handIndex];
      hand[handIndex] = faceUp[faceUpIndex];
      faceUp[faceUpIndex] = tmp;
      return state;
    }

    case 'playCards': {
      if (stateIn.status !== 'playing') throw new Error('Most nincs aktív kör.');
      const players = stateIn.players;
      const playerIndex = players.findIndex((p) => p.id === action.playerId);
      if (playerIndex === -1) throw new Error('Ismeretlen játékos.');
      if (playerIndex !== stateIn.currentPlayerIndex) throw new Error('Most nem te jössz.');
      if (stateIn.finishedOrder.includes(action.playerId)) throw new Error('Te már kiürültél ebben a körben.');
      if (!Array.isArray(action.indices) || action.indices.length === 0) {
        throw new Error('Válassz ki legalább egy lapot.');
      }

      const state = structuredClone(stateIn);
      const settings = state.settings;
      const zoneInfo = getActiveZone(state, action.playerId);
      if (zoneInfo.zone !== action.zone) throw new Error('Ezt a lapkészletet most nem játszhatod ki.');
      if (action.zone !== 'hand' && action.zone !== 'faceUp') throw new Error('Ebből a zónából egyesével, a felfordítással lehet csak lapot kijátszani.');

      const sourceArr = action.zone === 'hand' ? state.hands[action.playerId] : state.faceUp[action.playerId];
      const uniqueIdx = [...new Set(action.indices)].sort((a, b) => a - b);
      if (uniqueIdx.some((i) => i < 0 || i >= sourceArr.length)) throw new Error('Érvénytelen lapválasztás.');

      const cardsToPlay = uniqueIdx.map((i) => sourceArr[i]);
      const rank = cardRank(cardsToPlay[0]);
      if (!cardsToPlay.every((c) => cardRank(c) === rank)) throw new Error('Csak egyforma értékű lapokat rakhatsz le egyszerre.');
      if (settings.restrictPairPlay && cardsToPlay.length === 2) {
        throw new Error('Két egyforma lapot nem rakhatsz le együtt – egyesével, vagy hárommal/többel teheted.');
      }
      if (!isValidPlay(rank, state, settings)) throw new Error('Ez a lap most nem rakható le.');

      for (let i = uniqueIdx.length - 1; i >= 0; i--) sourceArr.splice(uniqueIdx[i], 1);
      for (const c of cardsToPlay) state.discard.push(c);

      const burned = resolvePostPlay(state, rank, settings);
      if (action.zone === 'hand') refillHand(state, action.playerId);

      const multiTxt = cardsToPlay.length > 1 ? `${cardsToPlay.length}× ` : '';
      state.log = pushLog(
        state.log,
        `${nameOf(players, action.playerId)} lerakott: ${multiTxt}${rankDisplay(rank)}${burned ? ' – ÉGETÉS! 🔥' : ''}`
      );

      const empty = state.hands[action.playerId].length === 0 &&
        state.faceUp[action.playerId].length === 0 &&
        state.faceDown[action.playerId].length === 0;

      if (empty) {
        finishPlayer(state, action.playerId);
        if (state.status === 'playing') state.currentPlayerIndex = nextActiveIndex(state, playerIndex);
      } else {
        state.currentPlayerIndex = burned ? playerIndex : nextActiveIndex(state, playerIndex);
      }
      return state;
    }

    case 'flipFaceDown': {
      if (stateIn.status !== 'playing') throw new Error('Most nincs aktív kör.');
      const players = stateIn.players;
      const playerIndex = players.findIndex((p) => p.id === action.playerId);
      if (playerIndex !== stateIn.currentPlayerIndex) throw new Error('Most nem te jössz.');
      if (stateIn.finishedOrder.includes(action.playerId)) throw new Error('Te már kiürültél.');
      const zoneInfo = getActiveZone(stateIn, action.playerId);
      if (zoneInfo.zone !== 'faceDown') throw new Error('Most nem a lefordított lapjaid jönnek.');
      const fd = stateIn.faceDown[action.playerId] || [];
      if (action.index < 0 || action.index >= fd.length) throw new Error('Érvénytelen lapválasztás.');

      const state = structuredClone(stateIn);
      const settings = state.settings;
      const [revealed] = state.faceDown[action.playerId].splice(action.index, 1);
      const rank = cardRank(revealed);
      state.log = pushLog(state.log, `${nameOf(players, action.playerId)} felfordított egy lefordított lapot: ${rankDisplay(rank)}.`);

      if (isValidPlay(rank, state, settings)) {
        state.discard.push(revealed);
        const burned = resolvePostPlay(state, rank, settings);
        const empty = state.hands[action.playerId].length === 0 &&
          state.faceUp[action.playerId].length === 0 &&
          state.faceDown[action.playerId].length === 0;
        if (empty) {
          finishPlayer(state, action.playerId);
          if (state.status === 'playing') state.currentPlayerIndex = nextActiveIndex(state, playerIndex);
        } else {
          state.currentPlayerIndex = burned ? playerIndex : nextActiveIndex(state, playerIndex);
        }
      } else {
        const pickedUpCount = state.discard.length + 1;
        state.hands[action.playerId] = [revealed, ...state.discard];
        state.discard = [];
        state.resetActive = false;
        state.reverseCap = null;
        state.log = pushLog(state.log, `Nem volt jó – ${nameOf(players, action.playerId)} felvette a paklit (${pickedUpCount} lap).`);
        state.currentPlayerIndex = nextActiveIndex(state, playerIndex);
      }
      return state;
    }

    case 'blindDraw': {
      if (stateIn.status !== 'playing') throw new Error('Most nincs aktív kör.');
      const players = stateIn.players;
      const playerIndex = players.findIndex((p) => p.id === action.playerId);
      if (playerIndex !== stateIn.currentPlayerIndex) throw new Error('Most nem te jössz.');
      if (stateIn.finishedOrder.includes(action.playerId)) throw new Error('Te már kiürültél.');
      if (!stateIn.settings.blindDrawAttempt) throw new Error('A vak húzás ki van kapcsolva ennél a partinál.');
      if ((stateIn.hands[action.playerId] || []).length === 0) throw new Error('Vak húzást csak a kézből lerakás helyett próbálhatsz.');
      if (stateIn.deck.length === 0) throw new Error('A húzópakli üres.');
      if (hasAnyValidPlay(stateIn, action.playerId)) throw new Error('Van lerakható lapod a kezedben – azt játszd ki.');

      const state = structuredClone(stateIn);
      const settings = state.settings;
      const drawn = state.deck.pop();
      const rank = cardRank(drawn);

      if (isValidPlay(rank, state, settings)) {
        state.discard.push(drawn);
        const burned = resolvePostPlay(state, rank, settings);
        refillHand(state, action.playerId);
        state.log = pushLog(
          state.log,
          `${nameOf(players, action.playerId)} vakon húzott és bejött: ${rankDisplay(rank)}${burned ? ' – ÉGETÉS! 🔥' : ''}`
        );
        state.currentPlayerIndex = burned ? playerIndex : nextActiveIndex(state, playerIndex);
      } else {
        const pickedUpCount = state.discard.length + 1;
        state.hands[action.playerId] = [...state.hands[action.playerId], drawn, ...state.discard];
        state.discard = [];
        state.resetActive = false;
        state.reverseCap = null;
        state.log = pushLog(
          state.log,
          `${nameOf(players, action.playerId)} vakon húzott (${rankDisplay(rank)}) – nem jött be, felvette a paklit (${pickedUpCount} lap).`
        );
        state.currentPlayerIndex = nextActiveIndex(state, playerIndex);
      }
      return state;
    }

    case 'pickupPile': {
      if (stateIn.status !== 'playing') throw new Error('Most nincs aktív kör.');
      const players = stateIn.players;
      const playerIndex = players.findIndex((p) => p.id === action.playerId);
      if (playerIndex !== stateIn.currentPlayerIndex) throw new Error('Most nem te jössz.');
      if (stateIn.finishedOrder.includes(action.playerId)) throw new Error('Te már kiürültél.');
      if (stateIn.discard.length === 0) throw new Error('A dobott pakli üres, nincs mit felvenni.');
      if (hasAnyValidPlay(stateIn, action.playerId) && !stateIn.settings.voluntaryPickup) {
        throw new Error('Van lerakható lapod – most kötelező lejátszanod (vagy vak húzást próbálnod).');
      }

      const state = structuredClone(stateIn);
      const pickedUpCount = state.discard.length;
      state.hands[action.playerId] = [...state.hands[action.playerId], ...state.discard];
      state.discard = [];
      state.resetActive = false;
      state.reverseCap = null;
      state.log = pushLog(state.log, `${nameOf(players, action.playerId)} felvette a dobott paklit (${pickedUpCount} lap).`);
      state.currentPlayerIndex = nextActiveIndex(state, playerIndex);
      return state;
    }

    case 'setConnected': {
      const state = structuredClone(stateIn);
      const p = state.players.find((x) => x.id === action.playerId);
      if (p) p.connected = action.connected;
      return state;
    }

    case 'forceSkip': {
      if (stateIn.status !== 'playing') throw new Error('Nincs aktív játék.');
      const state = structuredClone(stateIn);
      state.currentPlayerIndex = nextActiveIndex(state, state.currentPlayerIndex);
      state.log = pushLog(state.log, 'A kör átugorva (lecsatlakozott vagy inaktív játékos).');
      return state;
    }

    case 'returnToLobby': {
      const state = structuredClone(stateIn);
      state.status = 'lobby';
      state.dealerIndex = 0;
      state.roundNumber = 0;
      for (const p of state.players) p.lossCount = 0;
      state.hands = {};
      state.faceUp = {};
      state.faceDown = {};
      state.readySetup = {};
      state.deck = [];
      state.discard = [];
      state.burnedCount = 0;
      state.resetActive = false;
      state.reverseCap = null;
      state.finishedOrder = [];
      state.winnerId = null;
      state.loserId = null;
      state.currentPlayerIndex = 0;
      state.log = [];
      return state;
    }

    default:
      throw new Error('Ismeretlen lépés: ' + action.type);
  }
}
