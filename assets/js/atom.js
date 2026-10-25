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
      index: i,
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
    let scatterDist = 0;
    if (isDischargeActive && !reduceMotion) {
      if (dischargeTime < 0.07) {
        const t = dischargeTime / 0.07;
        scatterDist = 6.0 * (t * (2.0 - t));
      } else if (dischargeTime < 0.28) {
        const t = (dischargeTime - 0.07) / 0.21;
        scatterDist = 6.0 * Math.exp(-t * 5.0) * Math.cos(t * Math.PI * 1.5);
      }
    }

    for (let i = 0; i < nucleusCount; i++) {
      const base = nucleusBase[i];
      const jitter = reduceMotion ? 0 : 0.5;
      const bLen = Math.hypot(base.x, base.y, base.z) || 1;
      const nx = base.x / bLen;
      const ny = base.y / bLen;
      const nz = base.z / bLen;

      nucleonDummy.position.set(
        base.x + nx * scatterDist + Math.sin(time * 9.2 + i * 2.1) * jitter,
        base.y + ny * scatterDist + Math.cos(time * 8.4 + i * 2.7) * jitter,
        base.z + nz * scatterDist + Math.sin(time * 7.9 + i * 1.6) * jitter
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

  /* ═══════════════════════════════════════════════
     ENERGY-DISCHARGE CLICK INTERACTION STATE & MESHES
     ═══════════════════════════════════════════════ */
  let isDischargeActive = false;
  let dischargeTime = 0;
  const DISCHARGE_DURATION = 1.1; // Total ~1.1s, only one at a time

  let internalAnimRate = 1.0;
  let internalMotionTime = 0;
  let pulseAfterSparks = 1.0;
  let squishScale = 1.0;

  let hintPulseActive = false;
  let hintPulseTime = 0;
  let hintPulseScale = 1.0;

  let gripFlashActive = false;
  let gripFlashTime = 0;

  // ─── 1. NUCLEUS FLASH (Additive Sprite) ───
  const nucleusFlashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sprite,
    color: 0xe0f7ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  }));
  const flashSize = mobile ? 180 : 260;
  nucleusFlashSprite.scale.set(flashSize, flashSize, 1);
  nucleusFlashSprite.position.set(0, 0, 4);
  nucleusFlashSprite.visible = false;
  nucleusFlashSprite.renderOrder = 105;
  nucleusGroup.add(nucleusFlashSprite);

  // ─── 2. PARTICLE BURST (Custom Shader Streak Points) ───
  const MAX_SPARKS = mobile ? 120 : 260;
  const sparkPositions = new Float32Array(MAX_SPARKS * 3);
  const sparkVelocities = new Float32Array(MAX_SPARKS * 3);
  const sparkColors = new Float32Array(MAX_SPARKS * 3);
  const sparkLifeArr = new Float32Array(MAX_SPARKS);
  const sparkMaxLifeArr = new Float32Array(MAX_SPARKS);
  const sparkLifeAttrArr = new Float32Array(MAX_SPARKS);
  let sparkActiveCount = 0;

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeo.setAttribute('aVelocity', new THREE.BufferAttribute(sparkVelocities, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkColors, 3));
  sparkGeo.setAttribute('aLife', new THREE.BufferAttribute(sparkLifeAttrArr, 1));
  sparkGeo.setDrawRange(0, 0);

  const sparkVertShader = `
    attribute vec3 aVelocity;
    attribute float aLife;
    varying vec3 vColor;
    varying vec2 vVelocity2D;
    varying float vLife;
    uniform float uCameraDistance;
    uniform float uPixelRatio;

    void main() {
      vColor = color;
      vVelocity2D = aVelocity.xy;
      vLife = aLife;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      float speed = length(aVelocity.xy);
      float ptSize = clamp(speed * 0.075, 16.0, 42.0);
      gl_PointSize = ptSize * uPixelRatio * (uCameraDistance / max(1.0, -mvPosition.z));
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const sparkFragShader = `
    varying vec3 vColor;
    varying vec2 vVelocity2D;
    varying float vLife;
    uniform float uAtomOpacity;

    void main() {
      if (vLife <= 0.01) discard;
      vec2 p = gl_PointCoord - vec2(0.5);
      vec2 dir = normalize(vVelocity2D + vec2(0.0001, 0.0001));
      float dPerp = abs(p.x * dir.y - p.y * dir.x);
      float dAlong = abs(dot(p, dir));

      // Crisp luminous streak oriented along velocity direction
      float width = mix(0.20, 0.06, clamp(dAlong * 2.0, 0.0, 1.0));
      float core = 1.0 - smoothstep(0.0, width, dPerp);
      float trail = 1.0 - smoothstep(0.04, 0.48, dAlong);
      float glow = exp(-dPerp * 12.0) * 0.7;

      // Soft circular point fallback so even slowing sparks glow
      float rDist = length(p);
      float pointGlow = exp(-rDist * 7.0) * 0.5;

      float a = (core * trail + glow * trail + pointGlow) * vLife * uAtomOpacity * 2.0;
      if (a <= 0.01) discard;
      gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0));
    }
  `;

  const sparkMat = new THREE.ShaderMaterial({
    vertexShader: sparkVertShader,
    fragmentShader: sparkFragShader,
    uniforms: {
      uCameraDistance: { value: 1400 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uAtomOpacity: { value: 1.0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    vertexColors: true,
  });
  const sparkPointsMesh = new THREE.Points(sparkGeo, sparkMat);
  sparkPointsMesh.renderOrder = 120;
  scene.add(sparkPointsMesh);

  // ─── 3. LIGHTNING ARCS (Jagged Tapered Ribbons & Target Sparks) ───
  const MAX_ARCS = mobile ? 3 : 6;
  const ARC_SEGMENTS = 8;
  const ARC_POINTS = ARC_SEGMENTS + 1; // 9 points
  const ARC_VERTS = ARC_POINTS * 2;    // 18 vertices

  const arcCoreGeo = new THREE.BufferGeometry();
  const arcCorePos = new Float32Array(MAX_ARCS * ARC_VERTS * 3);
  const arcCoreCol = new Float32Array(MAX_ARCS * ARC_VERTS * 3);
  arcCoreGeo.setAttribute('position', new THREE.BufferAttribute(arcCorePos, 3));
  arcCoreGeo.setAttribute('color', new THREE.BufferAttribute(arcCoreCol, 3));

  const arcGlowGeo = new THREE.BufferGeometry();
  const arcGlowPos = new Float32Array(MAX_ARCS * ARC_VERTS * 3);
  const arcGlowCol = new Float32Array(MAX_ARCS * ARC_VERTS * 3);
  arcGlowGeo.setAttribute('position', new THREE.BufferAttribute(arcGlowPos, 3));
  arcGlowGeo.setAttribute('color', new THREE.BufferAttribute(arcGlowCol, 3));

  const arcIndices = new Uint16Array(MAX_ARCS * ARC_SEGMENTS * 6);
  for (let a = 0; a < MAX_ARCS; a++) {
    const vOffset = a * ARC_VERTS;
    const iOffset = a * ARC_SEGMENTS * 6;
    for (let s = 0; s < ARC_SEGMENTS; s++) {
      const v0 = vOffset + s * 2;
      const v1 = vOffset + s * 2 + 1;
      const v2 = vOffset + (s + 1) * 2;
      const v3 = vOffset + (s + 1) * 2 + 1;
      const idx = iOffset + s * 6;
      arcIndices[idx]     = v0;
      arcIndices[idx + 1] = v1;
      arcIndices[idx + 2] = v2;
      arcIndices[idx + 3] = v2;
      arcIndices[idx + 4] = v1;
      arcIndices[idx + 5] = v3;
    }
  }
  arcCoreGeo.setIndex(new THREE.BufferAttribute(arcIndices, 1));
  arcGlowGeo.setIndex(new THREE.BufferAttribute(arcIndices, 1));

  const arcCoreMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const arcGlowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });

  const arcCoreMesh = new THREE.Mesh(arcCoreGeo, arcCoreMat);
  const arcGlowMesh = new THREE.Mesh(arcGlowGeo, arcGlowMat);
  arcCoreGeo.setDrawRange(0, 0);
  arcGlowGeo.setDrawRange(0, 0);
  arcCoreMesh.renderOrder = 115;
  arcGlowMesh.renderOrder = 114;
  scene.add(arcGlowMesh);
  scene.add(arcCoreMesh);

  // Tiny spark burst at each arc target contact point (8 particles per arc)
  const TARGET_SPARKS_PER_ARC = 8;
  const TOTAL_TARGET_SPARKS = MAX_ARCS * TARGET_SPARKS_PER_ARC;
  const targetSparkPos = new Float32Array(TOTAL_TARGET_SPARKS * 3);
  const targetSparkCol = new Float32Array(TOTAL_TARGET_SPARKS * 3);
  const targetSparkGeo = new THREE.BufferGeometry();
  targetSparkGeo.setAttribute('position', new THREE.BufferAttribute(targetSparkPos, 3));
  targetSparkGeo.setAttribute('color', new THREE.BufferAttribute(targetSparkCol, 3));
  targetSparkGeo.setDrawRange(0, 0);

  const targetSparkMat = new THREE.PointsMaterial({
    size: 6.0,
    map: sprite,
    transparent: true,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: false,
  });
  const targetSparkMesh = new THREE.Points(targetSparkGeo, targetSparkMat);
  targetSparkMesh.renderOrder = 116;
  scene.add(targetSparkMesh);

  // Reusable points for arc polyline midpoint displacement
  const arcPolyPoints = [];
  for (let a = 0; a < MAX_ARCS; a++) {
    const pts = [];
    for (let p = 0; p < ARC_POINTS; p++) pts.push(new THREE.Vector3());
    arcPolyPoints.push(pts);
  }

  // Preallocated jitter seeds for 40ms flicker
  let lastArcFlickerCycle = -1;
  const arcOffsets = [];
  for (let a = 0; a < MAX_ARCS; a++) {
    arcOffsets.push({
      mid: 0,
      q1: 0, q2: 0,
      o1: 0, o2: 0, o3: 0, o4: 0,
    });
  }

  function randomizeArcOffsets() {
    for (let a = 0; a < MAX_ARCS; a++) {
      const o = arcOffsets[a];
      o.mid = (Math.random() - 0.5) * 28.0; // max 14px
      o.q1  = (Math.random() - 0.5) * 16.0; // max 8px
      o.q2  = (Math.random() - 0.5) * 16.0;
      o.o1  = (Math.random() - 0.5) * 8.0;
      o.o2  = (Math.random() - 0.5) * 8.0;
      o.o3  = (Math.random() - 0.5) * 8.0;
      o.o4  = (Math.random() - 0.5) * 8.0;
    }
  }
  randomizeArcOffsets();

  let activeLightningTargets = [];

  // ─── 4. EJECTED ELECTRONS STATE ───
  const NUM_EJECTED = mobile ? 2 : 3;
  const ejectedStartPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const ejectedMidOut = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const ejectedTargets = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  // Palette colors
  const COL_LIGHT_CYAN = new THREE.Color('#e0f7ff');
  const COL_CYAN       = new THREE.Color('#38bdf8');
  const COL_VIOLET     = new THREE.Color('#8b5cf6');

  function triggerClickEffects() {
    if (isDischargeActive) {
      // Only one discharge sequence at a time; extra clicks ignored for effects
      return false;
    }

    isDischargeActive = true;
    dischargeTime = 0;
    gripFlashActive = true;
    gripFlashTime = 0;

    if (atomCrawler && typeof atomCrawler.triggerGripFlash === 'function') {
      atomCrawler.triggerGripFlash();
    }

    if (reduceMotion) {
      // Reduced motion: soft glow on the nucleus for 300ms, no burst/arcs/glitch
      return true;
    }

    const innerH = window.innerHeight;
    const atomScreenX = atomRoot.position.x;
    const atomScreenY = innerH - atomRoot.position.y;

    // 1. Particle burst spawn (~250 sparks desktop, 100 mobile)
    const rootPos = atomRoot.position;
    for (let i = 0; i < MAX_SPARKS; i++) {
      sparkPositions[i * 3]     = rootPos.x;
      sparkPositions[i * 3 + 1] = rootPos.y;
      sparkPositions[i * 3 + 2] = rootPos.z + (Math.random() - 0.5) * 12.0;

      const theta = Math.random() * Math.PI * 2;
      const speed = 280 + Math.random() * 460; // 280 to 740 px/s
      sparkVelocities[i * 3]     = Math.cos(theta) * speed;
      sparkVelocities[i * 3 + 1] = Math.sin(theta) * speed;
      sparkVelocities[i * 3 + 2] = (Math.random() - 0.5) * 60.0;

      const r = Math.random();
      const c = r < 0.20 ? COL_VIOLET : (r < 0.65 ? COL_CYAN : COL_LIGHT_CYAN);
      sparkColors[i * 3]     = c.r;
      sparkColors[i * 3 + 1] = c.g;
      sparkColors[i * 3 + 2] = c.b;

      const life = 0.5 + Math.random() * 0.4; // 0.5 to 0.9s
      sparkLifeArr[i] = life;
      sparkMaxLifeArr[i] = life;
      sparkLifeAttrArr[i] = 1.0;
    }
    sparkActiveCount = MAX_SPARKS;
    sparkGeo.setDrawRange(0, MAX_SPARKS);
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.aVelocity.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
    sparkGeo.attributes.aLife.needsUpdate = true;

    // 2. Query nearby reactive targets for lightning arcs (4 to 6 nearest within ~320px)
    if (atomCrawler && typeof atomCrawler.getNearbyReactiveTargets === 'function') {
      activeLightningTargets = atomCrawler.getNearbyReactiveTargets(atomScreenX, atomScreenY, 320, MAX_ARCS);
    } else {
      activeLightningTargets = [];
    }

    // Always ensure MAX_ARCS targets so vibrant electric bolts fire in all directions
    const needed = MAX_ARCS - activeLightningTargets.length;
    for (let f = 0; f < needed; f++) {
      const fallbackAngle = (f / Math.max(1, needed)) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const fallbackRadius = 140 + Math.random() * 110;
      activeLightningTargets.push({
        element: null,
        edgeX: atomScreenX + Math.cos(fallbackAngle) * fallbackRadius,
        edgeY: atomScreenY + Math.sin(fallbackAngle) * fallbackRadius,
        dist: fallbackRadius,
      });
    }

    // Flash struck element borders
    activeLightningTargets.forEach((t) => {
      if (t.element) {
        t.element.classList.add('atom-arc-flash');
        setTimeout(() => {
          t.element.classList.remove('atom-arc-flash');
        }, 350);
      }
    });

    // 3. Ejected electrons target selection (3 nearby text elements)
    let textTargets = [];
    if (atomCrawler && typeof atomCrawler.getNearbyTextTargets === 'function') {
      textTargets = atomCrawler.getNearbyTextTargets(atomScreenX, atomScreenY, 320, NUM_EJECTED);
    }

    for (let k = 0; k < NUM_EJECTED; k++) {
      const elItem = electrons[k];
      const startPt = getOrbitPoint(elItem, elItem.angle);
      ejectedStartPos[k].copy(startPt);

      if (textTargets[k]) {
        // Convert screen target to atomRoot local coordinates
        ejectedTargets[k].set(
          textTargets[k].x - atomRoot.position.x,
          (innerH - textTargets[k].y) - atomRoot.position.y,
          0
        );
      } else {
        const fallbackAngle = (k * 2.1) + 0.4;
        ejectedTargets[k].set(
          Math.cos(fallbackAngle) * 160,
          Math.sin(fallbackAngle) * 160,
          0
        );
      }

      // Outward curved quadratic Bezier control point
      const dx = ejectedTargets[k].x - startPt.x;
      const dy = ejectedTargets[k].y - startPt.y;
      const len = Math.hypot(dx, dy) || 1;
      const perpX = -dy / len;
      const perpY = dx / len;
      const side = (k % 2 === 0) ? 1 : -1;
      ejectedMidOut[k].set(
        (startPt.x + ejectedTargets[k].x) * 0.5 + perpX * 38.0 * side,
        (startPt.y + ejectedTargets[k].y) * 0.5 + perpY * 38.0 * side,
        (startPt.z + ejectedTargets[k].z) * 0.5 + 18.0
      );
    }

    // 4. Page reaction text glitch (closest first, 10ms steps, up to ~40 elements)
    if (!mobile && atomCrawler && typeof atomCrawler.triggerPageGlitch === 'function') {
      atomCrawler.triggerPageGlitch(atomScreenX, atomScreenY, 260, 40);
    }

    return true;
  }

  function triggerHintPulse() {
    if (reduceMotion) return;
    hintPulseActive = true;
    hintPulseTime = 0;
  }

  let electronBurstScale = 1.0;

  function updateElectron(item, dt, speedBoost) {
    const pt = getOrbitPoint(item, item.angle);
    const distToCenter = pt.length();
    const keplerFactor = Math.min(2.2, Math.max(0.7, 120.0 / Math.max(25.0, distToCenter)));

    item.angle += dt * item.baseSpeed * speedBoost * keplerFactor;
    const currentPoint = getOrbitPoint(item, item.angle);
    const prevPoint = getOrbitPoint(item, item.angle - 0.03);

    // Ejected electrons detachment on energy discharge (0 to 700ms)
    const isDetached = isDischargeActive && !reduceMotion && item.index < NUM_EJECTED && dischargeTime <= 0.70;
    if (isDetached) {
      const k = item.index;
      const start = ejectedStartPos[k];
      const midOut = ejectedMidOut[k];
      const target = ejectedTargets[k];

      if (dischargeTime <= 0.35) {
        // Outward flight to text element (0 to 350ms)
        const u = dischargeTime / 0.35;
        const easeU = u * (2.0 - u);
        const invU = 1.0 - easeU;
        currentPoint.set(
          invU * invU * start.x + 2 * invU * easeU * midOut.x + easeU * easeU * target.x,
          invU * invU * start.y + 2 * invU * easeU * midOut.y + easeU * easeU * target.y,
          invU * invU * start.z + 2 * invU * easeU * midOut.z + easeU * easeU * target.z
        );
      } else {
        // Return flight smoothly rejoining moving orbit (350ms to 700ms)
        const u = (dischargeTime - 0.35) / 0.35;
        const easeU = u * u;
        const invU = 1.0 - easeU;
        const curOrbitPt = getOrbitPoint(item, item.angle).multiplyScalar(electronBurstScale);
        const midReturnX = (target.x + curOrbitPt.x) * 0.5 - (midOut.x - (start.x + target.x) * 0.5) * 0.5;
        const midReturnY = (target.y + curOrbitPt.y) * 0.5 - (midOut.y - (start.y + target.y) * 0.5) * 0.5;
        const midReturnZ = (target.z + curOrbitPt.z) * 0.5;
        currentPoint.set(
          invU * invU * target.x + 2 * invU * easeU * midReturnX + easeU * easeU * curOrbitPt.x,
          invU * invU * target.y + 2 * invU * easeU * midReturnY + easeU * easeU * curOrbitPt.y,
          invU * invU * target.z + 2 * invU * easeU * midReturnZ + easeU * easeU * curOrbitPt.z
        );
      }
    } else {
      currentPoint.multiplyScalar(electronBurstScale);
      prevPoint.multiplyScalar(electronBurstScale);
    }

    item.mesh.position.copy(currentPoint);
    item.glow.position.copy(currentPoint);

    const motionDir = currentPoint.clone().sub(prevPoint).normalize();
    item.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), motionDir);
    const stretch = 1.0 + Math.min(0.65, Math.abs(speedBoost - 1.0) * 0.28);
    item.mesh.scale.set(1.0, stretch, 1.0);

    const isBehind = currentPoint.z < -10;
    const effOpacity = isDischargeActive ? 1.0 : atomOpacity;
    item.mesh.material.emissiveIntensity = isBehind ? 0.45 : 0.85;
    item.glow.material.opacity = effOpacity * (isBehind ? 0.25 : 0.55);

    const positions = item.trail.geometry.attributes.position.array;
    for (let i = 0; i < trailCount; i++) {
      const trailAngle = item.angle - (i * 0.024 * speedBoost) / keplerFactor;
      const trailPt = getOrbitPoint(item, trailAngle);
      if (!isDetached) {
        trailPt.multiplyScalar(electronBurstScale);
      }
      positions[i * 3]     = trailPt.x;
      positions[i * 3 + 1] = trailPt.y;
      positions[i * 3 + 2] = trailPt.z;
    }
    item.trail.geometry.attributes.position.needsUpdate = true;
    item.trail.material.uniforms.uOpacity.value = effOpacity * (isBehind ? 0.6 : 0.95);
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

    // ─── ENERGY DISCHARGE SEQUENCE TIMINGS ───
    if (isDischargeActive) {
      dischargeTime += dt;
      if (dischargeTime >= DISCHARGE_DURATION) {
        isDischargeActive = false;
        dischargeTime = 0;
        internalAnimRate = 1.0;
        pulseAfterSparks = 1.0;
        squishScale = 1.0;
        nucleusFlashSprite.visible = false;
        arcCoreGeo.setDrawRange(0, 0);
        arcGlowGeo.setDrawRange(0, 0);
        targetSparkGeo.setDrawRange(0, 0);
      }
    }

    if (reduceMotion) {
      // Reduced motion: soft glow on nucleus for 300ms
      if (isDischargeActive && dischargeTime < 0.30) {
        const glowFade = 1.0 - (dischargeTime / 0.30);
        nucleusFlashSprite.material.opacity = glowFade * 0.45 * atomOpacity;
        nucleusFlashSprite.visible = true;
      } else {
        nucleusFlashSprite.visible = false;
      }
      internalAnimRate = 1.0;
      squishScale = 1.0;
      pulseAfterSparks = 1.0;
    } else if (isDischargeActive) {
      // 1. HIT-STOP (0 to 100ms): 0.15x for 80ms, then ease back to normal over 300ms
      if (dischargeTime < 0.08) {
        internalAnimRate = 0.15;
      } else if (dischargeTime < 0.38) {
        const tEase = (dischargeTime - 0.08) / 0.30;
        internalAnimRate = 0.15 + 0.85 * (tEase * (2.0 - tEase));
      } else {
        internalAnimRate = 1.0;
      }

      // Compute dramatic electron cloud & orbital expansion blast (1.65x radius)
      if (dischargeTime < 0.22) {
        const tNorm = dischargeTime / 0.22;
        electronBurstScale = 1.0 + 0.65 * (1.0 - Math.pow(1.0 - tNorm, 2.0));
      } else if (dischargeTime < 0.75) {
        const tDecay = (dischargeTime - 0.22) / 0.53;
        electronBurstScale = 1.0 + 0.65 * Math.exp(-tDecay * 4.8) * Math.cos(tDecay * Math.PI * 3.0);
      } else {
        electronBurstScale = 1.0;
      }

      // Nucleus flash: cyan-white additive sprite, intense flash for 60ms, then fades
      if (dischargeTime < 0.06) {
        nucleusFlashSprite.material.opacity = 1.4;
        nucleusFlashSprite.visible = true;
      } else if (dischargeTime < 0.22) {
        const fFade = 1.0 - ((dischargeTime - 0.06) / 0.16);
        nucleusFlashSprite.material.opacity = 1.4 * fFade;
        nucleusFlashSprite.visible = true;
      } else {
        nucleusFlashSprite.material.opacity = 0;
        nucleusFlashSprite.visible = false;
      }

      // Nucleus squish sequence: 0.9 -> 1.08 -> 1.0
      if (dischargeTime < 0.08) {
        const t = dischargeTime / 0.08;
        squishScale = 1.0 + (0.9 - 1.0) * t;
      } else if (dischargeTime < 0.22) {
        const t = (dischargeTime - 0.08) / 0.14;
        squishScale = 0.9 + (1.08 - 0.9) * t;
      } else if (dischargeTime < 0.38) {
        const t = (dischargeTime - 0.22) / 0.16;
        squishScale = 1.08 + (1.0 - 1.08) * t;
      } else {
        squishScale = 1.0;
      }

      // Nucleus soft pulse when returning sparks hit (~600 to 850ms)
      if (dischargeTime >= 0.60 && dischargeTime <= 0.85) {
        const pProg = (dischargeTime - 0.60) / 0.25;
        pulseAfterSparks = 1.0 + 0.07 * Math.sin(pProg * Math.PI);
      } else {
        pulseAfterSparks = 1.0;
      }
    } else {
      internalAnimRate = 1.0;
      electronBurstScale = 1.0;
      squishScale = 1.0;
      pulseAfterSparks = 1.0;
      nucleusFlashSprite.visible = false;
    }

    // ─── PARTICLE BURST PHYSICS & PULL (0 to 900ms) ───
    if (sparkActiveCount > 0 && !reduceMotion) {
      const drag = Math.pow(0.94, dt * 60.0);
      const lifeAttr = sparkGeo.attributes.aLife;
      let livingSparks = 0;

      for (let i = 0; i < MAX_SPARKS; i++) {
        if (sparkLifeArr[i] > 0) {
          sparkLifeArr[i] -= dt;
          livingSparks++;

          // After ~450ms, surviving sparks curve back and get pulled into nucleus
          if (dischargeTime >= 0.45) {
            const dx = atomRoot.position.x - sparkPositions[i * 3];
            const dy = atomRoot.position.y - sparkPositions[i * 3 + 1];
            const dz = atomRoot.position.z - sparkPositions[i * 3 + 2];
            const dist = Math.hypot(dx, dy, dz) || 1;
            const pull = 2600.0 * dt;
            sparkVelocities[i * 3]     += (dx / dist) * pull;
            sparkVelocities[i * 3 + 1] += (dy / dist) * pull;
            sparkVelocities[i * 3 + 2] += (dz / dist) * pull;
          }

          sparkVelocities[i * 3]     *= drag;
          sparkVelocities[i * 3 + 1] *= drag;
          sparkVelocities[i * 3 + 2] *= drag;

          sparkPositions[i * 3]     += sparkVelocities[i * 3] * dt;
          sparkPositions[i * 3 + 1] += sparkVelocities[i * 3 + 1] * dt;
          sparkPositions[i * 3 + 2] += sparkVelocities[i * 3 + 2] * dt;

          lifeAttr.array[i] = Math.max(0, sparkLifeArr[i] / sparkMaxLifeArr[i]);
        } else {
          lifeAttr.array[i] = 0;
        }
      }

      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.aVelocity.needsUpdate = true;
      lifeAttr.needsUpdate = true;
      sparkMat.uniforms.uAtomOpacity.value = 1.0;

      if (livingSparks === 0) {
        sparkActiveCount = 0;
        sparkGeo.setDrawRange(0, 0);
      }
    } else {
      sparkGeo.setDrawRange(0, 0);
    }

    // ─── LIGHTNING ARCS (50 to 350ms) ───
    if (isDischargeActive && !reduceMotion && dischargeTime >= 0.05 && dischargeTime <= 0.35 && activeLightningTargets.length > 0) {
      const innerH = window.innerHeight;
      const arcT = (dischargeTime - 0.05) / 0.30;
      const arcOpacity = Math.sin(arcT * Math.PI);

      // Re-randomize displacement offsets every 40ms for electric flicker
      const flickerCycle = Math.floor(dischargeTime / 0.04);
      if (flickerCycle !== lastArcFlickerCycle) {
        lastArcFlickerCycle = flickerCycle;
        randomizeArcOffsets();
      }

      const activeArcCount = Math.min(MAX_ARCS, activeLightningTargets.length);

      for (let a = 0; a < activeArcCount; a++) {
        const target = activeLightningTargets[a];
        const isViolet = (a === 2);
        const colCore = COL_LIGHT_CYAN;
        const colEdge = isViolet ? COL_VIOLET : COL_CYAN;

        const startX = atomRoot.position.x;
        const startY = atomRoot.position.y;
        const startZ = atomRoot.position.z;

        const endX = target.edgeX;
        const endY = innerH - target.edgeY;
        const endZ = 0;

        const dx = endX - startX;
        const dy = endY - startY;
        const dLen = Math.hypot(dx, dy) || 1;
        const normX = -dy / dLen;
        const normY = dx / dLen;

        const pts = arcPolyPoints[a];
        pts[0].set(startX, startY, startZ);
        pts[8].set(endX, endY, endZ);

        const o = arcOffsets[a];
        // Midpoint displacement hierarchy
        pts[4].set((startX + endX) * 0.5 + normX * o.mid, (startY + endY) * 0.5 + normY * o.mid, 0);
        pts[2].set((pts[0].x + pts[4].x) * 0.5 + normX * o.q1, (pts[0].y + pts[4].y) * 0.5 + normY * o.q1, 0);
        pts[6].set((pts[4].x + pts[8].x) * 0.5 + normX * o.q2, (pts[4].y + pts[8].y) * 0.5 + normY * o.q2, 0);
        pts[1].set((pts[0].x + pts[2].x) * 0.5 + normX * o.o1, (pts[0].y + pts[2].y) * 0.5 + normY * o.o1, 0);
        pts[3].set((pts[2].x + pts[4].x) * 0.5 + normX * o.o2, (pts[2].y + pts[4].y) * 0.5 + normY * o.o2, 0);
        pts[5].set((pts[4].x + pts[6].x) * 0.5 + normX * o.o3, (pts[4].y + pts[6].y) * 0.5 + normY * o.o3, 0);
        pts[7].set((pts[6].x + pts[8].x) * 0.5 + normX * o.o4, (pts[6].y + pts[8].y) * 0.5 + normY * o.o4, 0);

        // Slightly lower opacity where arc crosses body paragraphs
        let crossesParagraph = false;
        for (let p = 0; p < ARC_POINTS; p++) {
          const scrX = pts[p].x;
          const scrY = innerH - pts[p].y;
          for (let pr = 0; pr < cachedParagraphs.length; pr++) {
            const pg = cachedParagraphs[pr];
            if (scrX >= pg.left && scrX <= pg.right && scrY >= pg.top && scrY <= pg.bottom) {
              crossesParagraph = true;
              break;
            }
          }
          if (crossesParagraph) break;
        }
        const textDim = crossesParagraph ? 0.65 : 1.0;
        const currentArcOpacity = arcOpacity * textDim;

        // Build tapered ribbon vertices
        const vOffset = a * ARC_VERTS;
        for (let s = 0; s < ARC_POINTS; s++) {
          const u = s / ARC_SEGMENTS;
          const p = pts[s];

          let tanX, tanY;
          if (s === 0) {
            tanX = pts[1].x - p.x; tanY = pts[1].y - p.y;
          } else if (s === ARC_SEGMENTS) {
            tanX = p.x - pts[ARC_SEGMENTS - 1].x; tanY = p.y - pts[ARC_SEGMENTS - 1].y;
          } else {
            tanX = pts[s + 1].x - pts[s - 1].x; tanY = pts[s + 1].y - pts[s - 1].y;
          }
          const tLen = Math.hypot(tanX, tanY) || 1;
          const pNormX = -tanY / tLen;
          const pNormY = tanX / tLen;

          // Tapered width: 4.0px at base -> 1.5px at tip
          const coreW = 4.0 * (1.0 - u) + 1.5 * u;
          const glowW = 14.0 * (1.0 - u) + 4.5 * u;

          const vL = vOffset + s * 2;
          const vR = vOffset + s * 2 + 1;

          // Core ribbon
          arcCorePos[vL * 3]     = p.x + pNormX * (coreW * 0.5);
          arcCorePos[vL * 3 + 1] = p.y + pNormY * (coreW * 0.5);
          arcCorePos[vL * 3 + 2] = p.z + 1.0;

          arcCorePos[vR * 3]     = p.x - pNormX * (coreW * 0.5);
          arcCorePos[vR * 3 + 1] = p.y - pNormY * (coreW * 0.5);
          arcCorePos[vR * 3 + 2] = p.z + 1.0;

          arcCoreCol[vL * 3]     = colCore.r * currentArcOpacity;
          arcCoreCol[vL * 3 + 1] = colCore.g * currentArcOpacity;
          arcCoreCol[vL * 3 + 2] = colCore.b * currentArcOpacity;

          arcCoreCol[vR * 3]     = colCore.r * currentArcOpacity;
          arcCoreCol[vR * 3 + 1] = colCore.g * currentArcOpacity;
          arcCoreCol[vR * 3 + 2] = colCore.b * currentArcOpacity;

          // Glow ribbon
          arcGlowPos[vL * 3]     = p.x + pNormX * (glowW * 0.5);
          arcGlowPos[vL * 3 + 1] = p.y + pNormY * (glowW * 0.5);
          arcGlowPos[vL * 3 + 2] = p.z + 0.8;

          arcGlowPos[vR * 3]     = p.x - pNormX * (glowW * 0.5);
          arcGlowPos[vR * 3 + 1] = p.y - pNormY * (glowW * 0.5);
          arcGlowPos[vR * 3 + 2] = p.z + 0.8;

          const gAlpha = currentArcOpacity * 0.45;
          arcGlowCol[vL * 3]     = colEdge.r * gAlpha;
          arcGlowCol[vL * 3 + 1] = colEdge.g * gAlpha;
          arcGlowCol[vL * 3 + 2] = colEdge.b * gAlpha;

          arcGlowCol[vR * 3]     = colEdge.r * gAlpha;
          arcGlowCol[vR * 3 + 1] = colEdge.g * gAlpha;
          arcGlowCol[vR * 3 + 2] = colEdge.b * gAlpha;
        }

        // Tiny spark burst at target contact end (8 particles)
        const spOffset = a * TARGET_SPARKS_PER_ARC;
        const sparkDist = arcT * 18.0;
        const sFade = (1.0 - arcT) * currentArcOpacity;
        for (let k = 0; k < TARGET_SPARKS_PER_ARC; k++) {
          const ang = k * (Math.PI * 2 / TARGET_SPARKS_PER_ARC) + a * 0.7;
          const idx = (spOffset + k) * 3;
          targetSparkPos[idx]     = endX + Math.cos(ang) * sparkDist;
          targetSparkPos[idx + 1] = endY + Math.sin(ang) * sparkDist;
          targetSparkPos[idx + 2] = endZ + 1.2;

          targetSparkCol[idx]     = colEdge.r * sFade;
          targetSparkCol[idx + 1] = colEdge.g * sFade;
          targetSparkCol[idx + 2] = colEdge.b * sFade;
        }
      }

      arcCoreGeo.attributes.position.needsUpdate = true;
      arcCoreGeo.attributes.color.needsUpdate = true;
      arcGlowGeo.attributes.position.needsUpdate = true;
      arcGlowGeo.attributes.color.needsUpdate = true;
      targetSparkGeo.attributes.position.needsUpdate = true;
      targetSparkGeo.attributes.color.needsUpdate = true;

      arcCoreGeo.setDrawRange(0, activeArcCount * ARC_SEGMENTS * 6);
      arcGlowGeo.setDrawRange(0, activeArcCount * ARC_SEGMENTS * 6);
      targetSparkGeo.setDrawRange(0, activeArcCount * TARGET_SPARKS_PER_ARC);
    } else {
      arcCoreGeo.setDrawRange(0, 0);
      arcGlowGeo.setDrawRange(0, 0);
      targetSparkGeo.setDrawRange(0, 0);
    }

    // First-time hint pulse animation
    if (hintPulseActive && !reduceMotion) {
      hintPulseTime += dt;
      const p = hintPulseTime / 0.55;
      if (p >= 1.0) {
        hintPulseActive = false;
        hintPulseScale = 1.0;
      } else {
        hintPulseScale = 1.0 + Math.sin(p * Math.PI) * 0.14;
      }
    } else {
      hintPulseScale = 1.0;
    }

    if (gripFlashActive) {
      gripFlashTime += dt;
      if (gripFlashTime >= 0.5) gripFlashActive = false;
    }

    internalMotionTime += (reduceMotion ? 0 : dt * internalAnimRate);
    const motionTime = reduceMotion ? 0 : internalMotionTime;
    updateNucleus(motionTime);
    nucleusGroup.scale.setScalar(squishScale * pulseAfterSparks * hintPulseScale);

    // Orbital flare: 1.4x brightness easing back over 0.8s
    const flareMultiplier = isDischargeActive
      ? (reduceMotion ? 1.0 + 0.2 * (1.0 - Math.min(1, dischargeTime / 0.4)) : 1.0 + 0.45 * Math.max(0, 1.0 - dischargeTime / 0.8))
      : 1.0;

    const effOrbitalOpacity = isDischargeActive ? 1.0 : atomOpacity;
    orbitals.forEach((orb) => {
      orb.uniforms.uTime.value = motionTime;
      orb.uniforms.uOpacity.value = effOrbitalOpacity * orb.def.brightness * flareMultiplier;
      orb.points.rotation.z = motionTime * orb.def.speed * 0.35;
      orb.coreLine.rotation.z = motionTime * orb.def.speed * 0.35;
      orb.points.scale.setScalar(electronBurstScale);
      orb.coreLine.scale.setScalar(electronBurstScale);
      orb.coreLine.material.opacity = effOrbitalOpacity * orb.def.coreOpacity * flareMultiplier;
    });

    shellUniforms.uTime.value = motionTime;
    shellUniforms.uOpacity.value = atomOpacity * 0.10;

    sparkleUniforms.uTime.value = motionTime;
    sparkleUniforms.uOpacity.value = atomOpacity * 0.22;

    nucleus.material.opacity = atomOpacity;
    nucleusGlow.material.opacity = atomOpacity * 0.42;

    const speedBoost = reduceMotion ? 1 : 1 + Math.min(2.5, Math.abs(scrollVelocity) * 0.001);
    electrons.forEach((item) => updateElectron(item, reduceMotion ? 0 : dt * internalAnimRate, speedBoost));

    if (!reduceMotion && updateTendrilVisuals) {
      updateTendrilVisuals(motionTime, dt);
    }
  }

  /* ═══════════════════════════════════════════════
     6. TENDRIL VISUAL RIBBON ENGINE
     (Camera-facing tapered ribbons, glow, slack/tension, energy flow & grip effects)
     ═══════════════════════════════════════════════ */
  const MAX_VISUAL_TENDRILS = mobile ? 3 : 5;
  const RIBBON_SEGMENTS = 24;
  const RIBBON_VERTS = (RIBBON_SEGMENTS + 1) * 2; // 50 vertices
  const RIBBON_INDICES = RIBBON_SEGMENTS * 6; // 144 indices

  // Shared precomputed quad index buffer
  const quadIndices = new Uint16Array(RIBBON_INDICES);
  for (let s = 0; s < RIBBON_SEGMENTS; s++) {
    const v0 = s * 2;
    const v1 = s * 2 + 1;
    const v2 = (s + 1) * 2;
    const v3 = (s + 1) * 2 + 1;
    quadIndices[s * 6]     = v0;
    quadIndices[s * 6 + 1] = v1;
    quadIndices[s * 6 + 2] = v2;
    quadIndices[s * 6 + 3] = v1;
    quadIndices[s * 6 + 4] = v3;
    quadIndices[s * 6 + 5] = v2;
  }

  // Color palettes
  // 3 in 4: Deep cyan #0ea5e9 -> bright cyan #38bdf8 -> light cyan-white #e0f7ff (never pure white)
  const PALETTE_CYAN = {
    base: new THREE.Color('#0ea5e9'),
    mid: new THREE.Color('#38bdf8'),
    tip: new THREE.Color('#e0f7ff'),
  };
  // 1 in 4 (tendril 2): Violet #6d28d9 -> #8b5cf6 -> #ede9fe
  const PALETTE_VIOLET = {
    base: new THREE.Color('#6d28d9'),
    mid: new THREE.Color('#8b5cf6'),
    tip: new THREE.Color('#ede9fe'),
  };

  const visualTendrils = [];
  const interceptedRawTendrils = [];

  // Crossing text readability: cache paragraph viewport rects (Requirement 6)
  let cachedParagraphs = [];
  function updateParagraphCache() {
    const pEls = document.querySelectorAll('p');
    cachedParagraphs = [];
    pEls.forEach((p) => {
      const r = p.getBoundingClientRect();
      if (r.width > 20 && r.height > 10) {
        cachedParagraphs.push({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          midX: (r.left + r.right) * 0.5,
          midY: (r.top + r.bottom) * 0.5,
        });
      }
    });
  }
  updateParagraphCache();
  window.addEventListener('scroll', updateParagraphCache, { passive: true });
  window.addEventListener('resize', updateParagraphCache, { passive: true });

  for (let t = 0; t < MAX_VISUAL_TENDRILS; t++) {
    const isViolet = (t === 2);
    const palette = isViolet ? PALETTE_VIOLET : PALETTE_CYAN;

    // 1. Core Ribbon Mesh (tapers ~5px to ~1px)
    const coreGeo = new THREE.BufferGeometry();
    const corePos = new Float32Array(RIBBON_VERTS * 3);
    const coreCol = new Float32Array(RIBBON_VERTS * 3);
    coreGeo.setAttribute('position', new THREE.BufferAttribute(corePos, 3));
    coreGeo.setAttribute('color', new THREE.BufferAttribute(coreCol, 3));
    coreGeo.setIndex(new THREE.BufferAttribute(quadIndices, 1));
    coreGeo.setDrawRange(0, 0);

    const coreMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // 2. Soft Glow Ribbon (wider copy ~14px to ~2.8px, low opacity ~0.26)
    const glowGeo = new THREE.BufferGeometry();
    const glowPos = new Float32Array(RIBBON_VERTS * 3);
    const glowCol = new Float32Array(RIBBON_VERTS * 3);
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
    glowGeo.setIndex(new THREE.BufferAttribute(quadIndices, 1));
    glowGeo.setDrawRange(0, 0);

    const glowMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    scene.add(glowMesh);

    // 3. Energy Flow Pulses (3 bright packets along ribbon)
    const pulseCount = 3;
    const pulseGeo = new THREE.BufferGeometry();
    const pulsePos = new Float32Array(pulseCount * 3);
    const pulseCol = new Float32Array(pulseCount * 3);
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseCol, 3));
    const pulseMat = new THREE.PointsMaterial({
      size: 9.0,
      map: sprite,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });
    const pulsePoints = new THREE.Points(pulseGeo, pulseMat);
    scene.add(pulsePoints);

    // 4. Fine Drifting Particles (4 particles drifting off line)
    const driftCount = 4;
    const driftGeo = new THREE.BufferGeometry();
    const driftPos = new Float32Array(driftCount * 3);
    const driftCol = new Float32Array(driftCount * 3);
    driftGeo.setAttribute('position', new THREE.BufferAttribute(driftPos, 3));
    driftGeo.setAttribute('color', new THREE.BufferAttribute(driftCol, 3));
    const driftMat = new THREE.PointsMaterial({
      size: 3.5,
      map: sprite,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });
    const driftPoints = new THREE.Points(driftGeo, driftMat);
    scene.add(driftPoints);

    // 5. Grip Effect: Expanding and fading contact ring
    const gripRing = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sprite,
      color: isViolet ? 0x8b5cf6 : 0x38bdf8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    gripRing.scale.set(16, 16, 1);
    scene.add(gripRing);

    // 6. Grip Effect: 8 tiny spark particles bursting outward
    const sparkCount = 8;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkCol = new Float32Array(sparkCount * 3);
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
    const sparkMat = new THREE.PointsMaterial({
      size: 4.0,
      map: sprite,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });
    const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    scene.add(sparkPoints);

    // 7. Grip Effect: 3 short fine filaments (3 to 6px) spreading like roots
    const filamentGeo = new THREE.BufferGeometry();
    const filamentPos = new Float32Array(6 * 3);
    const filamentCol = new Float32Array(6 * 3);
    filamentGeo.setAttribute('position', new THREE.BufferAttribute(filamentPos, 3));
    filamentGeo.setAttribute('color', new THREE.BufferAttribute(filamentCol, 3));
    const filamentMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 1.5,
    });
    const filamentLines = new THREE.LineSegments(filamentGeo, filamentMat);
    scene.add(filamentLines);

    visualTendrils.push({
      id: t,
      palette,
      isViolet,
      coreMesh, coreGeo, corePos, coreCol, coreMat,
      glowMesh, glowGeo, glowPos, glowCol, glowMat,
      pulsePoints, pulseGeo, pulsePos, pulseCol, pulseMat,
      driftPoints, driftGeo, driftPos, driftCol, driftMat,
      gripRing,
      sparkPoints, sparkGeo, sparkPos, sparkCol, sparkMat,
      filamentLines, filamentGeo, filamentPos, filamentCol, filamentMat,
      curvePoints: new Array(RIBBON_SEGMENTS + 1).fill(0).map(() => new THREE.Vector3()),
      gripWeight: 0,
      prevRawOpacity: 0,
      releaseSpring: 0,
    });
  }

  // Intercept scene.add in attachAtomReactivity to hide 1px placeholder lines & capture tendril data
  const sceneProxy = Object.create(scene);
  sceneProxy.add = function (...objects) {
    for (const obj of objects) {
      if (obj.isLine && obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position && obj.geometry.attributes.position.count === 32) {
        obj.visible = false;
        interceptedRawTendrils.push({ line: obj });
      } else if (obj.isPoints && obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position && obj.geometry.attributes.position.count === 3) {
        obj.visible = false;
        if (interceptedRawTendrils.length > 0) {
          interceptedRawTendrils[interceptedRawTendrils.length - 1].flow = obj;
        }
      } else if (obj.isSprite && obj.scale.x <= 25) {
        obj.visible = false;
        if (interceptedRawTendrils.length > 0) {
          interceptedRawTendrils[interceptedRawTendrils.length - 1].pulse = obj;
        }
      }
    }
    return scene.add(...objects);
  };

  // Reusable vectors for zero per-frame allocation
  const tempV0 = new THREE.Vector3();
  const tempV1 = new THREE.Vector3();
  const tempTan = new THREE.Vector3();
  const tempNorm = new THREE.Vector3();
  const tempColor = new THREE.Color();

  function updateTendrilVisuals(time, dt) {
    const count = Math.min(visualTendrils.length, interceptedRawTendrils.length);
    const innerH = window.innerHeight;

    for (let i = 0; i < count; i++) {
      const vt = visualTendrils[i];
      const rt = interceptedRawTendrils[i];
      const rawPos = rt.line.geometry.attributes.position.array;
      const rawCount = rt.line.geometry.drawRange.count;
      const rawOpacity = rt.line.material.opacity;
      const isGripped = !!(rt.pulse && rt.pulse.material.opacity > 0.04);

      // Track grip and release dynamics
      vt.gripWeight += ((isGripped ? 1 : 0) - vt.gripWeight) * Math.min(1, dt * 7.0);

      const isReleasing = (!isGripped && vt.prevRawOpacity > rawOpacity && rawOpacity > 0.05);
      vt.prevRawOpacity = rawOpacity;

      if (isReleasing) {
        vt.releaseSpring += (1 - vt.releaseSpring) * Math.min(1, dt * 8.0);
      } else {
        vt.releaseSpring *= Math.exp(-dt * 4.0);
      }

      if (rawCount === 0 || rawOpacity < 0.01) {
        vt.coreGeo.setDrawRange(0, 0);
        vt.glowGeo.setDrawRange(0, 0);
        vt.pulseGeo.setDrawRange(0, 0);
        vt.driftGeo.setDrawRange(0, 0);
        vt.sparkGeo.setDrawRange(0, 0);
        vt.filamentGeo.setDrawRange(0, 0);
        vt.gripRing.material.opacity = 0;
        continue;
      }

      // Start at nucleus, end at tip
      const startX = rawPos[0], startY = rawPos[1], startZ = rawPos[2];
      const endX = rawPos[31 * 3], endY = rawPos[31 * 3 + 1], endZ = rawPos[31 * 3 + 2];
      tempV0.set(startX, startY, startZ);
      tempV1.set(endX, endY, endZ);

      const chordX = endX - startX;
      const chordY = endY - startY;
      const chordLen = Math.hypot(chordX, chordY) || 1;
      const chordNormX = -chordY / chordLen;
      const chordNormY = chordX / chordLen;

      // ─── 1 & 2. SHAPE & SLACK / TENSION ───
      // When GRIPPED: tightens, straightens (low wobble, low S-curve) and gets brighter
      // When REACHING: loose curve, swings with slight overshoot
      // When RELEASING: whips back with a fast decaying spring oscillation
      let wobbleAmp, sCurveAmp, travelSpeed, tensionBright;
      if (isGripped) {
        wobbleAmp = 2.4;
        sCurveAmp = 1.8;
        travelSpeed = 4.8;
        tensionBright = 1.35;
      } else if (isReleasing || vt.releaseSpring > 0.1) {
        const whip = Math.sin(time * 18.0 + vt.id * 2.1) * vt.releaseSpring * 15.0;
        wobbleAmp = 14.0 + whip;
        sCurveAmp = 9.0;
        travelSpeed = 4.2;
        tensionBright = 0.95;
      } else {
        // Reaching: loose, swings with slight overshoot
        const swing = Math.sin(time * 3.8 + vt.id * 1.7) * 4.5;
        wobbleAmp = 12.0 + swing;
        sCurveAmp = 10.5;
        travelSpeed = 3.0;
        tensionBright = 1.05;
      }

      // Generate 25 backbone points along the tendril
      for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
        const u = s / RIBBON_SEGMENTS;
        const rawIdx = Math.min(31, Math.floor(u * 31));
        const rawNext = Math.min(31, rawIdx + 1);
        const subFrac = (u * 31) - rawIdx;

        // Base point interpolated from raw physics line
        const bx = rawPos[rawIdx * 3] * (1 - subFrac) + rawPos[rawNext * 3] * subFrac;
        const by = rawPos[rawIdx * 3 + 1] * (1 - subFrac) + rawPos[rawNext * 3 + 1] * subFrac;
        const bz = rawPos[rawIdx * 3 + 2] * (1 - subFrac) + rawPos[rawNext * 3 + 2] * subFrac;

        // Envelope: 0 at nucleus, 0 at tip, max in middle
        const env = Math.sin(u * Math.PI);
        // Gentle S-curve
        const sOffset = Math.sin(u * Math.PI * 2.0) * sCurveAmp;
        // Traveling slow sine wobble
        const travelingWobble = Math.sin(u * 7.2 - time * travelSpeed + vt.id * 1.5) * wobbleAmp;

        // Requirement 6: Prefer routing curve around paragraph blocks with a slight bend
        let pBend = 0;
        const screenPtX = bx;
        const screenPtY = innerH - by;
        for (let p = 0; p < cachedParagraphs.length; p++) {
          const pr = cachedParagraphs[p];
          if (screenPtX >= pr.left - 45 && screenPtX <= pr.right + 45 &&
              screenPtY >= pr.top - 35 && screenPtY <= pr.bottom + 35) {
            const side = (screenPtX < pr.midX) ? -1 : 1;
            pBend += side * 14.0 * env;
            break;
          }
        }

        const totalPerp = (sOffset + travelingWobble + pBend) * env;
        const pt = vt.curvePoints[s];
        pt.set(
          bx + chordNormX * totalPerp,
          by + chordNormY * totalPerp,
          bz
        );
      }

      // ─── 3. CAMERA-FACING TAPERED RIBBON VERTICES & COLOR GRADIENTS ───
      for (let s = 0; s <= RIBBON_SEGMENTS; s++) {
        const u = s / RIBBON_SEGMENTS;
        const pt = vt.curvePoints[s];

        // Tangent
        if (s === 0) {
          tempTan.subVectors(vt.curvePoints[1], pt);
        } else if (s === RIBBON_SEGMENTS) {
          tempTan.subVectors(pt, vt.curvePoints[RIBBON_SEGMENTS - 1]);
        } else {
          tempTan.subVectors(vt.curvePoints[s + 1], vt.curvePoints[s - 1]);
        }
        const tLen = Math.hypot(tempTan.x, tempTan.y) || 1;
        tempNorm.set(-tempTan.y / tLen, tempTan.x / tLen, 0);

        // Width tapers from ~5px at base to ~1px at tip
        const coreWidth = (5.0 * (1 - u) + 1.0 * u);
        const glowWidth = coreWidth * 2.8; // Wider soft glow copy (~14px to ~2.8px)

        // Core ribbon vertices
        const vLeftIdx = s * 2;
        const vRightIdx = s * 2 + 1;

        vt.corePos[vLeftIdx * 3]     = pt.x + tempNorm.x * (coreWidth * 0.5);
        vt.corePos[vLeftIdx * 3 + 1] = pt.y + tempNorm.y * (coreWidth * 0.5);
        vt.corePos[vLeftIdx * 3 + 2] = pt.z;

        vt.corePos[vRightIdx * 3]     = pt.x - tempNorm.x * (coreWidth * 0.5);
        vt.corePos[vRightIdx * 3 + 1] = pt.y - tempNorm.y * (coreWidth * 0.5);
        vt.corePos[vRightIdx * 3 + 2] = pt.z;

        // Glow ribbon vertices
        vt.glowPos[vLeftIdx * 3]     = pt.x + tempNorm.x * (glowWidth * 0.5);
        vt.glowPos[vLeftIdx * 3 + 1] = pt.y + tempNorm.y * (glowWidth * 0.5);
        vt.glowPos[vLeftIdx * 3 + 2] = pt.z - 0.2;

        vt.glowPos[vRightIdx * 3]     = pt.x - tempNorm.x * (glowWidth * 0.5);
        vt.glowPos[vRightIdx * 3 + 1] = pt.y - tempNorm.y * (glowWidth * 0.5);
        vt.glowPos[vRightIdx * 3 + 2] = pt.z - 0.2;

        // Requirement 6: Drop opacity to ~45% where tendril passes over body text
        const scrX = pt.x;
        const scrY = innerH - pt.y;
        let isOverText = false;
        for (let p = 0; p < cachedParagraphs.length; p++) {
          const pr = cachedParagraphs[p];
          if (scrX >= pr.left && scrX <= pr.right && scrY >= pr.top && scrY <= pr.bottom) {
            isOverText = true;
            break;
          }
        }
        const textDim = isOverText ? 0.45 : 1.0;

        // Color gradient: Base -> Mid -> Tip (never pure white)
        if (u <= 0.5) {
          tempColor.copy(vt.palette.base).lerp(vt.palette.mid, u / 0.5);
        } else {
          tempColor.copy(vt.palette.mid).lerp(vt.palette.tip, (u - 0.5) / 0.5);
        }

        const alphaCore = rawOpacity * textDim * tensionBright * atomOpacity;
        const rC = tempColor.r * alphaCore;
        const gC = tempColor.g * alphaCore;
        const bC = tempColor.b * alphaCore;

        vt.coreCol[vLeftIdx * 3]     = rC;
        vt.coreCol[vLeftIdx * 3 + 1] = gC;
        vt.coreCol[vLeftIdx * 3 + 2] = bC;
        vt.coreCol[vRightIdx * 3]     = rC;
        vt.coreCol[vRightIdx * 3 + 1] = gC;
        vt.coreCol[vRightIdx * 3 + 2] = bC;

        const alphaGlow = alphaCore * 0.26;
        const rG = tempColor.r * alphaGlow;
        const gG = tempColor.g * alphaGlow;
        const bG = tempColor.b * alphaGlow;

        vt.glowCol[vLeftIdx * 3]     = rG;
        vt.glowCol[vLeftIdx * 3 + 1] = gG;
        vt.glowCol[vLeftIdx * 3 + 2] = bG;
        vt.glowCol[vRightIdx * 3]     = rG;
        vt.glowCol[vRightIdx * 3 + 1] = gG;
        vt.glowCol[vRightIdx * 3 + 2] = bG;
      }

      vt.coreGeo.attributes.position.needsUpdate = true;
      vt.coreGeo.attributes.color.needsUpdate = true;
      vt.coreGeo.setDrawRange(0, RIBBON_INDICES);

      vt.glowGeo.attributes.position.needsUpdate = true;
      vt.glowGeo.attributes.color.needsUpdate = true;
      vt.glowGeo.setDrawRange(0, RIBBON_INDICES);

      // ─── 4. ENERGY FLOW: BRIGHT PULSES & DRIFTING PARTICLES ───
      // Small bright pulses travel along the ribbon (speed up when gripped)
      const pulseSpeed = isGripped ? 1.75 : 0.85;
      for (let p = 0; p < 3; p++) {
        const uPulse = ((time * pulseSpeed + p / 3 + vt.id * 0.22) % 1.0);
        const segIdx = Math.min(RIBBON_SEGMENTS - 1, Math.floor(uPulse * RIBBON_SEGMENTS));
        const segFrac = (uPulse * RIBBON_SEGMENTS) - segIdx;
        const pA = vt.curvePoints[segIdx];
        const pB = vt.curvePoints[segIdx + 1];

        const pX = pA.x * (1 - segFrac) + pB.x * segFrac;
        const pY = pA.y * (1 - segFrac) + pB.y * segFrac;
        const pZ = pA.z * (1 - segFrac) + pB.z * segFrac + 0.6;

        vt.pulsePos[p * 3]     = pX;
        vt.pulsePos[p * 3 + 1] = pY;
        vt.pulsePos[p * 3 + 2] = pZ;

        const pCol = vt.palette.tip;
        const pAlpha = 0.95 * rawOpacity * atomOpacity;
        vt.pulseCol[p * 3]     = pCol.r * pAlpha;
        vt.pulseCol[p * 3 + 1] = pCol.g * pAlpha;
        vt.pulseCol[p * 3 + 2] = pCol.b * pAlpha;
      }
      vt.pulseGeo.attributes.position.needsUpdate = true;
      vt.pulseGeo.attributes.color.needsUpdate = true;
      vt.pulseGeo.setDrawRange(0, 3);

      // Fine drifting particles drifting off the line
      for (let d = 0; d < 4; d++) {
        const uDrift = ((d * 0.25 + vt.id * 0.15) % 0.8) + 0.1;
        const segIdx = Math.min(RIBBON_SEGMENTS - 1, Math.floor(uDrift * RIBBON_SEGMENTS));
        const pAnchor = vt.curvePoints[segIdx];

        const driftDist = ((time * 24.0 + d * 18.0) % 20.0);
        const driftFade = Math.max(0, 1.0 - driftDist / 20.0);
        const sideSign = (d % 2 === 0) ? 1 : -1;

        vt.driftPos[d * 3]     = pAnchor.x + chordNormX * (sideSign * driftDist);
        vt.driftPos[d * 3 + 1] = pAnchor.y + chordNormY * (sideSign * driftDist);
        vt.driftPos[d * 3 + 2] = pAnchor.z + 0.4;

        const dCol = vt.palette.mid;
        const dAlpha = driftFade * 0.55 * rawOpacity * atomOpacity;
        vt.driftCol[d * 3]     = dCol.r * dAlpha;
        vt.driftCol[d * 3 + 1] = dCol.g * dAlpha;
        vt.driftCol[d * 3 + 2] = dCol.b * dAlpha;
      }
      vt.driftGeo.attributes.position.needsUpdate = true;
      vt.driftGeo.attributes.color.needsUpdate = true;
      vt.driftGeo.setDrawRange(0, 4);

      // ─── 5. GRIP EFFECT: PULSE RING, SPARKS BURST, ROOT FILAMENTS ───
      const tipPt = vt.curvePoints[RIBBON_SEGMENTS];

      if (vt.gripWeight > 0.04) {
        // 5a. Expanding & fading pulse ring
        const ringCycle = ((time * 2.3 + vt.id * 0.4) % 1.0);
        const ringScale = 6.0 + ringCycle * 22.0;
        vt.gripRing.position.set(tipPt.x, tipPt.y, tipPt.z + 0.5);
        vt.gripRing.scale.set(ringScale, ringScale, 1);
        vt.gripRing.material.opacity = (1.0 - ringCycle) * 0.85 * vt.gripWeight * atomOpacity;

        // 5b. 8 tiny spark particles bursting outward
        for (let k = 0; k < 8; k++) {
          const sparkAngle = k * (Math.PI * 2 / 8) + Math.sin(time * 2.5 + k) * 0.25;
          const sparkProg = ((time * 3.0 + k * 0.125) % 1.0);
          const sparkDist = sparkProg * 14.0;
          const sFade = (1.0 - sparkProg) * vt.gripWeight * atomOpacity;

          vt.sparkPos[k * 3]     = tipPt.x + Math.cos(sparkAngle) * sparkDist;
          vt.sparkPos[k * 3 + 1] = tipPt.y + Math.sin(sparkAngle) * sparkDist;
          vt.sparkPos[k * 3 + 2] = tipPt.z + 0.8;

          const sCol = (k % 2 === 0) ? vt.palette.tip : vt.palette.mid;
          vt.sparkCol[k * 3]     = sCol.r * sFade;
          vt.sparkCol[k * 3 + 1] = sCol.g * sFade;
          vt.sparkCol[k * 3 + 2] = sCol.b * sFade;
        }
        vt.sparkGeo.attributes.position.needsUpdate = true;
        vt.sparkGeo.attributes.color.needsUpdate = true;
        vt.sparkGeo.setDrawRange(0, 8);

        // 5c. 3 short fine filaments (3 to 6px) spreading like roots
        const rootAngles = [0.4, 2.3, 4.3];
        const rootLens = [4.6, 5.8, 3.8];
        for (let r = 0; r < 3; r++) {
          const a = rootAngles[r] + Math.sin(time * 1.5 + r) * 0.15;
          const len = rootLens[r];
          // Root start at tip
          vt.filamentPos[r * 6]     = tipPt.x;
          vt.filamentPos[r * 6 + 1] = tipPt.y;
          vt.filamentPos[r * 6 + 2] = tipPt.z + 0.3;
          // Root end
          vt.filamentPos[r * 6 + 3] = tipPt.x + Math.cos(a) * len;
          vt.filamentPos[r * 6 + 4] = tipPt.y + Math.sin(a) * len;
          vt.filamentPos[r * 6 + 5] = tipPt.z + 0.3;

          const rCol = vt.palette.mid;
          const rAlpha = 0.85 * vt.gripWeight * atomOpacity;
          vt.filamentCol[r * 6]     = rCol.r * rAlpha;
          vt.filamentCol[r * 6 + 1] = rCol.g * rAlpha;
          vt.filamentCol[r * 6 + 2] = rCol.b * rAlpha;
          vt.filamentCol[r * 6 + 3] = vt.palette.tip.r * rAlpha * 0.7;
          vt.filamentCol[r * 6 + 4] = vt.palette.tip.g * rAlpha * 0.7;
          vt.filamentCol[r * 6 + 5] = vt.palette.tip.b * rAlpha * 0.7;
        }
        vt.filamentGeo.attributes.position.needsUpdate = true;
        vt.filamentGeo.attributes.color.needsUpdate = true;
        vt.filamentGeo.setDrawRange(0, 6);
      } else {
        vt.sparkGeo.setDrawRange(0, 0);
        vt.filamentGeo.setDrawRange(0, 0);
      }

      // Tendril grip point flash expanding ring on click
      if (gripFlashActive) {
        const flashProg = Math.min(1.0, gripFlashTime / 0.5);
        const flashScale = 14.0 + flashProg * 32.0;
        const flashAlpha = (1.0 - flashProg) * 0.95 * atomOpacity;
        vt.gripRing.position.set(tipPt.x, tipPt.y, tipPt.z + 0.6);
        vt.gripRing.scale.set(flashScale, flashScale, 1);
        vt.gripRing.material.opacity = Math.max(vt.gripRing.material.opacity, flashAlpha);
      } else if (vt.gripWeight <= 0.04) {
        vt.gripRing.material.opacity = 0;
      }
    }
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
    if (sparkMat && sparkMat.uniforms) {
      if (sparkMat.uniforms.uCameraDistance) {
        sparkMat.uniforms.uCameraDistance.value = curCameraZ;
      }
      if (sparkMat.uniforms.uPixelRatio) {
        sparkMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
      }
    }
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
    scene: sceneProxy,
    camera,
    atomRoot,
    renderer,
    canvas,
    sprite,
    velocity,
    triggerClickEffects,
    triggerHintPulse,
    get isDischargeActive() { return isDischargeActive; },
    get isShockwaveActive() { return isDischargeActive; },
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


