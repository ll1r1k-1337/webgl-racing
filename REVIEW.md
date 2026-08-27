# Code Review — webgl-racing

Reviewer: default (kanban t_7ef5ceb9)
Scope: `server.js` (125 lines), `index.html` (352 lines)
Method: every finding below was **executed**, not inferred. Probes ran the real
`server.js` over real TCP/WebSocket, and the real game script from `index.html`
inside Node with stubbed browser globals. All probe files have been deleted.

Repo has no git and no test suite (`npm test` = `echo "Error: no test specified" && exit 1`),
so there was no gate to run and nothing to regress against — every claim here comes
from a purpose-built probe.

---

## Verdict

**2 critical, 4 major, 4 minor.** Two of the criticals are trivially remotely
triggerable: any visitor can read arbitrary files off the host disk, and any
visitor can hard-kill the process with 10 bytes.

| # | Severity | Finding | Evidence tier |
|---|---|---|---|
| C1 | Critical | Path traversal: arbitrary file read | Verified — fetched `C:\Windows\win.ini` |
| C2 | Critical | One malformed WS frame kills the whole server | Verified — process exited, `ECONNREFUSED` |
| M1 | Major | Damage multiplies ~3x: server sync resets the `hit` latch | Verified — 80.1 HP vs 93.3 HP control |
| M2 | Major | Throttle is cosmetic online: traffic speed ignores player speed | Verified — 54.0 vs 55.1 u/s at spd 0.15 vs 1.2 |
| M3 | Major | Local collision physics discarded 20x/sec | Verified — vx 1.197 → 0 on next tick |
| M4 | Major | ~33% of deaths are never broadcast; wreck stays "alive" to peers | Verified — 20/30 trials broadcast |
| m1 | Minor | Camera shake never decays after death | Verified — shake=1.000 after 11s |
| m2 | Minor | All remote players render at z=0 | Verified — traced send/store/render chain |
| m3 | Minor | Vertex buffer silently overflows at ~55 players | Verified — vi=359316 > 350000 at 80 peers |
| m4 | Minor | Zero shader/program/GL error checking | Verified — 0 calls to the 5 check APIs |
| m5 | Minor | Query strings 404; unhandled `p.hp`/`p.spd` trust | Verified / Traced |

---

## C1 — Critical: path traversal, arbitrary file read (`server.js:9-11`)

```js
const fp = req.url === '/' ? '/index.html' : req.url;
const file = path.join(__dirname, fp);      // <-- no normalization, no containment check
fs.readFile(file, ...)
```

`path.join` **resolves** `..` segments; it does not reject them. There is no check
that the result is still under `__dirname`.

Verified with a raw socket (curl normalizes the path away client-side, which is why
a naive `curl ../` test returns a misleading 404 — I hit it with `net.connect`):

```
GET /../../../../../../Windows/win.ini
   -> HTTP/1.1 200 OK | ct=application/octet-stream | bytes=103
      "; for 16-bit app support\r\n[fonts]\r\n[extensions]\r\n[mci extensions]..."
```

That is the host's real `C:\Windows\win.ini` served to an unauthenticated remote
client. The same request shape reaches `.env`, SSH keys, `%USERPROFILE%\...`, anything
the node process can read. Also note `GET /server.js` returns 200 — source disclosure.

Fix (~5 lines):

```js
const root = __dirname;
const url = new URL(req.url, 'http://x');                    // also fixes m5 (query strings)
const fp = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
const file = path.resolve(root, '.' + fp);
if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end('no'); return; }
```

---

## C2 — Critical: unhandled `error` event kills the process (`server.js:84-123`)

Neither the `WebSocket` nor the `WebSocketServer` has an `'error'` listener. In Node,
an `EventEmitter` that emits `'error'` with no listener **throws**, and `ws` emits
`'error'` on any protocol violation.

Verified — a socket that completes the handshake then sends one unmasked frame
(`0x82 0x7f ...`, 10 bytes) and resets:

