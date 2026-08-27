// UI screens: connect, lobby, results, leaderboard — retro 80s pixel aesthetic
// Each screen is a div toggled by showScreen(). All DOM is created once.

const MAP_INFO = {
  neon_circuit:   { name: 'Neon Circuit',   difficulty: 'EASY',   laps: 3, color: '#f0f' },
  desert_drift:   { name: 'Desert Drift',   difficulty: 'MEDIUM', laps: 2, color: '#fa0' },
  cyber_highway:  { name: 'Cyber Highway',  difficulty: 'HARD',   laps: 2, color: '#0ff' },
};

let screens = {};
let currentScreen = null;
let _onConnect, _onCreateRoom, _onJoinRoom, _onReady, _onMapSelect, _onBackToMenu, _onDisconnect;

export function createUI() {
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);

  screens.connect = buildConnectScreen();
  screens.lobby = buildLobbyScreen();
  screens.countdown = buildCountdownScreen();
  screens.results = buildResultsScreen();
  screens.leaderboard = buildLeaderboardScreen();

  for (const s of Object.values(screens)) {
    s.style.display = 'none';
    root.appendChild(s);
  }
}

export function showScreen(name) {
  for (const [k, s] of Object.entries(screens)) {
    s.style.display = k === name ? 'flex' : 'none';
  }
  currentScreen = name;
}

export function hideAllScreens() {
  for (const s of Object.values(screens)) s.style.display = 'none';
  currentScreen = null;
}

export function setCallbacks(cbs) {
  _onConnect = cbs.onConnect;
  _onCreateRoom = cbs.onCreateRoom;
  _onJoinRoom = cbs.onJoinRoom;
  _onReady = cbs.onReady;
  _onMapSelect = cbs.onMapSelect;
  _onBackToMenu = cbs.onBackToMenu;
  _onDisconnect = cbs.onDisconnect;
}

// ---- Connect Screen ----
function buildConnectScreen() {
  const d = mkScreen();
  d.innerHTML = `
    <h1 class="ui-title">NEON CIRCUIT</h1>
    <div class="ui-subtitle">MULTIPLAYER RACING 198X</div>
    <div class="ui-form">
      <label class="ui-label">SERVER</label>
      <input class="ui-input" id="ui-host" value="localhost:8080" spellcheck="false">
      <label class="ui-label">YOUR NAME</label>
      <input class="ui-input" id="ui-name" value="" maxlength="16" placeholder="PLAYER" spellcheck="false">
      <button class="ui-btn ui-btn-primary" id="ui-connect-btn">CONNECT</button>
      <button class="ui-btn" id="ui-leaderboard-btn">LEADERBOARD</button>
      <div class="ui-error" id="ui-connect-error"></div>
    </div>
    <div class="ui-controls-hint">WASD / ARROWS — STEER & ACCEL &nbsp; SPACE — DRIFT &nbsp; TAB — CRT &nbsp; M — MUTE</div>
  `;
  d.querySelector('#ui-connect-btn').onclick = () => {
    const host = d.querySelector('#ui-host').value.trim();
    const name = d.querySelector('#ui-name').value.trim() || 'PLAYER';
    if (_onConnect) _onConnect(host, name);
  };
  d.querySelector('#ui-leaderboard-btn').onclick = () => {
    if (_onBackToMenu) _onBackToMenu('leaderboard');
  };
  return d;
}

export function showConnectError(msg) {
  const el = document.getElementById('ui-connect-error');
  if (el) { el.textContent = msg; el.style.opacity = 1; }
}

export function clearConnectError() {
  const el = document.getElementById('ui-connect-error');
  if (el) { el.textContent = ''; el.style.opacity = 0; }
}

