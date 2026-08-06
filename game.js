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
    difficulty: localStorage.getItem('heyzee_diff') || 'medium',
    stats: loadStats(),
    armed: null,
    gameOver: false,
  };
  if (!HeyzeeAI.SKILL[state.difficulty]) state.difficulty = 'medium';

  function loadStats() {
    const base = { games: 0, wins: 0, losses: 0, ties: 0, heyzees: 0, upperBonuses: 0, totalScore: 0, streak: 0, bestStreak: 0 };
    try { return Object.assign(base, JSON.parse(localStorage.getItem('heyzee_stats') || '{}')); }
    catch (e) { return base; }
  }
  function saveStats() { localStorage.setItem('heyzee_stats', JSON.stringify(state.stats)); }
  for (const c of CATEGORIES) { state.cards[0][c.id] = null; state.cards[1][c.id] = null; }

  const $ = (id) => document.getElementById(id);
  const tray = $('diceTray');
  const rollBtn = $('rollBtn');
  const statusEl = $('status');
  const cardEl = $('scorecard');

  /* ---------- audio: synthesized dice clatter (filtered noise bursts) ---------- */
  const MASTER_VOL = 2.6; // overall loudness multiplier
  let ac = null, master = null;
  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = MASTER_VOL;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function out() { return master; } // route sounds through the master gain
  // One dice impact: a short noise burst through a resonant (high-Q) bandpass at a
  // low, woody frequency, then a lowpass to remove the hiss — reads as a hollow knock.
  function clack(when, dur, freq, gain) {
    const c = ac, sr = c.sampleRate, n = Math.max(1, Math.floor(sr * dur));
    const buf = c.createBuffer(1, n, sr), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2); // sharp, fast-decaying transient
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.5 + Math.random() * 2.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500; // tame only the harshest hiss
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out());
    src.start(when); src.stop(when + dur);
  }
  function sndRoll() {
    if (state.muted) return;
    try {
      const c = ctx(), t = c.currentTime;
      // a chaotic tumble: knocks scattered at random times, with wide pitch/level variation
      const hits = 8 + Math.floor(Math.random() * 4);
      for (let i = 0; i < hits; i++) {
        const when = t + Math.random() * 0.46;         // random scatter = different every roll
        const freq = 380 + Math.random() * 900;        // wide woody pitch spread (audible mids)
        const dur = 0.03 + Math.random() * 0.05;
        const gain = 0.14 + Math.random() * 0.20;      // dynamic: some soft, some loud
        clack(when, dur, freq, gain);
      }
      // dice settling onto the felt: softer, lower thuds (slightly randomized too)
      clack(t + 0.40 + Math.random() * 0.06, 0.08, 300 + Math.random() * 80, 0.30);
      clack(t + 0.48 + Math.random() * 0.06, 0.09, 250 + Math.random() * 70, 0.26);
    } catch (e) { /* no audio */ }
  }
  function sndHold() {
    if (state.muted) return;
    try { const c = ctx(); clack(c.currentTime, 0.03, 950, 0.26); } catch (e) {}
  }
  function sndScore() {
    if (state.muted) return;
    try {
      const c = ctx(), o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(660, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(990, c.currentTime + 0.12);
      g.gain.setValueAtTime(0.07, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.22);
      o.connect(g); g.connect(out()); o.start(); o.stop(c.currentTime + 0.22);
    } catch (e) {}
  }

  function sndHeyzee() {
    if (state.muted) return;
    try {
      const c = ctx(), notes = [523, 659, 784, 1047, 1319];
      notes.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.085;
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g); g.connect(out()); o.start(t); o.stop(t + 0.32);
      });
    } catch (e) {}
  }

  // One melody note with an attack/decay envelope and an optional pitch bend (for the sad droop).
  function note(freq, start, dur, type, peak, bendTo) {
    const c = ctx(), t = c.currentTime + start;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (bendTo) o.frequency.exponentialRampToValueAtTime(bendTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out()); o.start(t); o.stop(t + dur + 0.03);
  }
  // Bright, triumphant major fanfare climbing to a held C-major chord.
  function sndWin() {
    if (state.muted) return;
    try {
      [[392, 0, 0.14], [523, 0.13, 0.14], [659, 0.26, 0.14], [784, 0.39, 0.18], [1046, 0.55, 0.5]]
        .forEach(([f, s, d]) => note(f, s, d, 'triangle', 0.11));
      [523, 659, 784].forEach((f) => note(f, 0.62, 0.95, 'triangle', 0.05)); // C major chord
    } catch (e) {}
  }
  // Slow descending minor line with a drooping final note + low chord (sad-trombone feel).
  function sndLose() {
    if (state.muted) return;
    try {
      [[659, 0, 0.3], [587, 0.32, 0.3], [523, 0.64, 0.34]]
        .forEach(([f, s, d]) => note(f, s, d, 'sawtooth', 0.07));
      note(440, 1.02, 0.85, 'sawtooth', 0.075, 415.3); // final note droops A -> G#
      [220, 261.6, 311.1].forEach((f) => note(f, 1.02, 0.95, 'sine', 0.05)); // low A-minor-ish chord
    } catch (e) {}
  }

  /* ---------- fireworks celebration (~2.6s) ---------- */
  let fwActive = false;
  function launchFireworks() {
    const canvas = $('fireworks');
    if (!canvas || fwActive) return;
    fwActive = true;
    const cx2d = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width = window.innerWidth * dpr;
    const H = canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const palette = ['#e8c37e', '#ff5964', '#7ad19a', '#ffd93d', '#6ec6ff', '#ff9de2'];
    let particles = [];
    const burst = () => {
      const bx = W * (0.18 + Math.random() * 0.64), by = H * (0.12 + Math.random() * 0.42);
      const n = 46, base = palette[Math.floor(Math.random() * palette.length)];
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2, sp = (2 + Math.random() * 3.2) * dpr;
        particles.push({ x: bx, y: by, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 1, decay: 0.011 + Math.random() * 0.012, size: (1.4 + Math.random() * 2) * dpr,
          color: Math.random() < 0.28 ? '#ffffff' : base });
      }
    };
    const start = performance.now(), burstUntil = 2200; let lastBurst = 0;
    burst();
    const frame = (now) => {
      const t = now - start;
      cx2d.clearRect(0, 0, W, H);
      if (t < burstUntil && now - lastBurst > 300) { burst(); lastBurst = now; }
      for (const p of particles) { p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.05 * dpr; p.x += p.vx; p.y += p.vy; p.life -= p.decay; }
      particles = particles.filter((p) => p.life > 0);
      for (const p of particles) {
        cx2d.globalAlpha = Math.max(0, p.life);
        cx2d.fillStyle = p.color;
        cx2d.beginPath(); cx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2); cx2d.fill();
      }
      cx2d.globalAlpha = 1;
      if (t < burstUntil || particles.length) requestAnimationFrame(frame);
      else { cx2d.clearRect(0, 0, W, H); fwActive = false; }
    };
    requestAnimationFrame(frame);
  }
  function celebrateHeyzee() { launchFireworks(); sndHeyzee(); }

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
    renderDice(); updateControls(); updateStatus();
  }

  function allHeld() { return state.hasRolled && state.held.every(Boolean); }

  function humanRoll() {
    if (state.busy || state.current !== 0 || state.rollsLeft === 0 || allHeld()) return;
    if (!state.hasRolled) $('lastMove').textContent = ''; // clear on your first roll of the turn
    state.armed = null; // rerolling clears any pending score selection
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
      if (isYahtzeeDice(final)) celebrateHeyzee();
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
    const gotBonus = isYahtzeeDice(state.dice) && state.cards[p].yahtzee === 50;
    if (gotBonus) state.yahtzeeBonus[p] += 100;
    const score = scoreCategory(catId, state.dice, joker);
    state.cards[p][catId] = score;
    if (p === 0 && isYahtzeeDice(state.dice)) { state.stats.heyzees++; saveStats(); }
    if (p === 1 && isYahtzeeDice(state.dice)) celebrateHeyzee(); // human already celebrates on the roll
    sndScore();
    showMove(p, catId, score, gotBonus);
  }

  function showMove(p, catId, score, gotBonus) {
    const name = p === 0 ? state.youName : state.aiName;
    const catName = CATEGORIES.find((c) => c.id === catId).name;
    const bonus = gotBonus ? ' (+100 Heyzee bonus!)' : '';
    const el = $('lastMove');
    el.textContent = `${name} scored ${score} in ${catName}${bonus}`;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
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
    state.armed = null;
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
    $('lastMove').textContent = ''; // clear on the AI's first roll of the turn
    const final0 = state.dice.map(() => 1 + Math.floor(Math.random() * 6));
    state.hasRolled = true;
    sndRoll();
    animateRoll(final0, [false, false, false, false, false], () => {
      state.dice = final0;
      renderDice();
      let rolls = 2;
      const step = () => {
        const hold = HeyzeeAI.aiChooseHold(state.dice, card, state.difficulty);
        state.held = hold; renderDice();
        if (rolls > 0 && !hold.every(Boolean)) {
          rolls--;
          setTimeout(() => {
            const nxt = state.dice.map((d, i) => (hold[i] ? d : 1 + Math.floor(Math.random() * 6)));
            sndRoll();
            animateRoll(nxt, hold, () => { state.dice = nxt; renderDice(); setTimeout(step, 550); });
          }, 500);
        } else {
          const catId = HeyzeeAI.aiChooseCategory(state.dice, card, state.difficulty);
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
    // First tap arms a box (reveals Submit); tapping it again cancels.
    cardEl.querySelectorAll('tr.cat.open-you td.val').forEach((td) => {
      td.addEventListener('click', () => {
        if (state.current !== 0 || !state.hasRolled || state.busy) return;
        if (!legalCategories(state.dice, state.cards[0]).includes(td.dataset.cat)) return;
        state.armed = state.armed === td.dataset.cat ? null : td.dataset.cat;
        renderCard(); updateStatus();
      });
    });
    // Submit commits the armed box.
    cardEl.querySelectorAll('.submit-score').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.current !== 0 || !state.hasRolled || state.busy) return;
        const cat = btn.dataset.cat;
        if (!legalCategories(state.dice, state.cards[0]).includes(cat)) return;
        state.armed = null;
        commitScore(0, cat); endTurn();
      });
    });
  }

  function catRow(c, active, legal, joker) {
    const you = state.cards[0][c.id];
    const ai = state.cards[1][c.id];
    const open = you == null;
    let cls = 'cat', youCell, nameCell = `<td class="catname">${c.name}</td>`;
    if (open && active) {
      const clickable = legal.includes(c.id);
      const armed = state.armed === c.id;
      cls += clickable ? ' open-you' : ' open-locked';
      if (armed) {
        cls += ' armed';
        nameCell = `<td class="catname">${c.name}<button class="submit-score" data-cat="${c.id}">Submit</button></td>`;
      }
      youCell = `<td class="val" data-cat="${c.id}">${scoreCategory(c.id, state.dice, joker)}</td>`;
    } else if (open) {
      youCell = `<td class="val">–</td>`;
    } else {
      cls += ' used';
      youCell = `<td class="val">${you}</td>`;
    }
    return `<tr class="${cls}">${nameCell}${youCell}<td class="aival">${ai == null ? '–' : ai}</td></tr>`;
  }

  /* ---------- misc UI ---------- */
  function updateStatus() {
    if (state.current !== 0) return;
    if (!state.hasRolled) { statusEl.textContent = 'Your turn — roll the dice.'; return; }
    if (state.armed) {
      const joker = jokerActive(state.dice, state.cards[0]);
      const nm = CATEGORIES.find((c) => c.id === state.armed).name;
      statusEl.textContent = `Tap Submit to score ${scoreCategory(state.armed, state.dice, joker)} in ${nm}.`;
      return;
    }
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
    if (allHeld()) { statusEl.textContent = 'All dice held. Pick a box to score.'; return; }
    statusEl.textContent = state.rollsLeft > 0 ? `Roll again or pick a box. (${state.rollsLeft} left)` : 'Last roll — pick a box.';
  }
  function updateControls() {
    rollBtn.disabled = state.current !== 0 || state.rollsLeft === 0 || state.busy || allHeld();
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
    $('bestScore').textContent = `Your personal best: ${state.best || '—'}`;
  }

  function renderStats() {
    const s = state.stats;
    const winRate = s.games ? Math.round((100 * s.wins) / s.games) + '%' : '—';
    const avg = s.games ? Math.round(s.totalScore / s.games) : '—';
    const tile = (num, lbl, cls) => `<div class="stat-tile${cls ? ' ' + cls : ''}"><div class="stat-num">${num}</div><div class="stat-lbl">${lbl}</div></div>`;
    const wide = (num, lbl, cls) => `<div class="stat-tile wide${cls ? ' ' + cls : ''}"><div class="stat-lbl">${lbl}</div><div class="stat-num">${num}</div></div>`;
    $('statsGrid').innerHTML = [
      tile(s.games, 'Games'),
      tile(s.wins, 'Wins', 'accent'),
      tile(s.losses, 'Losses'),
      tile(winRate, 'Win rate', 'accent'),
      tile(s.streak, 'Streak'),
      tile(s.bestStreak, 'Best streak'),
      tile(state.best || '—', 'Best score', 'accent'),
      tile(avg, 'Avg score'),
      tile(s.ties, 'Ties'),
      wide(s.heyzees, 'Heyzees rolled', 'accent'),
      wide(s.upperBonuses, 'Upper bonuses (63+)'),
    ].join('');
  }

  function recordGameStats(you, ai) {
    const s = state.stats;
    s.games++;
    s.totalScore += you;
    if (upperTotal(state.cards[0]) >= 63) s.upperBonuses++;
    if (you > ai) { s.wins++; s.streak++; if (s.streak > s.bestStreak) s.bestStreak = s.streak; }
    else if (you < ai) { s.losses++; s.streak = 0; }
    else { s.ties++; } // a tie neither extends nor breaks a win streak
    saveStats();
  }

  function finishGame() {
    updateTotals();
    const you = grandTotal(0), ai = grandTotal(1);
    recordGameStats(you, ai);
    const won = you > ai, lost = you < ai;
    const t = won ? 'You win! 🎉' : lost ? 'You lose' : "It's a tie";
    if (won) sndWin(); else if (lost) sndLose();
    const newBest = you > state.best;
    if (newBest) {
      state.best = you;
      localStorage.setItem('heyzee_best', String(you));
      renderBest();
      const b = $('bestScore'); b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 2500);
    }
    $('overlayTitle').textContent = t;
    // winner row on top, marked; loser dimmed; tie shows both neutral
    const row = (name, score, cls, crown) =>
      `<div class="result-row ${cls}"><span class="rname">${crown ? '👑 ' : ''}${escapeHtml(name)}</span><span class="rscore">${score}</span></div>`;
    const youCls = won ? 'winner' : lost ? 'loser' : 'tie';
    const aiCls = lost ? 'winner' : won ? 'loser' : 'tie';
    const youRow = row(state.youName, you, youCls, won);
    const aiRow = row(state.aiName, ai, aiCls, lost);
    $('overlayBody').innerHTML =
      (newBest ? `<div class="result-badge">🏆 New personal best!</div>` : '')
      + `<div class="result">${won ? youRow + aiRow : lost ? aiRow + youRow : youRow + aiRow}</div>`;
    state.gameOver = true;
    setGameOverControls(won, lost);
    $('overlay').classList.remove('hidden');
  }

  // Swap the Roll control for a New Game button once the game is over, so the
  // final-score overlay can be dismissed to view the board/stats.
  function setGameOverControls(won, lost) {
    $('rollBtn').classList.add('hidden');
    $('rollsLeft').classList.add('hidden');
    $('newGameCtrl').classList.remove('hidden');
    $('player-you').classList.remove('active');
    $('player-ai').classList.remove('active');
    statusEl.textContent = won ? 'You won! Start a new game when ready.'
      : lost ? `${state.aiName} won. Start a new game when ready.`
      : "It's a tie. Start a new game when ready.";
  }

  function newGame() {
    for (const c of CATEGORIES) { state.cards[0][c.id] = null; state.cards[1][c.id] = null; }
    state.yahtzeeBonus = [0, 0];
    state.current = 0;
    state.dice = [1, 1, 1, 1, 1];
    state.gameOver = false;
    state.aiName = HeyzeeAI.aiRandomName();
    $('aiNameLabel').textContent = state.aiName;
    $('lastMove').textContent = '';
    $('newGameCtrl').classList.add('hidden');
    $('rollBtn').classList.remove('hidden');
    $('rollsLeft').classList.remove('hidden');
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
  const DIFF_ORDER = ['easy', 'medium', 'hard'];
  const DIFF_LABEL = { easy: 'AI: Easy', medium: 'AI: Medium', hard: 'AI: Hard' };
  function renderDifficulty() { $('diffToggle').textContent = DIFF_LABEL[state.difficulty]; }
  $('diffToggle').addEventListener('click', () => {
    const next = DIFF_ORDER[(DIFF_ORDER.indexOf(state.difficulty) + 1) % DIFF_ORDER.length];
    state.difficulty = next;
    localStorage.setItem('heyzee_diff', next);
    renderDifficulty();
  });
  rollBtn.addEventListener('click', humanRoll);
  $('newGameBtn').addEventListener('click', newGame);
  $('newGameCtrl').addEventListener('click', newGame);
  // click the backdrop (outside the modal) to dismiss the final score and view the board
  $('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) $('overlay').classList.add('hidden'); });
  $('statsToggle').addEventListener('click', () => { renderStats(); $('statsOverlay').classList.remove('hidden'); });
  $('statsClose').addEventListener('click', () => $('statsOverlay').classList.add('hidden'));
  $('statsOverlay').addEventListener('click', (e) => { if (e.target === $('statsOverlay')) $('statsOverlay').classList.add('hidden'); });

  /* ---------- boot ---------- */
  document.body.classList.add('felt-green', 'dice-classic');
  $('aiNameLabel').textContent = state.aiName;
  renderBest();
  renderDifficulty();
  startTurn();
})();
