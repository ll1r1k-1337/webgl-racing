# Neon Circuit — Retro 80s Multiplayer Racing

A 3D multiplayer racing game with retro 80s pixel aesthetics. Built with Three.js (WebGL), WebSocket for real-time LAN multiplayer, and a Node.js backend.

```
 _  _  ____  ___  _  _     ___  ____  ____   ___  _  _  ____  ____
( \( )( ___)/ __)( \( )   / __)(_  _)(  _ \ / __)( )( )(_  _)(_  _)
 )  (  )__) \__ \ )  (   ( (__  _)(_  )   /( (__  )()(  _)(_   )(
(_)\_)(____)(___/(_)\_)   \___)(____)(_)\_) \___)(____)(____) (__)
```

## Features

- **3D WebGL Rendering**: Three.js-powered 3D engine at 384x216 resolution, upscaled with a retro CRT shader (barrel distortion, scanlines, chromatic aberration, vignette)
- **Arcade Physics**: Acceleration, braking, drift mechanics, wall collisions, lap detection
- **LAN Multiplayer**: WebSocket-based real-time state sync at 30 Hz — play with friends on the same network
- **Lobby System**: Create/join rooms, select maps, ready up, 3-2-1 countdown
- **3 Racing Maps**: Neon Circuit (Easy), Desert Drift (Medium), Cyber Highway (Hard) — each with unique layouts and props
- **Results & Leaderboard**: Race results with medals, persistent top-10 leaderboard per map
- **Retro 80s Style**: Press Start 2P pixel font, neon magenta/cyan/yellow palette, synthwave sky, CRT post-processing

## Prerequisites

- **Node.js** 18+ (with npm)
- A modern browser with WebGL support (Chrome, Firefox, Edge)

## Quick Start

```bash
# Clone the repo
git clone <repo-url>
cd webgl-racing

# Install dependencies
npm install

# Start the server
npm run server
```

The server will print:
```
Racing server running on:
  Local:   http://localhost:8080
  LAN:     http://192.168.x.x:8080
  WS:      ws://192.168.x.x:8080
  Results: http://localhost:8080/results
```

Open the **Local** URL in your browser to play. Share the **LAN** URL with friends on the same network.

## Connecting Multiple Players (LAN)

1. Start the server on one machine (`npm run server`)
2. Note the **LAN** address printed in the terminal (e.g. `http://192.168.1.42:8080`)
3. On each player's machine, open that LAN address in the browser
4. Enter a player name and click **CONNECT**
5. In the lobby: select a map, then click **READY**
6. Race starts when all players are ready (3-2-1 countdown)

### Same-machine testing
Open the URL in 2+ browser tabs/windows — each tab is a separate player.

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run server` | `node server/server.js` | Start the game server (serves client + WebSocket) |
| `npm run client` | `npx http-server client` | Standalone static file server for client (dev only) |
| `npm start` | `node server/server.js` | Alias for `npm run server` |
| `npm test` | `node server/test_server.js` | Run 35 integration tests |

> **Note**: `npm run server` serves both the game client and the WebSocket endpoint on the same port. You do NOT need to run `npm run client` separately — it exists only for development.

## Project Structure

```
webgl-racing/
├── server/
│   ├── server.js        # Node.js WebSocket + Express server
│   ├── test_server.js   # 35 integration tests
│   └── results.json     # Persistent race leaderboard (auto-created)
├── client/
│   ├── index.html       # Game entry point (all UI screens)
│   ├── src/
│   │   ├── game.js      # Three.js scene, CRT shader, game loop, multiplayer API
│   │   ├── car.js       # Low-poly car mesh + arcade physics engine
│   │   ├── track.js     # CatmullRom spline track builder + collision
│   │   ├── network.js   # WebSocket client wrapper
│   │   └── ui.js        # UI screens (connect, lobby, countdown, results, leaderboard)
│   └── maps/
│       ├── neon_circuit.json   # Easy — 3 laps, oval city track
│       ├── desert_drift.json   # Medium — 2 laps, tight hairpins
│       └── cyber_highway.json  # Hard — 2 laps, elevation changes
├── package.json
├── PROTOCOL.md          # WebSocket message protocol reference
└── MAPS.md              # Track data format specification
```

## Controls

| Key | Action |
|-----|--------|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / Reverse |
| `A` / `←` | Steer left |
| `D` / `→` | Steer right |
| `Space` | Handbrake / Drift |
| `Tab` | Toggle CRT shader |

## Maps

### Neon Circuit (Easy)
- **Laps**: 3
- **Layout**: Wide oval circuit through a neon-lit city
- **Good for**: Learning the controls, casual races

### Desert Drift (Medium)
- **Laps**: 2
- **Layout**: Twisting road through desert terrain with tight hairpin turns
- **Good for**: Practicing drift mechanics

### Cyber Highway (Hard)
- **Laps**: 2
- **Layout**: Complex highway with elevation changes and narrow sections
- **Good for**: Experienced racers, competitive play

## Game Flow

```
[Connect Screen]  →  Enter server address + name
       ↓
[Lobby]           →  See players, select map, press READY
       ↓
[Countdown]       →  3... 2... 1... GO!
       ↓
[Race]            →  Drive! HUD shows lap, position, speed, time
       ↓
[Results]         →  Medal-based results table (🥇🥈🥉)
       ↓
[Lobby]           →  Auto-return after 10 seconds
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `8080` | Server port for HTTP + WebSocket |

Example: `PORT=3000 npm run server`

## Integration Test Procedure

The automated test suite validates the full multiplayer flow:

```bash
npm test
```

This runs 35 tests covering:
- REST `/results` endpoint
- Path traversal security
- Static file serving
- WebSocket welcome + room creation
- Multi-player join
- Map selection
- Ready system + countdown
- Race start + state sync at 30 Hz
- Lap tracking + race finish detection
- Results persistence
- Disconnect cleanup
- Error resilience (garbage input)

### Manual Integration Test

To manually verify the full multiplayer experience:

1. Start the server: `npm run server`
2. Open **Tab 1**: go to `http://localhost:8080`, enter name "Alice", click CONNECT
3. Open **Tab 2**: go to `http://localhost:8080`, enter name "Bob", click CONNECT
4. Both tabs should auto-join the same lobby room
5. In either tab, select a map (click one of the 3 map cards)
6. In **both** tabs, click READY
7. Verify: 3-2-1 countdown appears, then the race starts
8. Race with both tabs — verify:
   - Both cars are visible and moving
   - HUD shows correct lap count, position, and speed
   - Positions update as players progress
9. Complete all laps in both tabs
10. Verify: Results screen shows both players with correct positions and times
11. After 10 seconds, both return to lobby automatically
12. Verify: `http://localhost:8080/results` shows the race results as JSON

## Technology

- **Rendering**: Three.js 0.171 via CDN (ES module importmap)
- **Physics**: Custom arcade-style (no physics library)
- **Networking**: WebSocket (ws library) + Express for static files and REST
- **UI**: Vanilla HTML/CSS with Press Start 2P pixel font from Google Fonts
- **Track System**: CatmullRom closed splines with 400-sample subdivision

## License

ISC
