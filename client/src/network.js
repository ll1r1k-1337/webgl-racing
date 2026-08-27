// WebSocket multiplayer client — follows PROTOCOL.md
export class Network {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.roomId = null;
    this.playerColor = null;
    this._handlers = {};
    this._syncInterval = null;
    this._getState = null;
    this._playerName = '';
  }

  on(type, fn) { this._handlers[type] = fn; }
  off(type) { delete this._handlers[type]; }
  _fire(type, data) { if (this._handlers[type]) this._handlers[type](data); }

  connect(host, playerName) {
    this._playerName = playerName;
    return new Promise((resolve, reject) => {
      try { this.ws = new WebSocket('ws://' + host); }
      catch (e) { reject(e); return; }

      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('Connection failed'));

      this.ws.onclose = () => {
        this.stopSync();
        this._fire('disconnected');
      };

      this.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this._dispatch(msg);
      };
    });
  }

  _dispatch(msg) {
    switch (msg.type) {
      case 'welcome':
        this.playerId = msg.playerId;
        break;
      case 'joined':
        this.roomId = msg.roomId;
        this.playerId = msg.playerId;
        this.playerColor = msg.color;
        break;
      case 'room_created':
        this.roomId = msg.roomId;
        break;
    }
    this._fire(msg.type, msg);
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  listRooms()            { this._send({ type: 'list_rooms' }); }
  createRoom(name, laps) { this._send({ type: 'create_room', name, playerName: this._playerName, maxLaps: laps || 3 }); }
  joinRoom(roomId)       { this._send({ type: 'join', roomId, playerName: this._playerName }); }
  toggleReady()           { this._send({ type: 'ready' }); }
  setMap(map, maxLaps)    { this._send({ type: 'set_map', map, maxLaps }); }
  sendLapComplete()       { this._send({ type: 'lap_complete' }); }

  sendState(st) {
    this._send({
      type: 'state_update',
      x: st.x, z: st.z, y: 0,
      rx: 0, ry: st.angle, rz: 0,
      vx: 0, vy: 0, vz: 0,
    });
  }

  startSync(getStateFn) {
    this._getState = getStateFn;
    this._syncInterval = setInterval(() => {
      if (this._getState) this.sendState(this._getState());
    }, 33);
  }

  stopSync() {
    if (this._syncInterval) { clearInterval(this._syncInterval); this._syncInterval = null; }
  }

  disconnect() {
    this.stopSync();
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.playerId = null;
    this.roomId = null;
  }

  get connected() { return this.ws && this.ws.readyState === 1; }
}
