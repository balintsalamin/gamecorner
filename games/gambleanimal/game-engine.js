// ============================================================================
// GambleAnimal – tiszta játéklogika
// ============================================================================
// Ez a fájl NEM tartalmaz DOM-ot, localStorage-ot vagy bármilyen UI kódot –
// csak sima függvényeket és állapot-objektumokat. A main.js hívja meg ezeket,
// és ő felel a renderelésért + mentésért. Így a game-engine.js Node.js-ből is
// tesztelhető (lásd: ../../test-gambleanimal-engine.mjs), a böngészőtől
// függetlenül – ugyanaz a minta, mint a többi játéknál (uno, hollandkocsma).
//
// Gazdaság dióhéjban:
// - "treats" (jutalomfalat): elkölthető egyenleg, mindkét szerencsejátékban
//   ezt lehet feltenni tétnek.
// - Minden játéknak (plinko, blackjack) van egy saját, ÉLETÚTI "treatsWon"
//   számlálója: ide csak a NETTÓ NYERESÉG kerül hozzáadásra (payout - tét,
//   ha pozitív). Veszteség sosem csökkenti – ezért nem lehet "elveszíteni"
//   egy már megszerzett témaállatot.
// - Minden 100 összegyűjtött treatsWon = 1 témaállat (lásd animalCount).
// - A megszerzett állatok 10 percenként termelnek 1-1 jutalomfalatot
//   passzívan (lásd applyPassiveIncome) – ez akkor is jóváíródik, ha a
//   játékos közben be sem nyitotta az appot (lastTick alapján számolva).
// ============================================================================

// ─── Játék-katalógus (témaállat, megjelenés) ───────────────────────────────
export const GAMES = {
  plinko: { id: 'plinko', name: 'Pig-Plinko', animalEmoji: '🐷', tag: 'Plinko' },
  blackjack: { id: 'blackjack', name: 'Bird-Blackjack', animalEmoji: '🐦', tag: 'Blackjack' },
};
export const GAME_IDS = Object.keys(GAMES);

export const TREATS_PER_ANIMAL = 100;
export const ANIMAL_PRODUCTION_INTERVAL_MS = 10 * 60 * 1000; // 10 perc / jutalomfalat / állat
export const MAX_VISIBLE_ANIMALS = 100;
export const STARTING_TREATS = 100;

// ─── Alap állapot ───────────────────────────────────────────────────────────
export function createInitialState(now = Date.now()) {
  return {
    treats: STARTING_TREATS,
    lastTick: now,
    games: {
      plinko: { treatsWon: 0 },
      blackjack: { treatsWon: 0 },
    },
    dev: {
      plinko: { winProb: 0.45 },
      blackjack: { winProb: 0.45 },
    },
  };
}

// Régebbi mentések kiegészítése hiányzó mezőkkel (ha bővül az állapot formája).
export function migrateState(state) {
  const base = createInitialState(state?.lastTick ?? Date.now());
  if (!state || typeof state !== 'object') return base;
  return {
    ...base,
    ...state,
    games: { ...base.games, ...(state.games || {}) },
    dev: {
      plinko: { ...base.dev.plinko, ...(state.dev?.plinko || {}) },
      blackjack: { ...base.dev.blackjack, ...(state.dev?.blackjack || {}) },
    },
  };
}

// ─── Állatok / treats könyvelés ─────────────────────────────────────────────
export function animalCount(state, gameId) {
  const won = state.games[gameId]?.treatsWon || 0;
  return Math.floor(won / TREATS_PER_ANIMAL);
}

export function totalAnimalCount(state) {
  return GAME_IDS.reduce((sum, id) => sum + animalCount(state, id), 0);
}

export function treatsToNextAnimal(state, gameId) {
  const won = state.games[gameId]?.treatsWon || 0;
  const remainder = won % TREATS_PER_ANIMAL;
  return TREATS_PER_ANIMAL - remainder;
}

// Egy tét lezárása: payout - stake a nettó eredmény. Csak pozitív nyereség
// növeli a treatsWon számlálót (=> csak ekkor járhat új állat).
export function applyBetResult(state, gameId, stake, payout) {
  const profit = payout - stake;
  const next = structuredClone(state);
  next.treats += profit;
  if (profit > 0) {
    next.games[gameId].treatsWon += profit;
  }
  return { state: next, profit };
}

