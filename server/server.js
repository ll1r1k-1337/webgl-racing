// WebSocket multiplayer racing server — lobby, game sync, race lifecycle, results
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const RESULTS_FILE = path.join(__dirname, 'results.json');

// ---- Express app (REST + static files) ----
const app = express();

// Static files live in ../client (sibling directory)
const CLIENT_DIR = path.join(__dirname, '..', 'client');

// Safe static file serving (fixes C1 path traversal)
app.use((req, res, next) => {
  const url = new URL(req.url, 'http://x');
  const fp = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(CLIENT_DIR, '.' + fp);
  const resolved = path.resolve(CLIENT_DIR);
  if (file !== resolved && !file.startsWith(resolved + path.sep)) {
    res.status(403).end('forbidden');
    return;
  }
  next();
});

app.use(express.static(CLIENT_DIR));

// ---- Results storage ----
let results = [];
try {
  if (fs.existsSync(RESULTS_FILE)) {
    results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  }
} catch (e) { results = []; }

function saveResults() {
  try { fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2)); } catch (e) {}
}

app.get('/results', (req, res) => {
  res.json(results);
});

// ---- HTTP server ----
const srv = http.createServer(app);

// ---- WebSocket server ----
const wss = new WebSocketServer({ server: srv });

// Fix C2: global WS server error handler
wss.on('error', e => console.error('[wss error]', e.message));

// ---- Rooms / Lobby ----
let nextPlayerId = 1;
const rooms = new Map();  // roomId -> Room
const playerRoom = new Map(); // ws -> { roomId, playerId }

function createRoom(name, maxLaps) {
  const id = 'room_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const room = {
    id,
    name: name || id,
    map: 'neon_circuit',   // default map (must match client MAP_FILES keys)
    maxLaps: maxLaps || 3,
    players: new Map(),    // playerId -> PlayerState
    state: 'lobby',        // lobby | countdown | racing | finished
    countdownLeft: 0,
    countdownTimer: null,
    syncInterval: null,
    raceStartTime: 0,
    finishOrder: [],
  };
  rooms.set(id, room);
  return room;
}

// Deterministic car color palette (matches client/src/car.js CAR_COLORS)
const CAR_COLORS = [
  [0.12, 0.35, 0.95], // blue
  [0.95, 0.15, 0.15], // red
  [0.15, 0.9, 0.25],  // green
  [0.95, 0.85, 0.1],  // yellow
  [0.95, 0.1, 0.85],  // magenta
  [0.1, 0.95, 0.9],   // cyan
];

function getPlayerState(playerId, name, ws, colorIndex) {
  const color = CAR_COLORS[colorIndex % CAR_COLORS.length];
  return {
    id: playerId,
    name: name || 'Player ' + playerId,
    ws,
    ready: false,
    x: 0, z: 0, y: 0,
    rx: 0, ry: 0, rz: 0,
    vx: 0, vy: 0, vz: 0,
    lap: 0,
    lapTimes: [],
    finished: false,
    finishTime: 0,
    color,
  };
}

function broadcastRoom(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const [pid, p] of room.players) {
    if (pid !== exceptId && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  }
}

function broadcastAll(room, msg) {
  broadcastRoom(room, msg, null);
}

function lobbyState(room) {
  const players = [];
  for (const [, p] of room.players) {
    players.push({ id: p.id, name: p.name, ready: p.ready, color: p.color });
  }
  return {
    type: 'lobby_state',
    roomId: room.id,
    roomName: room.name,
    map: room.map,
    maxLaps: room.maxLaps,
    state: room.state,
    players,
  };
}

function roomList() {
  const list = [];
  for (const [, room] of rooms) {
    list.push({
      id: room.id,
      name: room.name,
      map: room.map,
      state: room.state,
      playerCount: room.players.size,
    });
  }
  return { type: 'room_list', rooms: list };
}

function removePlayerFromRoom(ws) {
  const info = playerRoom.get(ws);
  if (!info) return;
  const { roomId, playerId } = info;
  const room = rooms.get(roomId);
  playerRoom.delete(ws);
  if (!room) return;

  room.players.delete(playerId);
  broadcastAll(room, { type: 'player_left', playerId });
  broadcastAll(room, lobbyState(room));

  // Clean up empty rooms
  if (room.players.size === 0) {
    if (room.syncInterval) clearInterval(room.syncInterval);
    if (room.countdownTimer) clearInterval(room.countdownTimer);
    rooms.delete(roomId);
  }
}

