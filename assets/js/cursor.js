// ============================================
// INTERACTIVE DOT GRID
// Canvas-based background grid with repel physics
// ============================================

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     CONFIGURATION
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
    LERP:              0.14,          // mouse position smoothing
  };

  /* ═══════════════════════════════════════════════
     GUARDS — Early exit for touch or reduced motion
     ═══════════════════════════════════════════════ */
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;

  // On touch-only devices without reduced motion, bail entirely
  if (!canHover && !prefersReduced) return;

  /* ═══════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════ */
  let rawMX = -400, rawMY = -400;       // raw mouse (from event)
  let mouseX = -400, mouseY = -400;     // throttled mouse (updated per frame)
  let smoothX = -400, smoothY = -400;   // lerp'd position
  let mouseInView = false;
  let mouseDirty = false;

  let dots = [];
  let W = 0, H = 0, dpr = 1;

  /* ═══════════════════════════════════════════════
     CANVAS SETUP
     ═══════════════════════════════════════════════ */
  const gridCvs = document.createElement('canvas');
  gridCvs.id = 'dotGrid';
  gridCvs.setAttribute('aria-hidden', 'true');
  Object.assign(gridCvs.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '-1',
    pointerEvents: 'none',
  });
  const gCtx = gridCvs.getContext('2d');

  function sizeCanvases() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    gridCvs.width = W * dpr;
    gridCvs.height = H * dpr;
    gridCvs.style.width = W + 'px';
    gridCvs.style.height = H + 'px';
    gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
     MAIN ANIMATION LOOP
     ═══════════════════════════════════════════════ */
  function animate() {
    if (mouseDirty) {
      mouseX = rawMX;
      mouseY = rawMY;
      mouseDirty = false;
    }

    smoothX += (mouseX - smoothX) * CFG.LERP;
    smoothY += (mouseY - smoothY) * CFG.LERP;

    drawGrid();
    requestAnimationFrame(animate);
  }

  /* ═══════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════ */
  function init() {
    // Insert grid canvas behind content via z-index: -1
    document.body.prepend(gridCvs);

    sizeCanvases();
    initDots();

    // Reduced motion: static grid, no animation
    if (prefersReduced) {
      drawStaticGrid();
      return;
    }

    if (!canHover) return;

    // Track mouse for dot grid physics
    document.addEventListener('mousemove', e => {
      rawMX = e.clientX;
      rawMY = e.clientY;
      mouseDirty = true;
    }, { passive: true });

    document.addEventListener('mouseenter', () => { mouseInView = true; });
    document.addEventListener('mouseleave', () => { mouseInView = false; });

    let rTimer;
    window.addEventListener('resize', () => {
      clearTimeout(rTimer);
      rTimer = setTimeout(() => { sizeCanvases(); initDots(); }, 200);
    });

    requestAnimationFrame(animate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
