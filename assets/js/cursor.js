// ============================================
// INTERACTIVE DOT GRID + HUD CURSOR
// Canvas-based background grid with repel physics
// + custom crosshair cursor with contextual labels
// ============================================

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     CONFIGURATION — Tune these constants to taste
     ═══════════════════════════════════════════════ */
  const CFG = {
    // Dot grid
    DOT_SPACING:       32,            // px between dots
    DOT_RADIUS:        1,             // base dot size
    DOT_RGB:           '56,189,248',  // accent color (RGB)
    DOT_ALPHA:         0.04,          // resting dot opacity
    DOT_ACTIVE_ALPHA:  0.25,          // opacity near cursor
    DOT_MAX:           5000,          // safety cap on total dots

    // Repel physics
    REPEL_RADIUS:      100,           // px — how far the push reaches
    REPEL_FORCE:       6,             // strength of the push
    SPRING:            0.055,         // pull-back stiffness
    DAMPING:           0.82,          // velocity decay per frame

    // Cursor HUD
    CURSOR_LERP:       0.14,          // cursor smoothing (0 = frozen, 1 = instant)
    RING_R:            14,            // ring radius at rest (px)
    RING_R_HOVER:      22,            // ring radius on interactive hover
    RING_LERP:         0.12,          // ring size transition speed
    LABEL_LERP:        0.16,          // label fade speed
    MAGNETIC:          0.12,          // magnetic pull toward hovered element center
  };

  /* ═══════════════════════════════════════════════
     GUARDS — Early exit for touch or reduced motion
     ═══════════════════════════════════════════════ */
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;

  // On touch-only devices, bail entirely (no grid, no cursor)
  if (!canHover && !prefersReduced) return;

  /* ═══════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════ */
  let rawMX = -400, rawMY = -400;       // raw mouse (from event)
  let mouseX = -400, mouseY = -400;     // throttled mouse (updated per frame)
  let smoothX = -400, smoothY = -400;   // lerp'd cursor position
  let mouseInView = false;
  let mouseDirty = false;               // true when mousemove fired since last frame

  let hoverTarget = null;
  let hoverLabel = '';
  let lastLabel = '';                    // persisted for fade-out
  let lastHoverX = -9999, lastHoverY = -9999;

  let currentRingR = CFG.RING_R;
  let labelAlpha = 0;

  let dots = [];
  let W = 0, H = 0, dpr = 1;

  /* ═══════════════════════════════════════════════
     CANVAS SETUP
     ═══════════════════════════════════════════════ */
  function makeCanvas(id, zIndex) {
    const c = document.createElement('canvas');
    c.id = id;
    c.setAttribute('aria-hidden', 'true');
    Object.assign(c.style, {
      position: 'fixed', inset: '0',
      zIndex: String(zIndex),
      pointerEvents: 'none',
    });
    return c;
  }

  const gridCvs = makeCanvas('dotGrid', -1);
  const cursorCvs = makeCanvas('cursorOverlay', 9999);
  const gCtx = gridCvs.getContext('2d');
  const cCtx = cursorCvs.getContext('2d');

  function sizeCanvases() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    [gridCvs, cursorCvs].forEach(c => {
      c.width = W * dpr;
      c.height = H * dpr;
      c.style.width = W + 'px';
      c.style.height = H + 'px';
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  /* ═══════════════════════════════════════════════
     DOT GRID — Initialization
     ═══════════════════════════════════════════════ */
  function initDots() {
    dots = [];
    const sp = CFG.DOT_SPACING;
    const cols = Math.ceil(W / sp) + 1;
    const rows = Math.ceil(H / sp) + 1;
    const total = Math.min(cols * rows, CFG.DOT_MAX);

    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ox = col * sp;
      const oy = row * sp;
      dots.push({ ox, oy, x: ox, y: oy, vx: 0, vy: 0 });
    }
  }

  /* ═══════════════════════════════════════════════
     DOT GRID — Static fallback (reduced-motion)
     ═══════════════════════════════════════════════ */
  function drawStaticGrid() {
    gCtx.fillStyle = `rgba(${CFG.DOT_RGB},${CFG.DOT_ALPHA})`;
    for (let i = 0; i < dots.length; i++) {
      gCtx.fillRect(dots[i].ox - 0.5, dots[i].oy - 0.5, 1, 1);
    }
  }

  /* ═══════════════════════════════════════════════
     DOT GRID — Physics + Draw (animated)
     ═══════════════════════════════════════════════ */
  function drawGrid() {
    gCtx.clearRect(0, 0, W, H);

    const repelR = CFG.REPEL_RADIUS;
    const repelR2 = repelR * repelR;
    const glowR = repelR * 1.5;
    const glowR2 = glowR * glowR;
    const rgb = CFG.DOT_RGB;
    const baseA = CFG.DOT_ALPHA;
    const activeA = CFG.DOT_ACTIVE_ALPHA;
    const force = CFG.REPEL_FORCE;
    const spring = CFG.SPRING;
    const damping = CFG.DAMPING;
    const sx = smoothX, sy = smoothY;
    const inView = mouseInView;

    // Pass 1: physics + batch-draw base dots
    gCtx.fillStyle = `rgba(${rgb},${baseA})`;
    const activeBuf = [];

    for (let i = 0, len = dots.length; i < len; i++) {
      const d = dots[i];

      // --- physics ---
      const dx = d.x - sx;
      const dy = d.y - sy;
      const dist2 = dx * dx + dy * dy;

      if (inView && dist2 < repelR2 && dist2 > 0.01) {
        const dist = Math.sqrt(dist2);
        const f = (1 - dist / repelR) * force;
        d.vx += (dx / dist) * f;
        d.vy += (dy / dist) * f;
      }

      d.vx += (d.ox - d.x) * spring;
      d.vy += (d.oy - d.y) * spring;
      d.vx *= damping;
      d.vy *= damping;
      d.x += d.vx;
      d.y += d.vy;

      // --- draw ---
      if (inView && dist2 < glowR2) {
        activeBuf.push(d.x, d.y, 1 - Math.sqrt(dist2) / glowR);
      } else {
        gCtx.fillRect(d.x - 0.5, d.y - 0.5, 1, 1);
      }
    }

    // Pass 2: active dots (per-dot alpha + size)
    for (let j = 0; j < activeBuf.length; j += 3) {
      const ax = activeBuf[j];
      const ay = activeBuf[j + 1];
      const t  = activeBuf[j + 2];
      const alpha = baseA + t * (activeA - baseA);
      const size = 1 + t * 0.8;
      gCtx.fillStyle = `rgba(${rgb},${alpha.toFixed(3)})`;
      gCtx.beginPath();
      gCtx.arc(ax, ay, size, 0, 6.2832);
      gCtx.fill();
    }
  }

  /* ═══════════════════════════════════════════════
     CURSOR HUD — Draw
     ═══════════════════════════════════════════════ */
  function drawCursor() {
    cCtx.clearRect(0, 0, W, H);
    if (!mouseInView) return;

    const cx = smoothX, cy = smoothY;
    const r = currentRingR;

    // --- Ring ---
    cCtx.strokeStyle = hoverTarget
      ? 'rgba(56,189,248,0.55)'
      : 'rgba(56,189,248,0.35)';
    cCtx.lineWidth = 1;
    cCtx.beginPath();
    cCtx.arc(cx, cy, r, 0, 6.2832);
    cCtx.stroke();

    // --- Tick marks (outside ring, cardinal directions) ---
    const ti = r + 3;
    const to = r + 8;
    cCtx.strokeStyle = 'rgba(56,189,248,0.2)';
    cCtx.lineWidth = 0.75;
    cCtx.beginPath();
    cCtx.moveTo(cx, cy - ti); cCtx.lineTo(cx, cy - to);
    cCtx.moveTo(cx, cy + ti); cCtx.lineTo(cx, cy + to);
    cCtx.moveTo(cx - ti, cy); cCtx.lineTo(cx - to, cy);
    cCtx.moveTo(cx + ti, cy); cCtx.lineTo(cx + to, cy);
    cCtx.stroke();

    // --- Center dot ---
    cCtx.fillStyle = 'rgba(56,189,248,0.5)';
    cCtx.beginPath();
    cCtx.arc(cx, cy, 1.5, 0, 6.2832);
    cCtx.fill();

    // --- Coordinates ---
    cCtx.font = "9px 'JetBrains Mono',monospace";
    cCtx.fillStyle = 'rgba(56,189,248,0.28)';
    cCtx.textBaseline = 'middle';
    cCtx.fillText(
      `${Math.round(mouseX)}, ${Math.round(mouseY)}`,
      cx + r + 12,
      cy + 1
    );

    // --- Label ---
    if (labelAlpha > 0.01) {
      const txt = hoverLabel || lastLabel;
      if (txt) {
        cCtx.save();
        cCtx.globalAlpha = labelAlpha;
        cCtx.font = "9px 'JetBrains Mono',monospace";
        cCtx.fillStyle = 'rgba(56,189,248,0.7)';
        cCtx.textAlign = 'center';
        cCtx.textBaseline = 'bottom';
        cCtx.fillText(txt, cx, cy - r - 8);
        cCtx.restore();
      }
    }
  }

  /* ═══════════════════════════════════════════════
     HOVER DETECTION — Label resolution
     ═══════════════════════════════════════════════ */
  function getLabelFor(el) {
    if (!el) return '';

    // Cards (outermost container matches)
    if (el.classList.contains('project-card')) return '[ VIEW ]';
    if (el.classList.contains('cert-card')) return '[ VIEW ]';

    // Links
    const a = el.tagName === 'A' ? el : el.closest('a');
    if (a) {
      if (a.hasAttribute('download'))       return '[ SAVE ]';
      if (a.href && a.href.includes('mailto:')) return '[ EMAIL ]';
      if (a.href && a.href.includes('tel:'))    return '[ CALL ]';
      if (a.classList.contains('nav-link'))      return '[ GO ]';
      if (a.classList.contains('social-icon'))   return '[ OPEN ]';
      if (a.classList.contains('btn-primary'))   return '[ VISIT ]';
      if (a.classList.contains('btn-secondary')) return '[ OPEN ]';
      if (a.classList.contains('btn-ghost'))     return '[ VIEW ]';
      return '[ OPEN ]';
    }

    // Buttons
    if (el.tagName === 'BUTTON' || el.closest('button')) return '[ CLICK ]';

    return '';
  }

  const INTERACTIVE_SELECTOR = 'a, button, [role="button"], .project-card, .cert-card';

  function updateHoverState() {
    if (!mouseInView) {
      hoverTarget = null;
      hoverLabel = '';
      return;
    }

    // Throttle: only re-check when mouse moved ≥ 2 px
    const hdx = mouseX - lastHoverX;
    const hdy = mouseY - lastHoverY;
    if (hdx * hdx + hdy * hdy < 4) return;
    lastHoverX = mouseX;
    lastHoverY = mouseY;

    const el = document.elementFromPoint(mouseX, mouseY);
    const interactive = el ? el.closest(INTERACTIVE_SELECTOR) : null;

    if (interactive !== hoverTarget) {
      hoverTarget = interactive;
      hoverLabel = getLabelFor(interactive);
      if (hoverLabel) lastLabel = hoverLabel;
    }
  }

  /* ═══════════════════════════════════════════════
     MAIN ANIMATION LOOP
     ═══════════════════════════════════════════════ */
  function animate() {
    // 1. Consume mouse (throttle to one read per frame)
    if (mouseDirty) {
      mouseX = rawMX;
      mouseY = rawMY;
      mouseDirty = false;
    }

    // 2. Lerp cursor position + magnetic pull
    let tx = mouseX, ty = mouseY;
    if (hoverTarget && mouseInView) {
      const r = hoverTarget.getBoundingClientRect();
      tx += (r.left + r.width / 2 - mouseX) * CFG.MAGNETIC;
      ty += (r.top + r.height / 2 - mouseY) * CFG.MAGNETIC;
    }
    smoothX += (tx - smoothX) * CFG.CURSOR_LERP;
    smoothY += (ty - smoothY) * CFG.CURSOR_LERP;

    // 3. Ring radius
    const targetR = hoverTarget ? CFG.RING_R_HOVER : CFG.RING_R;
    currentRingR += (targetR - currentRingR) * CFG.RING_LERP;

    // 4. Label fade
    const targetLA = hoverLabel ? 1 : 0;
    labelAlpha += (targetLA - labelAlpha) * CFG.LABEL_LERP;

    // 5. Hover detection
    updateHoverState();

    // 6. Render
    drawGrid();
    drawCursor();

    requestAnimationFrame(animate);
  }

  /* ═══════════════════════════════════════════════
     CSS — Hide default cursor (injected by JS so
     the normal cursor stays if JS fails to load)
     ═══════════════════════════════════════════════ */
  function injectCursorCSS() {
    const s = document.createElement('style');
    s.textContent = [
      'body.hud-cursor,',
      'body.hud-cursor a,',
      'body.hud-cursor button,',
      'body.hud-cursor [role="button"],',
      'body.hud-cursor label,',
      'body.hud-cursor summary { cursor: none !important; }',
      '',
      'body.hud-cursor input,',
      'body.hud-cursor textarea,',
      'body.hud-cursor select,',
      'body.hud-cursor [contenteditable="true"] { cursor: text !important; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════ */
  function init() {
    // Insert grid canvas (first child → behind content via z-index: -1)
    document.body.prepend(gridCvs);

    sizeCanvases();
    initDots();

    // ── Reduced motion: static grid, normal cursor, no animation ──
    if (prefersReduced) {
      drawStaticGrid();
      return;
    }

    // ── Touch-only without reduced motion: skip everything ──
    if (!canHover) return;

    // ── Full interactive mode ──
    document.body.appendChild(cursorCvs);
    injectCursorCSS();
    document.body.classList.add('hud-cursor');

    // Mouse tracking (passive, no preventDefault)
    document.addEventListener('mousemove', e => {
      rawMX = e.clientX;
      rawMY = e.clientY;
      mouseDirty = true;
    }, { passive: true });

    document.addEventListener('mouseenter', () => { mouseInView = true; });
    document.addEventListener('mouseleave', () => {
      mouseInView = false;
      hoverTarget = null;
      hoverLabel = '';
    });

    // Debounced resize
    let rTimer;
    window.addEventListener('resize', () => {
      clearTimeout(rTimer);
      rTimer = setTimeout(() => { sizeCanvases(); initDots(); }, 200);
    });

    // Go
    requestAnimationFrame(animate);
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
