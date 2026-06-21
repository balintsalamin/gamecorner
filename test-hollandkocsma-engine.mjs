// ============================================================================
// Fejlesztői teszt – NEM kell a weboldal működéséhez.
// ============================================================================
// Önálló Node.js szkript, ami a Holland kocsma game-engine.js szabálykönyvét
// teszteli. Futtatás (Node.js szükséges, https://nodejs.org):
//   node test-hollandkocsma-engine.mjs
// ============================================================================

import {
  createDeck, shuffle, cardRank, cardSuit, rankPower, isValidPlay,
  createInitialState, applyMove, DEFAULT_SETTINGS, getActiveZone, nextActiveIndex,
} from './games/hollandkocsma/game-engine.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
}

// ----------------------------------------------------------------------
// Deck / kártya segédfüggvények
// ----------------------------------------------------------------------
{
  const deck = createDeck();
  assert(deck.length === 52, 'deck has 52 cards');
  assert(cardRank('10-hearts') === '10', 'cardRank parses 10');
  assert(cardSuit('10-hearts') === 'hearts', 'cardSuit parses hearts');
  assert(rankPower('2') === 2, '2 has power 2');
  assert(rankPower('A') === 14, 'A has power 14 (highest)');
  assert(rankPower('K') > rankPower('Q'), 'K beats Q');
  eq(DEFAULT_SETTINGS.tableCardCount, 4, 'default table card count is 4');
  eq(DEFAULT_SETTINGS.startingHandSize, 4, 'default starting hand size is 4');
}

// ----------------------------------------------------------------------
// startGame -> setup status, correct deal sizes
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'Anna' });
  state = applyMove(state, { type: 'join', playerId: 'b', name: 'Bence' });
  state = applyMove(state, { type: 'join', playerId: 'c', name: 'Cili' });
  state = applyMove(state, { type: 'startGame' });
  eq(state.status, 'setup', 'status setup after startGame');
  for (const p of state.players) {
    eq(state.hands[p.id].length, 4, `player ${p.id} has 4 hand cards (new default)`);
    eq(state.faceUp[p.id].length, 4, `player ${p.id} has 4 face-up cards (new default)`);
    eq(state.faceDown[p.id].length, 4, `player ${p.id} has 4 face-down cards (new default)`);
  }
  const total = state.deck.length + state.players.reduce(
    (s, p) => s + state.hands[p.id].length + state.faceUp[p.id].length + state.faceDown[p.id].length, 0
  );
  // 3 players * 12 cards dealt = 36; 1 deck (52) already leaves 16 in the draw
  // pile, which meets the minDrawPile floor, so a single deck is enough here.
  eq(total, 52, 'total cards = 52 (one deck is already enough for 3 players at 4/4/4)');
  eq(state.deck.length, 16, 'draw pile has a healthy cushion (the minDrawPile floor) even with few players');
  assert(state.deck.length >= 16, 'draw pile never starts below the minDrawPile floor');
}

// ----------------------------------------------------------------------
// The exact scenario reported by the user: 4 players, default settings
// (4 table cards down, 4 up, 4 in hand) -> draw pile must NOT be tiny.
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'A' });
  state = applyMove(state, { type: 'join', playerId: 'b', name: 'B' });
  state = applyMove(state, { type: 'join', playerId: 'c', name: 'C' });
  state = applyMove(state, { type: 'join', playerId: 'd', name: 'D' });
  state = applyMove(state, { type: 'startGame' });
  // 4 players * 12 cards dealt = 48; a single 52-card deck would leave only 4
  // (the user's exact complaint), so this must bump to a 2nd deck.
  eq(state.deck.length, 56, '4 players at default settings: draw pile is comfortably large, not 4 cards');
  assert(state.deck.length >= 16, '4-player draw pile meets the minDrawPile floor');
}

// ----------------------------------------------------------------------
// setReady: all-ready transitions to playing
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'A' });
  state = applyMove(state, { type: 'join', playerId: 'b', name: 'B' });
  state = applyMove(state, { type: 'startGame' });
  eq(state.status, 'setup', 'still setup with one not-ready');
  state = applyMove(state, { type: 'setReady', playerId: 'a', ready: true });
  eq(state.status, 'setup', 'still setup, b not ready yet');
  state = applyMove(state, { type: 'setReady', playerId: 'b', ready: true });
  eq(state.status, 'playing', 'playing once everyone ready');
}