// ---- Race lifecycle ----

function startCountdown(room) {
  room.state = 'countdown';
  room.countdownLeft = 3;
  broadcastAll(room, { type: 'countdown', seconds: room.countdownLeft });

  room.countdownTimer = setInterval(() => {
    room.countdownLeft--;
    if (room.countdownLeft <= 0) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      startRace(room);
    } else {
      broadcastAll(room, { type: 'countdown', seconds: room.countdownLeft });
    }
  }, 1000);
}

function startRace(room) {
  room.state = 'racing';
  room.raceStartTime = Date.now();
  room.finishOrder = [];

  // Assign grid positions
  let slot = 0;
  for (const [, p] of room.players) {
    p.lap = 0;
    p.lapTimes = [];
    p.finished = false;
    p.finishTime = 0;
    p.x = (slot % 2 === 0 ? -2 : 2);
    p.z = -slot * 6;
    slot++;
  }

  broadcastAll(room, { type: 'race_start', map: room.map, maxLaps: room.maxLaps, startTime: room.raceStartTime });

  // Start state sync at ~30 Hz
  room.syncInterval = setInterval(() => {
    if (room.state !== 'racing') return;
    const states = [];
    for (const [, p] of room.players) {
      states.push({
        id: p.id,
        x: p.x, z: p.z, y: p.y,
        rx: p.rx, ry: p.ry, rz: p.rz,
        vx: p.vx, vy: p.vy, vz: p.vz,
        lap: p.lap,
        finished: p.finished,
        color: p.color,
      });
    }
    broadcastAll(room, { type: 'state_update', players: states });
  }, 33); // ~30 Hz
}

function handleLapComplete(room, player) {
  player.lap++;
  const now = Date.now();
  const lapTime = player.lapTimes.length > 0
    ? now - player.lapTimes[player.lapTimes.length - 1]
    : now - room.raceStartTime;
  player.lapTimes.push(now);

  broadcastAll(room, {
    type: 'lap_complete',
    playerId: player.id,
    playerName: player.name,
    lap: player.lap,
    lapTime,
  });

  if (player.lap >= room.maxLaps) {
    player.finished = true;
    player.finishTime = now - room.raceStartTime;
    room.finishOrder.push({
      playerId: player.id,
      playerName: player.name,
      finishTime: player.finishTime,
      position: room.finishOrder.length + 1,
    });

    broadcastAll(room, {
      type: 'race_finish',
      playerId: player.id,
      playerName: player.name,
      finishTime: player.finishTime,
      position: room.finishOrder.length,
    });

    // Check if all finished
    let allDone = true;
    for (const [, p] of room.players) {
      if (!p.finished) { allDone = false; break; }
    }

    if (allDone) {
      endRace(room);
    }
  }
}

function endRace(room) {
  room.state = 'finished';
  if (room.syncInterval) { clearInterval(room.syncInterval); room.syncInterval = null; }

  const raceResults = room.finishOrder.map(f => ({
    playerName: f.playerName,
    map: room.map,
    finishTime: f.finishTime,
    position: f.position,
    date: new Date().toISOString(),
  }));

  // Store results
  results.push(...raceResults);
  // Keep last 500 entries
  if (results.length > 500) results = results.slice(-500);
  saveResults();

  broadcastAll(room, {
    type: 'results',
    results: room.finishOrder,
    map: room.map,
  });

  // After 10 seconds, reset room to lobby
  setTimeout(() => {
    if (!rooms.has(room.id)) return;
    room.state = 'lobby';
    for (const [, p] of room.players) {
      p.ready = false;
      p.lap = 0;
      p.finished = false;
    }
    broadcastAll(room, lobbyState(room));
  }, 10000);
}

// ---- WebSocket connection handler ----

