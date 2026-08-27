// AudioManager — procedural audio using Web Audio API
// Engine hum, drift screech, synthwave music, SFX — all generated, no external files

let actx = null;     // AudioContext
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let engineGain = null;

let _musicVolume = 0.35;
let _sfxVolume = 0.6;
let _muted = false;
let _musicMuted = false;
let _started = false;

// Engine sound state
let engineOsc = null;
let engineOsc2 = null;
let engineFilter = null;
let _engineGainNode = null;

// Drift sound state
let driftNoise = null;
let driftFilter = null;
let driftGainNode = null;

// Music state
let musicNodes = [];
let musicInterval = null;

// ---- Public API ----

export function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = actx.createGain();
  masterGain.gain.value = _muted ? 0 : 1;
  masterGain.connect(actx.destination);

  musicGain = actx.createGain();
  musicGain.gain.value = _musicMuted ? 0 : _musicVolume;
  musicGain.connect(masterGain);

  sfxGain = actx.createGain();
  sfxGain.gain.value = _sfxVolume;
  sfxGain.connect(masterGain);

  engineGain = actx.createGain();
  engineGain.gain.value = _sfxVolume * 0.5;
  engineGain.connect(masterGain);
}

export function resumeAudio() {
  if (actx && actx.state === 'suspended') actx.resume();
}

export function destroyAudio() {
  stopMusic();
  stopEngine();
  stopDrift();
  if (actx) {
    actx.close().catch(() => {});
    actx = null;
  }
  _started = false;
}

// ---- Master controls ----

export function setMuted(m) {
  _muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 1;
}
export function isMuted() { return _muted; }

export function setMusicMuted(m) {
  _musicMuted = m;
  if (musicGain) musicGain.gain.value = m ? 0 : _musicVolume;
}
export function isMusicMuted() { return _musicMuted; }

export function setMusicVolume(v) {
  _musicVolume = v;
  if (musicGain && !_musicMuted) musicGain.gain.value = v;
}

export function setSfxVolume(v) {
  _sfxVolume = v;
  if (sfxGain) sfxGain.gain.value = v;
  if (engineGain) engineGain.gain.value = v * 0.5;
}

// ---- Engine sound ----

export function startEngine() {
  if (!actx || engineOsc) return;

  // Two detuned sawtooth oscillators for a thick engine hum
  engineOsc = actx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc.frequency.value = 60;

  engineOsc2 = actx.createOscillator();
  engineOsc2.type = 'sawtooth';
  engineOsc2.frequency.value = 62;

  engineFilter = actx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 200;
  engineFilter.Q.value = 5;

  _engineGainNode = actx.createGain();
  _engineGainNode.gain.value = 0.15;

  engineOsc.connect(engineFilter);
  engineOsc2.connect(engineFilter);
  engineFilter.connect(_engineGainNode);
  _engineGainNode.connect(engineGain);

  engineOsc.start();
  engineOsc2.start();
}

export function updateEngine(speed, maxSpeed) {
  if (!engineOsc || !actx) return;
  const ratio = Math.min(1, speed / maxSpeed);
  const t = actx.currentTime;
  // Frequency rises from 50Hz idle to 180Hz at max speed
  const freq = 50 + ratio * 130;
  engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
  engineOsc2.frequency.setTargetAtTime(freq * 1.03, t, 0.05);
  // Filter opens up with speed
  engineFilter.frequency.setTargetAtTime(200 + ratio * 800, t, 0.05);
  // Volume rises slightly with speed
  _engineGainNode.gain.setTargetAtTime(0.08 + ratio * 0.18, t, 0.1);
}

export function stopEngine() {
  if (engineOsc) { try { engineOsc.stop(); } catch (e) {} engineOsc = null; }
  if (engineOsc2) { try { engineOsc2.stop(); } catch (e) {} engineOsc2 = null; }
  _engineGainNode = null;
  engineFilter = null;
}

