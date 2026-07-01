// ============================================================================
// Fejlesztői teszt – NEM kell a weboldal működéséhez.
// ============================================================================
// Ez egy önálló Node.js szkript, ami a GambleAnimal game-engine.js tiszta
// logikáját teszteli (treats/állat könyvelés, pig-plinko kimenetel, a
// bird-blackjack lapok és az osztó-irányítás). Hasznos, ha módosítod a
// game-engine.js-t, és gyorsan ellenőrizni akarod, hogy nem törtél el semmit.
//
// Futtatás (Node.js szükséges, https://nodejs.org):
//   node test-gambleanimal-engine.mjs
// ============================================================================

import {
  GAMES, GAME_IDS, TREATS_PER_ANIMAL, ANIMAL_PRODUCTION_INTERVAL_MS, STARTING_TREATS,
  createInitialState, migrateState,
  animalCount, totalAnimalCount, treatsToNextAnimal, applyBetResult, quickBetAmount,
  applyPassiveIncome, msUntilNextTick, feedAnimal,
  PLINKO_ROWS, PLINKO_MULTIPLIERS, plinkoIsWinSlot, plinkoOutcome, plinkoPath, playPlinko,
  createDeck, shuffle, handTotal, isBust, isBlackjack, classifyOutcome,
  dealRound, playerHit, decideTarget, playDealer, resolvePayout,
  startBlackjack, hitBlackjack, resolveBust, standBlackjack,
  SLOTS_SYMBOLS, SLOTS_PAYOUTS, SLOTS_REEL_STRIP, slotsReelWindow, playSlots,
} from './games/gambleanimal/game-engine.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}
function eq(a, b, msg) {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
}
function approx(actual, expected, tolerance, msg) {
  assert(Math.abs(actual - expected) <= tolerance, `${msg} (got ${actual}, expected ~${expected} ±${tolerance})`);
}

// ----------------------------------------------------------------------
// Alap állapot / katalógus
// ----------------------------------------------------------------------
{
  eq(GAME_IDS, ['plinko', 'blackjack', 'slots'], 'GAME_IDS sorrend');
  assert(GAMES.plinko.animalEmoji === '🐷', 'plinko témaállat = malac');
  assert(GAMES.blackjack.animalEmoji === '🐦', 'blackjack témaállat = madár');

  const s = createInitialState(1000);
  eq(s.treats, STARTING_TREATS, 'kezdő egyenleg');
  eq(s.lastTick, 1000, 'kezdő lastTick');
  eq(s.games.plinko.treatsWon, 0, 'kezdő plinko treatsWon');
  eq(s.games.blackjack.treatsWon, 0, 'kezdő blackjack treatsWon');
  assert(s.dev.plinko.winProb > 0 && s.dev.plinko.winProb < 1, 'kezdő plinko winProb 0..1 között');
}

// ----------------------------------------------------------------------
// migrateState – hiányos mentés kiegészítése
// ----------------------------------------------------------------------
{
  const partial = { treats: 250, games: { plinko: { treatsWon: 350 } } };
  const migrated = migrateState(partial);
  eq(migrated.treats, 250, 'migrateState megtartja a meglévő treats-t');
  eq(migrated.games.plinko.treatsWon, 350, 'migrateState megtartja a meglévő treatsWon-t');
  eq(migrated.games.blackjack.treatsWon, 0, 'migrateState pótolja a hiányzó blackjack ágat');
  assert(typeof migrated.dev.plinko.winProb === 'number', 'migrateState pótolja a dev ágat');
  eq(migrateState(null).treats, STARTING_TREATS, 'migrateState null-ra alapállapotot ad');
}