// ---- Lobby Screen ----
function buildLobbyScreen() {
  const d = mkScreen();
  d.innerHTML = `
    <h2 class="ui-heading">LOBBY</h2>
    <div class="ui-lobby-cols">
      <div class="ui-lobby-left">
        <div class="ui-label">PLAYERS <span id="ui-player-count">0</span></div>
        <div class="ui-player-list" id="ui-player-list"></div>
        <button class="ui-btn ui-btn-accent" id="ui-ready-btn">READY</button>
        <button class="ui-btn ui-btn-small" id="ui-disconnect-btn">DISCONNECT</button>
      </div>
      <div class="ui-lobby-right">
        <div class="ui-label">SELECT MAP</div>
        <div class="ui-map-grid" id="ui-map-grid"></div>
      </div>
    </div>
    <div class="ui-lobby-status" id="ui-lobby-status"></div>
  `;
  // map thumbnails
  const grid = d.querySelector('#ui-map-grid');
  for (const [key, info] of Object.entries(MAP_INFO)) {
    const card = document.createElement('div');
    card.className = 'ui-map-card';
    card.dataset.map = key;
    card.innerHTML = `
      <div class="ui-map-thumb" style="border-color:${info.color}">${info.name.charAt(0)}</div>
      <div class="ui-map-name">${info.name}</div>
      <div class="ui-map-diff" style="color:${info.color}">${info.difficulty} · ${info.laps}L</div>
    `;
    card.onclick = () => { if (_onMapSelect) _onMapSelect(key, info.laps); };
    grid.appendChild(card);
  }
  d.querySelector('#ui-ready-btn').onclick = () => { if (_onReady) _onReady(); };
  d.querySelector('#ui-disconnect-btn').onclick = () => { if (_onDisconnect) _onDisconnect(); };
  return d;
}

export function updateLobby(state) {
  // state: { players: [{id,name,ready,color}], map, maxLaps, roomName }
  const list = document.getElementById('ui-player-list');
  const count = document.getElementById('ui-player-count');
  const status = document.getElementById('ui-lobby-status');
  if (!list) return;

  count.textContent = state.players.length;
  list.innerHTML = state.players.map(p => {
    const c = p.color ? `rgb(${(p.color[0]*255)|0},${(p.color[1]*255)|0},${(p.color[2]*255)|0})` : '#0ff';
    return `<div class="ui-player-row">
      <span class="ui-player-dot" style="background:${c}"></span>
      <span class="ui-player-name">${esc(p.name)}</span>
      <span class="ui-player-ready">${p.ready ? '✓ READY' : 'WAITING'}</span>
    </div>`;
  }).join('');

  // highlight selected map
  const cards = document.querySelectorAll('.ui-map-card');
  for (const card of cards) {
    card.classList.toggle('selected', card.dataset.map === state.map);
  }

  const allReady = state.players.length > 0 && state.players.every(p => p.ready);
  status.textContent = allReady ? 'ALL READY — STARTING...' : `WAITING FOR ${state.players.filter(p=>!p.ready).length} PLAYER(S)`;
  status.style.color = allReady ? '#ff0' : '#888';
}

// ---- Countdown Screen ----
function buildCountdownScreen() {
  const d = mkScreen();
  d.innerHTML = `<div class="ui-countdown" id="ui-countdown-num">3</div>`;
  return d;
}

export function showCountdown(n) {
  showScreen('countdown');
  const el = document.getElementById('ui-countdown-num');
  if (el) {
    el.textContent = n === 0 ? 'GO!' : n;
    el.style.color = n === 0 ? '#0f0' : '#ff0';
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = 'countPop .6s ease-out';
  }
}

// ---- Results Screen ----
function buildResultsScreen() {
  const d = mkScreen();
  d.innerHTML = `
    <h2 class="ui-heading" style="color:#ff0">RACE RESULTS</h2>
    <div class="ui-results-table" id="ui-results-table"></div>
    <div class="ui-results-footer">
      <span id="ui-results-timer">RETURNING TO LOBBY IN 10...</span>
    </div>
  `;
  return d;
}

