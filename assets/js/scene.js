// ============================================
// SCENE.JS — 3D Network Scene (Three.js ES Module)
// "A Living Network" — glowing nodes, lines,
// data packets, floating project panels
// ============================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

(function () {
  'use strict';

  /* ═══════════════════════════════════════════
     EARLY GUARDS
     ═══════════════════════════════════════════ */
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function testWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  if (!testWebGL()) {
    const fb = document.createElement('div');
    fb.id = 'scene-fallback';
    fb.setAttribute('aria-hidden', 'true');
    Object.assign(fb.style, {
      position: 'fixed', inset: '0', zIndex: '-1',
      background: 'radial-gradient(ellipse at 50% 40%, #0f172a 0%, #09090b 70%)',
      pointerEvents: 'none',
    });
    document.body.prepend(fb);
    window.__scene3d = { setProgress() {}, setSection() {}, setMouse() {} };
    return;
  }

  /* ═══════════════════════════════════════════
     CONSTANTS
     ═══════════════════════════════════════════ */
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
                   window.innerWidth < 768;
  const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
  const NODE_COUNT = isMobile ? 80 : 200;
  const LINE_DISTANCE = isMobile ? 3.5 : 4.5;
  const ENABLE_BLOOM = !isMobile;
  const PACKET_COUNT = isMobile ? 15 : 40;

  /* Colors */
  const CYAN = new THREE.Color(0x38bdf8);
  const VIOLET = new THREE.Color(0xa78bfa);
  const DARK_BG = new THREE.Color(0x09090b);

  /* ═══════════════════════════════════════════
     CANVAS + RENDERER
     ═══════════════════════════════════════════ */
  const canvas = document.createElement('canvas');
  canvas.id = 'scene3d';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', zIndex: '-1',
    pointerEvents: 'none', width: '100%', height: '100%',
  });
  document.body.prepend(canvas);
  canvas.style.opacity = '0.72';
  canvas.style.transition = 'opacity 700ms ease';

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(MAX_DPR);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(DARK_BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  /* ═══════════════════════════════════════════
     SCENE + CAMERA
     ═══════════════════════════════════════════ */
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(DARK_BG, 0.018);

  const camera = new THREE.PerspectiveCamera(
    60, window.innerWidth / window.innerHeight, 0.1, 200
  );
  camera.position.set(0, 0, 20);
  scene.add(camera);

  /* ═══════════════════════════════════════════
     POST-PROCESSING (Bloom)
     ═══════════════════════════════════════════ */
  let composer = null;
  if (ENABLE_BLOOM) {
    try {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.2,   // strength (brighter glow)
        0.6,   // radius
        0.35   // threshold (more elements glow)
      );
      composer.addPass(bloomPass);
    } catch (e) {
      console.warn('Bloom post-processing unavailable:', e);
      composer = null;
    }
  }

  /* ═══════════════════════════════════════════
     NODES — InstancedMesh
     ═══════════════════════════════════════════ */
  const nodeGeo = new THREE.SphereGeometry(0.18, 10, 10);
  const nodeMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 1.0 });
  const nodesMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, NODE_COUNT);
  scene.add(nodesMesh);

  const nodePositions = [];
  const nodeBaseColors = [];
  const nodePhases = [];
  const nodeIsViolet = [];
  const dummy = new THREE.Object3D();

  const SPREAD = 14;
  for (let i = 0; i < NODE_COUNT; i++) {
    const pos = new THREE.Vector3(
      (Math.random() - 0.5) * SPREAD * 2,
      (Math.random() - 0.5) * SPREAD * 1.4,
      (Math.random() - 0.5) * SPREAD * 2.5
    );
    nodePositions.push(pos);
    nodePhases.push(Math.random() * Math.PI * 2);

    const isViolet = Math.random() < 0.15;
    nodeIsViolet.push(isViolet);
    nodeBaseColors.push(isViolet ? VIOLET.clone() : CYAN.clone());

    dummy.position.copy(pos);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    nodesMesh.setMatrixAt(i, dummy.matrix);
    nodesMesh.setColorAt(i, nodeBaseColors[i]);
  }
  nodesMesh.instanceMatrix.needsUpdate = true;
  nodesMesh.instanceColor.needsUpdate = true;

  /* ═══════════════════════════════════════════
     CONNECTING LINES
     ═══════════════════════════════════════════ */
  const edges = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    for (let j = i + 1; j < NODE_COUNT; j++) {
      if (nodePositions[i].distanceTo(nodePositions[j]) < LINE_DISTANCE) {
        edges.push([i, j]);
      }
    }
  }

  const maxEdges = isMobile ? 200 : 600;
  if (edges.length > maxEdges) edges.length = maxEdges;

  const linePositions = new Float32Array(edges.length * 6);
  const lineColors = new Float32Array(edges.length * 6);
  const lineBaseAlpha = 0.2;

  function updateLinePositions() {
    for (let e = 0; e < edges.length; e++) {
      const [a, b] = edges[e];
      const pa = nodePositions[a], pb = nodePositions[b];
      const off = e * 6;
      linePositions[off]     = pa.x; linePositions[off + 1] = pa.y; linePositions[off + 2] = pa.z;
      linePositions[off + 3] = pb.x; linePositions[off + 4] = pb.y; linePositions[off + 5] = pb.z;

      const c = CYAN;
      lineColors[off]     = c.r * lineBaseAlpha;
      lineColors[off + 1] = c.g * lineBaseAlpha;
      lineColors[off + 2] = c.b * lineBaseAlpha;
      lineColors[off + 3] = c.r * lineBaseAlpha;
      lineColors[off + 4] = c.g * lineBaseAlpha;
      lineColors[off + 5] = c.b * lineBaseAlpha;
    }
  }
  updateLinePositions();

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const linesMesh = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(linesMesh);

  /* ═══════════════════════════════════════════
     DATA PACKETS
     ═══════════════════════════════════════════ */
  const packetGeo = new THREE.SphereGeometry(0.09, 6, 6);
  const packetMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc, transparent: true, opacity: 1.0,
  });
  const packetsMesh = new THREE.InstancedMesh(packetGeo, packetMat, PACKET_COUNT);
  scene.add(packetsMesh);

  const packetData = [];
  for (let i = 0; i < PACKET_COUNT; i++) {
    packetData.push({
      edgeIdx: Math.floor(Math.random() * Math.max(1, edges.length)),
      t: Math.random(),
      speed: 0.003 + Math.random() * 0.008,
      direction: Math.random() > 0.5 ? 1 : -1,
    });
  }

  let packetSpeedMul = 1.0;

  function updatePackets() {
    if (edges.length === 0) return;
    for (let i = 0; i < PACKET_COUNT; i++) {
      const p = packetData[i];
      p.t += p.speed * p.direction * packetSpeedMul;
      if (p.t > 1 || p.t < 0) {
        p.edgeIdx = Math.floor(Math.random() * edges.length);
        p.t = p.direction > 0 ? 0 : 1;
        p.speed = 0.003 + Math.random() * 0.008;
      }
      const [a, b] = edges[p.edgeIdx];
      const pa = nodePositions[a], pb = nodePositions[b];
      dummy.position.lerpVectors(pa, pb, p.t);
      dummy.scale.setScalar(0.8);
      dummy.updateMatrix();
      packetsMesh.setMatrixAt(i, dummy.matrix);
    }
    packetsMesh.instanceMatrix.needsUpdate = true;
  }

  /* ═══════════════════════════════════════════
     FLOATING PROJECT PANELS
     ═══════════════════════════════════════════ */
  const projectPanels = [];
  const panelGroup = new THREE.Group();
  scene.add(panelGroup);

  const projectImages = [
    'Projects/PiyuGuide/SuperadminPortal.jpg',
    'Projects/SiniloanDGP/SuperAdminDashboard.jpg',
    'Projects/Lost&Found/Dashboard.jpg',
    'Projects/PiyuClean/admindashboard.jpg',
  ];

  const textureLoader = new THREE.TextureLoader();
  const panelWidth = 3.2;
  const panelHeight = 2.0;

  projectImages.forEach((src, idx) => {
    const tex = textureLoader.load(src);
    tex.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.PlaneGeometry(panelWidth, panelHeight, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Border — slightly larger plane behind
    const borderGeo = new THREE.PlaneGeometry(panelWidth + 0.08, panelHeight + 0.08, 1, 1);
    const borderMat = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.z = -0.02;

    const group = new THREE.Group();
    group.add(border);
    group.add(mesh);

    // Position panels in a tunnel arrangement
    const angle = (idx / projectImages.length) * Math.PI * 0.8 - Math.PI * 0.4;
    const radius = 4.5;
    group.position.set(
      Math.sin(angle) * radius,
      (idx - 1.5) * 1.2,
      -5 - idx * 2
    );
    group.rotation.y = -angle * 0.3;

    panelGroup.add(group);
    projectPanels.push({
      group, mesh, border, mat, borderMat,
      basePos: group.position.clone(),
      hovered: false,
      texObj: tex, geoObj: geo, borderGeoObj: borderGeo,
    });
  });

  panelGroup.visible = true;

  /* ═══════════════════════════════════════════
     CAMERA PATH — CatmullRomCurve3
     ═══════════════════════════════════════════ */
  const cameraPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 2, 22),       // hero
    new THREE.Vector3(3, 1, 16),
    new THREE.Vector3(5, 0, 10),       // about
    new THREE.Vector3(4, -1, 5),
    new THREE.Vector3(2, -2, 0),       // experience
    new THREE.Vector3(0, -1, -4),
    new THREE.Vector3(-1, 0, -8),      // projects entry
    new THREE.Vector3(0, 0, -14),      // deep tunnel
    new THREE.Vector3(1, 1, -6),       // pulling back
    new THREE.Vector3(0, 2, 4),        // certifications
    new THREE.Vector3(-1, 2, 14),      // contact
    new THREE.Vector3(0, 2, 20),       // end
  ], false, 'catmullrom', 0.3);

  const cameraLookPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(2, 0, 8),
    new THREE.Vector3(3, -1, 4),
    new THREE.Vector3(2, -2, -2),
    new THREE.Vector3(0, -1, -6),
    new THREE.Vector3(-1, 0, -12),
    new THREE.Vector3(0, 0, -18),
    new THREE.Vector3(0, 0, -20),
    new THREE.Vector3(0, 0, -10),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 1, 8),
    new THREE.Vector3(0, 0, 10),
  ], false, 'catmullrom', 0.3);

  /* ═══════════════════════════════════════════
     SCROLL ATOM — the hero orbit resolves into a
     structural atom, then exits before Projects.
     ═══════════════════════════════════════════ */
  const atom = new THREE.Group();
  const atomCore = new THREE.Group();
  atom.add(atomCore);
  camera.add(atom);

  const atomMaterials = [];
  const makeAtomMaterial = (color, opacity) => {
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    atomMaterials.push({ material, opacity });
    return material;
  };

  const coreMaterial = makeAtomMaterial(0x7dd3fc, 0.96);
  const coreGlowMaterial = makeAtomMaterial(0x38bdf8, 0.22);
  atomCore.add(new THREE.Mesh(new THREE.SphereGeometry(0.27, 24, 24), coreMaterial));
  atomCore.add(new THREE.Mesh(new THREE.SphereGeometry(0.48, 24, 24), coreGlowMaterial));

  const orbitMaterials = [
    makeAtomMaterial(0x38bdf8, 0.72),
    makeAtomMaterial(0xa78bfa, 0.64),
    makeAtomMaterial(0x7dd3fc, 0.56),
  ];
  const electronMaterials = [
    makeAtomMaterial(0xffffff, 1),
    makeAtomMaterial(0x7dd3fc, 1),
    makeAtomMaterial(0xc4b5fd, 1),
  ];
  const electronPivots = [];
  for (let i = 0; i < 3; i++) {
    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(1.05, 0.012, 8, 120), orbitMaterials[i]
    );
    orbit.rotation.set(Math.PI / 2 + i * 0.62, i * 0.82, i * 0.34);
    atom.add(orbit);

    const pivot = new THREE.Group();
    const electron = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 16, 16), electronMaterials[i]
    );
    electron.position.x = 1.05;
    pivot.add(electron);
    pivot.rotation.set(Math.PI / 2 + i * 0.62, i * 0.82, i * 0.34);
    atom.add(pivot);
    electronPivots.push(pivot);
  }
  atom.position.set(2.15, 0.15, -8.5);
  atom.scale.setScalar(0.72);
  atom.visible = false;

  /* ═══════════════════════════════════════════
     SCROLL STATE (public API for scroll3d.js)
     ═══════════════════════════════════════════ */
  let scrollProgress = 0;
  let atomProgress = 0;
  let currentSection = 'hero';
  let mouseNX = 0, mouseNY = 0;

  window.__scene3d = {
    setProgress(p) { scrollProgress = Math.max(0, Math.min(1, p)); },
    setAtomProgress(p) {
      atomProgress = Math.max(0, Math.min(1, p));
      const fadeIn = THREE.MathUtils.smoothstep(atomProgress, 0.02, 0.22);
      const fadeOut = 1 - THREE.MathUtils.smoothstep(atomProgress, 0.72, 1);
      const opacity = fadeIn * fadeOut;
      atom.visible = opacity > 0.005;
      atomMaterials.forEach(({ material, opacity: baseOpacity }) => {
        material.opacity = baseOpacity * opacity;
      });
      // The atom moves off the card and toward the center as the orbit evolves.
      atom.position.x = THREE.MathUtils.lerp(2.15, -0.2, atomProgress);
      atom.position.y = THREE.MathUtils.lerp(0.15, 0.25, atomProgress) + Math.sin(atomProgress * Math.PI) * 0.35;
      atom.scale.setScalar(THREE.MathUtils.lerp(0.62, 1.12, fadeIn) * (0.9 + fadeOut * 0.1));
      atom.rotation.set(atomProgress * 0.45, atomProgress * 1.2, atomProgress * 0.3);
    },
    setSection(s) {
      currentSection = s;
      // Keep the scene expressive in the hero, then let the portfolio content lead.
      const opacityBySection = {
        hero: 0.78,
        about: 0.30,
        experience: 0.24,
        projects: 0.07,
        certifications: 0.20,
        contact: 0.28,
      };
      canvas.style.opacity = String(opacityBySection[s] ?? 0.2);
    },
    setMouse(nx, ny) { mouseNX = nx; mouseNY = ny; },
  };

  /* ═══════════════════════════════════════════
     RAYCASTER — Hover on nodes
     ═══════════════════════════════════════════ */
  const raycaster = new THREE.Raycaster();
  const raycasterMouse = new THREE.Vector2(-99, -99);
  let hoveredNodeIdx = -1;

  document.addEventListener('mousemove', (e) => {
    raycasterMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    raycasterMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }, { passive: true });

  function updateRaycaster() {
    raycaster.setFromCamera(raycasterMouse, camera);
    let closest = -1;
    let closestDist = Infinity;
    const ray = raycaster.ray;

    for (let i = 0; i < NODE_COUNT; i++) {
      const pos = nodePositions[i];
      const dist = ray.distanceToPoint(pos);
      const camDist = camera.position.distanceTo(pos);
      if (dist < 0.5 && camDist < closestDist && camDist < 30) {
        closest = i;
        closestDist = camDist;
      }
    }
    hoveredNodeIdx = closest;
  }

  /* ═══════════════════════════════════════════
     NODE PULSING + HOVER
     ═══════════════════════════════════════════ */
  const tempColor = new THREE.Color();

  function updateNodes(time) {
    for (let i = 0; i < NODE_COUNT; i++) {
      const pulse = 0.7 + 0.3 * Math.sin(time * 1.5 + nodePhases[i]);
      const baseScale = nodeIsViolet[i] ? 1.2 : 1.0;
      let scale = baseScale * pulse;
      let brightness = 1.0;

      if (hoveredNodeIdx === i) {
        scale *= 2.0;
        brightness = 2.5;
      } else if (hoveredNodeIdx >= 0) {
        for (let e = 0; e < edges.length; e++) {
          const [a, b] = edges[e];
          if ((a === hoveredNodeIdx && b === i) || (b === hoveredNodeIdx && a === i)) {
            scale *= 1.4;
            brightness = 1.8;
            break;
          }
        }
      }

      dummy.position.copy(nodePositions[i]);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      nodesMesh.setMatrixAt(i, dummy.matrix);

      tempColor.copy(nodeBaseColors[i]).multiplyScalar(brightness);
      nodesMesh.setColorAt(i, tempColor);
    }
    nodesMesh.instanceMatrix.needsUpdate = true;
    nodesMesh.instanceColor.needsUpdate = true;
  }

  /* ═══════════════════════════════════════════
     LINE HOVER HIGHLIGHTING
     ═══════════════════════════════════════════ */
  function updateLineColors() {
    for (let e = 0; e < edges.length; e++) {
      const [a, b] = edges[e];
      let alpha = lineBaseAlpha;
      if (hoveredNodeIdx >= 0 && (a === hoveredNodeIdx || b === hoveredNodeIdx)) {
        alpha = 0.55;
      }
      const off = e * 6;
      const c = CYAN;
      lineColors[off]     = c.r * alpha;
      lineColors[off + 1] = c.g * alpha;
      lineColors[off + 2] = c.b * alpha;
      lineColors[off + 3] = c.r * alpha;
      lineColors[off + 4] = c.g * alpha;
      lineColors[off + 5] = c.b * alpha;
    }
    lineGeo.attributes.color.needsUpdate = true;
  }

  /* ═══════════════════════════════════════════
     PANEL VISIBILITY (scroll-driven)
     ═══════════════════════════════════════════ */
  function updatePanels(time) {
    const inProject = currentSection === 'projects';

    for (let i = 0; i < projectPanels.length; i++) {
      const p = projectPanels[i];
      // Floating screenshots used to sit behind the real project cards, making
      // that section visually noisy. Keep these panels out of the reading flow.
      const targetOpacity = 0.0;
      const targetBorderOpacity = 0.0;

      p.mat.opacity += (targetOpacity - p.mat.opacity) * 0.05;
      p.borderMat.opacity += (targetBorderOpacity - p.borderMat.opacity) * 0.05;

      if (inProject) {
        p.group.rotation.x = mouseNY * 0.05;
        const targetRotY = -mouseNX * 0.06 + Math.sin(i + time * 0.4) * 0.02;
        p.group.rotation.y += (targetRotY - p.group.rotation.y) * 0.05;
      }
    }
  }

  /* ═══════════════════════════════════════════
     CAMERA UPDATE
     ═══════════════════════════════════════════ */
  const cameraOffset = new THREE.Vector3();

  function updateCamera(time) {
    const t = scrollProgress;
    const pos = cameraPath.getPointAt(t);
    const look = cameraLookPath.getPointAt(t);

    cameraOffset.set(mouseNX * 0.8, mouseNY * 0.5, 0);
    camera.position.copy(pos).add(cameraOffset);
    camera.lookAt(look);

    if (currentSection === 'hero' && !prefersReduced) {
      camera.position.x += Math.sin(time * 0.15) * 0.5;
      camera.position.y += Math.cos(time * 0.1) * 0.3;
    }
  }

  /* ═══════════════════════════════════════════
     PACKET SPEED BY SECTION
     ═══════════════════════════════════════════ */
  function updatePacketSpeed() {
    const speeds = {
      hero: 1.0, about: 0.8, experience: 1.3,
      projects: 0.9, certifications: 0.4, contact: 0.4,
    };
    packetSpeedMul = speeds[currentSection] || 0.7;
  }

  /* ═══════════════════════════════════════════
     VISIBILITY GUARDS
     ═══════════════════════════════════════════ */
  let isHidden = false;
  let isRunning = true;

  document.addEventListener('visibilitychange', () => {
    isHidden = document.hidden;
  });

  const canvasObserver = new IntersectionObserver((entries) => {
    isRunning = entries[0].isIntersecting;
  }, { threshold: 0 });
  canvasObserver.observe(canvas);

  /* ═══════════════════════════════════════════
     RESIZE
     ═══════════════════════════════════════════ */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
    }, 150);
  });

  /* ═══════════════════════════════════════════
     MAIN RENDER LOOP
     ═══════════════════════════════════════════ */
  const clock = new THREE.Clock();
  let frameCount = 0;

  function animate() {
    requestAnimationFrame(animate);

    if (isHidden || !isRunning) return;

    const time = clock.getElapsedTime();
    frameCount++;

    // Reduced motion: render 1 static frame
    if (prefersReduced && frameCount > 2) return;

    updatePacketSpeed();
    updateCamera(time);
    if (atom.visible) {
      atomCore.scale.setScalar(1 + Math.sin(time * 1.8) * 0.035);
      if (!prefersReduced) {
        electronPivots.forEach((pivot, i) => {
          pivot.rotation.z += 0.0025 + i * 0.0007;
        });
      }
    }
    updateNodes(time);
    updatePackets();
    updatePanels(time);

    // Raycaster: every 3rd frame for performance
    if (frameCount % 3 === 0) {
      updateRaycaster();
      updateLineColors();
    }

    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  animate();

  /* ═══════════════════════════════════════════
     CLEANUP
     ═══════════════════════════════════════════ */
  window.__scene3dDispose = function () {
    nodeGeo.dispose();
    nodeMat.dispose();
    lineGeo.dispose();
    lineMat.dispose();
    packetGeo.dispose();
    packetMat.dispose();
    projectPanels.forEach(p => {
      p.geoObj.dispose();
      p.mat.dispose();
      p.borderGeoObj.dispose();
      p.borderMat.dispose();
      if (p.texObj) p.texObj.dispose();
    });
    atom.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
    });
    atomMaterials.forEach(({ material }) => material.dispose());
    renderer.dispose();
    if (composer) {
      composer.passes.forEach(pass => { if (pass.dispose) pass.dispose(); });
    }
    canvasObserver.disconnect();
  };

})();
