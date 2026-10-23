import * as THREE from 'three';
import { attachAtomReactivity } from './atom-react.js';

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = window.innerWidth < 768;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  // Strict performance budget: Desktop total particles < 8000, Mobile < 2500
  const orbitalParticleCount = mobile ? 750 : 2200;
  const dustCount = mobile ? 15 : 30; // Halved to reduce sparkle noise
  const outerShellCount = mobile ? 80 : 180;
  const trailCount = mobile ? 40 : 60;
  const nucleusCount = mobile ? 12 : 28;

  const canvas = document.createElement('canvas');
  canvas.id = 'foregroundAtomCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', zIndex: '40', width: '100%', height: '100%',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 280ms ease',
  });

  function supportsWebGL() {
    try {
      const test = document.createElement('canvas');
      return !!(test.getContext('webgl2') || test.getContext('webgl'));
    } catch (_) { return false; }
  }

  if (!supportsWebGL()) return;
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !mobile,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Perspective camera with FOV ~35
  const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 5000);

  function getCameraZ() {
    return window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }

  function frameCamera() {
    const width = window.innerWidth, height = window.innerHeight;
    camera.aspect = width / height;
    camera.position.set(width / 2, height / 2, getCameraZ());
    camera.lookAt(width / 2, height / 2, 0);
    camera.updateProjectionMatrix();
  }
  frameCamera();

  const atomRoot = new THREE.Group();
  scene.add(atomRoot);

  // Soft additive radial texture for particle sprites & glows
  function makeSoftSprite() {
    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = spriteCanvas.height = 64;
    const ctx = spriteCanvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(210,245,255,0.92)');
    gradient.addColorStop(0.18, 'rgba(125,211,252,0.70)');
    gradient.addColorStop(0.44, 'rgba(56,189,248,0.20)');
    gradient.addColorStop(0.82, 'rgba(56,189,248,0.03)');
    gradient.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(spriteCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const sprite = makeSoftSprite();

  // Curated color palette: core cyan #38bdf8, soft highlight #9ae6ff, violet #8b5cf6 (~15%). No pure white fills.
  const PALETTE = {
    cyan: new THREE.Color('#38bdf8'),
    softHighlight: new THREE.Color('#9ae6ff'),
    violet: new THREE.Color('#8b5cf6'),
    blueGrey: new THREE.Color('#284257'),
    darkNeutron: new THREE.Color('#1c2e3d'),
    deepNeutron: new THREE.Color('#223647'),
    brightProton: new THREE.Color('#d4f4ff'),
    warmProton: new THREE.Color('#e0d2f8'),
  };

  /* ═══════════════════════════════════════════════
     1. NUCLEUS (Brightened, 15% larger, 2x Fresnel, warm inner glow)
     ═══════════════════════════════════════════════ */
  const nucleusGroup = new THREE.Group();
  atomRoot.add(nucleusGroup);

  // 15% larger cluster: sphere radius 12.2 on desktop, 8.2 on mobile
  const sphereRadius = mobile ? 8.2 : 12.2;
  const nucleonGeometry = new THREE.SphereGeometry(sphereRadius, mobile ? 12 : 20, mobile ? 10 : 16);

  // Custom 2x Fresnel + Warm inner core glow + volume shading; strictly capped under 0.9
  function createNucleonMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9be0fc,
      roughness: 0.32,
      metalness: 0.14,
      emissive: new THREE.Color('#14425a'),
      emissiveIntensity: 0.52,
    });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec3 norm = normalize(normal);
        vec3 viewDir = normalize(vViewPosition);
        float NdotV = max(dot(norm, viewDir), 0.0);

        // 2x Increased Fresnel rim light
        float fresnel = pow(1.0 - NdotV, 2.0);
        diffuseColor.rgb += vec3(0.40, 0.88, 1.0) * fresnel * 0.95;

        // Warm inner core glow (cyan-white, intensity ~0.5)
        float innerCore = pow(NdotV, 1.4);
        diffuseColor.rgb += vec3(0.72, 0.94, 1.0) * innerCore * 0.52;

        // Ensure values strictly stay under 0.90 so spheres remain individually visible
        diffuseColor.rgb = min(diffuseColor.rgb, vec3(0.89));
        `
      );
    };
    mat.customProgramCacheKey = () => 'nucleus-nucleon-fresnel-v3-bright';
    return mat;
  }

  const nucleonMaterial = createNucleonMaterial();
  const nucleus = new THREE.InstancedMesh(nucleonGeometry, nucleonMaterial, nucleusCount);
  nucleus.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nucleusGroup.add(nucleus);

  const nucleusBase = [];
  const nucleonDummy = new THREE.Object3D();
  // 15% larger cluster spread
  const clusterSpread = mobile ? 12.8 : 19.0;

  // Make 6 to 8 of the spheres bright cyan-white protons and keep the rest blue-grey neutrons
  // Desktop: exactly 7 bright protons (indices: 0, 4, 7, 11, 15, 19, 23); Mobile: 3 bright protons (0, 4, 8)
  const protonSet = mobile ? new Set([0, 4, 8]) : new Set([0, 4, 7, 11, 15, 19, 23]);

  for (let i = 0; i < nucleusCount; i++) {
    const z = 1 - (2 * (i + 0.5)) / nucleusCount;
    const phi = i * Math.PI * (3 - Math.sqrt(5)); // Golden angle
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const dist = clusterSpread * (0.68 + (i % 4) * 0.15);
    const pos = new THREE.Vector3(
      Math.cos(phi) * radial * dist,
      z * dist,
      Math.sin(phi) * radial * dist
    );
    nucleusBase.push(pos);

    let col;
    if (protonSet.has(i)) {
      // Bright cyan-white protons (with a touch of warm violet-pink on a couple)
      col = (i === 7 || i === 19) ? PALETTE.warmProton : PALETTE.brightProton;
    } else {
      // Solid blue-grey neutrons
      col = (i % 3 === 0) ? PALETTE.darkNeutron : ((i % 2 === 0) ? PALETTE.deepNeutron : PALETTE.blueGrey);
    }

    nucleus.setColorAt(i, col);
    nucleonDummy.position.copy(pos);
    nucleonDummy.updateMatrix();
    nucleus.setMatrixAt(i, nucleonDummy.matrix);
  }
  nucleus.instanceMatrix.needsUpdate = true;
  if (nucleus.instanceColor) nucleus.instanceColor.needsUpdate = true;

  // Enhanced nucleus lighting & contact shading
  const atomPointLight = new THREE.PointLight(0xa5f3fc, 280, 260, 1.5);
  atomPointLight.position.set(-28, 38, 52);
  atomRoot.add(atomPointLight);

  if (!mobile) {
    const keyLight = new THREE.DirectionalLight(0xc2f2ff, 3.4);
    keyLight.position.set(-42, 52, 92);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(512, 512);
    keyLight.shadow.camera.left = -55;
    keyLight.shadow.camera.right = 55;
    keyLight.shadow.camera.top = 55;
    keyLight.shadow.camera.bottom = -55;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 230;
    keyLight.shadow.bias = -0.0006;
    atomRoot.add(keyLight);
    nucleus.castShadow = true;
    nucleus.receiveShadow = true;
  }
  atomRoot.add(new THREE.AmbientLight(0x567a99, 1.8));

  // Soft additive radial halo around whole nucleus (intensity ~0.4, values <= 0.88, no clipping)
  const nucleusGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sprite,
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const glowScale = mobile ? 95 : 142;
  nucleusGlow.scale.set(glowScale, glowScale, 1);
  nucleusGlow.position.z = -14;
  atomRoot.add(nucleusGlow);

  /* ═══════════════════════════════════════════════
     2. ORBITALS (Smooth glowing ribbons with bright core lines & tightened Gaussian spread)
     ═══════════════════════════════════════════════ */
  const orbitalVertexShader = `
    attribute vec3 aBaseColor;
    attribute float aBrightness;
    attribute float aSize;
    attribute float aArcProgress;
    attribute float aPhase;

    uniform float uTime;
    uniform float uSpeed;
    uniform float uMotion;
    uniform float uCameraDistance;
    uniform float uFocalDistance;
    uniform float uDepthOfField;
    uniform float uOpacity;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      float progress = fract(aArcProgress + uTime * uSpeed * uMotion * 0.05);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

      float viewZ = -mvPosition.z;
      float depthRatio = clamp(uCameraDistance / max(1.0, viewZ), 0.35, 2.2);

      // Depth boost: particles in front of nucleus brighter/larger, behind dimmer/smaller
      float zFrontBonus = clamp(1.0 + (position.z / 130.0) * 0.35, 0.65, 1.35);

      float dofDelta = abs(viewZ - uFocalDistance) / max(1.0, uFocalDistance);
      float dofSpread = 1.0 + dofDelta * uDepthOfField * 1.5;

      gl_PointSize = clamp(aSize * depthRatio * zFrontBonus * dofSpread, 0.9, 3.8);
      gl_Position = projectionMatrix * mvPosition;

      // Gentle flicker
      float flicker = mix(1.0, 0.88 + 0.12 * sin(uTime * 2.8 + aPhase), uMotion);
      float pathFade = 0.85 + 0.15 * sin(progress * 6.28318);

      // Subtle hue shimmer (±10 degrees)
      float hueShift = sin(uTime * 0.35 + aPhase) * 0.08;
      vec3 col = aBaseColor;
      col.r = clamp(col.r - hueShift * 0.4, 0.0, 0.88);
      col.g = clamp(col.g + hueShift * 0.35, 0.0, 0.88);
      col.b = clamp(col.b + hueShift * 0.75, 0.0, 0.88);

      vColor = col;
      vAlpha = aBrightness * flicker * pathFade * zFrontBonus * uOpacity;
    }
  `;

  const orbitalFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      vec2 coord = gl_PointCoord - 0.5;
      float dist = length(coord);
      float strength = exp(-dist * dist * 16.0) * (1.0 - smoothstep(0.25, 0.5, dist));
      if (strength < 0.02) discard;

      // Cap orbital particle brightness to eliminate harsh white sparkle noise
      vec3 finalCol = min(vColor, vec3(0.85));
      gl_FragColor = vec4(finalCol, vAlpha * strength);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  function randomGaussian() {
    let u1 = 0, u2 = 0;
    while (u1 === 0) u1 = Math.random();
    while (u2 === 0) u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  function buildRibbonGeometry(count, pathFn, normalFn, thickness, tilt) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const baseColors = new Float32Array(count * 3);
    const brightness = new Float32Array(count);
    const sizes = new Float32Array(count);
    const arcProgress = new Float32Array(count);
    const phases = new Float32Array(count);

    // 1. High-resolution arc-length lookup table
    const TABLE_SIZE = 1024;
    const arcTable = new Float32Array(TABLE_SIZE);
    let totalArc = 0;
    let prevPoint = pathFn(0);
    arcTable[0] = 0;
    for (let i = 1; i < TABLE_SIZE; i++) {
      const u = (i / (TABLE_SIZE - 1)) * Math.PI * 2;
      const pt = pathFn(u);
      totalArc += prevPoint.distanceTo(pt);
      arcTable[i] = totalArc;
      prevPoint = pt;
    }

    function getUForDistance(dist) {
      let low = 0, high = TABLE_SIZE - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (arcTable[mid] < dist) low = mid + 1;
        else high = mid;
      }
      const idx = Math.max(1, low);
      const d0 = arcTable[idx - 1], d1 = arcTable[idx];
      const factor = (d1 - d0 > 0.0001) ? (dist - d0) / (d1 - d0) : 0;
      const u0 = ((idx - 1) / (TABLE_SIZE - 1)) * Math.PI * 2;
      const u1 = (idx / (TABLE_SIZE - 1)) * Math.PI * 2;
      return u0 + (u1 - u0) * factor;
    }

    const euler = new THREE.Euler(tilt.x, tilt.y, tilt.z, 'XYZ');
    const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const targetDist = t * totalArc;
      const u = getUForDistance(targetDist);

      const center = pathFn(u);
      const { normal, binormal } = normalFn(u);

      // ~20% of particles sit directly on the core filament (gX = 0, gY = 0)
      const isCoreParticle = i % 5 === 0;
      const spreadFactor = isCoreParticle ? 0.25 : 1.0;
      const gX = randomGaussian() * thickness * spreadFactor;
      const gY = randomGaussian() * thickness * spreadFactor;

      const local = center.clone()
        .addScaledVector(normal, gX)
        .addScaledVector(binormal, gY);

      local.applyMatrix4(rotMatrix);

      positions[i * 3]     = local.x;
      positions[i * 3 + 1] = local.y;
      positions[i * 3 + 2] = local.z;

      // Color: 73% core cyan, 15% violet, 12% soft cyan highlight (no harsh white)
      const rColor = Math.random();
      const col = (rColor < 0.15)
        ? PALETTE.violet
        : ((rColor < 0.27) ? PALETTE.softHighlight : PALETTE.cyan);

      baseColors[i * 3]     = col.r;
      baseColors[i * 3 + 1] = col.g;
      baseColors[i * 3 + 2] = col.b;

      // Capped particle brightness: 0.35 to 0.65 to eliminate sparkle noise
      brightness[i] = 0.35 + Math.random() * 0.30;
      if (isCoreParticle) brightness[i] = 0.68;

      // Shrunk highlight particles (1.0 to 1.8px)
      sizes[i] = (rColor < 0.27) ? (1.0 + Math.random() * 0.6) : (1.1 + Math.random() * 1.3);

      arcProgress[i] = t;
      phases[i] = Math.random() * Math.PI * 2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aBaseColor', new THREE.BufferAttribute(baseColors, 3));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aArcProgress', new THREE.BufferAttribute(arcProgress, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 220);

    return geometry;
  }

  // Define 3 distinct orbital trajectories:
  // 1. Circular orbital
  const R_CIRC = mobile ? 64 : 86;
  const pathCircle = (u) => new THREE.Vector3(Math.cos(u) * R_CIRC, Math.sin(u) * R_CIRC, 0);
  const normalCircle = (u) => ({
    normal: new THREE.Vector3(Math.cos(u), Math.sin(u), 0),
    binormal: new THREE.Vector3(0, 0, 1),
  });

  // 2. Tilted ellipse orbital (eccentricity ~0.5)
  const A_ELLIPSE = mobile ? 78 : 104;
  const B_ELLIPSE = A_ELLIPSE * Math.sqrt(1 - 0.5 * 0.5);
  const pathEllipse = (u) => new THREE.Vector3(Math.cos(u) * A_ELLIPSE, Math.sin(u) * B_ELLIPSE, 0);
  const normalEllipse = (u) => {
    const tx = -A_ELLIPSE * Math.sin(u);
    const ty = B_ELLIPSE * Math.cos(u);
    const len = Math.hypot(tx, ty) || 1;
    return {
      normal: new THREE.Vector3(-ty / len, tx / len, 0),
      binormal: new THREE.Vector3(0, 0, 1),
    };
  };

  // 3. Figure-eight p-orbital lobe through nucleus (larger, thicker, brighter)
  const R_P = mobile ? 82 : 110; // Expanded to make lobes clearly prominent
  const pathFigureEight = (u) => new THREE.Vector3(
    Math.sin(u) * R_P,
    Math.sin(u * 2.0) * R_P * 0.54,
    Math.sin(u) * Math.cos(u) * R_P * 0.34
  );
  const normalFigureEight = (u) => {
    const tx = Math.cos(u) * R_P;
    const ty = Math.cos(u * 2.0) * R_P * 1.08;
    const tz = (Math.cos(u) * Math.cos(u) - Math.sin(u) * Math.sin(u)) * R_P * 0.34;
    const tangent = new THREE.Vector3(tx, ty, tz).normalize();
    const up = new THREE.Vector3(0, 0, 1);
    const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();
    if (binormal.lengthSq() < 0.01) binormal.set(1, 0, 0);
    const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
    return { normal, binormal };
  };

  // Tightened Gaussian spread by ~25% on circular & ellipse; p-orbital made thicker & brighter
  const orbitDefs = [
    {
      name: 'circular',
      pathFn: pathCircle,
      normalFn: normalCircle,
      thickness: mobile ? 1.8 : 2.4, // Tightened ~25% (was 3.2)
      tilt: { x: 0.36, y: -0.22, z: 0.12 },
      speed: 0.045,
      brightness: 0.82,
      isLoop: true,
      coreOpacity: 0.34,
      coreColor: 0x7dd3fc,
    },
    {
      name: 'ellipse',
      pathFn: pathEllipse,
      normalFn: normalEllipse,
      thickness: mobile ? 2.2 : 3.0, // Tightened ~25% (was 4.0)
      tilt: { x: 1.08, y: 0.42, z: -0.35 },
      speed: -0.032,
      brightness: 0.65,
      isLoop: true,
      coreOpacity: 0.30,
      coreColor: 0x5ecbfa,
    },
    {
      name: 'p-orbital',
      pathFn: pathFigureEight,
      normalFn: normalFigureEight,
      thickness: mobile ? 3.4 : 4.6, // Thicker so it stands out clearly
      tilt: { x: -0.74, y: 0.92, z: 0.28 },
      speed: 0.028,
      brightness: 0.88, // Brighter
      isLoop: false,
      coreOpacity: 0.48, // Clearly visible bright core line
      coreColor: 0x93c5fd,
    },
  ];

  const cameraDistance = getCameraZ();
  const orbitalLines = [];

  const orbitals = orbitDefs.map((def) => {
    // 1. Particle ribbon
    const geometry = buildRibbonGeometry(orbitalParticleCount, def.pathFn, def.normalFn, def.thickness, def.tilt);
    const uniforms = {
      uTime: { value: 0 },
      uSpeed: { value: def.speed },
      uMotion: { value: reduceMotion ? 0 : 1 },
      uCameraDistance: { value: cameraDistance },
      uFocalDistance: { value: cameraDistance },
      uDepthOfField: { value: mobile ? 0 : 0.45 },
      uOpacity: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: orbitalVertexShader,
      fragmentShader: orbitalFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    atomRoot.add(points);

    // 2. Faint bright core line along each path so band reads as a smooth glowing ribbon
    const LINE_SAMPLES = 200;
    const linePoints = [];
    const rotMat = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(def.tilt.x, def.tilt.y, def.tilt.z, 'XYZ')
    );
    for (let s = 0; s <= LINE_SAMPLES; s++) {
      const u = (s / LINE_SAMPLES) * Math.PI * 2;
      const pt = def.pathFn(u).clone().applyMatrix4(rotMat);
      linePoints.push(pt);
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({
      color: def.coreColor,
      transparent: true,
      opacity: def.coreOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      linewidth: 1.5,
    });
    const coreLine = def.isLoop ? new THREE.LineLoop(lineGeo, lineMat) : new THREE.Line(lineGeo, lineMat);
    atomRoot.add(coreLine);
    orbitalLines.push(coreLine);

    return { points, geometry, material, uniforms, coreLine, def };
  });

  // Faint dotted outer shell ring (low opacity ~0.10)
  const shellRadius = mobile ? 120 : 160;
  const shellGeo = new THREE.BufferGeometry();
  const shellPos = new Float32Array(outerShellCount * 3);
  const shellCol = new Float32Array(outerShellCount * 3);
  const shellBright = new Float32Array(outerShellCount);
  const shellSize = new Float32Array(outerShellCount);
  const shellArc = new Float32Array(outerShellCount);
  const shellPhase = new Float32Array(outerShellCount);
  const shellEuler = new THREE.Euler(0.85, -0.55, 0.2, 'XYZ');
  const shellMat4 = new THREE.Matrix4().makeRotationFromEuler(shellEuler);

  for (let i = 0; i < outerShellCount; i++) {
    const angle = (i / outerShellCount) * Math.PI * 2;
    const pt = new THREE.Vector3(Math.cos(angle) * shellRadius, Math.sin(angle) * shellRadius, 0);
    pt.applyMatrix4(shellMat4);
    shellPos[i * 3]     = pt.x;
    shellPos[i * 3 + 1] = pt.y;
    shellPos[i * 3 + 2] = pt.z;
    shellCol[i * 3]     = PALETTE.cyan.r;
    shellCol[i * 3 + 1] = PALETTE.cyan.g;
    shellCol[i * 3 + 2] = PALETTE.cyan.b;
    shellBright[i] = 0.10;
    shellSize[i] = 1.2;
    shellArc[i] = i / outerShellCount;
    shellPhase[i] = i;
  }
  shellGeo.setAttribute('position', new THREE.BufferAttribute(shellPos, 3));
  shellGeo.setAttribute('aBaseColor', new THREE.BufferAttribute(shellCol, 3));
  shellGeo.setAttribute('aBrightness', new THREE.BufferAttribute(shellBright, 1));
  shellGeo.setAttribute('aSize', new THREE.BufferAttribute(shellSize, 1));
  shellGeo.setAttribute('aArcProgress', new THREE.BufferAttribute(shellArc, 1));
  shellGeo.setAttribute('aPhase', new THREE.BufferAttribute(shellPhase, 1));

  const shellUniforms = {
    uTime: { value: 0 },
    uSpeed: { value: 0.01 },
    uMotion: { value: reduceMotion ? 0 : 1 },
    uCameraDistance: { value: cameraDistance },
    uFocalDistance: { value: cameraDistance },
    uDepthOfField: { value: 0 },
    uOpacity: { value: 1 },
  };
  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: shellUniforms,
    vertexShader: orbitalVertexShader,
    fragmentShader: orbitalFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const shellPoints = new THREE.Points(shellGeo, shellMaterial);
  atomRoot.add(shellPoints);

  // Soft ambient dust (halved count & softened brightness to eliminate white sparkle noise)
  const sparkleGeo = new THREE.BufferGeometry();
  const sparklePos = new Float32Array(dustCount * 3);
  const sparkleCol = new Float32Array(dustCount * 3);
  const sparkleBright = new Float32Array(dustCount);
  const sparkleSize = new Float32Array(dustCount);
  const sparkleArc = new Float32Array(dustCount);
  const sparklePhase = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = (mobile ? 70 : 110) * (0.6 + Math.random() * 0.8);
    sparklePos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    sparklePos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    sparklePos[i * 3 + 2] = r * Math.cos(phi);
    const isV = Math.random() < 0.15;
    const c = isV ? PALETTE.violet : PALETTE.softHighlight;
    sparkleCol[i * 3]     = c.r;
    sparkleCol[i * 3 + 1] = c.g;
    sparkleCol[i * 3 + 2] = c.b;
    sparkleBright[i] = 0.18 + Math.random() * 0.20;
    sparkleSize[i] = 0.9 + Math.random() * 1.0;
    sparkleArc[i] = Math.random();
    sparklePhase[i] = Math.random() * Math.PI * 2;
  }
  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePos, 3));
  sparkleGeo.setAttribute('aBaseColor', new THREE.BufferAttribute(sparkleCol, 3));
  sparkleGeo.setAttribute('aBrightness', new THREE.BufferAttribute(sparkleBright, 1));
  sparkleGeo.setAttribute('aSize', new THREE.BufferAttribute(sparkleSize, 1));
  sparkleGeo.setAttribute('aArcProgress', new THREE.BufferAttribute(sparkleArc, 1));
  sparkleGeo.setAttribute('aPhase', new THREE.BufferAttribute(sparklePhase, 1));

  const sparkleUniforms = {
    uTime: { value: 0 },
    uSpeed: { value: 0.015 },
    uMotion: { value: reduceMotion ? 0 : 1 },
    uCameraDistance: { value: cameraDistance },
    uFocalDistance: { value: cameraDistance },
    uDepthOfField: { value: mobile ? 0 : 0.35 },
    uOpacity: { value: 1 },
  };
  const sparkleMaterial = new THREE.ShaderMaterial({
    uniforms: sparkleUniforms,
    vertexShader: orbitalVertexShader,
    fragmentShader: orbitalFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const sparklePoints = new THREE.Points(sparkleGeo, sparkleMaterial);
  atomRoot.add(sparklePoints);

  /* ═══════════════════════════════════════════════
     3. ELECTRONS (4 Bright electrons with Keplerian speed & tapering trails)
     ═══════════════════════════════════════════════ */
  const trailVertexShader = `
    attribute vec3 aColor;
    attribute float aBrightness;
    attribute float aSize;
    uniform float uCameraDistance;
    uniform float uOpacity;
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      float depth = max(0.3, uCameraDistance / max(1.0, -mvPosition.z));
      gl_PointSize = clamp(aSize * depth, 0.5, 3.8);
      gl_Position = projectionMatrix * mvPosition;
      vColor = aColor;
      vAlpha = aBrightness * uOpacity;
    }
  `;

  function makeCometTrail(count, color) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const brightness = new Float32Array(count);
    const sizes = new Float32Array(count);
    const baseCol = new THREE.Color(color);

    for (let i = 0; i < count; i++) {
      const t = i / count;
      colors[i * 3]     = baseCol.r;
      colors[i * 3 + 1] = baseCol.g;
      colors[i * 3 + 2] = baseCol.b;
      const fade = Math.pow(1.0 - t, 1.8);
      brightness[i] = fade * 0.72;
      sizes[i] = (1.0 - t) * 3.0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 220);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCameraDistance: { value: cameraDistance },
        uOpacity: { value: 1 },
      },
      vertexShader: trailVertexShader,
      fragmentShader: orbitalFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    atomRoot.add(points);
    return { points, geometry, material };
  }

  // 4 clearly visible bright electrons (~3.6px with tight glow)
  const electronSphereGeo = new THREE.SphereGeometry(3.6, mobile ? 12 : 16, mobile ? 10 : 14);
  const electronColors = [0x54d2ff, 0xa78bfa, 0x8fe5ff, 0x38bdf8];
  const electrons = [];

  for (let i = 0; i < 4; i++) {
    const orbitIndex = [0, 1, 2, 0][i];
    const orbit = orbitDefs[orbitIndex];
    const eCol = electronColors[i];

    const mat = new THREE.MeshStandardMaterial({
      color: eCol,
      roughness: 0.18,
      metalness: 0.08,
      emissive: eCol,
      emissiveIntensity: 0.65,
    });
    const mesh = new THREE.Mesh(electronSphereGeo, mat);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sprite,
      color: eCol,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    glow.scale.set(18, 18, 1);

    const trail = makeCometTrail(trailCount, eCol);

    const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(orbit.tilt.x, orbit.tilt.y, orbit.tilt.z, 'XYZ')
    );

    electrons.push({
      mesh,
      glow,
      trail,
      orbitIndex,
      orbitDef: orbit,
      rotMatrix,
      angle: (i * Math.PI * 2) / 4 + i * 0.4,
      baseSpeed: 0.8 + i * 0.15,
      trailPositions: [],
    });

    atomRoot.add(mesh, glow);
  }

  function getOrbitPoint(electron, angle) {
    const local = electron.orbitDef.pathFn(angle).clone();
    local.applyMatrix4(electron.rotMatrix);
    return local;
  }

  /* ═══════════════════════════════════════════════
     4. CRAWLING BODY LOCOMOTION & STATE
     ═══════════════════════════════════════════════ */
  const velocity = new THREE.Vector3();
  const screenPosition = new THREE.Vector3();
  let scrollVelocity = 0;
  let currentScrollY = window.scrollY;
  let previousScrollY = currentScrollY;
  let elapsed = 0;
  let lastTime = performance.now();
  let hidden = document.hidden;
  let atomOpacity = 1;

  // Initial startup placement in hero section side area
  atomRoot.position.set(
    window.innerWidth - (mobile ? 64 : 110),
    window.innerHeight * 0.56,
    0
  );

  /* ═══════════════════════════════════════════════
     5. ANIMATION UPDATES
     ═══════════════════════════════════════════════ */
  function updateNucleus(time) {
    for (let i = 0; i < nucleusCount; i++) {
      const base = nucleusBase[i];
      // ~0.5px quantum shimmer jitter
      const jitter = reduceMotion ? 0 : 0.5;
      nucleonDummy.position.set(
        base.x + Math.sin(time * 9.2 + i * 2.1) * jitter,
        base.y + Math.cos(time * 8.4 + i * 2.7) * jitter,
        base.z + Math.sin(time * 7.9 + i * 1.6) * jitter
      );
      const scale = 0.96 + (i % 3) * 0.03;
      nucleonDummy.scale.setScalar(scale);
      nucleonDummy.updateMatrix();
      nucleus.setMatrixAt(i, nucleonDummy.matrix);
    }
    nucleus.instanceMatrix.needsUpdate = true;

    // Slow rotation
    nucleusGroup.rotation.set(
      reduceMotion ? 0 : time * 0.045,
      reduceMotion ? 0 : time * 0.065,
      reduceMotion ? 0 : time * 0.035
    );
  }

  function updateElectron(item, dt, speedBoost) {
    const pt = getOrbitPoint(item, item.angle);
    const distToCenter = pt.length();
    const keplerFactor = Math.min(2.2, Math.max(0.7, 120.0 / Math.max(25.0, distToCenter)));

    item.angle += dt * item.baseSpeed * speedBoost * keplerFactor;
    const currentPoint = getOrbitPoint(item, item.angle);
    const prevPoint = getOrbitPoint(item, item.angle - 0.03);

    item.mesh.position.copy(currentPoint);
    item.glow.position.copy(currentPoint);

    const motionDir = currentPoint.clone().sub(prevPoint).normalize();
    item.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), motionDir);
    const stretch = 1.0 + Math.min(0.65, Math.abs(speedBoost - 1.0) * 0.28);
    item.mesh.scale.set(1.0, stretch, 1.0);

    const isBehind = currentPoint.z < -10;
    item.mesh.material.emissiveIntensity = isBehind ? 0.35 : 0.72;
    item.glow.material.opacity = atomOpacity * (isBehind ? 0.18 : 0.42);

    const positions = item.trail.geometry.attributes.position.array;
    for (let i = 0; i < trailCount; i++) {
      const trailAngle = item.angle - (i * 0.024 * speedBoost) / keplerFactor;
      const trailPt = getOrbitPoint(item, trailAngle);
      positions[i * 3]     = trailPt.x;
      positions[i * 3 + 1] = trailPt.y;
      positions[i * 3 + 2] = trailPt.z;
    }
    item.trail.geometry.attributes.position.needsUpdate = true;
    item.trail.material.uniforms.uOpacity.value = atomOpacity * (isBehind ? 0.5 : 0.85);
  }

  let atomCrawler = null;

  function update(time, dt) {
    currentScrollY = window.scrollY;
    if (!reduceMotion) scrollVelocity *= Math.exp(-dt * 2.8);

    if (reduceMotion) {
      const idleGutter = new THREE.Vector3(
        window.innerWidth - (mobile ? 54 : 96),
        window.innerHeight * 0.5,
        0
      );
      atomRoot.position.lerp(idleGutter, Math.min(1, dt * 2.5));
      atomRoot.rotation.set(0, 0, 0);
      velocity.set(0, 0, 0);
    } else {
      if (atomCrawler) atomCrawler.update(time, dt);
    }

    const motionTime = reduceMotion ? 0 : time;
    updateNucleus(motionTime);

    orbitals.forEach((orb) => {
      orb.uniforms.uTime.value = motionTime;
      orb.uniforms.uOpacity.value = atomOpacity * orb.def.brightness;
      orb.points.rotation.z = motionTime * orb.def.speed * 0.35;
      orb.coreLine.rotation.z = motionTime * orb.def.speed * 0.35;
      orb.coreLine.material.opacity = atomOpacity * orb.def.coreOpacity;
    });

    shellUniforms.uTime.value = motionTime;
    shellUniforms.uOpacity.value = atomOpacity * 0.10;

    sparkleUniforms.uTime.value = motionTime;
    sparkleUniforms.uOpacity.value = atomOpacity * 0.22;

    nucleus.material.opacity = atomOpacity;
    nucleusGlow.material.opacity = atomOpacity * 0.42;

    const speedBoost = reduceMotion ? 1 : 1 + Math.min(2.5, Math.abs(scrollVelocity) * 0.001);
    electrons.forEach((item) => updateElectron(item, reduceMotion ? 0 : dt, speedBoost));
  }

  function renderLoop(now) {
    requestAnimationFrame(renderLoop);
    if (hidden) return;
    const dt = Math.min(0.04, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    elapsed += dt;
    update(elapsed, dt);
    renderer.render(scene, camera);
  }

  function resize() {
    const width = window.innerWidth, height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    frameCamera();
    const curCameraZ = getCameraZ();
    orbitals.forEach((orb) => {
      orb.uniforms.uCameraDistance.value = curCameraZ;
      orb.uniforms.uFocalDistance.value = curCameraZ;
    });
    shellUniforms.uCameraDistance.value = curCameraZ;
    sparkleUniforms.uCameraDistance.value = curCameraZ;
    electrons.forEach((e) => {
      e.trail.material.uniforms.uCameraDistance.value = curCameraZ;
    });
  }

  window.addEventListener('resize', resize, { passive: true });
  let previousScrollTime = performance.now();
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const now = performance.now();
    scrollVelocity = ((y - previousScrollY) / Math.max(16, now - previousScrollTime)) * 1000;
    previousScrollY = y;
    previousScrollTime = now;
    currentScrollY = y;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    lastTime = performance.now();
  });

  resize();

  const api = {
    THREE,
    scene,
    camera,
    atomRoot,
    renderer,
    canvas,
    sprite,
    velocity,
    get atomOpacity() { return atomOpacity; },
    set atomOpacity(value) { atomOpacity = THREE.MathUtils.clamp(value, 0, 1); },
    get position() { return atomRoot.position; },
    get screenPosition() {
      screenPosition.copy(atomRoot.position);
      return screenPosition;
    },
    get scrollVelocity() { return scrollVelocity; },
    get reduceMotion() { return reduceMotion; },
    get elapsed() { return elapsed; },
    get hidden() { return hidden; },
  };

  window.__particleAtom = api;
  atomCrawler = attachAtomReactivity(api);
  canvas.style.opacity = '1';
  requestAnimationFrame(renderLoop);
})();


