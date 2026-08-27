// Minimap overlay — 2D canvas showing track outline and car positions

let canvas, ctx;
let trackData = null;
let bounds = null;
const SIZE = 160;
const PAD = 12;
const MARGIN = 12;

export function createMinimap() {
  if (canvas) destroyMinimap();
  canvas = document.createElement('canvas');
  canvas.id = 'minimap';
  canvas.width = SIZE;
  canvas.height = SIZE;
  Object.assign(canvas.style, {
    position: 'fixed',
    bottom: MARGIN + 'px',
    left: MARGIN + 'px',
    width: SIZE + 'px',
    height: SIZE + 'px',
    zIndex: '15',
    pointerEvents: 'none',
    border: '2px solid rgba(255,0,255,0.4)',
    borderRadius: '4px',
    background: 'rgba(10,0,21,0.7)',
    imageRendering: 'pixelated',
  });
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
}

export function initMinimapTrack(track) {
  const edgeL = track.edgeL;
  const edgeR = track.edgeR;

  // Compute bounding box from all edge points
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const arr of [edgeL, edgeR]) {
    for (const p of arr) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
  }

  // Downsample edges for drawing (every 4th point is plenty for 160px)
  const step = 4;
  const left = [], right = [];
  for (let i = 0; i < edgeL.length; i += step) {
    left.push({ x: edgeL[i].x, z: edgeL[i].z });
    right.push({ x: edgeR[i].x, z: edgeR[i].z });
  }

  bounds = { minX, maxX, minZ, maxZ };
  trackData = { left, right };
}

function toMinimap(wx, wz) {
  const rangeX = bounds.maxX - bounds.minX;
  const rangeZ = bounds.maxZ - bounds.minZ;
  const scale = (SIZE - PAD * 2) / Math.max(rangeX, rangeZ);
  const ox = (SIZE - rangeX * scale) / 2;
  const oz = (SIZE - rangeZ * scale) / 2;
  return {
    x: ox + (wx - bounds.minX) * scale,
    y: oz + (wz - bounds.minZ) * scale,
  };
}

/**
 * @param {{ x: number, z: number }} playerPos
 * @param {number[]} playerColor  [r,g,b] 0-1
 * @param {{ x: number, z: number, color: number[] }[]} others
 */
export function updateMinimap(playerPos, playerColor, others) {
  if (!ctx || !trackData || !bounds) return;
  ctx.clearRect(0, 0, SIZE, SIZE);

  // --- Track fill (left edge forward, right edge backward) ---
  ctx.fillStyle = 'rgba(50,20,80,0.5)';
  ctx.beginPath();
  const L = trackData.left, R = trackData.right;
  for (let i = 0; i < L.length; i++) {
    const p = toMinimap(L[i].x, L[i].z);
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  }
  for (let i = R.length - 1; i >= 0; i--) {
    const p = toMinimap(R[i].x, R[i].z);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  // --- Track edges ---
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,255,255,0.45)';
  for (const edge of [L, R]) {
    ctx.beginPath();
    for (let i = 0; i < edge.length; i++) {
      const p = toMinimap(edge[i].x, edge[i].z);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // --- Remote car dots ---
  for (const o of others) {
    const p = toMinimap(o.x, o.z);
    const [r, g, b] = o.color || [0.6, 0.6, 0.6];
    ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
    ctx.fillRect(p.x - 2, p.y - 2, 5, 5);
  }

  // --- Player dot (larger, with glow) ---
  if (playerPos) {
    const p = toMinimap(playerPos.x, playerPos.z);
    // glow ring
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    // solid dot
    const [r, g, b] = playerColor || [0, 1, 1];
    ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    // bright center
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function destroyMinimap() {
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  canvas = null;
  ctx = null;
  trackData = null;
  bounds = null;
}
