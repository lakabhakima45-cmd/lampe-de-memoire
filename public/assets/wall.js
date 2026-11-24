// La lampe de mémoire · le mur dans le noir et la lampe (canvas)
window.makeWall = function (canvas, messages, { auto = false, onFound = () => {}, onOpen = () => {} } = {}) {
  const W = 1280, H = 720, g = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tex = document.createElement('canvas'); tex.width = W; tex.height = H;
  function texture() {
    const t = tex.getContext('2d', { willReadFrequently: true }); seed = 7;
    t.fillStyle = '#5b5146'; t.fillRect(0, 0, W, H);
    let y = 0, row = 0;
    while (y < H) { const bh = 80 + rnd() * 30; let x = -(row % 2) * 70; while (x < W) { const bw = 120 + rnd() * 80; t.fillStyle = `hsl(32,${10 + rnd() * 8}%,${38 + rnd() * 12}%)`; t.fillRect(x + 2, y + 2, bw - 4, bh - 4); x += bw; } y += bh; row++; }
    const id = t.getImageData(0, 0, W, H), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - .5) * 40; d[i] += n; d[i + 1] += n; d[i + 2] += n * .9; }
    t.putImageData(id, 0, 0);
    for (let i = 0; i < 300; i++) { t.strokeStyle = `rgba(30,24,18,${.1 + rnd() * .25})`; t.lineWidth = .5 + rnd(); t.beginPath(); const x = rnd() * W, yy = rnd() * H; t.moveTo(x, yy); t.lineTo(x + (rnd() - .5) * 60, yy + (rnd() - .5) * 30); t.stroke(); }
    t.fillStyle = t.strokeStyle = 'rgba(232,222,200,.82)'; t.textAlign = 'center'; t.lineCap = 'round'; t.direction = 'ltr';
    for (const m of messages) {
      t.save(); t.translate(m.x, m.y);
      if (m.special) { t.font = 'italic 500 64px Lora, Georgia, serif'; t.fillText('17', 0, 40); t.lineWidth = 4; t.beginPath(); t.moveTo(-46, 22); t.lineTo(48, 8); t.stroke(); t.font = 'italic 600 60px Lora, Georgia, serif'; t.fillText('18', 4, -40); }
      else { t.rotate(m.r); t.font = `italic ${m.size}px Lora, Georgia, serif`; t.fillText(m.graffiti, 0, 0); }
      t.restore();
    }
  }
  const dark = document.createElement('canvas'); dark.width = W; dark.height = H; const dg = dark.getContext('2d');
  const lamp = { x: 200, y: 600, tx: 200, ty: 600 }, R = 130, found = new Set();
  let allOn = false, newDots = new Set(), stop = false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(ts) {
    if (stop) return;
    if (auto) { const s = ts / 1000; lamp.tx = 640 + Math.sin(s * .5) * 420; lamp.ty = 360 + Math.sin(s * .37 + 1) * 210; if (reduce) { lamp.tx = 640; lamp.ty = 370; } }
    lamp.x += (lamp.tx - lamp.x) * .14; lamp.y += (lamp.ty - lamp.y) * .14;
    g.drawImage(tex, 0, 0);
    if (!allOn) {
      dg.globalCompositeOperation = 'source-over'; dg.clearRect(0, 0, W, H); dg.fillStyle = 'rgba(10,8,6,.965)'; dg.fillRect(0, 0, W, H);
      dg.globalCompositeOperation = 'destination-out'; const gr = dg.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, R);
      gr.addColorStop(0, '#000'); gr.addColorStop(.55, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); dg.fillStyle = gr; dg.beginPath(); dg.arc(lamp.x, lamp.y, R, 0, 7); dg.fill();
      g.drawImage(dark, 0, 0);
      g.save(); g.globalCompositeOperation = 'lighter'; const gl = g.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, R); gl.addColorStop(0, 'rgba(224,151,43,.16)'); gl.addColorStop(1, 'rgba(224,151,43,0)'); g.fillStyle = gl; g.fillRect(lamp.x - R, lamp.y - R, 2 * R, 2 * R); g.restore();
    }
    for (const m of messages) {
      if (!found.has(m.id) && Math.hypot(lamp.x - m.x, lamp.y - m.y) < R * .6) { found.add(m.id); onFound(m); }
      if (newDots.has(m.id)) { g.beginPath(); g.arc(m.x + (m.special ? 60 : 50), m.y - (m.special ? 60 : 30), 6, 0, 7); g.fillStyle = '#E0972B'; g.fill(); }
    }
    if (!auto) { g.beginPath(); g.arc(lamp.x, lamp.y, 7, 0, 7); g.fillStyle = 'rgba(255,246,230,.9)'; g.fill(); }
    requestAnimationFrame(frame);
  }
  const toWall = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
  const nearest = (x, y, max = 90) => { let best = null, bd = max; for (const m of messages) { const d = Math.hypot(x - m.x, y - (m.y - (m.special ? 10 : 8))); if (d < bd) { bd = d; best = m; } } return best; };
  if (!auto) {
    canvas.addEventListener('pointermove', e => { [lamp.tx, lamp.ty] = toWall(e); });
    canvas.addEventListener('pointerdown', e => { [lamp.tx, lamp.ty] = toWall(e); });
    canvas.addEventListener('click', e => { const [x, y] = toWall(e); const m = nearest(x, y); if (m && (allOn || Math.hypot(lamp.x - m.x, lamp.y - m.y) < R)) { if (!found.has(m.id)) { found.add(m.id); onFound(m); } onOpen(m); } });
    canvas.addEventListener('keydown', e => {
      const s = 40, k = e.key;
      if (k === 'ArrowLeft') lamp.tx -= s; else if (k === 'ArrowRight') lamp.tx += s; else if (k === 'ArrowUp') lamp.ty -= s; else if (k === 'ArrowDown') lamp.ty += s;
      else if (k === 'Enter' || k === ' ') { const m = nearest(lamp.x, lamp.y, R); if (m) { if (!found.has(m.id)) { found.add(m.id); onFound(m); } onOpen(m); } e.preventDefault(); return; }
      else return;
      e.preventDefault(); lamp.tx = Math.max(0, Math.min(W, lamp.tx)); lamp.ty = Math.max(0, Math.min(H, lamp.ty));
    });
  }
  texture();
  if (document.fonts) document.fonts.ready.then(texture);
  requestAnimationFrame(frame);
  return {
    found, setAll(on) { allOn = on; if (on) messages.forEach(m => { if (!found.has(m.id)) { found.add(m.id); onFound(m); } }); },
    markNew(ids) { newDots = new Set(ids); }, destroy() { stop = true; }
  };
};