// ----------------------------------------------------------------------
// swapSetupCard
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'A' });
  state = applyMove(state, { type: 'join', playerId: 'b', name: 'B' });
  state = applyMove(state, { type: 'startGame' });
  const before = { hand: [...state.hands.a], faceUp: [...state.faceUp.a] };
  state = applyMove(state, { type: 'swapSetupCard', playerId: 'a', handIndex: 0, faceUpIndex: 0 });
  eq(state.hands.a[0], before.faceUp[0], 'hand[0] now holds old faceUp[0]');
  eq(state.faceUp.a[0], before.hand[0], 'faceUp[0] now holds old hand[0]');

  // cannot swap after ready
  state = applyMove(state, { type: 'setReady', playerId: 'a', ready: true });
  let threw = false;
  try { applyMove(state, { type: 'swapSetupCard', playerId: 'a', handIndex: 0, faceUpIndex: 1 }); }
  catch (e) { threw = true; }
  assert(threw, 'cannot swap after marking ready');
}

// ----------------------------------------------------------------------
// Helper to build a controlled mid-game 'playing' state
// ----------------------------------------------------------------------
function baseState(overrides = {}) {
  const state = createInitialState(overrides.settings);
  state.players = overrides.players || [
    { id: 'a', name: 'A', connected: true, lossCount: 0 },
    { id: 'b', name: 'B', connected: true, lossCount: 0 },
  ];
  state.status = 'playing';
  state.deck = overrides.deck || [];
  state.discard = overrides.discard || [];
  state.hands = overrides.hands || { a: ['7-hearts'], b: ['8-clubs'] };
  state.faceUp = overrides.faceUp || { a: [], b: [] };
  state.faceDown = overrides.faceDown || { a: [], b: [] };
  state.currentPlayerIndex = overrides.currentPlayerIndex ?? 0;
  state.resetActive = overrides.resetActive ?? false;
  state.reverseCap = overrides.reverseCap ?? null;
  state.finishedOrder = overrides.finishedOrder || [];
  return state;
}

// ----------------------------------------------------------------------
// isValidPlay basics
// ----------------------------------------------------------------------
{
  const state = baseState({ discard: ['5-hearts'] });
  assert(isValidPlay('7', state, state.settings), '7 valid on 5 (higher)');
  assert(isValidPlay('5', state, state.settings), '5 valid on 5 (equal)');
  assert(!isValidPlay('3', state, state.settings), '3 invalid on 5 (lower)');
  assert(isValidPlay('2', state, state.settings), '2 always valid (reset, default on)');
  assert(isValidPlay('10', state, state.settings), '10 always valid (burn, default on)');
}

// ----------------------------------------------------------------------
// Normal play advances turn, refills hand
// ----------------------------------------------------------------------
{
  let state = baseState({
    deck: ['9-spades', '3-clubs'], // pop() takes from the end: 3-clubs drawn first
    discard: ['5-hearts'],
    hands: { a: ['7-hearts'], b: ['8-clubs'] },
  });
  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0] });
  eq(state.currentPlayerIndex, 1, 'normal play -> next player');
  eq(state.discard[state.discard.length - 1], '7-hearts', 'discard top updated');
  eq(state.hands.a, ['3-clubs', '9-spades'], 'hand refilled from deck (only 2 cards were available, so it falls short of the target 3)');
}

// ----------------------------------------------------------------------
// Not your turn -> error
// ----------------------------------------------------------------------
{
  let state = baseState({ discard: ['5-hearts'] });
  let threw = false;
  try { applyMove(state, { type: 'playCards', playerId: 'b', zone: 'hand', indices: [0] }); }
  catch (e) { threw = true; }
  assert(threw, 'playing out of turn throws');
}

// ----------------------------------------------------------------------
// Two = reset: next play can be anything
// ----------------------------------------------------------------------
{
  let state = baseState({
    discard: ['9-hearts'],
    hands: { a: ['2-clubs'], b: ['3-spades'] },
    faceDown: { a: ['9-diamonds'], b: [] }, // a still has a card left so playing the 2 doesn't finish them
  });
  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0] });
  eq(state.resetActive, true, 'resetActive true after playing a 2');
  assert(isValidPlay('3', state, state.settings), '3 is valid after reset even though top is 2 (power 2)');
  state = applyMove(state, { type: 'playCards', playerId: 'b', zone: 'hand', indices: [0] });
  eq(state.resetActive, false, 'resetActive cleared after next play');
}

