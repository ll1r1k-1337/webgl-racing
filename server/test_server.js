// Integration test for the racing WebSocket server
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 9876; // test port
let server;
let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function wsConnect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const msgs = [];
    ws.on('message', d => msgs.push(JSON.parse(d)));
    ws.on('error', e => reject(e));
    ws.on('open', () => {
      // Small delay to let welcome message arrive
      setTimeout(() => resolve({ ws, msgs }), 100);
    });
  });
}

function waitMsg(conn, type, timeout = 3000, predicate) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);
    const check = () => {
      const idx = conn.msgs.findIndex(m => m.type === type && (!predicate || predicate(m)));
      if (idx >= 0) { clearTimeout(t); resolve(conn.msgs.splice(idx, 1)[0]); return; }
      setTimeout(check, 50);
    };
    check();
  });
}

function drainMsgs(conn) { conn.msgs.length = 0; }

function send(conn, msg) { conn.ws.send(JSON.stringify(msg)); }

async function runTests() {
  console.log('Starting test server...');

  // Start the server on test port
  process.env.PORT = PORT;
  // Require the server directly? No — it calls listen(). Spawn it.
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'pipe',
  });

  let started = false;
  server.stdout.on('data', d => { if (d.toString().includes('Racing server')) started = true; });
  server.stderr.on('data', d => process.stderr.write(d));

  // Wait for server to start
  for (let i = 0; i < 30 && !started; i++) await new Promise(r => setTimeout(r, 200));
  if (!started) { console.log('Server failed to start'); process.exit(1); }

  console.log('\n--- Test: REST /results endpoint ---');
  const res = await httpGet(`http://localhost:${PORT}/results`);
  assert(res.status === 200, '/results returns 200');
  const body = JSON.parse(res.body);
  assert(Array.isArray(body), '/results returns an array');

  console.log('\n--- Test: Path traversal blocked ---');
  const evil = await httpGet(`http://localhost:${PORT}/../../../../../../Windows/win.ini`);
  assert(evil.status === 403 || evil.status === 404, 'Path traversal blocked (got ' + evil.status + ')');

  console.log('\n--- Test: Static file serving ---');
  const html = await httpGet(`http://localhost:${PORT}/`);
  assert(html.status === 200, '/ serves index.html');
  assert(html.body.includes('<!DOCTYPE'), 'index.html content is HTML');

  console.log('\n--- Test: WS welcome message ---');
  const c1 = await wsConnect(PORT);
  const welcome = await waitMsg(c1, 'welcome');
  assert(welcome.type === 'welcome', 'Welcome message received');
  assert(typeof welcome.playerId === 'number', 'Welcome has playerId');
  assert(Array.isArray(welcome.rooms), 'Welcome has rooms list');

  console.log('\n--- Test: Create room ---');
  send(c1, { type: 'create_room', name: 'Test Room', playerName: 'Alice', maxLaps: 2 });
  const created = await waitMsg(c1, 'room_created');
  assert(created.roomId.startsWith('room_'), 'Room created with valid id');
  const lobby1 = await waitMsg(c1, 'lobby_state');
  assert(lobby1.players.length === 1, 'Lobby has 1 player');
  assert(lobby1.players[0].name === 'Alice', 'Player name is Alice');
  assert(lobby1.map === 'neon_circuit', 'Default map is neon_circuit');
  assert(lobby1.maxLaps === 2, 'maxLaps is 2');

  console.log('\n--- Test: Second player joins ---');
  const c2 = await wsConnect(PORT);
  const w2 = await waitMsg(c2, 'welcome');
  send(c2, { type: 'join', roomId: created.roomId, playerName: 'Bob' });
  const joined = await waitMsg(c2, 'joined');
  assert(joined.roomId === created.roomId, 'Bob joined the right room');
  const lobby2 = await waitMsg(c2, 'lobby_state');
  assert(lobby2.players.length === 2, 'Lobby has 2 players after join');

  console.log('\n--- Test: Map change ---');
  drainMsgs(c1);
  send(c1, { type: 'set_map', map: 'desert', maxLaps: 3 });
  const lobby3 = await waitMsg(c1, 'lobby_state', 3000, m => m.map === 'desert');
  assert(lobby3.map === 'desert', 'Map changed to desert');
  assert(lobby3.maxLaps === 3, 'maxLaps changed to 3');

  console.log('\n--- Test: Ready + countdown ---');
  drainMsgs(c1);
  send(c1, { type: 'ready' });
  const l4 = await waitMsg(c1, 'lobby_state', 3000, m => m.players.some(p => p.name === 'Alice' && p.ready));
  const alice = l4.players.find(p => p.name === 'Alice');
  assert(alice && alice.ready === true, 'Alice is ready');

  send(c2, { type: 'ready' });
  // All ready → countdown starts
  const cd = await waitMsg(c1, 'countdown');
  assert(cd.seconds === 3, 'Countdown starts at 3');

  console.log('\n--- Test: Race start ---');
  const start = await waitMsg(c1, 'race_start', 5000);
  assert(start.type === 'race_start', 'Race started');
  assert(start.map === 'desert', 'Race map is desert');
  assert(start.maxLaps === 3, 'Race maxLaps is 3');

  console.log('\n--- Test: State sync broadcast ---');
  drainMsgs(c2);
  send(c1, { type: 'state_update', x: 5.5, z: -100, y: 0, rx: 0, ry: 1.5, rz: 0, vx: 0, vy: 0, vz: -3 });
  // Wait for a state_update where Alice's x is ~5.5
  const sync = await waitMsg(c2, 'state_update', 3000, m => {
    const a = m.players.find(p => p.id === welcome.playerId);
    return a && Math.abs(a.x - 5.5) < 0.01;
  });
  assert(sync.players.length === 2, 'State update has 2 players');
  const aliceState = sync.players.find(p => p.id === welcome.playerId);
  assert(aliceState && Math.abs(aliceState.x - 5.5) < 0.01, 'Alice position synced correctly');

  console.log('\n--- Test: Lap complete + race finish ---');
  for (let lap = 0; lap < 3; lap++) {
    send(c1, { type: 'lap_complete' });
    const lc = await waitMsg(c1, 'lap_complete');
    assert(lc.lap === lap + 1, `Alice lap ${lap + 1} complete`);
  }

  // Alice should have finished
  const finish = await waitMsg(c1, 'race_finish', 3000);
  assert(finish.playerName === 'Alice', 'Alice finished');
  assert(finish.position === 1, 'Alice is P1');

  // Bob finishes
  for (let lap = 0; lap < 3; lap++) {
    send(c2, { type: 'lap_complete' });
    await waitMsg(c2, 'lap_complete');
  }

  const results = await waitMsg(c1, 'results', 3000);
  assert(results.results.length === 2, 'Results have 2 entries');
  assert(results.map === 'desert', 'Results show correct map');

  console.log('\n--- Test: REST /results after race ---');
  const res2 = await httpGet(`http://localhost:${PORT}/results`);
  const lb = JSON.parse(res2.body);
  assert(lb.length >= 2, 'Leaderboard has race entries');
  assert(lb.some(e => e.playerName === 'Alice'), 'Alice in leaderboard');

  console.log('\n--- Test: Disconnect cleanup ---');
  c2.ws.close();
  await new Promise(r => setTimeout(r, 500));
  // c1 should get player_left
  const left = c1.msgs.find(m => m.type === 'player_left');
  assert(left !== undefined, 'Player left notification received');

  console.log('\n--- Test: WS error resilience (C2 fix) ---');
  // Send garbage to test error handler doesn't crash server
  const c3 = await wsConnect(PORT);
  await waitMsg(c3, 'welcome');
  c3.ws.send('not json at all{{{');
  await new Promise(r => setTimeout(r, 500));
  // Server should still be alive
  const c4 = await wsConnect(PORT);
  const w4 = await waitMsg(c4, 'welcome');
  assert(w4.type === 'welcome', 'Server alive after garbage input');
  c3.ws.close();
  c4.ws.close();

  // Summary
  console.log(`\n=============================`);
  console.log(`PASSED: ${passed}, FAILED: ${failed}`);
  console.log(`=============================`);

  c1.ws.close();
  server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Test error:', e);
  if (server) server.kill();
  process.exit(1);
});