// ---- Drift screech ----

export function startDrift() {
  if (!actx || driftNoise) return;

  // White noise through a bandpass filter for tire screech
  const bufferSize = actx.sampleRate * 2;
  const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  driftNoise = actx.createBufferSource();
  driftNoise.buffer = buffer;
  driftNoise.loop = true;

  driftFilter = actx.createBiquadFilter();
  driftFilter.type = 'bandpass';
  driftFilter.frequency.value = 3000;
  driftFilter.Q.value = 3;

  driftGainNode = actx.createGain();
  driftGainNode.gain.value = 0;

  driftNoise.connect(driftFilter);
  driftFilter.connect(driftGainNode);
  driftGainNode.connect(sfxGain);

  driftNoise.start();
}

export function updateDrift(driftAmount) {
  if (!driftGainNode || !actx) return;
  const t = actx.currentTime;
  const vol = Math.min(1, driftAmount) * 0.25;
  driftGainNode.gain.setTargetAtTime(vol, t, 0.05);
  if (driftFilter) {
    driftFilter.frequency.setTargetAtTime(2000 + driftAmount * 2000, t, 0.05);
  }
}

export function stopDrift() {
  if (driftNoise) { try { driftNoise.stop(); } catch (e) {} driftNoise = null; }
  driftFilter = null;
  driftGainNode = null;
}

// ---- SFX one-shots ----

export function playCountdownBeep(isGo) {
  if (!actx) return;
  resumeAudio();
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = 'square';
  osc.frequency.value = isGo ? 880 : 440;
  g.gain.value = 0.3;
  g.gain.setTargetAtTime(0, actx.currentTime + (isGo ? 0.3 : 0.15), 0.05);
  osc.connect(g);
  g.connect(sfxGain);
  osc.start();
  osc.stop(actx.currentTime + (isGo ? 0.5 : 0.25));
}

export function playLapChime() {
  if (!actx) return;
  const t = actx.currentTime;
  [660, 880, 1100].forEach((f, i) => {
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.25, t + i * 0.08);
    g.gain.setTargetAtTime(0, t + i * 0.08 + 0.1, 0.05);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t + i * 0.08);
    osc.stop(t + i * 0.08 + 0.3);
  });
}

export function playWallHit() {
  if (!actx) return;
  const t = actx.currentTime;
  // Short burst of noise for impact
  const buf = actx.createBuffer(1, actx.sampleRate * 0.1, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const g = actx.createGain();
  g.gain.value = 0.3;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 600;
  src.connect(f);
  f.connect(g);
  g.connect(sfxGain);
  src.start();
}

export function playFinish() {
  if (!actx) return;
  const t = actx.currentTime;
  // Triumphant arpeggio
  [523, 659, 784, 1047, 784, 1047].forEach((f, i) => {
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = 'square';
    osc.frequency.value = f;
    g.gain.value = 0;
    g.gain.setValueAtTime(0.2, t + i * 0.12);
    g.gain.setTargetAtTime(0, t + i * 0.12 + 0.15, 0.08);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t + i * 0.12);
    osc.stop(t + i * 0.12 + 0.5);
  });
}

// ---- Procedural synthwave music ----

const MUSIC_BPM = 110;
const BEAT = 60 / MUSIC_BPM;

// Chord progressions (Am - F - C - G) in frequencies
const CHORDS = [
  [220, 277.18, 329.63],    // Am
  [174.61, 220, 261.63],    // F
  [261.63, 329.63, 392],    // C
  [196, 246.94, 293.66],    // G
];

const BASS_NOTES = [110, 87.31, 130.81, 98]; // root notes one octave down

let _musicBeat = 0;
let _musicChord = 0;

export function startMusic() {
  if (!actx || musicInterval) return;
  _musicBeat = 0;
  _musicChord = 0;

  musicInterval = setInterval(() => {
    if (!actx || _muted || _musicMuted) return;
    playMusicBeat();
  }, BEAT * 1000);

  // Kick off first beat immediately
  playMusicBeat();
}