// ----------------------------------------------------------------------
// Állat / treats könyvelés
// ----------------------------------------------------------------------
{
  let s = createInitialState();
  eq(animalCount(s, 'plinko'), 0, '0 treatsWon = 0 állat');
  eq(treatsToNextAnimal(s, 'plinko'), 100, '0 treatsWon = 100 hiányzik a következőig');

  s.games.plinko.treatsWon = 250;
  eq(animalCount(s, 'plinko'), 2, '250 treatsWon = 2 állat');
  eq(treatsToNextAnimal(s, 'plinko'), 50, '250 treatsWon után 50 hiányzik');

  s.games.blackjack.treatsWon = 100;
  eq(totalAnimalCount(s), 3, 'totalAnimalCount összesíti a játékokat');
}

{
  // applyBetResult: nyereség nő, veszteség SOSEM csökkenti a treatsWon-t
  let s = createInitialState();
  s.treats = 500;

  let r = applyBetResult(s, 'plinko', 100, 250); // +150 nyereség
  eq(r.profit, 150, 'applyBetResult profit (nyerés)');
  eq(r.state.treats, 650, 'applyBetResult treats nő nyerésnél');
  eq(r.state.games.plinko.treatsWon, 150, 'applyBetResult treatsWon nő nyerésnél');

  r = applyBetResult(r.state, 'plinko', 200, 0); // teljes veszteség
  eq(r.profit, -200, 'applyBetResult profit (vesztés)');
  eq(r.state.treats, 450, 'applyBetResult treats csökken vesztésnél');
  eq(r.state.games.plinko.treatsWon, 150, 'applyBetResult treatsWon VÁLTOZATLAN vesztésnél');

  r = applyBetResult(r.state, 'plinko', 100, 100); // push
  eq(r.profit, 0, 'applyBetResult profit (push)');
  eq(r.state.games.plinko.treatsWon, 150, 'applyBetResult treatsWon változatlan push-nál');

  eq(s.games.plinko.treatsWon, 0, 'applyBetResult nem mutálja az eredeti state-et');
}

{
  eq(quickBetAmount(0, 0.5), 0, 'quickBetAmount 0 egyenlegnél 0');
  eq(quickBetAmount(1000, 0.01), 10, 'quickBetAmount 1%');
  eq(quickBetAmount(1000, 1), 1000, 'quickBetAmount 100%');
  eq(quickBetAmount(50, 0.01), 1, 'quickBetAmount kerekítés legalább 1-re');
  eq(quickBetAmount(3, 1), 3, 'quickBetAmount sosem lépi túl az egyenleget');
}

{
  let s = createInitialState();
  s.treats = 2;
  let r = feedAnimal(s, 1);
  assert(r.ok === true, 'feedAnimal sikeres, ha van elég treat');
  eq(r.state.treats, 1, 'feedAnimal levonja a treat költséget');
  r = feedAnimal(r.state, 5);
  assert(r.ok === false, 'feedAnimal sikertelen, ha nincs elég treat');
  eq(r.state.treats, 1, 'feedAnimal sikertelen hívásnál nem nyúl az egyenleghez');
}

// ----------------------------------------------------------------------
// Passzív termelés
// ----------------------------------------------------------------------
{
  let s = createInitialState(0);
  let r = applyPassiveIncome(s, 5 * 60 * 1000); // csak 5 perc telt el, nincs még állat sem
  eq(r.earned, 0, 'nincs termelés 10 percen belül');
  eq(r.state, s, 'nincs változás esetén ugyanaz az állapot jön vissza');

  s.games.plinko.treatsWon = 300; // 3 malac
  r = applyPassiveIncome(s, ANIMAL_PRODUCTION_INTERVAL_MS); // pontosan 1 ütem
  eq(r.earned, 3, '3 állat 1 ütem alatt 3 jutalomfalatot termel');
  eq(r.state.treats, STARTING_TREATS + 3, 'a termelés jóváíródik az egyenlegen');
  eq(r.state.lastTick, ANIMAL_PRODUCTION_INTERVAL_MS, 'lastTick pontosan az ütem hosszával tolódik');

  // 3.5 ütemnyi idő -> csak a teljes (3) ütem számít, a maradék megmarad a következő körre
  r = applyPassiveIncome(s, Math.floor(ANIMAL_PRODUCTION_INTERVAL_MS * 3.5));
  eq(r.earned, 9, '3 állat, 3 teljes ütem = 9 jutalomfalat (a fél ütem nem számít még)');
  const remaining = msUntilNextTick(r.state, Math.floor(ANIMAL_PRODUCTION_INTERVAL_MS * 3.5));
  approx(remaining, ANIMAL_PRODUCTION_INTERVAL_MS * 0.5, 1000, 'a fél ütemnyi maradék nem veszett el');
}

