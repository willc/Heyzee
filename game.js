/* Heyzee — game controller */
(function () {
  const { CATEGORIES, UPPER_IDS, UPPER_FACE, scoreCategory, counts,
    isYahtzeeDice, jokerActive, legalCategories } = HeyzeeScore;

  const state = {
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollsLeft: 3,
    hasRolled: false,
    current: 0,               // 0 = you, 1 = opponent
    cards: [{}, {}],
    yahtzeeBonus: [0, 0],
    muted: false,
    busy: false,
    youName: localStorage.getItem('heyzee_name') || 'You',
    aiName: HeyzeeAI.aiRandomName(),
    best: parseInt(localStorage.getItem('heyzee_best') || '0', 10) || 0,
  };
  for (const c of CATEGORIES) { state.cards[0][c.id] = null; state.cards[1][c.id] = null; }

  const $ = (id) => document.getElementById(id);
  const tray = $('diceTray');
  const rollBtn = $('rollBtn');
  const statusEl = $('status');
  const cardEl = $('scorecard');

  /* ---------- audio: synthesized dice clatter (filtered noise bursts) ---------- */
  let ac = null;
  function ctx() {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function clack(when, dur, freq, gain) {
    const c = ac, sr = c.sampleRate, n = Math.max(1, Math.floor(sr * dur));
    const buf = c.createBuffer(1, n, sr), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n); // decaying noise
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(when); src.stop(when + dur);
  }
  function sndRoll() {
    if (state.muted) return;
    try {
      const c = ctx(), t = c.currentTime;
      // a rattle: several clacks scattered over ~0.45s, then a settling pair
      for (let i = 0; i < 7; i++) clack(t + Math.random() * 0.42, 0.05 + Math.random() * 0.05, 1400 + Math.random() * 2200, 0.10 + Math.random() * 0.08);
      clack(t + 0.46, 0.09, 900, 0.14);
      clack(t + 0.5, 0.07, 1600, 0.10);
    } catch (e) { /* no audio */ }
  }
  function sndHold() {
    if (state.muted) return;
    try { const c = ctx(); clack(c.currentTime, 0.05, 2600, 0.10); } catch (e) {}
  }
  function sndScore() {
    if (state.muted) return;
    try {
      const c = ctx(), o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(660, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(990, c.currentTime + 0.12);
      g.gain.setValueAtTime(0.07, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.22);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.22);
    } catch (e) {}
  }

  /* ---------- dice ---------- */
  function setDieFace(el, face) {
    el.dataset.face = String(face);
    el.innerHTML = '';
    for (let p = 0; p < face; p++) { const s = document.createElement('span'); s.className = 'pip'; el.appendChild(s); }
  }
  function renderDice() {
    tray.innerHTML = '';
    state.dice.forEach((val, i) => {
      const die = document.createElement('div');
      die.className = 'die' + (state.held[i] ? ' held' : '');
      if (state.current !== 0 || !state.hasRolled || state.busy) die.classList.add('disabled');
      setDieFace(die, val);
      die.addEventListener('click', () => toggleHold(i));
      tray.appendChild(die);
    });
  }
  /* Spin non-held dice through random faces, then settle on the real values. */
  function animateRoll(finalDice, heldMask, done) {
    const dice = [...tray.children];
    dice.forEach((d, i) => { if (!heldMask[i]) d.classList.add('rolling'); });
    let elapsed = 0; const dur = 520, tick = 55;
    const iv = setInterval(() => {
      dice.forEach((d, i) => { if (!heldMask[i]) setDieFace(d, 1 + Math.floor(Math.random() * 6)); });
      elapsed += tick;
      if (elapsed >= dur) {
        clearInterval(iv);
        dice.forEach((d, i) => { if (!heldMask[i]) { setDieFace(d, finalDice[i]); d.classList.remove('rolling'); } });
        done && done();
      }
    }, tick);
  }

  function toggleHold(i) {
    if (state.busy || state.current !== 0 || !state.hasRolled || state.rollsLeft === 0) return;
    state.held[i] = !state.held[i];
    sndHold();
    renderDice();
  }

  function humanRoll() {
    if (state.busy || state.current !== 0 || state.rollsLeft === 0) return;
    state.busy = true;
    const final = state.dice.map((d, i) => (state.held[i] ? d : 1 + Math.floor(Math.random() * 6)));
    state.rollsLeft--;
    state.hasRolled = true;
    sndRoll();
    updateControls();
    animateRoll(final, state.held, () => {
      state.dice = final;
      state.busy = false;
      renderDice(); renderCard(); updateControls(); updateStatus();
    });
  }

  /* ---------- scoring / turn flow ---------- */
  function upperTotal(card) { return UPPER_IDS.reduce((t, id) => t + (card[id] || 0), 0); }
  function upperBonus(card) { return upperTotal(card) >= 63 ? 35 : 0; }
  function upperSection(card) { return upperTotal(card) + upperBonus(card); }
  function lowerTotal(p) {
    const card = state.cards[p];
    let lower = 0;
    for (const c of CATEGORIES) if (c.section === 'lower' && card[c.id] != null) lower += card[c.id];
    return lower + state.yahtzeeBonus[p];
  }
  function grandTotal(p) { return upperSection(state.cards[p]) + lowerTotal(p); }

  function commitScore(p, catId) {
    const joker = jokerActive(state.dice, state.cards[p]);
    // Heyzee bonus: extra five-of-a-kind after a scored 50 in the Heyzee box
    if (isYahtzeeDice(state.dice) && state.cards[p].yahtzee === 50) state.yahtzeeBonus[p] += 100;
    state.cards[p][catId] = scoreCategory(catId, state.dice, joker);
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
    state.busy = state.current === 1; // set before UI updates so controls reflect it
    renderDice(); renderCard(); updateControls(); setActivePlayer();
    if (state.current === 1) {
      statusEl.textContent = `${state.aiName} is thinking…`;
      setTimeout(aiTurn, 700);
    } else {
      statusEl.textContent = 'Your turn — roll the dice.';
    }
  }

  function isGameOver() {
    return [0, 1].every((p) => CATEGORIES.every((c) => state.cards[p][c.id] != null));
  }

  /* ---------- opponent turn ---------- */
  function aiTurn() {
    const card = state.cards[1];
    const final0 = state.dice.map(() => 1 + Math.floor(Math.random() * 6));
    state.hasRolled = true;
    sndRoll();
    animateRoll(final0, [false, false, false, false, false], () => {
      state.dice = final0;
      renderDice();
      let rolls = 2;
      const step = () => {
        const hold = HeyzeeAI.aiChooseHold(state.dice, card);
        state.held = hold; renderDice();
        if (rolls > 0 && !hold.every(Boolean)) {
          rolls--;
          setTimeout(() => {
            const nxt = state.dice.map((d, i) => (hold[i] ? d : 1 + Math.floor(Math.random() * 6)));
            sndRoll();
            animateRoll(nxt, hold, () => { state.dice = nxt; renderDice(); setTimeout(step, 550); });
          }, 500);
        } else {
          const catId = HeyzeeAI.aiChooseCategory(state.dice, card);
          commitScore(1, catId); renderCard();
          setTimeout(endTurn, 750);
        }
      };
      setTimeout(step, 600);
    });
  }

  /* ---------- scorecard ---------- */
  function renderCard() {
    const active = state.current === 0 && state.hasRolled && !state.busy;
    const legal = active ? legalCategories(state.dice, state.cards[0]) : [];
    const joker = active && jokerActive(state.dice, state.cards[0]);
    const you = escapeHtml(state.youName), ai = escapeHtml(state.aiName);
    const rows = [];
    const cardY = state.cards[0], cardA = state.cards[1];
    const sub = (label, vy, va, cls) => `<tr class="subtotal${cls ? ' ' + cls : ''}"><td>${label}</td><td class="val">${vy}</td><td class="val">${va}</td></tr>`;

    rows.push(`<tr><th>Upper</th><th class="num name" title="${you}">${you}</th><th class="num name" title="${ai}">${ai}</th></tr>`);
    for (const c of CATEGORIES.filter((x) => x.section === 'upper')) rows.push(catRow(c, active, legal, joker));
    const uY = upperTotal(cardY), uA = upperTotal(cardA);
    rows.push(sub('Upper subtotal', uY, uA));
    rows.push(sub('Bonus (63+)', uY >= 63 ? '+35' : `${uY}/63`, uA >= 63 ? '+35' : `${uA}/63`));
    rows.push(sub('Upper total', upperSection(cardY), upperSection(cardA), 'total'));

    rows.push(`<tr><th>Lower</th><th class="num"></th><th class="num"></th></tr>`);
    for (const c of CATEGORIES.filter((x) => x.section === 'lower')) rows.push(catRow(c, active, legal, joker));
    rows.push(sub('Heyzee bonus', state.yahtzeeBonus[0], state.yahtzeeBonus[1]));
    rows.push(sub('Lower total', lowerTotal(0), lowerTotal(1), 'total'));

    rows.push(sub('Grand total', grandTotal(0), grandTotal(1), 'grand'));
    cardEl.innerHTML = rows.join('');
    cardEl.querySelectorAll('tr.cat.open-you td.val').forEach((td) => {
      td.addEventListener('click', () => {
        if (state.current !== 0 || !state.hasRolled || state.busy) return;
        if (!legalCategories(state.dice, state.cards[0]).includes(td.dataset.cat)) return;
        commitScore(0, td.dataset.cat); endTurn();
      });
    });
  }

  function catRow(c, active, legal, joker) {
    const you = state.cards[0][c.id];
    const ai = state.cards[1][c.id];
    const open = you == null;
    let cls = 'cat', youCell;
    if (open && active) {
      const clickable = legal.includes(c.id);
      cls += clickable ? ' open-you' : ' open-locked';
      youCell = `<td class="val" data-cat="${c.id}">${scoreCategory(c.id, state.dice, joker)}</td>`;
    } else if (open) {
      youCell = `<td class="val">–</td>`;
    } else {
      cls += ' used';
      youCell = `<td class="val">${you}</td>`;
    }
    return `<tr class="${cls}"><td class="catname">${c.name}</td>${youCell}<td class="aival">${ai == null ? '–' : ai}</td></tr>`;
  }

  /* ---------- misc UI ---------- */
  function updateStatus() {
    if (state.current !== 0) return;
    if (!state.hasRolled) { statusEl.textContent = 'Your turn — roll the dice.'; return; }
    if (jokerActive(state.dice, state.cards[0])) {
      const legal = legalCategories(state.dice, state.cards[0]);
      const upperId = UPPER_IDS[state.dice[0] - 1];
      if (legal.length === 1 && legal[0] === upperId) {
        statusEl.textContent = `Heyzee joker! Forced into ${CATEGORIES.find((c) => c.id === upperId).name}.`;
      } else if (legal[0] && CATEGORIES.find((c) => c.id === legal[0]).section === 'lower') {
        statusEl.textContent = 'Heyzee joker! Score it in any open lower box.';
      } else {
        statusEl.textContent = 'Heyzee joker! No lower boxes left — take a zero up top.';
      }
      return;
    }
    statusEl.textContent = state.rollsLeft > 0 ? `Roll again or pick a box. (${state.rollsLeft} left)` : 'Last roll — pick a box.';
  }
  function updateControls() {
    rollBtn.disabled = state.current !== 0 || state.rollsLeft === 0 || state.busy;
    $('rollsLeft').textContent = `Rolls left: ${state.rollsLeft}`;
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

  function renderBest() {
    $('bestScore').textContent = `Best: ${state.best || '—'}`;
  }

  function finishGame() {
    updateTotals();
    const you = grandTotal(0), ai = grandTotal(1);
    const t = you > ai ? 'You win! 🎉' : you < ai ? `${state.aiName} wins` : "It's a tie";
    const newBest = you > state.best;
    if (newBest) {
      state.best = you;
      localStorage.setItem('heyzee_best', String(you));
      renderBest();
      const b = $('bestScore'); b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 2500);
    }
    $('overlayTitle').textContent = t;
    $('overlayBody').innerHTML = `${escapeHtml(state.youName)} ${you} — ${escapeHtml(state.aiName)} ${ai}`
      + (newBest ? `<br><span style="color:var(--accent);font-weight:700">🏆 New personal best!</span>`
        : state.best ? `<br><span style="color:var(--ink-dim)">Best: ${state.best}</span>` : '');
    $('overlay').classList.remove('hidden');
  }

  function newGame() {
    for (const c of CATEGORIES) { state.cards[0][c.id] = null; state.cards[1][c.id] = null; }
    state.yahtzeeBonus = [0, 0];
    state.current = 0;
    state.dice = [1, 1, 1, 1, 1];
    state.aiName = HeyzeeAI.aiRandomName();
    $('aiNameLabel').textContent = state.aiName;
    $('overlay').classList.add('hidden');
    updateTotals();
    startTurn();
  }

  /* ---------- helpers ---------- */
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

  /* ---------- name input ---------- */
  const youNameInput = $('youName');
  youNameInput.value = state.youName;
  youNameInput.addEventListener('input', () => {
    state.youName = youNameInput.value.trim() || 'You';
    localStorage.setItem('heyzee_name', state.youName);
    renderCard();
  });
  youNameInput.addEventListener('blur', () => { if (!youNameInput.value.trim()) youNameInput.value = 'You'; });
  youNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') youNameInput.blur(); });

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
  $('aiNameLabel').textContent = state.aiName;
  renderBest();
  startTurn();
})();