// Gyorsgomb tét-összeg számítása (1% / 10% / 50% / 100%).
export function quickBetAmount(balance, pct) {
  if (balance <= 0) return 0;
  return Math.min(balance, Math.max(1, Math.round(balance * pct)));
}

// Passzív termelés jóváírása – minden meglévő állat 10 percenként 1
// jutalomfalatot termel. "Behozza" a háttérben (bezárt app mellett) eltelt
// időt is, a lastTick-et pontosan a felhasznált ütemek számával tolja el
// (nem csak "now"-ra ugorva), hogy ne vesszen el a következő ütemig
// felgyülemlett töredékidő.
export function applyPassiveIncome(state, now = Date.now()) {
  const elapsed = now - state.lastTick;
  if (elapsed < ANIMAL_PRODUCTION_INTERVAL_MS) return { state, earned: 0 };
  const ticks = Math.floor(elapsed / ANIMAL_PRODUCTION_INTERVAL_MS);
  const animals = totalAnimalCount(state);
  const earned = ticks * animals;
  const next = structuredClone(state);
  next.treats += earned;
  next.lastTick = state.lastTick + ticks * ANIMAL_PRODUCTION_INTERVAL_MS;
  return { state: next, earned };
}

export function msUntilNextTick(state, now = Date.now()) {
  const elapsed = now - state.lastTick;
  const remainder = elapsed % ANIMAL_PRODUCTION_INTERVAL_MS;
  return ANIMAL_PRODUCTION_INTERVAL_MS - remainder;
}

// Etetés: 1 treat-be kerül, semmilyen mechanikai hatása nincs (csak kedves
// kis animáció jár hozzá a UI oldalon) – szándékosan nem csinál többet, mint
// amit kértél.
export function feedAnimal(state, cost = 1) {
  if (state.treats < cost) return { state, ok: false };
  const next = structuredClone(state);
  next.treats -= cost;
  return { state: next, ok: true };
}

// ============================================================================
// PIG-PLINKO
// ============================================================================
export const PLINKO_ROWS = 8;
// 9 rekesz (rows + 1), szimmetrikus kifizetési táblázat. A középső rekeszek
// körül van a "nem nyerő" sáv (push vagy kisebb veszteség), a szélek ritka,
// nagy szorzók.
export const PLINKO_MULTIPLIERS = [15, 4, 1.6, 1, 0.5, 1, 1.6, 4, 15];
const PLINKO_WIN_SLOTS = [0, 1, 2, 6, 7, 8]; // szorzó > 1
const PLINKO_NONWIN_SLOTS = [3, 4, 5]; // szorzó <= 1 (push vagy veszteség)
// Binomiális együtthatók C(8,k) – egy "tisztességes" Galton-deszka természetes
// eloszlása. Ezt használjuk súlyként MINDKÉT vödrön belül, hogy a kimenetel a
// kontrollált nyerési esély MELLETT is fizikailag hihető maradjon (pl. a
// szélső 15x ritkább, mint a belső 4x, még a "nyerő" vödrön belül is).
const PLINKO_ROW_WEIGHTS = [1, 8, 28, 56, 70, 56, 28, 8, 1];

export function plinkoIsWinSlot(slot) {
  return PLINKO_MULTIPLIERS[slot] > 1;
}

// Eldönti, melyik rekeszben landol a golyó, a dev-panelben beállított
// nyerési eséllyel súlyozva.
export function plinkoOutcome(winProb, rng = Math.random) {
  const pool = rng() < winProb ? PLINKO_WIN_SLOTS : PLINKO_NONWIN_SLOTS;
  const totalWeight = pool.reduce((s, i) => s + PLINKO_ROW_WEIGHTS[i], 0);
  let r = rng() * totalWeight;
  for (const i of pool) {
    r -= PLINKO_ROW_WEIGHTS[i];
    if (r <= 0) return i;
  }
  return pool[pool.length - 1];
}

// Egy véletlenszerű bal/jobb utat generál, ami PONTOSAN a megadott rekeszben
// végződik (a "jobbra" lépések száma = targetSlot). Csak az animációhoz kell.
export function plinkoPath(targetSlot, rows = PLINKO_ROWS, rng = Math.random) {
  const moves = Array.from({ length: rows }, (_, i) => (i < targetSlot ? 'R' : 'L'));
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  return moves;
}