// ============================================================================
// PIG-PLINKO
// ============================================================================
{
  eq(PLINKO_MULTIPLIERS.length, PLINKO_ROWS + 1, 'a rekeszek száma = sorok + 1');
  eq(PLINKO_MULTIPLIERS[0], PLINKO_MULTIPLIERS[PLINKO_MULTIPLIERS.length - 1], 'szimmetrikus széle (bal=jobb)');
  eq(PLINKO_MULTIPLIERS[4], 0.5, 'középső rekesz a legalacsonyabb szorzó');
  assert(plinkoIsWinSlot(0) === true, 'a szélső rekesz nyerő');
  assert(plinkoIsWinSlot(4) === false, 'a középső rekesz nem nyerő');
}

{
  // plinkoPath: mindig pontosan targetSlot 'R' lépést tartalmaz
  for (let slot = 0; slot <= PLINKO_ROWS; slot++) {
    const path = plinkoPath(slot);
    eq(path.length, PLINKO_ROWS, `plinkoPath hossza (slot=${slot})`);
    eq(path.filter(m => m === 'R').length, slot, `plinkoPath R-lépések száma (slot=${slot})`);
  }
}

{
  // plinkoOutcome statisztikai teszt: a nyerési arány kövesse a beállított esélyt
  function winRateOver(winProb, n) {
    let wins = 0;
    for (let i = 0; i < n; i++) {
      if (plinkoIsWinSlot(plinkoOutcome(winProb))) wins++;
    }
    return wins / n;
  }
  approx(winRateOver(0.5, 20000), 0.5, 0.03, 'plinko 50% beállításnál ~50% nyerési arány');
  approx(winRateOver(0.2, 20000), 0.2, 0.03, 'plinko 20% beállításnál ~20% nyerési arány');
  approx(winRateOver(0.9, 20000), 0.9, 0.03, 'plinko 90% beállításnál ~90% nyerési arány');
  eq(winRateOver(0, 2000), 0, 'plinko 0% beállításnál sosem nyerő rekesz');
  eq(winRateOver(1, 2000), 1, 'plinko 100% beállításnál mindig nyerő rekesz');
}

{
  let s = createInitialState();
  s.treats = 1000;
  s.dev.plinko.winProb = 1; // mindig nyerő rekesz -> a profit mindig pozitív
  for (let i = 0; i < 50; i++) {
    const r = playPlinko(s, 50);
    assert(r.profit > 0, 'playPlinko 100% nyerési eséllyel mindig pozitív profit');
    assert(r.path.length === PLINKO_ROWS, 'playPlinko path hossza helyes');
    s = r.state;
  }
  assert(s.games.plinko.treatsWon > 0, 'sok nyerés után nő a treatsWon');
  assert(animalCount(s, 'plinko') >= 1, 'sok nyerés után legalább 1 malac jár');

  let threw = false;
  try { playPlinko(s, 0); } catch (e) { threw = true; }
  assert(threw, 'playPlinko hibát dob 0 tétre');

  threw = false;
  try { playPlinko(s, s.treats + 1000); } catch (e) { threw = true; }
  assert(threw, 'playPlinko hibát dob egyenlegnél nagyobb tétre');
}

// ============================================================================
// BIRD-BLACKJACK
// ============================================================================
{
  const deck = createDeck();
  eq(deck.length, 52, 'a pakli 52 lapos');
  eq(new Set(deck).size, 52, 'nincs duplikált lap');

  const shuffled = shuffle(deck);
  eq(shuffled.length, 52, 'keverés után is 52 lap');
  eq([...shuffled].sort().join(','), [...deck].sort().join(','), 'keverés ugyanazokat a lapokat tartalmazza');
}

