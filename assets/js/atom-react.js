import * as THREE from 'three';

/**
 * Crawling Atom Locomotion & Tendril Reactivity Engine
 *
 * Implements spider/octopus-like crawling across portfolio DOM elements:
 * - Collects & caches anchor points (corners, edge midpoints, text lines) in PAGE space
 * - 4-6 tendril legs (3 on mobile) with SEARCH -> REACH -> GRIP -> PULL -> RELEASE state machines
 * - Damped spring locomotion (accel = (target - pos)*k - vel*c, k ~ 30, c ~ 8)
 * - Staggered crawling gait keeping >= 2 tendrils gripped at all times
 * - Text scraping (~120px/s) with glow ripples and card border light sweeps
 */
export function attachAtomReactivity(atom) {
  const reduceMotion = atom.reduceMotion;
  const mobile = window.innerWidth < 768;
  const maxTendrils = mobile ? 3 : 5;
  const pointCount = 32;

  // Inject styles for text ripple and card border sweep
  const style = document.createElement('style');
  style.id = 'atom-crawler-styles';
  style.textContent = `
    .atom-reactive-text {
      --prox: 0;
      transition: filter 160ms ease;
      filter: drop-shadow(0 0 calc(var(--prox) * 10px) rgba(56, 189, 248, calc(var(--prox) * 0.95)));
    }
    .atom-card-gripped {
      box-shadow: 0 0 24px rgba(56, 189, 248, 0.42), inset 0 0 8px rgba(56, 189, 248, 0.22) !important;
      border-color: rgba(56, 189, 248, 0.75) !important;
      transition: box-shadow 260ms ease, border-color 260ms ease;
    }
  `;
  document.head.appendChild(style);

  /* ═══════════════════════════════════════════════
     1. DOM ANCHOR COLLECTION & CACHING
     ═══════════════════════════════════════════════ */
  const selector = '.card-surface, .project-card, .cert-card, .badge-skill, .badge-role, button, a.btn, .btn, h1, h2, h3, p';
  const queryElements = () => [...document.querySelectorAll(selector)]
    .filter((el) => !el.closest('#mainNav, #atomGuide, footer, #theme-toggle'));

  let reactiveElements = queryElements();
  reactiveElements.forEach((el) => {
    if (['H1', 'H2', 'H3', 'P'].includes(el.tagName)) {
      el.classList.add('atom-reactive-text');
    }
  });

  // Cached anchor points in PAGE space (x, y)
  let anchors = [];
  let paragraphRects = [];

  function collectAnchors() {
    reactiveElements = queryElements();
    const newAnchors = [];
    const newParagraphRects = [];
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    reactiveElements.forEach((el, elIdx) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const pageLeft = rect.left + scrollX;
      const pageTop = rect.top + scrollY;
      const pageRight = rect.right + scrollX;
      const pageBottom = rect.bottom + scrollY;
      const isCard = el.matches('.card-surface, .project-card, .cert-card');
      const isBadge = el.matches('.badge-skill, .badge-role, button, a.btn, .btn');
      const isText = ['H1', 'H2', 'H3', 'P'].includes(el.tagName);

      if (el.tagName === 'P') {
        newParagraphRects.push({ pageLeft, pageTop, pageRight, pageBottom });
      }

      if (isCard || isBadge) {
        // Corners + edge midpoints
        const midX = (pageLeft + pageRight) * 0.5;
        const midY = (pageTop + pageBottom) * 0.5;
        const points = [
          { x: pageLeft, y: pageTop },
          { x: pageRight, y: pageTop },
          { x: pageLeft, y: pageBottom },
          { x: pageRight, y: pageBottom },
          { x: midX, y: pageTop },
          { x: midX, y: pageBottom },
          { x: pageLeft, y: midY },
          { x: pageRight, y: midY },
        ];
        points.forEach((pt, pIdx) => {
          newAnchors.push({
            id: `card_${elIdx}_${pIdx}`,
            element: el,
            type: isCard ? 'card' : 'badge',
            pageX: pt.x,
            pageY: pt.y,
            lineLeft: pageLeft,
            lineRight: pageRight,
            lastVisited: 0,
          });
        });
      } else if (isText) {
        // Text lines: start, middle, and end of each client rect
        const lineRects = el.getClientRects();
        const rectCount = Math.min(lineRects.length, 5);
        for (let r = 0; r < rectCount; r++) {
          const lRect = lineRects[r];
          if (lRect.width <= 4) continue;
          const lPageLeft = lRect.left + scrollX;
          const lPageTop = lRect.top + scrollY;
          const lPageRight = lRect.right + scrollX;
          const lPageMidY = lPageTop + lRect.height * 0.5;

          newAnchors.push(
            {
              id: `text_${elIdx}_${r}_start`,
              element: el,
              type: 'text',
              pageX: lPageLeft + 6,
              pageY: lPageMidY,
              lineLeft: lPageLeft,
              lineRight: lPageRight,
              lastVisited: 0,
            },
            {
              id: `text_${elIdx}_${r}_mid`,
              element: el,
              type: 'text',
              pageX: (lPageLeft + lPageRight) * 0.5,
              pageY: lPageMidY,
              lineLeft: lPageLeft,
              lineRight: lPageRight,
              lastVisited: 0,
            },
            {
              id: `text_${elIdx}_${r}_end`,
              element: el,
              type: 'text',
              pageX: lPageRight - 6,
              pageY: lPageMidY,
              lineLeft: lPageLeft,
              lineRight: lPageRight,
              lastVisited: 0,
            }
          );
        }
      }
    });

    anchors = newAnchors;
    paragraphRects = newParagraphRects;
  }

  collectAnchors();
  window.addEventListener('resize', collectAnchors, { passive: true });
  // Throttled anchor refresh
  let lastRefresh = performance.now();
  function checkAnchorRefresh(now) {
    if (now - lastRefresh > 1500) {
      lastRefresh = now;
      collectAnchors();
    }
  }

  /* ═══════════════════════════════════════════════
     2. TENDRIL GRAPHICS & STATE MACHINE
     ═══════════════════════════════════════════════ */
  function createTendrilMesh() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);

    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      // Bright glowing cyan ribbon gradient towards tip
      const col = new THREE.Color().setRGB(
        0.35 + t * 0.55,
        0.75 + t * 0.25,
        1.0
      );
      colors[i * 3]     = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, pointCount);

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 2,
    });
    const line = new THREE.Line(geometry, material);
    atom.scene.add(line);

    // Flowing particles along the tendril
    const flowCount = 3;
    const flowGeo = new THREE.BufferGeometry();
    const flowPos = new Float32Array(flowCount * 3);
    flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
    const flowMat = new THREE.PointsMaterial({
      size: 10,
      map: atom.sprite,
      color: 0xe0f7ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });
    const flow = new THREE.Points(flowGeo, flowMat);
    atom.scene.add(flow);

    // Contact pulse ring at the grip point
    const pulseMat = new THREE.SpriteMaterial({
      map: atom.sprite,
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pulse = new THREE.Sprite(pulseMat);
    pulse.scale.set(18, 18, 1);
    atom.scene.add(pulse);

    return { line, geometry, positions, material, flow, flowGeo, flowPos, flowMat, pulse, pulseMat };
  }

  const tendrils = [];
  for (let i = 0; i < maxTendrils; i++) {
    const mesh = createTendrilMesh();
    tendrils.push({
      id: i,
      state: 'SEARCH', // 'SEARCH', 'REACH', 'GRIP', 'RELEASE'
      anchor: null,
      tipPos: new THREE.Vector3(),
      reachProgress: 0,
      reachDuration: 0.35 + Math.random() * 0.25,
      gripTimer: 0,
      gripDuration: 1.3 + Math.random() * 1.0,
      releaseProgress: 0,
      scrapeOffset: 0,
      scrapeDir: (i % 2 === 0) ? 1 : -1,
      phase: (i / maxTendrils) * Math.PI * 2,
      weight: 0,
      pullForce: new THREE.Vector3(),
      ...mesh,
    });
  }

  // Pre-stagger tendrils on startup
  if (tendrils.length >= 2) {
    tendrils[0].gripTimer = 0.8;
    tendrils[1].gripTimer = 0.3;
  }

  /* ═══════════════════════════════════════════════
     3. ANCHOR SCORING & SELECTION (Legs finding grip)
     ═══════════════════════════════════════════════ */
  function findBestAnchor(tendril, atomPos, scrollX, scrollY, scrollVelocity, now) {
    const usedAnchorIds = new Set(
      tendrils.filter((t) => t.id !== tendril.id && t.anchor).map((t) => t.anchor.id)
    );

    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    const scrollDirY = scrollVelocity > 40 ? 1 : (scrollVelocity < -40 ? -1 : 0);
    const isScrambling = Math.abs(scrollVelocity) > 100;
    const maxSearchDist = isScrambling ? 720 : 520;
    const minSearchDist = 25;

    let bestAnchor = null;
    let bestScore = -Infinity;

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (usedAnchorIds.has(a.id)) continue;

      // Current screen coordinates
      const screenX = a.pageX - scrollX;
      const screenY = a.pageY - scrollY;

      // Must be currently inside or near viewport
      if (screenX < -60 || screenX > innerW + 60 || screenY < -60 || screenY > innerH + 60) {
        continue;
      }

      // Three.js coords (y is inverted)
      const threeX = screenX;
      const threeY = innerH - screenY;

      const dx = threeX - atomPos.x;
      const dy = threeY - atomPos.y;
      const dist = Math.hypot(dx, dy);

      if (dist < minSearchDist || dist > maxSearchDist) continue;

      // Base score: prefer natural reach distance ~ 180-260px
      let score = 360 - Math.abs(dist - 220);

      // Scroll direction bias: aggressively latch onto upcoming content
      if (scrollDirY !== 0) {
        // When scrolling down (scrollVelocity > 0), incoming content enters from below (screenY > atom, dy < 0)
        const inScrollDirection = (scrollDirY > 0 && dy < 0) || (scrollDirY < 0 && dy > 0);
        if (inScrollDirection) score += isScrambling ? 280 : 140;
      }

      // Bias toward side gutters & card edges
      if (screenX < 280 || screenX > innerW - 280) score += 45;
      if (a.type === 'card') score += 40;
      if (a.type === 'badge') score += 25;

      // Soft recency penalty: gently expires in 1.2s instead of 3s lockout
      if (a.lastVisited && now - a.lastVisited < 1200) {
        score -= (1200 - (now - a.lastVisited)) * 0.05;
      }

      // Tendril phase angle bias: spread legs in different directions
      const legAngle = Math.atan2(dy, dx);
      const idealAngle = tendril.phase;
      const angleDiff = Math.abs(Math.atan2(Math.sin(legAngle - idealAngle), Math.cos(legAngle - idealAngle)));
      score -= angleDiff * 20;

      if (score > bestScore) {
        bestScore = score;
        bestAnchor = a;
      }
    }

    return bestAnchor;
  }

  /* ═══════════════════════════════════════════════
     4. UPDATE TENDRILS & SPRING LOCOMOTION
     ═══════════════════════════════════════════════ */
  const bodyVelocity = atom.velocity || new THREE.Vector3();
  const netPull = new THREE.Vector3();
  let gripFlashProgress = 0;

  function updateCrawler(time, dt) {
    if (reduceMotion) return;

    const now = performance.now();
    checkAnchorRefresh(now);

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollVel = atom.scrollVelocity || 0;
    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    const atomPos = atom.position;
    const isScrambling = Math.abs(scrollVel) > 100;

    netPull.set(0, 0, 0);

    const grippedTendrils = tendrils.filter((t) => t.state === 'GRIP');
    const grippedCount = grippedTendrils.length;

    tendrils.forEach((tendril) => {
      // ─── STATE MACHINE ───
      if (tendril.state === 'SEARCH') {
        // Keep weight high so search tendril is always an alive, visible probe
        tendril.weight = Math.min(0.85, tendril.weight + dt * 4.0);

        // Fluid organic probe motion in its assigned sector
        const probeRadius = (isScrambling ? 220 : 150) + Math.sin(time * 3.0 + tendril.phase) * 35;
        const probeAngle = tendril.phase + Math.sin(time * 2.2 + tendril.id * 1.5) * 0.45;
        const probeTargetX = atomPos.x + Math.cos(probeAngle) * probeRadius;
        const probeTargetY = atomPos.y + Math.sin(probeAngle) * probeRadius;
        tendril.tipPos.lerp(new THREE.Vector3(probeTargetX, probeTargetY, 2), Math.min(1, dt * 7.0));

        const best = findBestAnchor(tendril, atomPos, scrollX, scrollY, scrollVel, now);
        if (best) {
          tendril.anchor = best;
          tendril.anchor.lastVisited = now;
          tendril.state = 'REACH';
          tendril.reachProgress = 0;
          const fastFactor = Math.min(3.5, 1 + Math.abs(scrollVel) * 0.005);
          tendril.reachDuration = Math.max(0.12, (0.32 + Math.random() * 0.18) / fastFactor);
          tendril.scrapeOffset = 0;
        }
      }

      if (tendril.state === 'REACH') {
        tendril.reachProgress += dt / tendril.reachDuration;
        tendril.weight = Math.min(1, tendril.weight + dt * 6.0);

        // Get current target anchor position in Three.js space
        const targetScreenX = tendril.anchor.pageX - scrollX;
        const targetScreenY = tendril.anchor.pageY - scrollY;
        const targetThree = new THREE.Vector3(targetScreenX, innerH - targetScreenY, 2);

        // Eased reach curve (overshoot slightly on contact)
        const t = Math.min(1, tendril.reachProgress);
        const ease = 1 - Math.pow(1 - t, 2.5);
        tendril.tipPos.lerpVectors(atomPos, targetThree, ease);

        if (tendril.reachProgress >= 1) {
          tendril.state = 'GRIP';
          tendril.gripTimer = 0;
          tendril.gripDuration = 1.3 + Math.random() * 1.2;

          // React element
          if (tendril.anchor.type === 'card' && tendril.anchor.element) {
            tendril.anchor.element.classList.add('atom-card-gripped');
          }
        }
      }

      if (tendril.state === 'GRIP') {
        tendril.gripTimer += dt;
        tendril.weight = Math.min(1, tendril.weight + dt * 6.0);

        // Sticky tip in PAGE space
        let targetScreenX = tendril.anchor.pageX - scrollX;
        let targetScreenY = tendril.anchor.pageY - scrollY;

        // Scraping text lines: slide along text line at ~120px/s
        if (tendril.anchor.type === 'text') {
          tendril.scrapeOffset += 120 * dt * tendril.scrapeDir;
          const currentX = tendril.anchor.pageX + tendril.scrapeOffset;
          if (currentX > tendril.anchor.lineRight) tendril.scrapeDir = -1;
          if (currentX < tendril.anchor.lineLeft) tendril.scrapeDir = 1;
          targetScreenX = THREE.MathUtils.clamp(currentX, tendril.anchor.lineLeft, tendril.anchor.lineRight) - scrollX;

          // Ripple effect via CSS variable
          if (tendril.anchor.element) {
            tendril.anchor.element.style.setProperty('--prox', '0.9');
          }
        }

        tendril.tipPos.set(targetScreenX, innerH - targetScreenY, 2);

        // Damped spring pull force: F = (anchor - pos) * k (k ~ 30)
        const kPull = 32.0;
        const pullX = (tendril.tipPos.x - atomPos.x) * kPull;
        const pullY = (tendril.tipPos.y - atomPos.y) * kPull;
        tendril.pullForce.set(pullX, pullY, 0);
        netPull.add(tendril.pullForce);

        // Release conditions:
        const dist = atomPos.distanceTo(tendril.tipPos);
        const isNear = dist < 45;
        const isOverstretched = dist > (isScrambling ? 540 : 440);
        const isSeverelyOverstretched = dist > 640;
        const outOfViewport = targetScreenX < -80 || targetScreenX > innerW + 80 ||
                              targetScreenY < -80 || targetScreenY > innerH + 80;
        const timeout = tendril.gripTimer >= tendril.gripDuration;

        // Gait safety: ensure at least 1-2 tendrils remain gripped unless severely overstretched or offscreen
        const canRelease = (grippedCount > 1) || isSeverelyOverstretched || outOfViewport;

        if (canRelease && (isNear || isOverstretched || outOfViewport || timeout)) {
          tendril.state = 'RELEASE';
          tendril.releaseProgress = 1;
          if (tendril.anchor && tendril.anchor.type === 'card' && tendril.anchor.element) {
            tendril.anchor.element.classList.remove('atom-card-gripped');
          }
          if (tendril.anchor && tendril.anchor.type === 'text' && tendril.anchor.element) {
            tendril.anchor.element.style.setProperty('--prox', '0');
          }
        }
      }

      if (tendril.state === 'RELEASE') {
        tendril.releaseProgress -= dt / 0.16;
        tendril.weight = Math.max(0.65, tendril.releaseProgress);

        // Smoothly retract tip towards atom
        const targetScreenX = tendril.anchor ? tendril.anchor.pageX - scrollX : atomPos.x;
        const targetScreenY = tendril.anchor ? tendril.anchor.pageY - scrollY : (innerH - atomPos.y);
        const targetThree = new THREE.Vector3(targetScreenX, innerH - targetScreenY, 2);
        tendril.tipPos.lerpVectors(atomPos, targetThree, Math.max(0, tendril.releaseProgress));

        if (tendril.releaseProgress <= 0) {
          tendril.state = 'SEARCH';
          tendril.anchor = null;
        }
      }

      // ─── GEOMETRY DRAWING & VISUAL TIGHTENING ───
      const start = atomPos;
      const end = tendril.tipPos;

      // Line tightens as it pulls: lower wobble and straighter line
      const isGripped = tendril.state === 'GRIP';
      const isReaching = tendril.state === 'REACH';
      const wobbleAmp = isGripped ? 3.5 : 10.0;
      const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      const wobble = Math.sin(time * 3.2 + tendril.phase) * wobbleAmp;
      const control = midpoint.add(new THREE.Vector3((-dy / len) * wobble, (dx / len) * wobble, 2));

      const curve = new THREE.QuadraticBezierCurve3(start, control, end);

      for (let p = 0; p < pointCount; p++) {
        const u = p / (pointCount - 1);
        const pt = curve.getPoint(u);
        tendril.positions[p * 3]     = pt.x;
        tendril.positions[p * 3 + 1] = pt.y;
        tendril.positions[p * 3 + 2] = pt.z;
      }
      tendril.geometry.attributes.position.needsUpdate = true;
      tendril.geometry.setDrawRange(0, pointCount); // Always draw points so ribbon never collapses

      // Straighter, brighter line during PULL and active glow during SEARCH/REACH
      const brightnessBoost = isGripped ? 1.3 : (isReaching ? 1.05 : 0.85);
      tendril.material.opacity = Math.min(0.95, Math.max(0.48, tendril.weight) * brightnessBoost * atom.atomOpacity);

      // Flowing particles along the line
      for (let f = 0; f < 3; f++) {
        const flowU = ((time * (0.6 + Math.abs(scrollVel) * 0.002) + f / 3 + tendril.phase * 0.2) % 1);
        const flowPt = curve.getPoint(flowU);
        tendril.flowPos[f * 3]     = flowPt.x;
        tendril.flowPos[f * 3 + 1] = flowPt.y;
        tendril.flowPos[f * 3 + 2] = flowPt.z + 1;
      }
      tendril.flowGeo.attributes.position.needsUpdate = true;
      tendril.flowMat.opacity = isGripped ? 0.95 * tendril.weight * atom.atomOpacity : 0.5 * tendril.weight * atom.atomOpacity;

      // Contact pulse ring at tip
      if (isGripped && tendril.weight > 0.5) {
        tendril.pulse.position.copy(end);
        const pulseScale = (14 + Math.sin(time * 6.0 + tendril.phase) * 5) + gripFlashProgress * 18;
        tendril.pulse.scale.set(pulseScale, pulseScale, 1);
        tendril.pulseMat.opacity = Math.max(0.75 * tendril.weight * atom.atomOpacity, gripFlashProgress * 0.95 * atom.atomOpacity);
      } else if (gripFlashProgress > 0) {
        tendril.pulse.position.copy(end);
        const pulseScale = 14 + gripFlashProgress * 20;
        tendril.pulse.scale.set(pulseScale, pulseScale, 1);
        tendril.pulseMat.opacity = gripFlashProgress * 0.85 * atom.atomOpacity;
      } else {
        tendril.pulseMat.opacity = 0;
      }
    });

    if (gripFlashProgress > 0) {
      gripFlashProgress = Math.max(0, gripFlashProgress - dt * 2.0);
    }

    // ─── 5. SPRING-DAMPED BODY LOCOMOTION ───
    const effectiveGripped = Math.max(1, grippedCount);
    // Average pull force from gripped legs
    const avgPull = netPull.clone().multiplyScalar(1.0 / effectiveGripped);

    // Soft viewport centering constraint (vertical center)
    const targetY = innerH * 0.52;
    const centerForceY = (targetY - atomPos.y) * 4.5;

    // Horizontal boundary soft spring (keep between 60px and innerW - 60px)
    let boundForceX = 0;
    if (atomPos.x < 75) boundForceX = (75 - atomPos.x) * 12.0;
    if (atomPos.x > innerW - 75) boundForceX = (innerW - 75 - atomPos.x) * 12.0;

    // Subtle idle float
    const idleX = Math.sin(time * 0.9) * 14 + Math.sin(time * 2.1) * 6;
    const idleY = Math.cos(time * 0.8) * 12 + Math.cos(time * 1.8) * 5;

    // Damped spring acceleration: accel = pull + bounds + idle - vel * c (c ~ 8.0)
    const damping = 8.0;
    const accelX = avgPull.x + boundForceX + idleX - bodyVelocity.x * damping;
    const accelY = avgPull.y + centerForceY + idleY - bodyVelocity.y * damping;

    bodyVelocity.x += accelX * dt;
    bodyVelocity.y += accelY * dt;

    // Limit body speed (max ~900px/s)
    const maxSpeed = 900;
    if (bodyVelocity.length() > maxSpeed) {
      bodyVelocity.setLength(maxSpeed);
    }

    // Limit displacement to max ~40px per frame
    const maxFrameMove = 40;
    const frameMove = bodyVelocity.clone().multiplyScalar(dt);
    if (frameMove.length() > maxFrameMove) {
      frameMove.setLength(maxFrameMove);
    }

    atomPos.add(frameMove);

    // Body leans (banks) toward strongest pull
    let dominantAngle = 0;
    if (avgPull.lengthSq() > 20) {
      dominantAngle = Math.atan2(avgPull.y, avgPull.x);
    } else if (bodyVelocity.lengthSq() > 20) {
      dominantAngle = Math.atan2(bodyVelocity.y, bodyVelocity.x);
    }
    atom.atomRoot.rotation.z += (dominantAngle - atom.atomRoot.rotation.z) * Math.min(1, dt * 5.0);

    // Stretch slightly along movement direction
    const curSpeed = bodyVelocity.length();
    const stretch = 1.0 + Math.min(0.24, curSpeed / 1400);
    const squash = 1.0 / Math.sqrt(stretch);
    const baseScale = mobile ? 0.65 : 0.84;
    atom.atomRoot.scale.set(baseScale * stretch, baseScale * squash, baseScale);

    // Readability: fade to 35% opacity when body overlaps any paragraph
    const bodyScreenX = atomPos.x;
    const bodyScreenY = innerH - atomPos.y;
    const overlapsParagraph = paragraphRects.some((pr) => {
      const sL = pr.pageLeft - scrollX - 25;
      const sR = pr.pageRight - scrollX + 25;
      const sT = pr.pageTop - scrollY - 20;
      const sB = pr.pageBottom - scrollY + 20;
      return bodyScreenX >= sL && bodyScreenX <= sR && bodyScreenY >= sT && bodyScreenY <= sB;
    });

    const targetOpacity = (overlapsParagraph && !atom.isDischargeActive) ? 0.35 : 1.0;
    atom.atomOpacity += (targetOpacity - atom.atomOpacity) * Math.min(1, dt * 6.0);
    atom.canvas.style.opacity = atom.atomOpacity.toFixed(2);
  }

  return {
    update: updateCrawler,
    triggerGripFlash() {
      gripFlashProgress = 1.0;
    },
    getNearbyReactiveTargets(screenX, screenY, maxDist = 320, maxCount = 6) {
      const innerW = window.innerWidth;
      const innerH = window.innerHeight;
      const seenElements = new Set();
      const candidates = [];

      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (!a.element || seenElements.has(a.element)) continue;

        const rect = a.element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.bottom < 0 || rect.top > innerH || rect.right < 0 || rect.left > innerW) continue;

        const clampX = Math.max(rect.left, Math.min(screenX, rect.right));
        const clampY = Math.max(rect.top, Math.min(screenY, rect.bottom));
        const dist = Math.hypot(clampX - screenX, clampY - screenY);

        if (dist <= maxDist) {
          seenElements.add(a.element);
          candidates.push({
            element: a.element,
            edgeX: clampX,
            edgeY: clampY,
            dist,
          });
        }
      }

      candidates.sort((a, b) => a.dist - b.dist);
      return candidates.slice(0, maxCount);
    },

    getNearbyTextTargets(screenX, screenY, maxDist = 320, count = 3) {
      const innerW = window.innerWidth;
      const innerH = window.innerHeight;
      const seenElements = new Set();
      const textCandidates = [];

      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if (a.type !== 'text' || !a.element || seenElements.has(a.element)) continue;

        const rect = a.element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.bottom < 0 || rect.top > innerH || rect.right < 0 || rect.left > innerW) continue;

        const elMidX = rect.left + rect.width * 0.5;
        const elMidY = rect.top + rect.height * 0.5;
        const dist = Math.hypot(elMidX - screenX, elMidY - screenY);

        if (dist <= maxDist) {
          seenElements.add(a.element);
          textCandidates.push({
            element: a.element,
            x: elMidX,
            y: elMidY,
            dist,
          });
        }
      }

      textCandidates.sort((a, b) => a.dist - b.dist);
      return textCandidates.slice(0, count);
    },

    triggerPageGlitch(screenX, screenY, maxDist = 260, maxCount = 40) {
      const innerW = window.innerWidth;
      const innerH = window.innerHeight;
      const textEls = document.querySelectorAll('h1, h2, h3, h4, p, span, li, a');
      const items = [];

      for (let i = 0; i < textEls.length; i++) {
        const el = textEls[i];
        if (el.closest('#atomGuideMenu, #atomBubble, #atomClickTarget')) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (r.bottom < 0 || r.top > innerH || r.right < 0 || r.left > innerW) continue;

        const cx = r.left + r.width * 0.5;
        const cy = r.top + r.height * 0.5;
        const dist = Math.hypot(cx - screenX, cy - screenY);
        if (dist <= maxDist) {
          items.push({ el, dist });
        }
      }

      items.sort((a, b) => a.dist - b.dist);
      const chosen = items.slice(0, maxCount);

      chosen.forEach((item, idx) => {
        const stepDelay = Math.min(300, idx * 10);
        setTimeout(() => {
          item.el.classList.add('atom-text-glitch');
          setTimeout(() => {
            item.el.classList.remove('atom-text-glitch');
          }, 320);
        }, 50 + stepDelay);
      });
    },

    destroy() {
      style.remove();
      tendrils.forEach((t) => {
        atom.scene.remove(t.line, t.flow, t.pulse);
        t.geometry.dispose();
        t.material.dispose();
        t.flowGeo.dispose();
        t.flowMat.dispose();
        t.pulseMat.dispose();
      });
    },
  };
}