// ----------------------------------------------------------------------
// Ten = burn: pile cleared, same player goes again
// ----------------------------------------------------------------------
{
  let state = baseState({
    deck: ['A-spades', 'K-spades', 'Q-spades'],
    discard: ['9-hearts', '9-clubs'],
    hands: { a: ['10-spades', '4-hearts'], b: ['3-spades'] },
  });
  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0] });
  eq(state.discard, [], 'discard cleared after burn');
  eq(state.burnedCount, 3, 'burnedCount tracks burned cards (2 prior + the 10 itself)');
  eq(state.currentPlayerIndex, 0, 'same player (a) goes again after burning');
}

// ----------------------------------------------------------------------
// Quad burn: 4th matching card auto-burns
// ----------------------------------------------------------------------
{
  let state = baseState({
    discard: ['6-hearts', '6-clubs', '6-spades'],
    hands: { a: ['6-diamonds'], b: ['3-spades'] },
    faceDown: { a: ['9-diamonds'], b: [] }, // a still has a card left so playing doesn't finish them
  });
  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0] });
  eq(state.discard, [], 'quad burn clears the pile');
  eq(state.currentPlayerIndex, 0, 'same player goes again after quad burn');
}

// ----------------------------------------------------------------------
// Five = reverse cap (optional rule, enable via settings)
// ----------------------------------------------------------------------
{
  let state = baseState({
    settings: { fiveReverse: true },
    discard: ['9-hearts'],
    hands: { a: ['5-clubs'], b: ['8-spades', '3-spades'] },
    faceDown: { a: ['9-diamonds'], b: [] }, // a still has a card left so playing the 5 doesn't finish them
  });
  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0] });
  eq(state.reverseCap, '5', 'reverseCap set to 5');
  assert(!isValidPlay('8', state, state.settings), '8 invalid under reverse cap (too high)');
  assert(isValidPlay('3', state, state.settings), '3 valid under reverse cap (<=5)');
  let threw = false;
  try { applyMove(state, { type: 'playCards', playerId: 'b', zone: 'hand', indices: [0] }); } // 8-spades
  catch (e) { threw = true; }
  assert(threw, 'playing 8 under reverse cap throws');
}

// ----------------------------------------------------------------------
// restrictPairPlay
// ----------------------------------------------------------------------
{
  let state = baseState({
    settings: { restrictPairPlay: true },
    discard: ['3-hearts'],
    hands: { a: ['6-clubs', '6-spades'], b: ['3-spades'] },
  });
  let threw = false;
  try { applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0, 1] }); }
  catch (e) { threw = true; }
  assert(threw, 'playing exactly 2 matching cards throws when restrictPairPlay is on');
}

// ----------------------------------------------------------------------
// Zone progression: hand -> faceUp -> faceDown
// ----------------------------------------------------------------------
{
  let state = baseState({
    deck: [],
    discard: ['3-hearts'],
    hands: { a: [], b: ['9-spades'] },
    faceUp: { a: ['5-clubs'], b: [] },
    faceDown: { a: ['Q-hearts'], b: [] },
  });
  eq(getActiveZone(state, 'a').zone, 'faceUp', 'active zone is faceUp when hand+deck empty');

  let threw = false;
  try { applyMove(state, { type: 'flipFaceDown', playerId: 'a', index: 0 }); }
  catch (e) { threw = true; }
  assert(threw, 'cannot flip face-down while face-up cards remain');

  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'faceUp', indices: [0] });
  eq(state.faceUp.a, [], 'faceUp emptied');
  eq(getActiveZone(state, 'a').zone, 'faceDown', 'active zone now faceDown');
}

