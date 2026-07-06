/* Heyzee — scoring rules, joker logic + AI opponent (greedy expected-value heuristic) */

const CATEGORIES = [
  { id: 'ones',   name: 'Ones',   section: 'upper' },
  { id: 'twos',   name: 'Twos',   section: 'upper' },
  { id: 'threes', name: 'Threes', section: 'upper' },
  { id: 'fours',  name: 'Fours',  section: 'upper' },
  { id: 'fives',  name: 'Fives',  section: 'upper' },
  { id: 'sixes',  name: 'Sixes',  section: 'upper' },
  { id: 'threeKind', name: 'Three of a Kind', section: 'lower' },
  { id: 'fourKind',  name: 'Four of a Kind',  section: 'lower' },
  { id: 'fullHouse', name: 'Full House',       section: 'lower' },
  { id: 'smStraight', name: 'Small Straight',  section: 'lower' },
  { id: 'lgStraight', name: 'Large Straight',  section: 'lower' },
  { id: 'yahtzee',   name: 'Heyzee!',          section: 'lower' },
  { id: 'chance',    name: 'Chance',           section: 'lower' },
];

const UPPER_IDS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const UPPER_FACE = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}
function sum(dice) { return dice.reduce((a, b) => a + b, 0); }
function isYahtzeeDice(dice) { return counts(dice).includes(5); }

/* Raw score for a category. `joker` = true when scoring a Heyzee under joker rules,
   which makes Full House / straights pay full value even though the dice are five-of-a-kind. */
function scoreCategory(id, dice, joker) {
  const c = counts(dice);
  if (UPPER_FACE[id]) { const f = UPPER_FACE[id]; return c[f] * f; }
  const has = (n) => c.some((x) => x >= n);
  const straight = (len) => {
    let run = 0;
    for (let f = 1; f <= 6; f++) { run = c[f] ? run + 1 : 0; if (run >= len) return true; }
    return false;
  };
  switch (id) {
    case 'threeKind': return has(3) ? sum(dice) : 0;
    case 'fourKind':  return has(4) ? sum(dice) : 0;
    case 'fullHouse': return ((c.includes(3) && c.includes(2)) || (joker && c.includes(5))) ? 25 : 0;
    case 'smStraight': return (straight(4) || (joker && c.includes(5))) ? 30 : 0;
    case 'lgStraight': return (straight(5) || (joker && c.includes(5))) ? 40 : 0;
    case 'yahtzee': return c.includes(5) ? 50 : 0;
    case 'chance': return sum(dice);
    default: return 0;
  }
}

/* Whether joker rules are in force for this roll (a Heyzee rolled after the Heyzee box is filled). */
function jokerActive(dice, card) {
  return isYahtzeeDice(dice) && card.yahtzee != null;
}

/* Which categories a player is allowed to score this roll, per official forced-placement rules. */
function legalCategories(dice, card) {
  const open = CATEGORIES.filter((c) => card[c.id] == null).map((c) => c.id);
  if (!jokerActive(dice, card)) return open;
  // Joker: must use the matching upper box first if it is open...
  const upperId = UPPER_IDS[dice[0] - 1];
  if (card[upperId] == null) return [upperId];
  // ...otherwise any open lower box...
  const lowerOpen = open.filter((id) => CATEGORIES.find((c) => c.id === id).section === 'lower');
  if (lowerOpen.length) return lowerOpen;
  // ...otherwise a zero in any open upper box.
  return open;
}

const HeyzeeScore = { CATEGORIES, UPPER_IDS, UPPER_FACE, scoreCategory, counts, sum, isYahtzeeDice, jokerActive, legalCategories };

/* ---------- ridiculous AI names ---------- */
const AI_NAMES = [
  'Sir Rolls-a-Lot', 'Dice Vader', 'Gambit McSnake-Eyes', 'Baron von Boxcars',
  'The Yahtzenator', 'Captain Cluckenstein', 'Reroll Reginald', 'Duchess Diceypants',
  'Chairman Meow', 'Professor Pipswick', 'Big Chungus Cubes', 'Lady Fumblefingers',
  'Tumbleweed Tony', 'Count Rollula', 'Snake Plisskin Jr.', 'Diceabeth II',
  'General Gambleton', 'Rando Calrissian', 'Sir Loin of Beef', 'Wafflecone Wanda',
];
function aiRandomName() { return AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)]; }

/* ---------- AI ---------- */

function bestOpenValue(dice, card) {
  let best = 0;
  for (const cat of CATEGORIES) {
    if (card[cat.id] != null) continue;
    let v = scoreCategory(cat.id, dice, false);
    if (cat.section === 'upper' && v > 0) v += 1.5;
    best = Math.max(best, v);
  }
  return best;
}

function evalHoldMask(dice, held, card, samples) {
  let total = 0;
  for (let s = 0; s < samples; s++) {
    const trial = dice.map((d, i) => (held[i] ? d : 1 + Math.floor(Math.random() * 6)));
    total += bestOpenValue(trial, card);
  }
  return total / samples;
}

function aiChooseHold(dice, card) {
  const samples = 60;
  let bestMask = dice.map(() => true);
  let bestVal = evalHoldMask(dice, bestMask, card, samples);
  for (let mask = 0; mask < 32; mask++) {
    const held = [0, 1, 2, 3, 4].map((i) => Boolean(mask & (1 << i)));
    const v = evalHoldMask(dice, held, card, samples);
    if (v > bestVal + 0.01) { bestVal = v; bestMask = held; }
  }
  return bestMask;
}

/* Choose a category to score, respecting joker legality and joker scoring. */
function aiChooseCategory(dice, card) {
  const legal = legalCategories(dice, card);
  const joker = jokerActive(dice, card);
  const openCount = CATEGORIES.filter((c) => card[c.id] == null).length;
  let bestId = legal[0], bestScore = -1e9;
  for (const id of legal) {
    const cat = CATEGORIES.find((c) => c.id === id);
    const s = scoreCategory(id, dice, joker);
    let shaped = s;
    if (cat.section === 'upper' && s > 0) shaped += 2;
    if (s === 0 && ['yahtzee', 'lgStraight', 'fullHouse'].includes(id) && openCount > 3) shaped -= 8;
    if (id === 'chance' && openCount > 5) shaped -= 4;
    if (shaped > bestScore) { bestScore = shaped; bestId = id; }
  }
  return bestId;
}

const HeyzeeAI = { aiChooseHold, aiChooseCategory, aiRandomName };
