/* Heyzee — scoring rules + AI opponent (greedy expected-value heuristic) */

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

const UPPER_FACE = { ones: 1, twos: 2, threes: 3, fours: 4, fives: 5, sixes: 6 };

function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}
function sum(dice) { return dice.reduce((a, b) => a + b, 0); }

/* Raw score for a category given 5 dice values (1-6). Does not apply Yahtzee bonus. */
function scoreCategory(id, dice) {
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
    case 'fullHouse': return (c.includes(3) && c.includes(2)) || c.includes(5) ? 25 : 0;
    case 'smStraight': return straight(4) ? 30 : 0;
    case 'lgStraight': return straight(5) ? 40 : 0;
    case 'yahtzee': return c.includes(5) ? 50 : 0;
    case 'chance': return sum(dice);
    default: return 0;
  }
}

const HeyzeeScore = { CATEGORIES, UPPER_FACE, scoreCategory, counts, sum };

/* ---------- AI ---------- */

/* Evaluate expected value of the best open category for a set of dice. */
function bestOpenValue(dice, card) {
  let best = 0;
  for (const cat of CATEGORIES) {
    if (card[cat.id] != null) continue;
    let v = scoreCategory(cat.id, dice);
    // nudge toward upper bonus progress and away from burning premium slots cheaply
    if (cat.section === 'upper' && v > 0) v += 1.5;
    best = Math.max(best, v);
  }
  return best;
}

/* Roll random dice for the non-held positions and estimate value via sampling. */
function evalHoldMask(dice, held, card, samples) {
  let total = 0;
  for (let s = 0; s < samples; s++) {
    const trial = dice.map((d, i) => (held[i] ? d : 1 + Math.floor(Math.random() * 6)));
    total += bestOpenValue(trial, card);
  }
  return total / samples;
}

/* Decide which dice to hold before a reroll. Returns boolean[5]. */
function aiChooseHold(dice, card) {
  const samples = 60;
  let bestMask = dice.map(() => true);
  let bestVal = evalHoldMask(dice, bestMask, card, samples);
  // try every hold combination (32) — tiny search space
  for (let mask = 0; mask < 32; mask++) {
    const held = [0, 1, 2, 3, 4].map((i) => Boolean(mask & (1 << i)));
    const v = evalHoldMask(dice, held, card, samples);
    if (v > bestVal + 0.01) { bestVal = v; bestMask = held; }
  }
  return bestMask;
}

/* Decide which category to score at end of turn. Returns category id. */
function aiChooseCategory(dice, card, yahtzeeScored) {
  let bestId = null, bestScore = -1;
  const openCount = CATEGORIES.filter((c) => card[c.id] == null).length;
  for (const cat of CATEGORIES) {
    if (card[cat.id] != null) continue;
    let s = scoreCategory(cat.id, dice);
    // value shaping: reward upper progress, penalize dumping a zero into a premium slot early
    let shaped = s;
    if (cat.section === 'upper' && s > 0) shaped += 2;
    if (s === 0 && ['yahtzee', 'lgStraight', 'fullHouse'].includes(cat.id) && openCount > 3) shaped -= 8;
    if (cat.id === 'chance' && openCount > 5) shaped -= 4;
    if (shaped > bestScore) { bestScore = shaped; bestId = cat.id; }
  }
  return bestId;
}

const HeyzeeAI = { aiChooseHold, aiChooseCategory };
