/* Wortschütze — komplett (Deutsch)
   - Spielprinzip: Wörter (Feinde) nähern sich. Tippe Buchstaben (in der richtigen Reihenfolge),
     um Buchstaben vom aktuellen Wort zu entfernen. Vollständig zerstörtes Wort = +5 Punkte.
   - Maximal 15 Feinde auf dem Bildschirm.
   - Bei Berührung: Spiel vorbei. Anzeige + Bestleistung (localStorage).
   - Einstellungen: SFX / Musik an/aus.
   - Alles in einer Datei: WebAudio für Sounds / Musik (kein externes Asset).
*/

(() => {
  // ---- Utils ----
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---- DOM ----
  const screenMenu = $('menu');
  const screenSettings = $('settings');
  const screenGame = $('game');
  const overlay = $('overlay');

  const btnPlay = $('playButton');
  const btnSettings = $('btn-settings');
  const btnBack = $('btn-back');
  const toggleSfx = $('toggle-sfx');
  const toggleMusic = $('toggle-music');

  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');

  const scoreEl = $('score');
  const bestEl = $('best');
  const overlayTitle = $('overlay-title');
  const overlayScore = $('overlay-score');
  const overlayBest = $('overlay-best');
  const btnRestart = $('btn-restart');
  const btnReturn = $('btn-return');

  // ---- Game variables ----
  let W = canvas.width, H = canvas.height;
  function resizeCanvas(){
    // keep logical resolution, canvas auto scales with CSS
    const ratio = canvas.clientWidth / W;
    canvas.style.height = (H * ratio) + 'px';
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  let running = false;
  let gameOver = false;
  let score = 0;
  let best = parseInt(localStorage.getItem('wortschuetze_best') || "0", 10);

  // ---- Player (stationary ship) ----
  const ship = {
    x: W / 2,
    y: H - 70,
    w: 54,
    h: 28
  };

  // ---- Enemy words (German, ASCII-friendly: no ä/ö/ü/ß) ----
  const WORD_BUCKET = {
    easy: ["raum","stern","laser","ziel","wort","schiff","nebel","planet","energie","radar"],
    mid:  ["kosmos","system","angriff","schutz","daten","meteor","lernen","korpus","signal","arbeiten"],
    hard: ["galaxie","sternbild","explosion","quantum","invasion","transmit","resonanz","Weltanschauung"]
  };

  function chooseWordByScore(s) {
    // as score increases, choose harder words
    if (s < 50) return WORD_BUCKET.easy[Math.floor(Math.random()*WORD_BUCKET.easy.length)];
    if (s < 200) {
      const pool = WORD_BUCKET.easy.concat(WORD_BUCKET.mid);
      return pool[Math.floor(Math.random()*pool.length)];
    }
    const pool = WORD_BUCKET.easy.concat(WORD_BUCKET.mid).concat(WORD_BUCKET.hard);
    return pool[Math.floor(Math.random()*pool.length)];
  }

  let enemies = [];
  const MAX_ENEMIES = 8;
  let spawnTimer = 5;
  let spawnInterval = 130; // frames initial
  let baseSpeed = 0.35; // pixels per frame

  // ---- Audio: WebAudio synth for SFX and mellow background ----
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;

  let sfxEnabled = true;
  let musicEnabled = true;

  // simple sound helpers
  function playLaser() {
    if (!audioCtx || !sfxEnabled) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1200, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t);
    o.stop(t + 0.3);
  }

  function playExplosion() {
    if (!audioCtx || !sfxEnabled) return;
    const t = audioCtx.currentTime;
    // noise burst
    const bufferSize = audioCtx.sampleRate * 0.25;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * Math.exp(-3*(i/bufferSize));
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(g);
    g.connect(audioCtx.destination);
    src.start(t);
  }

  // ambient loop (simple pad) — plays if musicEnabled
  let musicNodes = null;
  function startMusic() {
    if (!audioCtx || !musicEnabled || musicNodes) return;
    const t = audioCtx.currentTime;
    const o1 = audioCtx.createOscillator();
    const o2 = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    o1.type = 'sine'; o1.frequency.value = 110;
    o2.type = 'sine'; o2.frequency.value = 220;
    o1.detune.value = -10; o2.detune.value = 9;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 1);
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    o1.connect(filter);
    o2.connect(filter);
    filter.connect(g);
    g.connect(audioCtx.destination);
    o1.start(t);
    o2.start(t);
    // slow pulsing
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.type = 'sine'; lfo.frequency.value = 0.08;
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    lfo.start(t);
    musicNodes = {o1,o2,g,filter,lfo,lfoGain};
  }
  function stopMusic() {
    if (!musicNodes) return;
    try {
      musicNodes.o1.stop(); musicNodes.o2.stop(); musicNodes.lfo.stop();
      musicNodes.g.disconnect(); musicNodes.filter.disconnect();
    } catch(e){}
    musicNodes = null;
  }

  // ---- Input / selection logic ----
  // current target = enemy with largest y (closest to ship), tie-breaker by smallest x distance
  function currentTarget() {
    if (enemies.length === 0) return null;
    let bestE = enemies[0];
    for (let e of enemies) {
      if (e.y > bestE.y) bestE = e;
      else if (e.y === bestE.y) {
        if (Math.abs(e.x - ship.x) < Math.abs(bestE.x - ship.x)) bestE = e;
      }
    }
    return bestE;
  }

  // visual lasers active frames
  let lasers = []; // {x1,y1,x2,y2,ttl}

  // keyboard
  document.addEventListener('keydown', (ev) => {
    if (!running) {
      // if not running and key is Escape, go to menu
      if (ev.code === 'Escape') showMenu();
      return;
    }
    if (ev.key === 'Escape') {
      // pause to menu
      endGameToMenu();
      return;
    }
    // only accept single character letters (a-z)
    const k = ev.key.toLowerCase();
    if (k.length !== 1) return;
    if (k < 'a' || k > 'z') return;
    handleTypedLetter(k);
  });

  function handleTypedLetter(letter) {
  // audio context resume on first key press
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  const target = currentTarget();
  if (!target) return;

  if (target.remaining.length === 0) return;

  const needed = target.remaining.charAt(0).toLowerCase();

  // ✅ BONNE LETTRE
  if (letter === needed) {

    // retirer la première lettre
    target.remaining = target.remaining.substring(1);

    // Laser visuel
    lasers.push({
      x1: ship.x,
      y1: ship.y - 6,
      x2: target.x + target.w / 2,
      y2: target.y + target.h / 2,
      ttl: 10
    });

    playLaser();

    // Mot terminé → explosion + score + suppression du mot
    if (target.remaining.length === 0) {
      playExplosion();
      score += 5;
      enemies = enemies.filter(e => e !== target);
    }

  } 
  // ❌ MAUVAISE LETTRE → pénalité
  else {
    score -= 5;
    if (score < 0) score = 0;
  }
}
  // ---- Spawn / update / draw ----
  function spawnEnemy() {
    if (enemies.length >= MAX_ENEMIES) return;
    const word = chooseWordByScore(score);
    const fontSize = 20 + Math.floor(Math.random()*8);
    const w = Math.max(80, word.length * (fontSize * 0.6));
    const x = 60 + Math.random() * (W - 120 - w);
    const y = -40 - Math.random() * 160;
    enemies.push({
      text: word,
      remaining: word, // remaining letters to destroy
      x: x,
      y: y,
      w: w,
      h: 30,
      speed: baseSpeed + Math.random()*0.4 + Math.min(1.6, score/250) // increases with score
    });
  }

  function update() {
    if (!running || gameOver) return;
    // spawn logic
    spawnTimer++;
    const dynamicInterval = Math.max(30, spawnInterval - Math.floor(score / 8));
    if (spawnTimer >= dynamicInterval) {
      spawnEnemy();
      spawnTimer = 0;
    }

    // move enemies
    for (let e of enemies) {
      e.y += e.speed;
      // If reaches ship (collision)
      if (e.y + e.h >= ship.y - 6) {
        // game over
        gameOver = true;
        running = false;
        endGame();
      }
    }

    // update lasers ttl
    for (let i=lasers.length-1;i>=0;i--){
      lasers[i].ttl--;
      if (lasers[i].ttl <= 0) lasers.splice(i,1);
    }

    // increment score slowly based on time and destroyed words
    score += 0.02; // continuous small increment for survival
    // update HUD
    scoreEl.textContent = `Punkte: ${Math.floor(score)}`;
     bestEl.textContent = `Bestleistung: ${best}`;
  }

  // draw neon style
  function draw() {
    // clear
    ctx.clearRect(0,0,W,H);

    // background: nebula + stars (simple)
    // gradient nebula
    const g = ctx.createLinearGradient(0,0, W, H);
    g.addColorStop(0, '#071022');
    g.addColorStop(0.5, '#0b0830');
    g.addColorStop(1, '#02010a');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // stars
    for (let i=0;i<60;i++){
      const sx = (i*17) % W; // deterministic distribution
      const sy = ( (i*31) % H);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(sx, sy, 1,1);
    }

    // faint nebula blobs
    const ng = ctx.createRadialGradient(W*0.2, H*0.15, 20, W*0.2, H*0.15, 400);
    ng.addColorStop(0, 'rgba(0,255,213,0.06)');
    ng.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ng; ctx.fillRect(0,0,W,H);

    const ng2 = ctx.createRadialGradient(W*0.8, H*0.6, 40, W*0.8, H*0.6, 480);
    ng2.addColorStop(0, 'rgba(255,93,244,0.04)');
    ng2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ng2; ctx.fillRect(0,0,W,H);

    // draw enemies (words)
    enemies.forEach(e => {
      // glow
      ctx.save();
      ctx.shadowColor = 'rgba(255,93,244,0.25)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(e.x-6, e.y-6, e.w+12, e.h+12);
      ctx.restore();

      // word background bar
      ctx.fillStyle = 'rgba(10,10,10,0.35)';
      ctx.fillRect(e.x, e.y, e.w, e.h);

      // draw remaining letters: colored neon for remaining and dim for removed
      const fontSize = 18;
      ctx.font = `${fontSize}px monospace`;
      ctx.textBaseline = 'middle';
      const centerY = e.y + e.h/2;
      // draw removed part (dim)
      const removed = e.text.substring(0, e.text.length - e.remaining.length);
      const remWidth = ctx.measureText(removed).width;
      // draw remaining (neon)
      ctx.fillStyle = 'rgba(180,255,200,0.06)';
      ctx.fillRect(e.x, e.y, remWidth, e.h);

      // draw removed letters (dim)
      ctx.fillStyle = 'rgba(160,190,210,0.28)';
      ctx.fillText(removed, e.x + 8, centerY);

      // draw remaining letters neon
      ctx.save();
      ctx.shadowColor = 'rgba(124,255,107,0.9)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#dfffe7';
      ctx.fillText(e.remaining, e.x + 8 + remWidth, centerY);
      ctx.restore();

      // small progress outline
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.strokeRect(e.x, e.y, e.w, e.h);
    });

    // draw ship (neon)
    ctx.save();
    ctx.translate(ship.x, ship.y);
    // glow
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgba(0,255,213,0.25)';
    ctx.fillStyle = 'rgba(0,255,213,0.9)';
    // simple triangle ship
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(-22, 12);
    ctx.lineTo(22, 12);
    ctx.closePath();
    ctx.fill();
    // cockpit
    ctx.fillStyle = 'rgba(8,8,10,0.8)';
    ctx.fillRect(-8, -6, 16, 8);
    ctx.restore();

    // draw lasers
    lasers.forEach(l => {
      ctx.save();
      ctx.strokeStyle = 'rgba(124,255,107,0.95)';
      ctx.lineWidth = 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
      ctx.restore();
    });

    // if game over overlay drawn by DOM
  }

  // ---- Game flow ----
  function startGame() {
    // reset
    enemies = [];
    lasers = [];
    score = 0;
    spawnTimer = 0;
    gameOver = false;
    running = true;
    // resume audio context if needed
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (musicEnabled) startMusic();
    hideOverlay();
    showScreen('game');
  }

  function endGame() {
    // update best
    const srounded = Math.floor(score);
    if (srounded > best) {
      best = srounded;
      localStorage.setItem('wortschuetze_best', best);
    }
    // show overlay with german text
    overlayTitle.textContent = 'Spiel vorbei';
    overlayScore.textContent = `Punkte: ${srounded}`;
     bestEl.textContent = `Bestleistung: ${best}`;
    showOverlay();
    // stop music?
    stopMusic();
  }

  function showOverlay() {
    overlay.classList.remove('hidden');
  }
  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function endGameToMenu() {
    // stop running and go back to menu
    running = false;
    stopMusic();
    showMenu();
  }

  // menu / settings DOM handlers
  btnPlay.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    startGame();
  });
  btnSettings.addEventListener('click', () => showScreen('settings'));
  btnBack.addEventListener('click', () => showScreen('menu'));
  btnReturn.addEventListener('click', () => {
    hideOverlay();
    showScreen('menu');
  });
  btnRestart.addEventListener('click', () => {
    hideOverlay();
    startGame();
  });

  toggleSfx.addEventListener('change', (e) => {
    sfxEnabled = e.target.checked;
  });
  toggleMusic.addEventListener('change', (e) => {
    musicEnabled = e.target.checked;
    if (musicEnabled) startMusic(); else stopMusic();
  });

  function showScreen(name) {
    [screenMenu, screenSettings, screenGame].forEach(s => s.classList.remove('visible'));
    if (name === 'menu') screenMenu.classList.add('visible');
    if (name === 'settings') screenSettings.classList.add('visible');
    if (name === 'game') screenGame.classList.add('visible');
  }
  showScreen('menu');

  // ---- Main loop ----
  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }
  loop();

  // ---- For polish: initial best display ----
  bestEl.textContent = `Bestleistung: ${best}`;

  // ---- Touch / Mobile tip: resume audio on first tap to permit sounds ----
  ['touchstart','click'].forEach(evt => {
    document.addEventListener(evt, function firstInteract(){
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      document.removeEventListener(evt, firstInteract);
    });
  });

})();