```
handshake ok -> now sending garbage frame + RST
SERVER DEAD: ECONNREFUSED

# server stdout:
RangeError: Invalid WebSocket frame: MASK must be set
    at Receiver.getInfo (.../ws/lib/receiver.js:351:28)
  code: 'WS_ERR_EXPECTED_MASK', [Symbol(status-code)]: 1002
Node.js v22.23.2   <- process exited
```

Every connected player is dropped, and the process does not come back. No auth, no
rate limit, no restart supervisor — a single 10-byte payload is a full DoS.

Control probes confirm the *other* failure modes are already handled correctly:
a plain TCP RST after handshake → server survives (HTTP 200); a well-formed text
frame containing invalid JSON → survives, thanks to the `try/catch` at `server.js:95`.
So the gap is precisely the missing `'error'` handlers.

Fix (~3 lines):

```js
wss.on('error', e => console.error('wss', e));
// inside wss.on('connection', ws => { ... }):
ws.on('error', e => { console.error('ws', id, e.code || e.message); try { ws.terminate(); } catch {} });
```

---

## M1 — Major: damage multiplies ~3x because server sync clears the `hit` latch

`index.html:269` uses `t.hit` as a once-per-collision latch. But the `'tr'` handler at
`index.html:209-211` **rebuilds the arrays from scratch** every server tick, always
with `hit:false`:

```js
traf.length=0; onc.length=0;
for(const s of m.s) traf.push({x:s.x, z:s.z, vx:0, vz:0, c:s.c, hit:false});
```

So a sustained overlap re-fires the full impact — damage, speed penalty, explosion,
sparks, shake — 20 times a second instead of once.

Verified, one traffic car parked on the player for 1 second:

```
server @20Hz (real)  : 20 syncs/s -> hp 80.1/100, spd 0.035 (started .300)
control (1 sync only): hp 93.3/100, spd 0.210          <- intended single-hit behaviour
```

19.9 HP lost instead of 6.7 (~3x), and speed crushed to 0.035 (~12% of intended).
Because the server also never moves the player's lane-mate away (see M3), an
unlucky overlap is an unrecoverable death spiral. Scale it up: the same second
against an oncoming car costs 60 HP per hit, capped — repeated 20x it is instant death.

Fix: key the latch on identity that survives resync. The server already sends `t.id`
(`server.js:77`) and the client throws it away. Keep it, and carry the latch in a
`Set` that is not rebuilt:

```js
// module scope
const hitIds = new Set();
// in the 'tr' handler, preserve id:
for(const s of m.s) traf.push({id:s.id, x:s.x, z:s.z, vx:0, vz:0, c:s.c});
// in the collision loop:
if(!hitIds.has(t.id)){ hitIds.add(t.id); /* ...impact... */ }
// in the else branch: hitIds.delete(t.id);
```

---

## M2 — Major: the throttle does nothing online — traffic speed is a server constant

`server.js:54-56` moves traffic at fixed rates. It never reads any player's `spd`,
even though `spd` is received and stored at `server.js:100`.

Verified against the live server, two 4-second runs hammering `{t:'u', spd:...}`:

```
SLOW: client-claimed spd=0.15 -> oncoming approach 53.96 units/s (5 cars, 18.0 Hz)
FAST: client-claimed spd=1.2  -> oncoming approach 55.07 units/s (5 cars, 18.5 Hz)
```

A 8x difference in claimed speed produces a 2% difference in closing rate — noise.
Meanwhile the HUD reads 49 km/h vs 396 km/h and the score still accrues at `spd*dt`,
so the number goes up while the world is visibly static. The offline fallback
(`index.html:246-251`) *does* scale correctly, which makes the online/offline
behaviours diverge sharply:

```
client OFFLINE @spd=0.15: oncoming  42.0 u/s, same-dir  2.3 u/s
client OFFLINE @spd=1.2 : oncoming 168.0 u/s, same-dir 18.0 u/s
server ONLINE (any spd) : oncoming  60.0 u/s, same-dir  4.5 u/s
```