// ----------------------------------------------------------------------
// flipFaceDown: success and failure paths
// ----------------------------------------------------------------------
{
  // success: revealed card is playable (3 players, so the round doesn't end
  // immediately when 'a' finishes - lets us verify the turn passes to 'b')
  let state = baseState({
    players: [
      { id: 'a', name: 'A', connected: true, lossCount: 0 },
      { id: 'b', name: 'B', connected: true, lossCount: 0 },
      { id: 'c', name: 'C', connected: true, lossCount: 0 },
    ],
    discard: ['3-hearts'],
    hands: { a: [], b: ['9-spades'], c: ['9-spades'] },
    faceUp: { a: [], b: [], c: [] },
    faceDown: { a: ['9-hearts'], b: [], c: [] },
  });
  state = applyMove(state, { type: 'flipFaceDown', playerId: 'a', index: 0 });
  eq(state.discard[state.discard.length - 1], '9-hearts', 'revealed playable card lands on discard');
  eq(state.status, 'playing', 'round continues (b and c still have cards)');
  eq(state.winnerId, 'a', 'a finished first via a face-down flip');
  eq(state.currentPlayerIndex, 1, 'turn passes to b (a finished and is skipped)');

  // failure: revealed card is not playable -> picks up pile + the card
  let state2 = baseState({
    discard: ['9-hearts', '9-clubs'],
    hands: { a: [], b: ['9-spades'] },
    faceUp: { a: [], b: [] },
    faceDown: { a: ['3-hearts'], b: [] },
  });
  state2 = applyMove(state2, { type: 'flipFaceDown', playerId: 'a', index: 0 });
  eq(state2.hands.a, ['3-hearts', '9-hearts', '9-clubs'], 'failed flip: card + whole pile go to hand');
  eq(state2.discard, [], 'discard cleared after failed flip pickup');
  eq(state2.currentPlayerIndex, 1, 'turn passes to b after failed flip');
  eq(state2.lastPickup.playerId, 'a', 'lastPickup records who picked up (UI red-flash hook)');
  eq(state2.lastPickup.count, 3, 'lastPickup records how many cards were picked up');
}

// ----------------------------------------------------------------------
// pickupPile: forced vs voluntary
// ----------------------------------------------------------------------
{
  // forced: no valid card -> must be allowed regardless of voluntaryPickup
  let state = baseState({
    settings: { voluntaryPickup: false },
    discard: ['9-hearts'],
    hands: { a: ['3-clubs'], b: ['5-spades'] },
  });
  state = applyMove(state, { type: 'pickupPile', playerId: 'a' });
  eq(state.hands.a, ['3-clubs', '9-hearts'], 'forced pickup merges pile into hand');
  eq(state.currentPlayerIndex, 1, 'turn passes after pickup');
  eq(state.lastPickup.playerId, 'a', 'lastPickup records who picked up (UI red-flash hook)');
  eq(state.lastPickup.count, 1, 'lastPickup records how many cards were picked up');
  assert(typeof state.lastPickup.ts === 'number', 'lastPickup has a timestamp');

  // voluntary blocked: has a valid card, voluntaryPickup off
  let state2 = baseState({
    settings: { voluntaryPickup: false },
    discard: ['3-hearts'],
    hands: { a: ['9-clubs'], b: ['5-spades'] },
  });
  let threw = false;
  try { applyMove(state2, { type: 'pickupPile', playerId: 'a' }); }
  catch (e) { threw = true; }
  assert(threw, 'voluntary pickup blocked when setting is off and a valid play exists');

  // voluntary allowed: has a valid card, voluntaryPickup on (default)
  let state3 = baseState({
    discard: ['3-hearts'],
    hands: { a: ['9-clubs'], b: ['5-spades'] },
  });
  state3 = applyMove(state3, { type: 'pickupPile', playerId: 'a' });
  eq(state3.hands.a, ['9-clubs', '3-hearts'], 'voluntary pickup allowed by default');
}

// ----------------------------------------------------------------------
// blindDraw: success and failure paths
// ----------------------------------------------------------------------
{
  let state = baseState({
    settings: { blindDrawAttempt: true },
    deck: ['4-clubs'], // pop() -> 4-clubs, not playable on 9
    discard: ['9-hearts'],
    hands: { a: ['3-clubs'], b: ['5-spades'] },
  });
  state = applyMove(state, { type: 'blindDraw', playerId: 'a' });
  eq(state.hands.a, ['3-clubs', '4-clubs', '9-hearts'], 'failed blind draw: drawn card + pile go to hand');
  eq(state.currentPlayerIndex, 1, 'turn passes after failed blind draw');
  eq(state.lastPickup.playerId, 'a', 'lastPickup records who picked up (UI red-flash hook)');
  eq(state.lastPickup.count, 2, 'lastPickup counts the drawn card + the pile');

  let state2 = baseState({
    settings: { blindDrawAttempt: true },
    deck: ['J-clubs'], // playable (>= 9)
    discard: ['9-hearts'],
    hands: { a: ['3-clubs'], b: ['5-spades'] },
  });
  state2 = applyMove(state2, { type: 'blindDraw', playerId: 'a' });
  eq(state2.discard[state2.discard.length - 1], 'J-clubs', 'successful blind draw lands on discard');
  eq(state2.hands.a, ['3-clubs'], 'hand unchanged (drawn card never entered hand) on success');
}