function playMusicBeat() {
  if (!actx) return;
  const t = actx.currentTime;
  const chordIdx = _musicChord % CHORDS.length;
  const chord = CHORDS[chordIdx];
  const bass = BASS_NOTES[chordIdx];
  const beatInBar = _musicBeat % 4;

  // Bass on every beat — sub synth
  const bassOsc = actx.createOscillator();
  const bassG = actx.createGain();
  bassOsc.type = 'sawtooth';
  bassOsc.frequency.value = bass;
  bassG.gain.value = 0.15;
  bassG.gain.setTargetAtTime(0, t + BEAT * 0.8, 0.05);
  const bassF = actx.createBiquadFilter();
  bassF.type = 'lowpass';
  bassF.frequency.value = 300;
  bassOsc.connect(bassF);
  bassF.connect(bassG);
  bassG.connect(musicGain);
  bassOsc.start(t);
  bassOsc.stop(t + BEAT);

  // Kick on beats 0,2
  if (beatInBar === 0 || beatInBar === 2) {
    const kick = actx.createOscillator();
    const kG = actx.createGain();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(150, t);
    kick.frequency.exponentialRampToValueAtTime(30, t + 0.12);
    kG.gain.setValueAtTime(0.4, t);
    kG.gain.setTargetAtTime(0, t + 0.08, 0.03);
    kick.connect(kG);
    kG.connect(musicGain);
    kick.start(t);
    kick.stop(t + 0.2);
  }

  // Hi-hat on every beat, open on off-beats
  const hatBuf = actx.createBuffer(1, actx.sampleRate * 0.05, actx.sampleRate);
  const hatD = hatBuf.getChannelData(0);
  for (let i = 0; i < hatD.length; i++) hatD[i] = (Math.random() * 2 - 1) * (1 - i / hatD.length);
  const hat = actx.createBufferSource();
  hat.buffer = hatBuf;
  const hatG = actx.createGain();
  hatG.gain.value = beatInBar % 2 === 1 ? 0.12 : 0.08;
  const hatF = actx.createBiquadFilter();
  hatF.type = 'highpass';
  hatF.frequency.value = 8000;
  hat.connect(hatF);
  hatF.connect(hatG);
  hatG.connect(musicGain);
  hat.start(t);

  // Pad chord on beat 0 of each bar (sustained)
  if (beatInBar === 0) {
    chord.forEach((f, ci) => {
      const padOsc = actx.createOscillator();
      const padG = actx.createGain();
      padOsc.type = 'sine';
      padOsc.frequency.value = f * 2; // one octave up for shimmer
      padG.gain.value = 0.06;
      padG.gain.setTargetAtTime(0, t + BEAT * 3.5, 0.3);
      padOsc.connect(padG);
      padG.connect(musicGain);
      padOsc.start(t);
      padOsc.stop(t + BEAT * 4);
    });
  }

  // Arp on beats 1 and 3
  if (beatInBar === 1 || beatInBar === 3) {
    const arpNote = chord[_musicBeat % chord.length] * 2;
    const arp = actx.createOscillator();
    const arpG = actx.createGain();
    arp.type = 'square';
    arp.frequency.value = arpNote;
    arpG.gain.value = 0.07;
    arpG.gain.setTargetAtTime(0, t + BEAT * 0.4, 0.05);
    arp.connect(arpG);
    arpG.connect(musicGain);
    arp.start(t);
    arp.stop(t + BEAT * 0.6);
  }

  _musicBeat++;
  if (_musicBeat % 4 === 0) _musicChord++;
}

export function stopMusic() {
  if (musicInterval) { clearInterval(musicInterval); musicInterval = null; }
  _musicBeat = 0;
  _musicChord = 0;
}