export function showResults(results, mapName) {
  showScreen('results');
  const table = document.getElementById('ui-results-table');
  if (!table) return;
  table.innerHTML = `
    <div class="ui-results-map">${mapName || ''}</div>
    ${results.map((r, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${r.position}`;
      const time = formatMs(r.finishTime);
      const delay = i * 0.3;
      return `<div class="ui-result-row" style="animation-delay:${delay}s">
        <span class="ui-result-pos">${medal}</span>
        <span class="ui-result-name">${esc(r.playerName)}</span>
        <span class="ui-result-time">${time}</span>
      </div>`;
    }).join('')}
  `;
  // countdown to lobby
  let t = 10;
  const timer = document.getElementById('ui-results-timer');
  const iv = setInterval(() => {
    t--;
    if (timer) timer.textContent = t > 0 ? `RETURNING TO LOBBY IN ${t}...` : '';
    if (t <= 0) clearInterval(iv);
  }, 1000);
}

// ---- Leaderboard Screen ----
function buildLeaderboardScreen() {
  const d = mkScreen();
  d.innerHTML = `
    <h2 class="ui-heading" style="color:#0ff">LEADERBOARD</h2>
    <div class="ui-lb-tabs" id="ui-lb-tabs"></div>
    <div class="ui-lb-table" id="ui-lb-table"></div>
    <div class="ui-lb-loading" id="ui-lb-loading">LOADING...</div>
    <button class="ui-btn" id="ui-lb-back">BACK</button>
  `;
  d.querySelector('#ui-lb-back').onclick = () => { showScreen('connect'); };
  return d;
}

export function showLeaderboard(host) {
  showScreen('leaderboard');
  const loading = document.getElementById('ui-lb-loading');
  const table = document.getElementById('ui-lb-table');
  const tabs = document.getElementById('ui-lb-tabs');
  if (loading) loading.style.display = 'block';
  if (table) table.innerHTML = '';

  const url = `http://${host || 'localhost:8080'}/results`;
  fetch(url).then(r => r.json()).then(data => {
    if (loading) loading.style.display = 'none';
    // group by map
    const byMap = {};
    for (const r of data) {
      if (!byMap[r.map]) byMap[r.map] = [];
      byMap[r.map].push(r);
    }
    // sort each map's results by time
    for (const k of Object.keys(byMap)) {
      byMap[k].sort((a, b) => a.finishTime - b.finishTime);
      byMap[k] = byMap[k].slice(0, 10); // top 10
    }
    const maps = Object.keys(byMap);
    if (maps.length === 0) {
      if (table) table.innerHTML = '<div class="ui-lb-empty">NO RESULTS YET</div>';
      return;
    }
    // tabs
    if (tabs) {
      tabs.innerHTML = maps.map((m, i) =>
        `<button class="ui-lb-tab ${i===0?'active':''}" data-map="${m}">${(MAP_INFO[m]?.name || m).toUpperCase()}</button>`
      ).join('');
      tabs.querySelectorAll('.ui-lb-tab').forEach(btn => {
        btn.onclick = () => {
          tabs.querySelectorAll('.ui-lb-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderLBTable(byMap[btn.dataset.map], table);
        };
      });
    }
    renderLBTable(byMap[maps[0]], table);
  }).catch(() => {
    if (loading) { loading.textContent = 'COULD NOT LOAD — IS THE SERVER RUNNING?'; }
  });
}

function renderLBTable(entries, el) {
  if (!el) return;
  el.innerHTML = entries.map((r, i) => `
    <div class="ui-lb-row">
      <span class="ui-lb-rank">#${i + 1}</span>
      <span class="ui-lb-name">${esc(r.playerName)}</span>
      <span class="ui-lb-time">${formatMs(r.finishTime)}</span>
      <span class="ui-lb-date">${new Date(r.date).toLocaleDateString()}</span>
    </div>
  `).join('');
}

// ---- Helpers ----
function mkScreen() {
  const d = document.createElement('div');
  d.className = 'ui-screen';
  return d;
}
function esc(s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function formatMs(ms) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const frac = Math.floor(ms % 1000);
  return `${m}:${String(sec).padStart(2,'0')}.${String(frac).padStart(3,'0')}`;
}
