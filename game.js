/* Heyzee — game controller */
(function () {
  const { CATEGORIES, UPPER_FACE, scoreCategory, counts } = HeyzeeScore;

  const state = {
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollsLeft: 3,
    hasRolled: false,
    current: 0,               // 0 = you, 1 = AI
    cards: [{}, {}],          // catId -> score (null/undefined = open)
    yahtzeeBonus: [0, 0],
    muted: false,
    busy: false,              // locks input during animations / AI turn
  };
  for (const c of CATEGORIES) { state.cards[0][c.id] = null; state.cards[1][c.id] = null; }

  const $ = (id) => document.getElementById(id);
  const tray = $('diceTray');
  const rollBtn = $('rollBtn');
  const statusEl = $('status');
  const cardEl = $('scorecard');

  /* ---------- sound ---------- */
  let audioCtx = null;
  function beep(freq, dur, type = 'sine', vol = 0.05) {
    if (state.muted) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = vol; o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* no audio */ }
  }
  const sndRoll = () => beep(180 + Math.random() * 60, 0.12, 'triangle', 0.06);
  const sndHold = () => beep(520, 0.06, 'square', 0.04);
  const sndScore = () => { beep(660, 0.1, 'sine', 0.06); setTimeout(() => beep(880, 0.12, 'sine', 0.06), 90); };

  /* ---------- dice rendering ---------- */
  function renderDice(animate) {
    tray.innerHTML = '';
    state.dice.forEach((val, i) => {
      const die = document.createElement('div');
      die.className = 'die' + (state.held[i] ? ' held' : '');
      die.dataset.face = String(val);
      if (state.current !== 0 || !state.hasRolled || state.busy) die.classList.add('disabled');
      for (let p = 0; p < val; p++) {
        const pip = document.createElement('span'); pip.className = 'pip'; die.appendChild(pip);
      }
      if (animate && !state.held[i]) die.classList.add('rolling');
      die.addEventListener('click', () => toggleHold(i));
      tray.appendChild(die);
    });
  }

  function toggleHold(i) {
    if (state.busy || state.current !== 0 || !state.hasRolled || state.rollsLeft === 0) return;
    state.held[i] = !state.held[i];
    sndHold();
    renderDice(false);
  }

  /* ---------- rolling ---------- */
  function rollDice() {
    state.dice = state.dice.map((d, i) => (state.held[i] ? d : 1 + Math.floor(Math.random() * 6)));
  }

  function humanRoll() {
    if (state.busy || state.current !== 0 || state.rollsLeft === 0) return;
    state.busy = true;
    rollDice();
    state.rollsLeft--;
    state.hasRolled = true;
    sndRoll();
    renderDice(true);
    updateControls();
    setTimeout(() => { state.busy = false; renderDice(false); renderCard(); updateControls(); }, 500);
  }

  /* ---------- scoring / turn flow ---------- */
  function upperTotal(card) {
    return Object.keys(UPPER_FACE).reduce((t, id) => t + (card[id] || 0), 0);
  }
  function grandTotal(p) {
    const card = state.cards[p];
    let upper = upperTotal(card);
    let bonus = upper >= 63 ? 35 : 0;
    let lower = 0;
    for (const c of CATEGORIES) if (c.section === 'lower' && card[c.id] != null) lower += card[c.id];
    return upper + bonus + lower + state.yahtzeeBonus[p];
  }

  function commitScore(p, catId) {
    const raw = scoreCategory(catId, state.dice);
    // Heyzee (Yahtzee) bonus: extra 5-of-a-kind after the first scored Heyzee
    if (counts(state.dice).includes(5) && state.cards[p].yahtzee === 50 && catId !== 'yahtzee') {
      state.yahtzeeBonus[p] += 100;
    }
    state.cards[p][catId] = raw;
    sndScore();
  }

  function endTurn() {
    updateTotals();
    if (isGameOver()) return finishGame();
    state.current = state.current === 0 ? 1 : 0;
    startTurn();
  }

  function startTurn() {
    state.held = [false, false, false, false, false];
    state.rollsLeft = 3;
    state.hasRolled = false;
    renderDice(false);
    renderCard();
    updateControls();
    setActivePlayer();
    if (state.current === 1) {
      statusEl.textContent = 'AI is thinking…';
      state.busy = true;
      setTimeout(aiTurn, 700);
    } else {
      statusEl.textContent = 'Your turn — roll the dice.';
      state.busy = false;
    }
  }

  function isGameOver() {
    return [0, 1].every((p) => CATEGORIES.every((c) => state.cards[p][c.id] != null));
  }

  /* ---------- AI turn ---------- */
  function aiTurn() {
    const card = state.cards[1];
    // roll #1 (mandatory)
    state.dice = state.dice.map(() => 1 + Math.floor(Math.random() * 6));
    state.hasRolled = true;
    renderDice(true);
    sndRoll();
    let rolls = 2;

    const step = () => {
      const hold = HeyzeeAI.aiChooseHold(state.dice, card);
      state.held = hold;
      renderDice(false);
      if (rolls > 0 && !hold.every(Boolean)) {
        rolls--;
        setTimeout(() => {
          state.dice = state.dice.map((d, i) => (hold[i] ? d : 1 + Math.floor(Math.random() * 6)));
          renderDice(true);
          sndRoll();
          setTimeout(step, 650);
        }, 550);
      } else {
        const catId = HeyzeeAI.aiChooseCategory(state.dice, card, card.yahtzee === 50);
        commitScore(1, catId);
        renderCard();
        setTimeout(endTurn, 700);
      }
    };
    setTimeout(step, 650);
  }

  /* ---------- scorecard rendering ---------- */
  function renderCard() {
    const canPick = state.current === 0 && state.hasRolled && !state.busy;
    const rows = [];
    rows.push(`<tr><th>Upper</th><th>You</th><th>AI</th></tr>`);
    for (const c of CATEGORIES.filter((x) => x.section === 'upper')) rows.push(catRow(c, canPick));
    const uYou = upperTotal(state.cards[0]), uAi = upperTotal(state.cards[1]);
    rows.push(`<tr class="subtotal"><td>Bonus (63+)</td><td>${uYou >= 63 ? '+35' : `${uYou}/63`}</td><td>${uAi >= 63 ? '+35' : `${uAi}/63`}</td></tr>`);
    rows.push(`<tr><th>Lower</th><th></th><th></th></tr>`);
    for (const c of CATEGORIES.filter((x) => x.section === 'lower')) rows.push(catRow(c, canPick));
    if (state.yahtzeeBonus[0] || state.yahtzeeBonus[1]) {
      rows.push(`<tr class="subtotal"><td>Heyzee bonus</td><td>${state.yahtzeeBonus[0]}</td><td>${state.yahtzeeBonus[1]}</td></tr>`);
    }
    rows.push(`<tr class="subtotal"><td>Total</td><td>${grandTotal(0)}</td><td>${grandTotal(1)}</td></tr>`);
    cardEl.innerHTML = rows.join('');
    // wire up open cells
    cardEl.querySelectorAll('tr.cat.open-you td.val').forEach((td) => {
      td.addEventListener('click', () => {
        if (state.current !== 0 || !state.hasRolled || state.busy) return;
        commitScore(0, td.dataset.cat);
        endTurn();
      });
    });
  }

  function catRow(c, canPick) {
    const you = state.cards[0][c.id];
    const ai = state.cards[1][c.id];
    const open = you == null;
    let cls = 'cat';
    let youCell;
    if (open) {
      if (canPick) {
        cls += ' open-you';
        youCell = `<td class="val" data-cat="${c.id}">${scoreCategory(c.id, state.dice)}</td>`;
      } else {
        youCell = `<td class="val">–</td>`;
      }
    } else {
      cls += ' used';
      youCell = `<td class="val">${you}</td>`;
    }
    const aiCell = `<td class="aival">${ai == null ? '–' : ai}</td>`;
    return `<tr class="${cls}"><td class="catname">${c.name}</td>${youCell}${aiCell}</tr>`;
  }

  /* ---------- misc UI ---------- */
  function updateControls() {
    rollBtn.disabled = state.current !== 0 || state.rollsLeft === 0 || state.busy;
    $('rollsLeft').textContent = `Rolls left: ${state.rollsLeft}`;
    rollBtn.textContent = state.hasRolled ? 'Roll' : 'Roll';
  }
  function updateTotals() {
    $('total-0').textContent = grandTotal(0);
    $('total-1').textContent = grandTotal(1);
  }
  function setActivePlayer() {
    $('player-you').classList.toggle('active', state.current === 0);
    $('player-ai').classList.toggle('active', state.current === 1);
    updateControls();
  }

  function finishGame() {
    updateTotals();
    const you = grandTotal(0), ai = grandTotal(1);
    const t = you > ai ? 'You win! 🎉' : you < ai ? 'AI wins' : "It's a tie";
    $('overlayTitle').textContent = t;
    $('overlayBody').textContent = `You ${you} — AI ${ai}`;
    $('overlay').classList.remove('hidden');
  }

  function newGame() {
    for (const c of CATEGORIES) { state.cards[0][c.id] = null; state.cards[1][c.id] = null; }
    state.yahtzeeBonus = [0, 0];
    state.current = 0;
    state.dice = [1, 1, 1, 1, 1];
    $('overlay').classList.add('hidden');
    updateTotals();
    startTurn();
  }

  /* ---------- toggles ---------- */
  $('feltToggle').addEventListener('click', (e) => {
    const green = document.body.classList.toggle('felt-green');
    document.body.classList.toggle('felt-burgundy', !green);
    e.target.textContent = green ? 'Green felt' : 'Burgundy felt';
  });
  $('diceToggle').addEventListener('click', (e) => {
    const inverted = document.body.classList.toggle('dice-inverted');
    document.body.classList.toggle('dice-classic', !inverted);
    e.target.textContent = inverted ? 'Inverted dice' : 'Classic dice';
  });
  $('muteToggle').addEventListener('click', (e) => {
    state.muted = !state.muted;
    e.target.textContent = state.muted ? '🔇' : '🔊';
  });
  rollBtn.addEventListener('click', humanRoll);
  $('newGameBtn').addEventListener('click', newGame);

  /* ---------- boot ---------- */
  document.body.classList.add('felt-green', 'dice-classic');
  startTurn();
})();