export function playPlinko(state, stake, rng = Math.random) {
  if (!Number.isInteger(stake) || stake <= 0) throw new Error('Érvénytelen tét.');
  if (stake > state.treats) throw new Error('Nincs ennyi jutalomfalatod.');
  const winProb = state.dev?.plinko?.winProb ?? 0.45;
  const slot = plinkoOutcome(winProb, rng);
  const path = plinkoPath(slot, PLINKO_ROWS, rng);
  const multiplier = PLINKO_MULTIPLIERS[slot];
  const payout = Math.round(stake * multiplier);
  const { state: next, profit } = applyBetResult(state, 'plinko', stake, payout);
  return { state: next, slot, path, multiplier, payout, profit };
}

// ============================================================================
// BIRD-BLACKJACK
// ============================================================================
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
// Egyszerűsítés (szándékos, "nagyon egyszerű" játékot kértél): nincs osztás
// (split), dupla tét (double) vagy biztosítás (insurance) – csak Húzás/Állok.
// A döntetlen-szabály is egyszerűsített: bármilyen 21=21 döntetlen, nem
// különböztetjük meg a 2-lapos "natural" blackjacket egy 3+ lapos 21-től a
// PÁROS oldalon (csak a SAJÁT 21-ed kap 3:2 bónuszt, ha a tiéd natural).

export function createDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function rankOf(card) { return card.slice(0, -1); }

function cardValue(card) {
  const r = rankOf(card);
  if (r === 'A') return 11;
  if (r === 'J' || r === 'Q' || r === 'K') return 10;
  return parseInt(r, 10);
}

export function handTotal(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c), 0);
  let aces = cards.filter(c => rankOf(c) === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export function isBust(cards) { return handTotal(cards) > 21; }
export function isBlackjack(cards) { return cards.length === 2 && handTotal(cards) === 21; }

// Osztó-szabály: 17 alatt mindig húz, 17-en (puha 17-en is) mindig áll.
function dealerShouldHit(cards) { return handTotal(cards) < 17; }

export function classifyOutcome(playerTotal, dealerCards) {
  const dealerTotal = handTotal(dealerCards);
  if (dealerTotal > 21) return 'win';
  if (dealerTotal < playerTotal) return 'win';
  if (dealerTotal > playerTotal) return 'lose';
  return 'push';
}

export function dealRound(rng = Math.random) {
  const deck = shuffle(createDeck(), rng);
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  return { deck, player, dealer };
}

export function playerHit(deck, playerCards) {
  const card = deck[deck.length - 1];
  return { deck: deck.slice(0, -1), player: [...playerCards, card] };
}

// A dev-panelben beállított nyerési eséllyel eldönti a kör CÉLZOTT
// kimenetelét. A push-arány fix belső konstans (nem kérted külön
// állíthatónak, ezért nem is teszem azzá) – csak azt szabályozza, hogy a
// "nem nyerés" hányad mekkora része legyen döntetlen a sima vereség helyett.
const BLACKJACK_PUSH_SHARE = 0.12;

export function decideTarget(winProb, rng = Math.random) {
  const r = rng();
  if (r < winProb) return 'win';
  if (r < winProb + (1 - winProb) * BLACKJACK_PUSH_SHARE) return 'push';
  return 'lose';
}

// Lejátssza az osztó körét úgy, hogy (ha lehetséges) a targetOutcome jöjjön
// ki. Az osztó FELFEDETT lapja (dealerCards[0]) rögzített marad – ezt a
// játékos már a köre eleje óta látja. A REJTETT lap (dealerCards[1]) viszont
// sosem volt látható, ezért azt a húzópakli maradékával együtt egy közös
// "nem látott" körbe tesszük, és onnan húzunk újra mindig egy friss rejtett
// lapot: így minden próbálkozásnál biztosan van mit változtatni (ha a
// rögzített 2 lap önmagában már 17+ lenne, attól még az új rejtett lap más
// lehet). Sok lehetséges (egyformán valószínű) keverés közül azt választjuk,
// amelyik a kívánt kimenetelhez vezet a standard "17 alatt húz" szabállyal.
// A játékos saját Húzásai sosem ebből a függvényből jönnek, azok mindig
// teljesen véletlenek (lásd playerHit) – csak az osztó rejtett + utólagos
// lapjai "válogatottak". targetOutcome=null esetén tisztán véletlen (nincs
// irányítás), csak egyszer lejátssza a meglévő lapokkal.
export function playDealer(deck, dealerCards, playerTotal, targetOutcome, rng = Math.random, maxAttempts = 250) {
  const upCard = dealerCards[0];
  const unseenPool = [...deck, ...dealerCards.slice(1)];

  const playOut = (pool) => {
    let cards = [upCard];
    let rest = pool.slice();
    cards.push(rest.pop()); // új rejtett lap
    while (dealerShouldHit(cards)) cards.push(rest.pop());
    return { dealerCards: cards, deck: rest };
  };

  if (!targetOutcome) return playOut(unseenPool);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = playOut(shuffle(unseenPool, rng));
    if (classifyOutcome(playerTotal, result.dealerCards) === targetOutcome) return result;
  }
  // Ritka eset (pl. a célzott kimenetel a szabályok miatt elérhetetlen –
  // lásd a fenti megjegyzést a 21=21 döntetlenről): az utolsó próbálkozást
  // fogadjuk el, ne ragadjon be a játék.
  return playOut(shuffle(unseenPool, rng));
}

