// ============================================================================
// Fejlesztői teszt – NEM kell a weboldal működéséhez.
// ============================================================================
// Ez egy önálló Node.js szkript, ami a game-engine.js szabálykönyvét
// teszteli (lapok lerakása, húzás, halmozás, +4 kihívás, 7/0 szabály, stb.)
// Hasznos, ha módosítod a szabálykönyvet, és gyorsan ellenőrizni akarod,
// hogy nem törtél el semmit.
//
// Futtatás (Node.js szükséges, https://nodejs.org):
//   node test-engine.mjs
// ============================================================================

import {
  createDeck, shuffle, cardColor, cardValue, isValidPlay, nextIndex,
  createInitialState, applyMove, DEFAULT_SETTINGS, SETTINGS_META, COLORS,
} from './games/uno/game-engine.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
}

// ----------------------------------------------------------------------
// Deck
// ----------------------------------------------------------------------
{
  const deck = createDeck();
  assert(deck.length === 108, 'deck has 108 cards');
  const wild4 = deck.filter(c => c === 'wild-draw4').length;
  const wild = deck.filter(c => c === 'wild-wild').length;
  assert(wild4 === 4 && wild === 4, 'has 4 wild and 4 wild-draw4');
  assert(cardColor('red-5') === 'red', 'cardColor red-5');
  assert(cardValue('red-5') === '5', 'cardValue red-5');
  assert(cardValue('wild-draw4') === 'draw4', 'cardValue wild-draw4');
  assert(cardValue('blue-skip') === 'skip', 'cardValue blue-skip');
}

// ----------------------------------------------------------------------
// Start round (random) sanity
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state.players.push({ id: 'a', name: 'A', score: 0, connected: true });
  state.players.push({ id: 'b', name: 'B', score: 0, connected: true });
  state.players.push({ id: 'c', name: 'C', score: 0, connected: true });
  state = applyMove(state, { type: 'startGame' });
  assert(state.status === 'playing', 'status playing after startGame');
  for (const p of state.players) {
    assert(state.hands[p.id].length === 7, `player ${p.id} has 7 cards`);
  }
  const total = state.deck.length + state.discard.length + state.players.reduce((s, p) => s + state.hands[p.id].length, 0);
  assert(total === 108, `total cards = 108 (got ${total})`);
  assert(cardValue(state.discard[0]) !== 'draw4', 'first discard is not wild draw4');
  assert(COLORS.includes(state.currentColor), 'currentColor is a real color');
}

// ----------------------------------------------------------------------
// Helper to build a controlled mid-game state
// ----------------------------------------------------------------------
function baseState(overrides = {}) {
  const state = createInitialState(overrides.settings);
  state.players = overrides.players || [
    { id: 'a', name: 'A', score: 0, connected: true },
    { id: 'b', name: 'B', score: 0, connected: true },
  ];
  state.status = 'playing';
  state.deck = overrides.deck || ['red-1', 'blue-2', 'green-3', 'yellow-4', 'red-9'];
  state.discard = overrides.discard || ['red-5'];
  state.hands = overrides.hands || {
    a: ['red-7', 'blue-7', 'green-2'],
    b: ['blue-3', 'yellow-1', 'wild-wild'],
  };
  state.currentColor = overrides.currentColor || 'red';
  state.currentPlayerIndex = overrides.currentPlayerIndex ?? 0;
  state.direction = overrides.direction ?? 1;
  state.drawStack = overrides.drawStack ?? 0;
  state.lastWild4 = overrides.lastWild4 ?? null;
  state.pendingForcedCard = overrides.pendingForcedCard ?? null;
  state.unoCalls = overrides.unoCalls || {};
  return state;
}

// ----------------------------------------------------------------------
// isValidPlay
// ----------------------------------------------------------------------
{
  const state = baseState();
  assert(isValidPlay('red-7', state, state.settings), 'red-7 valid on red-5 (color match)');
  assert(!isValidPlay('blue-3', state, state.settings), 'blue-3 invalid on red-5');
  assert(isValidPlay('wild-wild', state, state.settings), 'wild always valid');
}