Same-direction traffic is the worst case. At the fixed 4.5 u/s closing rate, a car
spawned at z=-200 needs ~43 s of runway. Measured over a 20 s session at claimed
max throttle:

```
closest SAME-DIRECTION car got to z=9.9; reached the player's zone at 14.4s
closest ONCOMING       car got to z=9.0; reached the player's zone at 0.9s
```

So "overtaking" barely exists as a mechanic online — the only real hazard is oncoming.

Root cause is architectural: the design comment (`server.js:1`) says
*"server-authoritative traffic, client-authoritative player pos"*, but the player's
forward motion is **simulated as world motion** — the client never actually moves in z
(`index.html:302` literally sends `z:0`). With multiple players at different speeds
that model has no consistent solution: one shared world stream cannot be scrolling at
two rates at once.

Two coherent options, both bigger than a patch — worth an explicit decision:
- **(a) Make z real.** Track the player's actual `z` on the client, send it, and have
  the server move traffic in absolute world coordinates. Fixes M2, M4, and m2 together.
- **(b) Go fully client-side for traffic** and use the socket only for peer ghosts.
  Much smaller change; drops the "shared traffic" feature.

---

## M3 — Major: local collision response is erased 20 times a second

`index.html:256-288` computes an elaborate push (`t.vx`, `t.vz`) for cars you hit and
cars that hit each other. When online, none of it survives — the next `'tr'` message
overwrites the arrays with `vx:0, vz:0`.

Verified:

```
right after server sync : [{"x":1.6,"z":0,"vx":0,"vz":0}]
after 1 local frame     : [{"x":1.6,"z":0,"vx":1.197,"vz":0.18}]   <- client computed a push
after next server tick  : [{"x":1.6,"z":0,"vx":0,"vz":0}]          <- ERASED, car teleports back
```

The server *does* have its own push logic (`server.js:104-113`), so the effect is not
totally absent — but the client's much richer response (relative-speed scaling,
`pvx` recoil on the player) is dead code online. Combined with M1 this is what
produces the "stuck grinding against a car that won't move" failure mode.

Fix: don't rebuild — reconcile. Match incoming ids to existing objects and lerp
position while preserving local velocity, or drop the client-side traffic push entirely
and let the server own it. Do not keep both.

---

## M4 — Major: ~1 in 3 deaths is never broadcast

`index.html:302` is the only `ws.send`, and it sits **inside `if(alive)`**, gated on
`netTick%3===0`. When you die, you get at most one more send that frame — and only if
the tick phase lines up. Otherwise `alive:false` is never transmitted at all, because
the next frame skips the whole block.

Verified across 30 trials with varying tick phase:

```
trial 0: alive=false | msgs sent after death frame: 0 | any alive:false broadcast? false
trial 1: alive=false | msgs sent after death frame: 1 | any alive:false broadcast? true
...
20/30 deaths were broadcast to other players.
```

In the other 10 the wreck stays rendered as a live car (`index.html:342` only draws
`if(p.alive)`), frozen at the crash spot, until the tab closes. Pressing Space to
restart also never announces the revival — `reset()` (`index.html:188`) touches no
network state and does not clear `peers`.

Fix (~4 lines): send unconditionally on state transitions.

```js
function netSend(){ if(wsOk && ws && ws.readyState===1) ws.send(JSON.stringify({t:'u',x:px,z:0,spd,hp,alive})); }
// at death (index.html:292 block):  netSend();
// in reset():                       netSend();
// keep the throttled call for the steady state.
```

---

## Minor findings

**m1 — camera shake never decays after death** (`index.html:238`). `shake*=.9` lives
inside `if(alive)`, but `shake` is *used* unconditionally in the camera at
`index.html:347`. Verified: `shake=1.000` at the death frame, still `1.000` after
11 s on the game-over screen. The "WRECKED" screen jitters forever until you restart.
Fix: move `shake*=.9` above the `if(alive)` block.