// ----------------------------------------------------------------------
// Win / loss: finishing order + loser tracking
// ----------------------------------------------------------------------
{
  let state = baseState({
    players: [
      { id: 'a', name: 'A', connected: true, lossCount: 0 },
      { id: 'b', name: 'B', connected: true, lossCount: 0 },
      { id: 'c', name: 'C', connected: true, lossCount: 0 },
    ],
    discard: ['3-hearts'],
    hands: { a: ['6-clubs'], b: ['J-spades'], c: ['7-hearts'] },
    faceUp: { a: [], b: [], c: [] },
    faceDown: { a: [], b: [], c: [] },
    currentPlayerIndex: 0,
  });
  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0] });
  eq(state.status, 'playing', 'round continues, 2 players still in');
  eq(state.winnerId, 'a', 'a is recorded as first finisher (winner)');
  eq(state.currentPlayerIndex, 1, 'turn passes to b (a skipped, finished)');

  state = applyMove(state, { type: 'playCards', playerId: 'b', zone: 'hand', indices: [0] });
  eq(state.status, 'roundEnd', 'round ends once only 1 player remains');
  eq(state.loserId, 'c', 'c is the loser (only one left with cards)');
  eq(state.players.find((p) => p.id === 'c').lossCount, 1, 'loser lossCount incremented');
}

// ----------------------------------------------------------------------
// nextRound / returnToLobby
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'A' });
  state = applyMove(state, { type: 'join', playerId: 'b', name: 'B' });
  state = applyMove(state, { type: 'startGame' });
  state = applyMove(state, { type: 'setReady', playerId: 'a', ready: true });
  state = applyMove(state, { type: 'setReady', playerId: 'b', ready: true });
  eq(state.status, 'playing', 'sanity: playing');

  // Force a round end manually via direct hand manipulation + a play
  state.hands.a = ['9-clubs'];
  state.faceUp.a = []; state.faceDown.a = [];
  state.deck = []; // so refillHand can't top the hand back up after the play
  state.discard = ['3-hearts'];
  state.currentPlayerIndex = state.players.findIndex((p) => p.id === 'a');
  state = applyMove(state, { type: 'playCards', playerId: 'a', zone: 'hand', indices: [0] });
  eq(state.status, 'roundEnd', 'round ended');

  const prevDealer = state.dealerIndex;
  state = applyMove(state, { type: 'nextRound' });
  eq(state.status, 'setup', 'nextRound deals a fresh setup phase');
  eq(state.dealerIndex, (prevDealer + 1) % 2, 'dealerIndex advanced');
  eq(state.roundNumber, 2, 'roundNumber incremented');

  state = applyMove(state, { type: 'returnToLobby' });
  eq(state.status, 'lobby', 'returnToLobby resets to lobby');
  eq(state.hands, {}, 'hands cleared');
  eq(state.players.every((p) => p.lossCount === 0), true, 'lossCount reset');
}

// ----------------------------------------------------------------------
// forceSkip
// ----------------------------------------------------------------------
{
  let state = baseState({ discard: ['5-hearts'] });
  state = applyMove(state, { type: 'forceSkip' });
  eq(state.currentPlayerIndex, 1, 'forceSkip advances turn');
}

// ----------------------------------------------------------------------
// join / leave
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'Anna' });
  state = applyMove(state, { type: 'join', playerId: 'b', name: 'Bence' });
  eq(state.players.length, 2, 'two players joined');
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'Anna2' });
  eq(state.players.length, 2, 'rejoin does not duplicate');
  eq(state.players[0].name, 'Anna2', 'rejoin updates name');
  state = applyMove(state, { type: 'leave', playerId: 'b' });
  eq(state.players.length, 1, 'leave removes player in lobby');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