wss.on('connection', (ws) => {
  let playerId = nextPlayerId++;

  // Fix C2: per-connection error handler
  ws.on('error', e => {
    console.error('[ws error]', playerId, e.code || e.message);
    try { ws.terminate(); } catch (_) {}
  });

  // Send available rooms on connect
  const rl = roomList();
  ws.send(JSON.stringify({ type: 'welcome', playerId, rooms: rl.rooms }));

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    switch (m.type) {

      case 'list_rooms': {
        ws.send(JSON.stringify(roomList()));
        break;
      }

      case 'create_room': {
        removePlayerFromRoom(ws);
        const room = createRoom(m.name, m.maxLaps);
        const player = getPlayerState(playerId, m.playerName, ws, room.players.size);
        room.players.set(playerId, player);
        playerRoom.set(ws, { roomId: room.id, playerId });
        ws.send(JSON.stringify({ type: 'room_created', roomId: room.id }));
        ws.send(JSON.stringify(lobbyState(room)));
        break;
      }

      case 'join': {
        removePlayerFromRoom(ws);
        let room = rooms.get(m.roomId);

        // If no specific room, join/create a default one
        if (!room) {
          // Find first lobby room or create one
          for (const [, r] of rooms) {
            if (r.state === 'lobby') { room = r; break; }
          }
          if (!room) room = createRoom('Default Lobby');
        }

        if (room.state !== 'lobby') {
          ws.send(JSON.stringify({ type: 'error', message: 'Race already in progress' }));
          break;
        }

        const player = getPlayerState(playerId, m.playerName, ws, room.players.size);
        room.players.set(playerId, player);
        playerRoom.set(ws, { roomId: room.id, playerId });
        ws.send(JSON.stringify({ type: 'joined', roomId: room.id, playerId, color: player.color }));
        broadcastAll(room, lobbyState(room));
        break;
      }

      case 'ready': {
        const info = playerRoom.get(ws);
        if (!info) break;
        const room = rooms.get(info.roomId);
        if (!room || room.state !== 'lobby') break;
        const player = room.players.get(info.playerId);
        if (!player) break;

        player.ready = !player.ready; // toggle
        broadcastAll(room, lobbyState(room));

        // Check if all ready
        if (room.players.size >= 1) {
          let allReady = true;
          for (const [, p] of room.players) {
            if (!p.ready) { allReady = false; break; }
          }
          if (allReady) startCountdown(room);
        }
        break;
      }

      case 'set_map': {
        const info = playerRoom.get(ws);
        if (!info) break;
        const room = rooms.get(info.roomId);
        if (!room || room.state !== 'lobby') break;
        room.map = String(m.map || 'highway');
        if (m.maxLaps) room.maxLaps = Math.max(1, Math.min(20, Number(m.maxLaps) || 3));
        broadcastAll(room, lobbyState(room));
        break;
      }

      case 'state_update': {
        const info = playerRoom.get(ws);
        if (!info) break;
        const room = rooms.get(info.roomId);
        if (!room || room.state !== 'racing') break;
        const player = room.players.get(info.playerId);
        if (!player || player.finished) break;

        // Coerce + clamp values (fixes m5 trust issue)
        player.x = clamp(Number(m.x) || 0, -100, 100);
        player.z = clamp(Number(m.z) || 0, -10000, 10000);
        player.y = clamp(Number(m.y) || 0, -10, 50);
        player.rx = Number(m.rx) || 0;
        player.ry = Number(m.ry) || 0;
        player.rz = Number(m.rz) || 0;
        player.vx = clamp(Number(m.vx) || 0, -50, 50);
        player.vy = clamp(Number(m.vy) || 0, -50, 50);
        player.vz = clamp(Number(m.vz) || 0, -50, 50);
        break;
      }

      case 'lap_complete': {
        const info = playerRoom.get(ws);
        if (!info) break;
        const room = rooms.get(info.roomId);
        if (!room || room.state !== 'racing') break;
        const player = room.players.get(info.playerId);
        if (!player || player.finished) break;
        handleLapComplete(room, player);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    removePlayerFromRoom(ws);
  });
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ---- LAN IP discovery ----
function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

srv.listen(PORT, () => {
  const ip = getLanIP();
  console.log(`Racing server running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  LAN:     http://${ip}:${PORT}`);
  console.log(`  WS:      ws://${ip}:${PORT}`);
  console.log(`  Results: http://localhost:${PORT}/results`);
});
