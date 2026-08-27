# WebSocket Multiplayer Racing Protocol

All messages are JSON over WebSocket. Every message has a `type` field.

## Connection

Port: `8080` (default, configurable via `PORT` env var).
WebSocket URL: `ws://<server-ip>:8080`
REST endpoint: `GET /results` — returns JSON leaderboard.

---

## Server → Client Messages

### `welcome`
Sent immediately on connection.
```json
{
  "type": "welcome",
  "playerId": 1,
  "rooms": [
    { "id": "room_xxx", "name": "Default Lobby", "map": "highway", "state": "lobby", "playerCount": 2 }
  ]
}
```

### `room_created`
Confirms room creation.
```json
{ "type": "room_created", "roomId": "room_xxx" }
```

### `joined`
Confirms the player joined a room.
```json
{ "type": "joined", "roomId": "room_xxx", "playerId": 1, "color": [0.5, 0.3, 0.9] }
```

### `room_list`
List of all rooms.
```json
{
  "type": "room_list",
  "rooms": [
    { "id": "room_xxx", "name": "My Room", "map": "highway", "state": "lobby", "playerCount": 3 }
  ]
}
```

### `lobby_state`
Full lobby state — sent whenever lobby changes (player joins/leaves/readies, map changes).
```json
{
  "type": "lobby_state",
  "roomId": "room_xxx",
  "roomName": "My Room",
  "map": "highway",
  "maxLaps": 3,
  "state": "lobby",
  "players": [
    { "id": 1, "name": "Alice", "ready": true, "color": [0.5, 0.3, 0.9] },
    { "id": 2, "name": "Bob", "ready": false, "color": [0.9, 0.2, 0.2] }
  ]
}
```

### `player_left`
A player disconnected.
```json
{ "type": "player_left", "playerId": 2 }
```

### `countdown`
Race starting countdown (3, 2, 1).
```json
{ "type": "countdown", "seconds": 3 }
```

### `race_start`
Race begins — all clients should start.
```json
{
  "type": "race_start",
  "map": "highway",
  "maxLaps": 3,
  "startTime": 1700000000000
}
```

### `state_update`
Broadcast at ~30 Hz during racing. Contains all players' positions.
```json
{
  "type": "state_update",
  "players": [
    {
      "id": 1,
      "x": 2.5, "z": -150.3, "y": 0,
      "rx": 0, "ry": 1.57, "rz": 0,
      "vx": 0.1, "vy": 0, "vz": -5.2,
      "lap": 1,
      "finished": false
    }
  ]
}
```

### `lap_complete`
A player completed a lap.
```json
{
  "type": "lap_complete",
  "playerId": 1,
  "playerName": "Alice",
  "lap": 2,
  "lapTime": 32450
}
```

### `race_finish`
A player crossed the finish line after completing all laps.
```json
{
  "type": "race_finish",
  "playerId": 1,
  "playerName": "Alice",
  "finishTime": 95230,
  "position": 1
}
```

### `results`
Final race results — sent when all players finish (or race ends).
```json
{
  "type": "results",
  "map": "highway",
  "results": [
    { "playerId": 1, "playerName": "Alice", "finishTime": 95230, "position": 1 },
    { "playerId": 2, "playerName": "Bob", "finishTime": 102500, "position": 2 }
  ]
}
```

### `error`
Server-side error (e.g., joining a race already in progress).
```json
{ "type": "error", "message": "Race already in progress" }
```

---

## Client → Server Messages

### `list_rooms`
Request current room list.
```json
{ "type": "list_rooms" }
```

### `create_room`
Create a new room and join it.
```json
{ "type": "create_room", "name": "My Room", "playerName": "Alice", "maxLaps": 3 }
```

### `join`
Join an existing room (or the default one if `roomId` is omitted).
```json
{ "type": "join", "roomId": "room_xxx", "playerName": "Alice" }
```

### `ready`
Toggle ready state in lobby. When all players are ready, countdown starts automatically.
```json
{ "type": "ready" }
```

### `set_map`
Change the selected map (lobby only).
```json
{ "type": "set_map", "map": "desert", "maxLaps": 5 }
```

### `state_update`
Send local player state during racing (~30 Hz recommended).
```json
{
  "type": "state_update",
  "x": 2.5, "z": -150.3, "y": 0,
  "rx": 0, "ry": 1.57, "rz": 0,
  "vx": 0.1, "vy": 0, "vz": -5.2
}
```
Values are coerced to `Number` and clamped server-side to prevent cheat/garbage.

### `lap_complete`
Client reports crossing the start/finish line.
```json
{ "type": "lap_complete" }
```

---

## Flow

```
Client                        Server
  |--- join/create_room -------->|
  |<-------- joined / room_created ---|
  |<-------- lobby_state --------|
  |--- ready ------------------->|
  |<-------- lobby_state --------|  (all players see readiness)
  |            ...all ready...   |
  |<-------- countdown {3} ------|
  |<-------- countdown {2} ------|
  |<-------- countdown {1} ------|
  |<-------- race_start ---------|
  |--- state_update ------------>|  (30 Hz)
  |<-------- state_update -------|  (30 Hz, all players)
  |--- lap_complete ------------>|
  |<-------- lap_complete -------|  (broadcast)
  |--- lap_complete ------------>|  (final lap)
  |<-------- race_finish --------|  (this player finished)
  |            ...all done...    |
  |<-------- results ------------|
  |         (10s pause)          |
  |<-------- lobby_state --------|  (back to lobby)
```

## REST API

### `GET /results`
Returns the leaderboard as JSON array:
```json
[
  {
    "playerName": "Alice",
    "map": "highway",
    "finishTime": 95230,
    "position": 1,
    "date": "2026-08-27T14:05:00.000Z"
  }
]
```