{
  eq(handTotal(['10♠', '5♥']), 15, 'kézösszeg: 10+5=15');
  eq(handTotal(['A♠', 'K♥']), 21, 'kézösszeg: A+K=21 (puha ász 11-ként)');
  eq(handTotal(['A♠', 'A♥']), 12, 'kézösszeg: A+A=12 (egyik ász visszavált 1-re)');
  eq(handTotal(['A♠', 'A♥', 'A♦']), 13, 'kézösszeg: A+A+A=13');
  eq(handTotal(['10♠', '10♥', '5♦']), 25, 'kézösszeg busztnál is a tényleges összeg');
  assert(isBust(['10♠', '10♥', '5♦']) === true, 'isBust felismeri a busztot');
  assert(isBust(['10♠', '9♥']) === false, 'isBust nem jelez busztot 19-nél');
  assert(isBlackjack(['A♠', 'K♥']) === true, 'isBlackjack felismeri a natural BJ-t');
  assert(isBlackjack(['7♠', '7♥', '7♦']) === false, '3 lapos 21 NEM natural blackjack');
}

{
  eq(classifyOutcome(20, ['10♠', '5♥', '9♦']), 'win', 'classifyOutcome: osztó buszt = játékos nyer');
  eq(classifyOutcome(20, ['10♠', '9♥']), 'win', 'classifyOutcome: 20 vs 19 = játékos nyer');
  eq(classifyOutcome(18, ['10♠', '9♥']), 'lose', 'classifyOutcome: 18 vs 19 = játékos veszít');
  eq(classifyOutcome(19, ['10♠', '9♥']), 'push', 'classifyOutcome: 19 vs 19 = döntetlen');
}

{
  const { deck, player, dealer } = dealRound();
  eq(deck.length, 48, 'osztás után 48 lap marad a pakliban');
  eq(player.length, 2, 'a játékos 2 lapot kap');
  eq(dealer.length, 2, 'az osztó 2 lapot kap');
  const all = [...deck, ...player, ...dealer];
  eq(new Set(all).size, 52, 'osztás után sincs duplikált/eltűnt lap');

  const hit = playerHit(deck, player);
  eq(hit.deck.length, 47, 'húzás után eggyel kevesebb lap a pakliban');
  eq(hit.player.length, 3, 'húzás után eggyel több lap a kézben');
}

{
  // decideTarget statisztikai teszt
  function rates(winProb, n) {
    const counts = { win: 0, push: 0, lose: 0 };
    for (let i = 0; i < n; i++) counts[decideTarget(winProb)]++;
    return counts;
  }
  const r50 = rates(0.5, 20000);
  approx(r50.win / 20000, 0.5, 0.03, 'decideTarget 50%-nál ~50% win célzás');
  const r0 = rates(0, 20000);
  eq(r0.win, 0, 'decideTarget 0%-nál sosem célzunk win-t');
  approx(r0.push / 20000, 0.12, 0.03, 'decideTarget 0%-nál a push arány a fix BLACKJACK_PUSH_SHARE');
}

{
  // playDealer: a célzott kimenetel a legtöbb esetben tényleg kijön (statisztikai,
  // mert szélsőséges játékos-összegeknél a szabályok miatt nem minden cél érhető el)
  function successRate(target, playerTotal, n) {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const deck = shuffle(createDeck()).slice(0, 48); // 4 lap "elosztva" feltételezve
      const dealerStart = [deck.pop(), deck.pop()];
      const { dealerCards } = playDealer(deck, dealerStart, playerTotal, target);
      if (classifyOutcome(playerTotal, dealerCards) === target) hits++;
    }
    return hits / n;
  }
  assert(successRate('win', 19, 300) > 0.95, 'playDealer "win" célzás >95%-ban sikerül 19-es játékosösszegnél');
  assert(successRate('lose', 19, 300) > 0.95, 'playDealer "lose" célzás >95%-ban sikerül 19-es játékosösszegnél');
  assert(successRate('push', 19, 300) > 0.90, 'playDealer "push" célzás >90%-ban sikerül 19-es játékosösszegnél');

  // null cél = nincs irányítás, simán lejátssza a szabály szerint
  const deck = shuffle(createDeck()).slice(0, 48);
  const dealerStart = [deck.pop(), deck.pop()];
  const { dealerCards } = playDealer(deck, dealerStart, 19, null);
  assert(handTotal(dealerCards) >= 17 || handTotal(dealerStart) >= 17, 'playDealer null cél esetén is 17-ig húz');
}