**m2 — all remote players are glued to z=0.** Traced end to end: client sends `z:0`
(`index.html:302`) → server stores and forwards verbatim (`server.js:100-101`) →
client renders `car(p.x, p.z, ...)` (`index.html:342`). Verified peer dump:
`[{"id":2,"x":-4.5,"z":0},{"id":3,"x":7.5,"z":0}]`. Every other player appears exactly
level with you, no matter their real progress. Falls out of M2's architectural issue.

**m3 — vertex buffer overflows silently at ~55 players.** Measured: static scene =
19,476 floats, each car = 3,816 floats, `VB` = 350,000.

```
 70 peers -> vi=316836 / 350000
 80 peers -> vi=359316 / 350000  *** OVERFLOW ***
```

Out-of-range `Float32Array` writes are dropped without throwing (confirmed separately),
but `vi` keeps counting, so `drawArrays(TRIANGLES, 0, vi/6)` asks for 59,886 vertices
from a 58,333-vertex buffer → garbage geometry, no error. With the server traffic cap
(20 cars) and 200 particles, headroom is ~55 players. Not urgent at current scale, but
add `if(vi+36>VB.length)return;` at the top of `q()` — one line, turns silent corruption
into graceful degradation.

**m4 — no shader or GL error checking at all.** Verified by proxying the GL context and
recording every call: `getShaderParameter`, `getShaderInfoLog`, `getProgramParameter`,
`getProgramInfoLog`, `getError` — **none are ever called**. `sh()` (`index.html:33`)
returns the shader without checking `COMPILE_STATUS`; `linkProgram` is never checked.
On any driver that rejects the shader, the page renders a blank blue screen with a
clean console and no way to diagnose it. ~6 lines to fix.

**m5 — HTTP and message-trust nits.**
- Query strings 404: `GET /index.html?v=1 -> 404` (verified). Any cache-buster or
  deep link breaks. Fixed for free by the `new URL()` parse in C1.
- Directory requests return 404 with `EISDIR` swallowed — fine, but `.css`, `.png`,
  `.json` all serve as `application/octet-stream` (`server.js:14`).
- The server trusts every client-reported field. Verified round-trip:
  `{"t":"p","id":4,"x":"BOOM","z":null,"spd":1000000000,"hp":999999,...}` was accepted
  and rebroadcast verbatim to another client. It doesn't crash anyone (the renderer
  just produces NaN geometry for that peer), but with `hp`/`alive` client-authoritative
  there is no cheat resistance whatsoever. Consistent with the stated design, so
  logged as minor — but at minimum coerce with `Number()` and clamp before rebroadcast.

---

## What's good

- The `try/catch` around `JSON.parse` (`server.js:95`) genuinely holds — I threw
  malformed text frames at it and the server stayed up. The crash in C2 is strictly the
  frame layer, below that guard.
- `readyState===1` is checked before every `send` (`server.js:80, 102, 121`) — no
  writes to closing sockets.
- The offline fallback (`index.html:245-252`) is real and correct: `wsOk` gating means
  the game is fully playable with the server down, and its speed scaling is the
  behaviour M2 is missing.
- `explode()` hard-caps `parts` at 200 (`index.html:173`). Verified under sustained
  overlap: peak 200, no unbounded growth. `tireSmoke`/`sparks` lack the cap but are
  naturally rate-limited — measured peak 55 particles after 10 s of continuous hard
  steering, so not a real leak.
- Reconnect with backoff (`index.html:201`) and `peers.clear()` on close — no ghost
  peers after a drop.

---

## Suggested order

1. **C1** path traversal — 5 lines, remote arbitrary file read.
2. **C2** WS error handlers — 3 lines, remote DoS.
3. **M4** + **m1** — ~5 lines together, both are one-line-scope logic placement bugs.
4. **M1** id-based hit latch — ~10 lines, the biggest gameplay-feel win.
5. **M2/M3** — needs the architecture decision above before writing code.
6. **m3/m4/m5** — cheap hardening, batch them.
