# Track Data Format

Track files are stored as `.json` in the `/maps` directory.

## Schema

```json
{
  "name": "string — display name of the track",
  "difficulty": "easy | medium | hard",
  "laps": "integer — number of laps to complete",
  "theme": {
    "skyColor": [r, g, b],
    "groundColor": [r, g, b],
    "ambientColor": [r, g, b],
    "fogDensity": "number (0–1)"
  },
  "trackWidth": "number — half-width of the drivable surface in world units",
  "centerline": [
    { "x": 0, "y": 0, "z": 0 },
    "... ordered polyline points defining the track center"
  ],
  "walls": [
    {
      "side": "left | right | both",
      "from": "integer — centerline index start",
      "to": "integer — centerline index end",
      "height": "number",
      "color": [r, g, b]
    }
  ],
  "startFinish": {
    "position": { "x": 0, "y": 0, "z": 0 },
    "direction": { "x": 0, "z": 0 }
  },
  "spawnPositions": [
    { "x": 0, "y": 0, "z": 0, "direction": { "x": 0, "z": 0 } }
  ],
  "checkpoints": [
    {
      "position": { "x": 0, "y": 0, "z": 0 },
      "radius": "number — trigger distance"
    }
  ],
  "props": [
    {
      "type": "string — prop identifier (e.g. 'building', 'cactus', 'ramp')",
      "position": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "color": [r, g, b]
    }
  ]
}
```

## Field Details

### centerline
An ordered array of `{x, y, z}` points that define the track's spine as a closed loop. The last point should connect back near the first to form a circuit. The `y` component encodes elevation (0 = ground level). Points should be spaced roughly 5–15 world units apart; the renderer interpolates between them.

### trackWidth
Half-width from the centerline to each edge. A `trackWidth` of 9 means the total drivable surface is 18 units wide.

### walls
Segments of barriers along the track edges. `from` and `to` are indices into the `centerline` array. `side` can be `"left"`, `"right"`, or `"both"`. Walls prevent the car from leaving the track.

### startFinish
The position and facing direction of the start/finish line. `direction` is a normalized 2D vector on the XZ plane.

### spawnPositions
Up to 4 spawn points for multiplayer. Each has a position and facing direction. Players spawn in order (index 0 = P1).

### checkpoints
Invisible trigger volumes placed around the track. The car must pass through all checkpoints in order for a lap to count. `radius` defines the trigger sphere size.

### props
Decorative objects placed around the track. `type` identifies the mesh to use. Common types:
- `building` — rectangular city building
- `neon_sign` — glowing sign prop
- `cactus` — desert cactus
- `rock` — boulder
- `ramp` — drivable ramp/elevation change
- `bridge` — overhead bridge structure
- `barrier` — concrete barrier
- `light_pole` — street light

### theme
Visual settings for the track environment:
- `skyColor` — clear color / sky gradient base
- `groundColor` — terrain color outside track edges
- `ambientColor` — ambient light tint
- `fogDensity` — distance fog strength (0 = none, 1 = heavy)

## Tracks

| File | Name | Difficulty | Laps |
|------|------|-----------|------|
| `neon_circuit.json` | Neon Circuit | Easy | 3 |
| `desert_drift.json` | Desert Drift | Medium | 2 |
| `cyber_highway.json` | Cyber Highway | Hard | 2 |