// ----------------------------------------------------------------------
// Normal play advances turn by 1
// ----------------------------------------------------------------------
{
  let state = baseState();
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-7' });
  eq(state.currentPlayerIndex, 1, 'normal play -> next player');
  eq(state.discard[state.discard.length - 1], 'red-7', 'discard top updated');
  eq(state.currentColor, 'red', 'color stays red');
  eq(state.hands.a, ['blue-7', 'green-2'], 'card removed from hand');
}

// ----------------------------------------------------------------------
// Not your turn -> error
// ----------------------------------------------------------------------
{
  let state = baseState();
  let threw = false;
  try { applyMove(state, { type: 'play', playerId: 'b', card: 'blue-3' }); }
  catch (e) { threw = true; }
  assert(threw, 'playing out of turn throws');
}

// ----------------------------------------------------------------------
// Skip card -> skip next player (advance 2)
// ----------------------------------------------------------------------
{
  let state = baseState({
    players: [
      { id: 'a', name: 'A', score: 0, connected: true },
      { id: 'b', name: 'B', score: 0, connected: true },
      { id: 'c', name: 'C', score: 0, connected: true },
    ],
    hands: { a: ['red-skip', 'red-1'], b: ['blue-1'], c: ['green-1'] },
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-skip' });
  eq(state.currentPlayerIndex, 2, 'skip -> player c is current (b skipped)');
}

// ----------------------------------------------------------------------
// Reverse with 2 players -> acts as skip (same player again)
// ----------------------------------------------------------------------
{
  let state = baseState({ hands: { a: ['red-reverse', 'red-1'], b: ['blue-1'] } });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-reverse' });
  eq(state.currentPlayerIndex, 0, 'reverse (2p) -> same player goes again');
}

// ----------------------------------------------------------------------
// Reverse with 3 players -> direction flips
// ----------------------------------------------------------------------
{
  let state = baseState({
    players: [
      { id: 'a', name: 'A', score: 0, connected: true },
      { id: 'b', name: 'B', score: 0, connected: true },
      { id: 'c', name: 'C', score: 0, connected: true },
    ],
    hands: { a: ['red-reverse', 'red-1'], b: ['blue-1'], c: ['green-1'] },
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-reverse' });
  eq(state.direction, -1, 'direction flips with 3 players');
  eq(state.currentPlayerIndex, 2, 'reverse (3p) -> player c goes next (to the left)');
}

// ----------------------------------------------------------------------
// Draw2 stacking + cross-stack
// ----------------------------------------------------------------------
{
  let state = baseState({
    settings: { stackDrawTwo: true, stackDrawFour: true, crossStack: true },
    hands: { a: ['red-draw2', 'red-1'], b: ['wild-draw4', 'blue-9'] },
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-draw2' });
  eq(state.drawStack, 2, 'drawStack = 2 after first draw2');
  eq(state.currentPlayerIndex, 1, 'turn passes to b');
  // b stacks a wild-draw4 on top (cross-stack)
  state = applyMove(state, { type: 'play', playerId: 'b', card: 'wild-draw4', chosenColor: 'blue' });
  eq(state.drawStack, 6, 'drawStack = 6 after stacked wild draw4');
  eq(state.currentColor, 'blue', 'color changed via wild4');
  eq(state.currentPlayerIndex, 0, 'turn back to a, facing the stack');

  // a draws the stack (forced)
  const before = state.hands.a.length;
  state = applyMove(state, { type: 'draw', playerId: 'a' });
  eq(state.drawStack, 0, 'drawStack cleared after forced draw');
  eq(state.hands.a.length, before + 6, 'a drew 6 cards');
  eq(state.currentPlayerIndex, 1, 'turn skips a, goes to b');
}

// ----------------------------------------------------------------------
// Wild card without chosenColor -> error
// ----------------------------------------------------------------------
{
  let state = baseState({ hands: { a: ['wild-wild', 'red-1'], b: ['blue-1'] } });
  let threw = false;
  try { applyMove(state, { type: 'play', playerId: 'a', card: 'wild-wild' }); }
  catch (e) { threw = true; }
  assert(threw, 'wild without chosenColor throws');

  state = applyMove(state, { type: 'play', playerId: 'a', card: 'wild-wild', chosenColor: 'green' });
  eq(state.currentColor, 'green', 'wild sets chosen color');
}

// ----------------------------------------------------------------------
// Wild draw4 challenge - success and failure
// ----------------------------------------------------------------------
{
  // Failure case: accused (a) genuinely had no red card
  let state = baseState({
    settings: { drawFourChallenge: true },
    hands: { a: ['wild-draw4', 'blue-3'], b: ['green-1'] },
    currentColor: 'red',
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'wild-draw4', chosenColor: 'green' });
  eq(state.drawStack, 4, 'drawStack = 4 after wild draw4');
  assert(state.lastWild4 && state.lastWild4.playerId === 'a' && state.lastWild4.priorColor === 'red', 'lastWild4 recorded with prior color red');

  const bBefore = state.hands.b.length;
  state = applyMove(state, { type: 'challenge', playerId: 'b' });
  // a had no red card -> challenge fails -> b draws 4+2=6
  eq(state.hands.b.length, bBefore + 6, 'failed challenge: b draws stack+2 = 6');
  eq(state.drawStack, 0, 'drawStack cleared after challenge');
  eq(state.currentPlayerIndex, 0, 'turn passes back to a after failed challenge');
}
{
  // Success case: accused (a) DID have a red card when playing wild4
  let state = baseState({
    settings: { drawFourChallenge: true },
    hands: { a: ['wild-draw4', 'red-3'], b: ['green-1'] },
    currentColor: 'red',
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'wild-draw4', chosenColor: 'green' });
  const aBefore = state.hands.a.length;
  state = applyMove(state, { type: 'challenge', playerId: 'b' });
  eq(state.hands.a.length, aBefore + 4, 'successful challenge: a draws the stack (4)');
  eq(state.drawStack, 0, 'drawStack cleared');
  eq(state.currentPlayerIndex, 1, 'turn stays with b (challenger)');
}

// ----------------------------------------------------------------------
// mustPlayDrawn + drawUntilPlayable
// ----------------------------------------------------------------------
{
  let state = baseState({
    settings: { mustPlayDrawn: true },
    deck: ['red-9'], // top of deck (popped first) -> drawn card will be red-9, playable on red-5
    hands: { a: ['blue-2'], b: ['green-1'] },
    discard: ['red-5'],
  });
  state = applyMove(state, { type: 'draw', playerId: 'a' });
  eq(state.pendingForcedCard, 'red-9', 'drawn playable card becomes pendingForcedCard');
  eq(state.currentPlayerIndex, 0, 'turn does not pass while forced card pending');

  // trying to play a different card should fail
  let threw = false;
  try { applyMove(state, { type: 'play', playerId: 'a', card: 'blue-2' }); }
  catch (e) { threw = true; }
  assert(threw, 'cannot play a different card while pendingForcedCard is set');

  // playing the forced card works
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-9' });
  eq(state.pendingForcedCard, null, 'pendingForcedCard cleared after playing it');
  eq(state.currentPlayerIndex, 1, 'turn passes after forced card played');
}

{
  // drawUntilPlayable: deck has unplayable cards first, then a playable one
  let state = baseState({
    settings: { drawUntilPlayable: true },
    deck: ['green-9', 'blue-8', 'red-2'], // popped from end: red-2 first (playable), so should stop immediately
    hands: { a: ['blue-2'], b: ['green-1'] },
    discard: ['red-5'],
  });
  const before = state.hands.a.length;
  state = applyMove(state, { type: 'draw', playerId: 'a' });
  eq(state.hands.a.length, before + 1, 'drew exactly 1 card (it was immediately playable - red-2)');
  eq(state.currentPlayerIndex, 1, 'turn passes (mustPlayDrawn off)');
}

{
  // drawUntilPlayable where the first draws are not playable
  let state = baseState({
    settings: { drawUntilPlayable: true },
    // pop() takes from the end: order popped = green-9, blue-8, red-2
    deck: ['red-2', 'blue-8', 'green-9'],
    hands: { a: ['blue-2'], b: ['green-1'] },
    discard: ['red-5'],
  });
  const before = state.hands.a.length;
  state = applyMove(state, { type: 'draw', playerId: 'a' });
  eq(state.hands.a.length, before + 3, 'drew 3 cards until a playable one (red-2) appeared');
  eq(state.currentPlayerIndex, 1, 'turn passes after draw-until-playable resolves');
}

// ----------------------------------------------------------------------
// Jump-in
// ----------------------------------------------------------------------
{
  let state = baseState({
    settings: { jumpIn: true },
    players: [
      { id: 'a', name: 'A', score: 0, connected: true },
      { id: 'b', name: 'B', score: 0, connected: true },
      { id: 'c', name: 'C', score: 0, connected: true },
    ],
    hands: { a: ['blue-2'], b: ['green-1'], c: ['red-5', 'red-1'] }, // c has the exact same card as discard top
    discard: ['red-5'],
    currentPlayerIndex: 0,
  });
  let threw = false;
  try { applyMove(state, { type: 'play', playerId: 'b', card: 'green-1' }); }
  catch (e) { threw = true; }
  assert(threw, 'non-matching jump-in out of turn fails');

  state = applyMove(state, { type: 'play', playerId: 'c', card: 'red-5' });
  eq(state.discard[state.discard.length - 1], 'red-5', 'jump-in card played');
  eq(state.currentPlayerIndex, 0, 'after jump-in by c (index 2), next player is a (index 0)');
}

// ----------------------------------------------------------------------
// Seven-zero rule
// ----------------------------------------------------------------------
{
  // 7: swap hands
  let state = baseState({
    settings: { sevenZero: true },
    hands: { a: ['red-7', 'red-1'], b: ['blue-9', 'blue-8', 'blue-7'] },
    discard: ['red-5'],
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-7', sevenTarget: 'b' });
  eq(state.hands.a, ['blue-9', 'blue-8', 'blue-7'], 'a got b\'s old hand');
  eq(state.hands.b, ['red-1'], 'b got a\'s remaining hand');
}
{
  // 0: rotate all hands
  let state = baseState({
    settings: { sevenZero: true },
    players: [
      { id: 'a', name: 'A', score: 0, connected: true },
      { id: 'b', name: 'B', score: 0, connected: true },
      { id: 'c', name: 'C', score: 0, connected: true },
    ],
    hands: { a: ['red-0', 'x-a'], b: ['x-b'], c: ['x-c'] },
    discard: ['red-5'],
    direction: 1,
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-0' });
  // direction = 1: player i gets hand from player (i-1)
  eq(state.hands.a, ['x-c'], 'a gets c\'s hand (rotate)');
  eq(state.hands.b, ['x-a'], 'b gets a\'s old hand');
  eq(state.hands.c, ['x-b'], 'c gets b\'s old hand');
}

// ----------------------------------------------------------------------
// UNO call / catch
// ----------------------------------------------------------------------
{
  let state = baseState({ hands: { a: ['red-7', 'red-1'], b: ['blue-1'] } });

  // Before playing, a has 2 cards - cannot be "caught" yet
  let threwEarly = false;
  try { applyMove(state, { type: 'catchUno', playerId: 'b', targetId: 'a' }); }
  catch (e) { threwEarly = true; }
  assert(threwEarly, 'cannot catch a player who has more than 1 card');

  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-7' });
  eq(state.hands.a.length, 1, 'a has 1 card left');
  eq(state.unoCalls.a, false, 'unoCalls.a initialized to false');

  const before = state.hands.a.length;
  state = applyMove(state, { type: 'catchUno', playerId: 'b', targetId: 'a' });
  eq(state.hands.a.length, before + DEFAULT_SETTINGS.unoPenalty, 'a drew penalty cards for missed UNO');
  eq(state.unoCalls.a, true, 'unoCalls.a set to true after catch');

  // calling UNO before being caught prevents the penalty
  let state2 = baseState({ hands: { a: ['red-7', 'red-1'], b: ['blue-1'] } });
  state2 = applyMove(state2, { type: 'play', playerId: 'a', card: 'red-7' });
  state2 = applyMove(state2, { type: 'callUno', playerId: 'a' });
  eq(state2.unoCalls.a, true, 'a called UNO');
  let threw2 = false;
  try { applyMove(state2, { type: 'catchUno', playerId: 'b', targetId: 'a' }); }
  catch (e) { threw2 = true; }
  assert(threw2, 'cannot catch a player who already called UNO');
}

// ----------------------------------------------------------------------
// Win condition + scoring (target mode) + nextRound + returnToLobby
// ----------------------------------------------------------------------
{
  let state = baseState({
    settings: { scoringMode: 'target', targetScore: 50 },
    hands: { a: ['red-7'], b: ['blue-9', 'green-skip', 'wild-draw4'] }, // 9 + 20 + 50 = 79 pts
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-7' });
  eq(state.status, 'finished', 'reaching target score finishes the game (79 >= 50)');
  eq(state.winnerId, 'a', 'a is the winner');
  eq(state.players.find(p => p.id === 'a').score, 79, 'winner score = sum of opponents hand points');

  // returnToLobby resets everything
  state = applyMove(state, { type: 'returnToLobby' });
  eq(state.status, 'lobby', 'status back to lobby');
  eq(state.players.find(p => p.id === 'a').score, 0, 'scores reset');
  eq(state.hands, {}, 'hands cleared');
}

{
  // round end (not finished) -> nextRound deals a fresh round
  let state = baseState({
    settings: { scoringMode: 'target', targetScore: 1000 },
    hands: { a: ['red-7'], b: ['blue-9'] }, // only 9 pts, far from 1000
  });
  state = applyMove(state, { type: 'play', playerId: 'a', card: 'red-7' });
  eq(state.status, 'roundEnd', 'round ends without reaching target');
  state = applyMove(state, { type: 'nextRound' });
  eq(state.status, 'playing', 'nextRound starts a new round');
  eq(state.dealerIndex, 1, 'dealerIndex advanced');
  eq(state.currentPlayerIndex, 1, 'new round starts with new dealer index');
  for (const p of state.players) assert(state.hands[p.id].length === 7, 'fresh hands dealt');
}

// ----------------------------------------------------------------------
// forceSkip
// ----------------------------------------------------------------------
{
  let state = baseState({ drawStack: 4, lastWild4: { playerId: 'b', priorColor: 'red' } });
  state = applyMove(state, { type: 'forceSkip' });
  eq(state.currentPlayerIndex, 1, 'forceSkip advances turn');
  eq(state.drawStack, 0, 'forceSkip clears drawStack');
  eq(state.lastWild4, null, 'forceSkip clears lastWild4');
}

// ----------------------------------------------------------------------
// join / leave
// ----------------------------------------------------------------------
{
  let state = createInitialState();
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'Anna' });
  state = applyMove(state, { type: 'join', playerId: 'b', name: 'Bence' });
  eq(state.players.length, 2, 'two players joined');

  // rejoin updates name, does not duplicate
  state = applyMove(state, { type: 'join', playerId: 'a', name: 'Anna2' });
  eq(state.players.length, 2, 'rejoin does not duplicate');
  eq(state.players[0].name, 'Anna2', 'rejoin updates name');

  state = applyMove(state, { type: 'leave', playerId: 'b' });
  eq(state.players.length, 1, 'leave removes player in lobby');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