{
  eq(resolvePayout(100, ['10♠', '10♥', '5♦'], ['10♣', '9♥']), 0, 'resolvePayout: játékos buszt = 0');
  eq(resolvePayout(100, ['A♠', 'K♥'], ['10♣', '9♥']), 250, 'resolvePayout: natural BJ = 2.5x');
  eq(resolvePayout(100, ['A♠', 'K♥'], ['A♣', 'K♦']), 100, 'resolvePayout: mindkettőnek BJ = push (1x vissza)');
  eq(resolvePayout(100, ['10♠', '9♥'], ['10♣', '5♥', '9♦']), 200, 'resolvePayout: osztó buszt = 2x');
  eq(resolvePayout(100, ['10♠', '9♥'], ['10♣', '8♥']), 200, 'resolvePayout: 19 vs 18 = 2x');
  eq(resolvePayout(100, ['10♠', '9♥'], ['10♣', '9♦']), 100, 'resolvePayout: 19 vs 19 = push');
  eq(resolvePayout(100, ['10♠', '8♥'], ['10♣', '9♦']), 0, 'resolvePayout: 18 vs 19 = vesztés');
}

{
  // startBlackjack / hitBlackjack / resolveBust / standBlackjack integráció
  let s = createInitialState();
  s.treats = 1000;

  let threw = false;
  try { startBlackjack(s, 0); } catch (e) { threw = true; }
  assert(threw, 'startBlackjack hibát dob érvénytelen tétre');

  // Sok kört lejátszunk egy egyszerű "állok 17-en" stratégiával, hogy a
  // standBlackjack és a hitBlackjack/resolveBust ágakat is lefedjük.
  let handsPlayed = 0, wins = 0, naturalBJs = 0;
  for (let i = 0; i < 300; i++) {
    const start = startBlackjack(s, 10);
    s = start.state;
    handsPlayed++;
    if (start.outcome) {
      // natural blackjack -> azonnal lezárult
      if (start.outcome === 'win') { wins++; naturalBJs++; }
      continue;
    }
    let hand = start.hand;
    while (!hand.resolved && handTotal(hand.player) < 17) {
      hand = hitBlackjack(hand);
    }
    if (hand.resolved) {
      const r = resolveBust(s, hand);
      s = r.state;
      eq(r.outcome, 'lose', 'resolveBust mindig vesztés');
      eq(r.payout, 0, 'resolveBust payout mindig 0');
    } else {
      const r = standBlackjack(s, hand);
      s = r.state;
      if (r.outcome === 'win') wins++;
      // payout konzisztencia-ellenőrzés
      const expectedPayout = resolvePayout(10, r.hand.player, r.hand.dealer);
      eq(r.payout, expectedPayout, 'standBlackjack payout konzisztens a resolvePayout-tal');
    }
  }
  eq(handsPlayed, 300, '300 kör lement hiba nélkül');
  assert(naturalBJs >= 0, 'natural blackjack ág nem dobott hibát (akár 0-szor is történhet)');
  assert(s.treats >= 0, 'az egyenleg sosem megy negatívba normál játék közben');

  // 100% nyerési eséllyel a nem-buktatott kezek szinte mindig nyerjenek
  let s2 = createInitialState();
  s2.treats = 5000;
  s2.dev.blackjack.winProb = 1;
  let standWins = 0, standTotal = 0;
  for (let i = 0; i < 200; i++) {
    const start = startBlackjack(s2, 10);
    s2 = start.state;
    if (start.outcome) continue; // natural BJ, nem ebbe számít
    let hand = start.hand;
    // mindig állunk az első két lapnál, hogy a busztolás ne zavarja a mérést
    const r = standBlackjack(s2, hand);
    s2 = r.state;
    standTotal++;
    if (r.outcome === 'win') standWins++;
  }
  assert(standTotal > 0, 'volt mérhető nem-natural kör');
  approx(standWins / standTotal, 1, 0.05, '100% blackjack winProb mellett a standolt körök szinte mindig nyernek');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

// ============================================================================
// SLOTH-SLOTS
// ============================================================================
{
  // Szalag ellenőrzése
  eq(SLOTS_REEL_STRIP.length, 20, 'SLOTS_REEL_STRIP pontosan 20 szimbólumból áll');
  const counts = {};
  SLOTS_REEL_STRIP.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  eq(counts['🦥'], 1, '🦥 pontosan 1× szerepel a szalagon (jackpot = ritka)');
  eq(counts['💎'], 2, '💎 pontosan 2× szerepel');
  eq(counts['🍌'], 2, '🍌 pontosan 2× szerepel');
  eq(counts['🌿'], 4, '🌿 pontosan 4× szerepel');
  eq(counts['🌸'], 5, '🌸 pontosan 5× szerepel');
  eq(counts['🍀'], 6, '🍀 pontosan 6× szerepel (leggyakoribb)');
  assert(SLOTS_SYMBOLS.every(s => SLOTS_REEL_STRIP.includes(s)), 'minden szimbólum szerepel a szalagon');

  // Kifizetési táblázat nem üres, minden szimbólumhoz van érték
  assert(SLOTS_SYMBOLS.every(s => typeof SLOTS_PAYOUTS[s] === 'number' && SLOTS_PAYOUTS[s] > 1),
    'minden szimbólumhoz van >1× kifizetés');
  eq(SLOTS_PAYOUTS['🦥'], 100, 'jackpot szorzó 100×');
}

{
  // slotsReelWindow
  const win18 = slotsReelWindow(18); // 🦥 pozíció
  eq(win18[1], '🦥', 'slotsReelWindow(18) középső = 🦥');
  eq(win18.length, 3, 'slotsReelWindow mindig 3 szimbólumot ad');
  eq(slotsReelWindow(0)[1], SLOTS_REEL_STRIP[0], 'slotsReelWindow(0) középső = strip[0]');
  // Körbefutás: strip[-1] = strip[19]
  eq(slotsReelWindow(0)[0], SLOTS_REEL_STRIP[19], 'slotsReelWindow(0) felső = strip[19] (körbefut)');
  // stop = utolsó: alsó = strip[0]
  const last = SLOTS_REEL_STRIP.length - 1;
  eq(slotsReelWindow(last)[2], SLOTS_REEL_STRIP[0], 'slotsReelWindow(utolsó) alsó = strip[0] (körbefut)');
}

{
  // playSlots – alapvető struktúra
  let s = createInitialState(); s.treats = 500;
  const r = playSlots(s, 10);
  assert(Array.isArray(r.centerSymbols) && r.centerSymbols.length === 3, 'centerSymbols 3 elemű tömb');
  assert(Array.isArray(r.stopPositions) && r.stopPositions.length === 3, 'stopPositions 3 elemű tömb');
  assert(r.stopPositions.every(p => p >= 0 && p < SLOTS_REEL_STRIP.length), 'stopPositions az érvényes tartományban');
  // Minden stopPos a megfelelő szimbólumra mutat
  for (let i = 0; i < 3; i++) {
    eq(SLOTS_REEL_STRIP[r.stopPositions[i]], r.centerSymbols[i],
      `stopPositions[${i}] → helyes szimbólum a szalagon`);
  }
  assert(typeof r.multiplier === 'number', 'multiplier szám');
  assert(typeof r.payout === 'number' && r.payout >= 0, 'payout nemnegatív szám');
  assert(typeof r.isJackpot === 'boolean', 'isJackpot boolean');
  // isJackpot ↔ 3×🦥 ↔ multiplier = 100
  if (r.isJackpot) {
    assert(r.centerSymbols.every(s => s === '🦥'), 'isJackpot = true csak 3×🦥-nél');
    eq(r.multiplier, 100, 'isJackpot = true → multiplier = 100');
  }
  assert(s.treats === 500, 'playSlots nem mutálja az eredeti state-et');
}

{
  // playSlots – hibakezelés
  let s = createInitialState(); s.treats = 5;
  let threw = false;
  try { playSlots(s, 0); } catch (e) { threw = true; }
  assert(threw, 'playSlots hibát dob 0 tét esetén');

  threw = false;
  try { playSlots(s, 100); } catch (e) { threw = true; }
  assert(threw, 'playSlots hibát dob az egyenlegnél nagyobb tétre');
}

{
  // winProb = 1 → mindig nyerő kombináció (3 egyforma)
  let s = createInitialState(); s.treats = 5000; s.dev.slots.winProb = 1;
  for (let i = 0; i < 200; i++) {
    const r = playSlots(s, 1);
    assert(r.centerSymbols[0] === r.centerSymbols[1] && r.centerSymbols[1] === r.centerSymbols[2],
      'winProb=1 → mindig 3 egyforma szimbólum');
    assert(r.multiplier > 0, 'winProb=1 → multiplier > 0');
    s = r.state;
  }
}

{
  // winProb = 0 → soha nem nyerő kombináció
  let s = createInitialState(); s.treats = 5000; s.dev.slots.winProb = 0;
  for (let i = 0; i < 200; i++) {
    const r = playSlots(s, 1);
    assert(!(r.centerSymbols[0] === r.centerSymbols[1] && r.centerSymbols[1] === r.centerSymbols[2]),
      'winProb=0 → soha nem 3 egyforma');
    eq(r.multiplier, 0, 'winProb=0 → multiplier = 0');
    s = r.state;
  }
}

{
  // Statisztikai nyerési arány teszt
  function slotsWinRate(winProb, n) {
    let s = createInitialState(); s.treats = n * 100; s.dev.slots.winProb = winProb;
    let wins = 0;
    for (let i = 0; i < n; i++) {
      const r = playSlots(s, 1);
      if (r.multiplier > 0) wins++;
      s = r.state;
    }
    return wins / n;
  }
  approx(slotsWinRate(0.5, 5000), 0.5, 0.04, 'Sloth-Slots 50% winProb → ~50% nyerési arány');
  approx(slotsWinRate(0.2, 5000), 0.2, 0.04, 'Sloth-Slots 20% winProb → ~20% nyerési arány');
}

{
  // Jackpot csak 🦥🦥🦥 esetén lehet – soha ne aktiválódjon 3 másik egyforma szimbólumnál
  let s = createInitialState(); s.treats = 10000; s.dev.slots.winProb = 1;
  for (let i = 0; i < 300; i++) {
    const r = playSlots(s, 1);
    if (r.isJackpot) {
      assert(r.centerSymbols.every(c => c === '🦥'), 'isJackpot csak 3×🦥-nél igaz');
      eq(r.multiplier, 100, 'isJackpot → multiplier pontosan 100');
    }
    s = r.state;
  }
}

{
  // treatsWon könyvelés slots játékhoz
  let s = createInitialState(); s.treats = 500; s.dev.slots.winProb = 1;
  const before = animalCount(s, 'slots');
  let r;
  // Pörgetünk addig, amíg pontosan 1 lajhárhoz elegendő nettó nyereményt összegyűjtünk
  let netWin = 0;
  while (netWin < 100) {
    r = playSlots(s, 1);
    s = r.state;
    if (r.profit > 0) netWin += r.profit;
  }
  assert(animalCount(s, 'slots') >= before + 1, 'slots treatsWon → lajhárszám nő elég nyeremény után');
}