export function resolvePayout(stake, playerCards, dealerCards) {
  if (isBust(playerCards)) return 0;
  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);
  if (playerBJ && dealerBJ) return stake;
  if (playerBJ) return Math.round(stake * 2.5);
  if (isBust(dealerCards)) return stake * 2;
  const playerTotal = handTotal(playerCards);
  const dealerTotal = handTotal(dealerCards);
  if (playerTotal > dealerTotal) return stake * 2;
  if (playerTotal === dealerTotal) return stake;
  return 0;
}

function outcomeLabel(stake, payout) {
  if (payout > stake) return 'win';
  if (payout === stake) return 'push';
  return 'lose';
}

// Új kör indítása: leoszt, és ha a játékosnak rögtön natural blackjackje van,
// azonnal lezárja a kört (ez a ritka ág NEM megy át a dev-irányításon – lásd
// fájl tetején a megjegyzést).
export function startBlackjack(state, stake, rng = Math.random) {
  if (!Number.isInteger(stake) || stake <= 0) throw new Error('Érvénytelen tét.');
  if (stake > state.treats) throw new Error('Nincs ennyi jutalomfalatod.');
  const { deck, player, dealer } = dealRound(rng);
  const hand = { deck, player, dealer, stake, resolved: false };

  if (isBlackjack(player)) {
    const payout = resolvePayout(stake, player, dealer);
    const { state: next, profit } = applyBetResult(state, 'blackjack', stake, payout);
    return { state: next, hand: { ...hand, resolved: true }, payout, profit, outcome: outcomeLabel(stake, payout) };
  }
  return { state, hand, payout: null, profit: null, outcome: null };
}

export function hitBlackjack(hand) {
  if (hand.resolved) throw new Error('A kör már lezárult.');
  const { deck, player } = playerHit(hand.deck, hand.player);
  const nextHand = { ...hand, deck, player };
  nextHand.resolved = isBust(player);
  return nextHand;
}

// A játékos túllépte a 21-et – a hívó (main.js) ezt hívja a hitBlackjack()
// után, ha annak resolved=true lett egy bukás miatt.
export function resolveBust(state, hand) {
  const payout = 0;
  const { state: next, profit } = applyBetResult(state, 'blackjack', hand.stake, payout);
  return { state: next, hand, payout, profit, outcome: 'lose' };
}

export function standBlackjack(state, hand, rng = Math.random) {
  if (hand.resolved) throw new Error('A kör már lezárult.');
  const winProb = state.dev?.blackjack?.winProb ?? 0.45;
  const playerTotal = handTotal(hand.player);
  const target = decideTarget(winProb, rng);
  const { dealerCards, deck } = playDealer(hand.deck, hand.dealer, playerTotal, target, rng);
  const finalHand = { ...hand, dealer: dealerCards, deck, resolved: true };
  const payout = resolvePayout(hand.stake, hand.player, dealerCards);
  const { state: next, profit } = applyBetResult(state, 'blackjack', hand.stake, payout);
  return { state: next, hand: finalHand, payout, profit, outcome: outcomeLabel(hand.stake, payout) };
}
