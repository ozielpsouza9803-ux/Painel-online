import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface SpaceSceneEnvironmentInfo {
  webglSupported: boolean;
  isSoftwareGl: boolean;
  reducedMotion: boolean;
}

interface LoginSpaceSceneProps {
  onEnvironmentReady?: (info: SpaceSceneEnvironmentInfo) => void;
}

function detectSoftwareWebGL(): { supported: boolean; isSoftwareGl: boolean } {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl =
      probeCanvas.getContext('webgl2') ||
      probeCanvas.getContext('webgl');
    if (!gl) {
      return { supported: false, isSoftwareGl: true };
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = String(
      ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(
      rendererStr,
    );
    return { supported: true, isSoftwareGl };
  } catch {
    return { supported: false, isSoftwareGl: true };
  }
}

function createPlanetTextures(maxAnisotropy: number): {
  albedoMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
} {
  const width = 1024;
  const height = 512;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = width;
  albedoCanvas.height = height;
  const aCtx = albedoCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const rCtx = roughCanvas.getContext('2d')!;

  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = width;
  emissiveCanvas.height = height;
  const eCtx = emissiveCanvas.getContext('2d')!;

  // Base obsidian basalt atmosphere/surface gradient
  const baseGrad = aCtx.createLinearGradient(0, 0, 0, height);
  baseGrad.addColorStop(0, '#050608');
  baseGrad.addColorStop(0.28, '#0B0C10');
  baseGrad.addColorStop(0.5, '#11100E');
  baseGrad.addColorStop(0.72, '#0A0B0F');
  baseGrad.addColorStop(1, '#040507');
  aCtx.fillStyle = baseGrad;
  aCtx.fillRect(0, 0, width, height);

  rCtx.fillStyle = '#D4D4D4';
  rCtx.fillRect(0, 0, width, height);

  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, width, height);

  // Subtle deterministic atmospheric bands & tectonic plates
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 42; i++) {
    const y = rand() * height;
    const bandH = 8 + rand() * 34;
    const alpha = 0.04 + rand() * 0.07;
    aCtx.fillStyle =
      i % 3 === 0
        ? `rgba(212, 175, 55, ${alpha * 0.35})`
        : `rgba(26, 29, 38, ${alpha})`;
    aCtx.fillRect(0, y, width, bandH);

    rCtx.fillStyle = i % 2 === 0 ? 'rgba(130,130,130,0.25)' : 'rgba(225,225,225,0.22)';
    rCtx.fillRect(0, y, width, bandH);
  }

  // Subtle continental mineral landmasses
  for (let i = 0; i < 160; i++) {
    const cx = rand() * width;
    const cy = 40 + rand() * (height - 80);
    const rx = 18 + rand() * 88;
    const ry = 8 + rand() * 28;
    const grad = aCtx.createRadialGradient(cx, cy, 2, cx, cy, rx);
    grad.addColorStop(0, 'rgba(30, 26, 18, 0.52)');
    grad.addColorStop(0.65, 'rgba(15, 17, 23, 0.25)');
    grad.addColorStop(1, 'rgba(7, 8, 11, 0)');
    aCtx.fillStyle = grad;
    aCtx.beginPath();
    aCtx.ellipse(cx, cy, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    aCtx.fill();
  }

  // Delicate champagne-gold neural meridian / tectonic filaments
  aCtx.strokeStyle = 'rgba(218, 182, 78, 0.22)';
  aCtx.lineWidth = 0.9;
  eCtx.strokeStyle = 'rgba(212, 175, 55, 0.28)';
  eCtx.lineWidth = 1.0;

  for (let i = 0; i < 28; i++) {
    const startX = rand() * width;
    const startY = 55 + rand() * (height - 110);
    aCtx.beginPath();
    eCtx.beginPath();
    aCtx.moveTo(startX, startY);
    eCtx.moveTo(startX, startY);
    let px = startX;
    let py = startY;
    for (let s = 0; s < 5; s++) {
      px += (rand() - 0.35) * 90;
      py += (rand() - 0.5) * 38;
      aCtx.lineTo(px, py);
      eCtx.lineTo(px, py);
    }
    aCtx.stroke();
    eCtx.stroke();
  }

  // Micro luminous golden surface clusters (subtle planetary telemetry nodes)
  for (let i = 0; i < 140; i++) {
    const nx = rand() * width;
    const ny = 45 + rand() * (height - 90);
    const nr = 0.55 + rand() * 0.9;
    eCtx.fillStyle = `rgba(246, 222, 142, ${0.4 + rand() * 0.45})`;
    eCtx.beginPath();
    eCtx.arc(nx, ny, nr, 0, Math.PI * 2);
    eCtx.fill();
  }

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.anisotropy = maxAnisotropy;

  return { albedoMap, roughnessMap, emissiveMap };
}

function createOrbitalBandTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  ctx.clearRect(0, 0, size, size);

  const bands = [
    { r: 168, w: 2, alpha: 0.42 },
    { r: 178, w: 6, alpha: 0.14 },
    { r: 192, w: 1.5, alpha: 0.52 },
    { r: 205, w: 10, alpha: 0.12 },
    { r: 222, w: 2, alpha: 0.36 },
    { r: 236, w: 4, alpha: 0.18 },
  ];

  for (const band of bands) {
    ctx.beginPath();
    ctx.arc(cx, cy, band.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(229, 195, 96, ${band.alpha})`;
    ctx.lineWidth = band.w;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createParticleSpriteTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255, 250, 232, 1)');
  grad.addColorStop(0.28, 'rgba(232, 198, 108, 0.72)');
  grad.addColorStop(0.65, 'rgba(212, 175, 55, 0.16)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Pre-allocated math helpers outside the animation loop (zero per-frame GC).
const _targetPlanetPos = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();
const _colorTmp = new THREE.Color();
const _dummy = new THREE.Object3D();

export function LoginSpaceScene({ onEnvironmentReady }: LoginSpaceSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onEnvironmentReady);
  callbackRef.current = onEnvironmentReady;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    const host: HTMLDivElement = container;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = motionQuery.matches;

    const probe = detectSoftwareWebGL();
    if (!probe.supported) {
      callbackRef.current?.({
        webglSupported: false,
        isSoftwareGl: true,
        reducedMotion,
      });
      return;
    }

    const isSoftwareGl = probe.isSoftwareGl;
    callbackRef.current?.({
      webglSupported: true,
      isSoftwareGl,
      reducedMotion,
    });

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      callbackRef.current?.({
        webglSupported: false,
        isSoftwareGl: true,
        reducedMotion,
      });
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#040507');
    scene.fog = new THREE.FogExp2('#040507', 0.02);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);

    // 3-Point Cinematic Space Lighting
    const keyLight = new THREE.DirectionalLight('#FFE5A3', 3.4);
    keyLight.position.set(10, 6.5, 4);
    scene.add(keyLight);

    const hemiLight = new THREE.HemisphereLight('#3A4B6E', '#141009', 0.72);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight('#D4AF37', 2.0);
    rimLight.position.set(-9, -4.5, -6);
    scene.add(rimLight);

    const orbitalGlowLight = new THREE.PointLight('#E6C465', 2.4, 24, 1.5);
    orbitalGlowLight.position.set(3.2, 1.5, 2.8);
    scene.add(orbitalGlowLight);

    const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    const disposables: Array<{ dispose: () => void }> = [envTarget];

    // Composite Planetary System Group (planet + atmosphere + rings + orbital nodes)
    const planetSystem = new THREE.Group();
    scene.add(planetSystem);

    const planetTextures = createPlanetTextures(maxAnisotropy);
    disposables.push(
      planetTextures.albedoMap,
      planetTextures.roughnessMap,
      planetTextures.emissiveMap,
    );

    // Part 1: Planetary Core Sphere
    const planetGeo = new THREE.SphereGeometry(2.55, 64, 48);
    const planetMat = new THREE.MeshStandardMaterial({
      map: planetTextures.albedoMap,
      roughnessMap: planetTextures.roughnessMap,
      emissiveMap: planetTextures.emissiveMap,
      emissive: new THREE.Color('#D4AF37'),
      emissiveIntensity: 0.78,
      roughness: 0.84,
      metalness: 0.14,
      envMapIntensity: 0.52,
    });
    const planetMesh = new THREE.Mesh(planetGeo, planetMat);
    planetSystem.add(planetMesh);
    disposables.push(planetGeo, planetMat);

    // Part 2: Fresnel Atmospheric Horizon Shell
    const atmosGeo = new THREE.SphereGeometry(2.74, 64, 48);
    const atmosMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorInner: { value: new THREE.Color('#F2D479') },
        uColorOuter: { value: new THREE.Color('#8C6718') },
        uSunDir: { value: new THREE.Vector3(10, 6.5, 4).normalize() },
      },
      vertexShader: `
        varying vec3 vNormalWorld;
        varying vec3 vViewDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vNormalWorld = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColorInner;
        uniform vec3 uColorOuter;
        uniform vec3 uSunDir;
        varying vec3 vNormalWorld;
        varying vec3 vViewDir;
        void main() {
          float fresnel = pow(clamp(1.0 - dot(-vViewDir, vNormalWorld), 0.0, 1.0), 3.1);
          float sunSide = smoothstep(-0.35, 0.75, dot(vNormalWorld, uSunDir));
          vec3 col = mix(uColorOuter, uColorInner, sunSide);
          float alpha = fresnel * (0.24 + 0.62 * sunSide);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
    planetSystem.add(atmosMesh);
    disposables.push(atmosGeo, atmosMat);

    // Orbital Rig Tilt Container
    const orbitalRig = new THREE.Group();
    orbitalRig.rotation.set(Math.PI * 0.36, -Math.PI * 0.14, Math.PI * 0.09);
    planetSystem.add(orbitalRig);

    // Part 3: Primary Brushed Champagne-Gold Ring
    const primaryRingGeo = new THREE.TorusGeometry(4.15, 0.036, 16, 144);
    const primaryRingMat = new THREE.MeshPhysicalMaterial({
      color: '#E6C76E',
      metalness: 0.94,
      roughness: 0.18,
      anisotropy: 0.8,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.35,
    });
    const primaryRing = new THREE.Mesh(primaryRingGeo, primaryRingMat);
    primaryRing.rotation.x = Math.PI / 2;
    orbitalRig.add(primaryRing);
    disposables.push(primaryRingGeo, primaryRingMat);

    // Part 4: Secondary Outer Telemetry Ring
    const outerRingGeo = new THREE.TorusGeometry(5.1, 0.018, 12, 160);
    const outerRingMat = new THREE.MeshStandardMaterial({
      color: '#B89135',
      metalness: 0.9,
      roughness: 0.28,
      emissive: '#5C440C',
      emissiveIntensity: 0.35,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = Math.PI / 2 + 0.12;
    outerRing.rotation.y = 0.08;
    orbitalRig.add(outerRing);
    disposables.push(outerRingGeo, outerRingMat);

    // Part 5: Inner Precision Gimbal Ring
    const innerRingGeo = new THREE.TorusGeometry(3.38, 0.022, 12, 128);
    const innerRingMat = new THREE.MeshStandardMaterial({
      color: '#D4AF37',
      metalness: 0.92,
      roughness: 0.22,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = Math.PI / 2 - 0.18;
    innerRing.rotation.y = -0.14;
    orbitalRig.add(innerRing);
    disposables.push(innerRingGeo, innerRingMat);

    // Part 6: Equatorial Banded Dust Plane
    const dustBandTex = createOrbitalBandTexture(maxAnisotropy);
    const dustBandGeo = new THREE.RingGeometry(3.55, 4.95, 96);
    const dustBandMat = new THREE.MeshBasicMaterial({
      map: dustBandTex,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dustBand = new THREE.Mesh(dustBandGeo, dustBandMat);
    dustBand.rotation.x = Math.PI / 2;
    orbitalRig.add(dustBand);
    disposables.push(dustBandTex, dustBandGeo, dustBandMat);

    // Part 7: Instanced Orbital Relay Satellites & Structural Nodes
    const nodeCount = 36;
    const nodeGeo = new THREE.OctahedronGeometry(0.068, 0);
    const nodeMat = new THREE.MeshStandardMaterial({
      color: '#F5DF97',
      metalness: 0.95,
      roughness: 0.16,
      emissive: '#B88924',
      emissiveIntensity: 0.55,
    });
    const orbitalNodes = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCount);
    orbitalNodes.frustumCulled = false;

    for (let i = 0; i < nodeCount; i++) {
      const angle = (i / nodeCount) * Math.PI * 2;
      const trackRadius = i % 3 === 0 ? 5.1 : i % 2 === 0 ? 4.15 : 3.38;
      const yOffset = i % 3 === 0 ? Math.sin(angle) * 0.55 : i % 2 === 0 ? 0 : -Math.sin(angle) * 0.45;
      _dummy.position.set(
        Math.cos(angle) * trackRadius,
        yOffset,
        Math.sin(angle) * trackRadius,
      );
      const s = 0.72 + ((i * 7) % 5) * 0.14;
      _dummy.scale.setScalar(s);
      _dummy.rotation.set(angle, angle * 0.5, 0);
      _dummy.updateMatrix();
      orbitalNodes.setMatrixAt(i, _dummy.matrix);

      _colorTmp.setHex(i % 4 === 0 ? 0xf7e3a1 : 0xd4af37);
      orbitalNodes.setColorAt(i, _colorTmp);
    }
    orbitalNodes.instanceMatrix.needsUpdate = true;
    if (orbitalNodes.instanceColor) orbitalNodes.instanceColor.needsUpdate = true;
    orbitalNodes.computeBoundingSphere();
    orbitalRig.add(orbitalNodes);
    disposables.push(nodeGeo, nodeMat);

    // Deep Space Starfield & Golden Cosmic Dust Particles
    const particleSprite = createParticleSpriteTexture();
    disposables.push(particleSprite);

    const starCount = 920;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    let pSeed = 9173;
    const pRand = () => {
      pSeed = (pSeed * 48271) % 2147483647;
      return (pSeed - 1) / 2147483646;
    };

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const radius = 16 + pRand() * 34;
      const theta = pRand() * Math.PI * 2;
      const phi = Math.acos(2 * pRand() - 1);
      starPositions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i3 + 2] = radius * Math.cos(phi) - 6;

      const warm = pRand() > 0.42;
      _colorTmp.setHex(warm ? 0xf3dc94 : 0xe4e8f0);
      const brightness = 0.58 + pRand() * 0.42;
      starColors[i3] = _colorTmp.r * brightness;
      starColors[i3 + 1] = _colorTmp.g * brightness;
      starColors[i3 + 2] = _colorTmp.b * brightness;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.34,
      map: particleSprite,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);
    disposables.push(starGeo, starMat);

    const dustCount = 220;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const i3 = i * 3;
      dustPositions[i3] = (pRand() - 0.5) * 18;
      dustPositions[i3 + 1] = (pRand() - 0.5) * 12;
      dustPositions[i3 + 2] = (pRand() - 0.5) * 10 - 1;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.24,
      color: '#EBC86C',
      map: particleSprite,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const goldenDust = new THREE.Points(dustGeo, dustMat);
    scene.add(goldenDust);
    disposables.push(dustGeo, dustMat);

    // Responsive layout target calculation across Desktop, Tablet, and Mobile (portrait + landscape)
    let targetScale = 1;
    function updateResponsiveTargets(snapNow: boolean) {
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;
      const aspect = width / Math.max(height, 1);

      camera.aspect = aspect;

      if (width < 640 && aspect < 1.0) {
        // Mobile Portrait: pull camera back and elevate planet horizon cleanly above the floating login card
        camera.fov = 52;
        _targetCamPos.set(0, 0.2, 12.6);
        _targetPlanetPos.set(0, 2.85, -2.5);
        targetScale = 0.78;
      } else if (height < 520 && aspect >= 1.2) {
        // Mobile Landscape: frame planet on the left flank opposite the right-aligned compact card
        camera.fov = 46;
        _targetCamPos.set(0, 0.05, 11.4);
        _targetPlanetPos.set(-3.95, 0.1, -2.1);
        targetScale = 0.76;
      } else if (width < 1024) {
        // Tablet (portrait & landscape)
        if (aspect < 1.0) {
          camera.fov = 48;
          _targetCamPos.set(0, 0.15, 11.8);
          _targetPlanetPos.set(-1.35, 2.3, -2.2);
          targetScale = 0.88;
        } else {
          camera.fov = 45;
          _targetCamPos.set(0, 0.15, 11.0);
          _targetPlanetPos.set(-2.65, 0.25, -2.0);
          targetScale = 0.92;
        }
      } else {
        // Desktop wide cinematic framing
        camera.fov = 44;
        _targetCamPos.set(0, 0.15, 10.6);
        _targetPlanetPos.set(-2.55, 0.25, -1.8);
        targetScale = 1.04;
      }

      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));

      if (snapNow) {
        camera.position.copy(_targetCamPos);
        planetSystem.position.copy(_targetPlanetPos);
        planetSystem.scale.setScalar(targetScale);
        camera.lookAt(0, 0, -1.5);
      }
    }

    updateResponsiveTargets(true);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Subtle pointer parallax (desktop/pointer devices only, damped cleanly)
    let pointerX = 0;
    let pointerY = 0;
    const handlePointerMove = (e: PointerEvent) => {
      if (reducedMotion || e.pointerType === 'touch') return;
      const nx = (e.clientX / Math.max(window.innerWidth, 1)) * 2 - 1;
      const ny = (e.clientY / Math.max(window.innerHeight, 1)) * 2 - 1;
      pointerX = THREE.MathUtils.clamp(nx, -1, 1);
      pointerY = THREE.MathUtils.clamp(ny, -1, 1);
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });

    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;
    let contextLost = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      if (disposed || contextLost) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      gl.flush();
      const poll = () => {
        if (disposed || contextLost) {
          gl.deleteSync(sync);
          return;
        }
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestSingleRender() {
      if (disposed || contextLost) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed || contextLost) return;
        renderDirty = false;
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty && !disposed && !contextLost) {
            requestSingleRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    function tick() {
      if (disposed || contextLost || reducedMotion) return;

      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      // Smooth responsive repositioning & subtle pointer parallax
      const camTargetX = _targetCamPos.x + pointerX * 0.38;
      const camTargetY = _targetCamPos.y - pointerY * 0.24;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, camTargetX, 3.2, delta);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, camTargetY, 3.2, delta);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 4.0, delta);
      camera.lookAt(0, 0, -1.5);

      planetSystem.position.x = THREE.MathUtils.damp(
        planetSystem.position.x,
        _targetPlanetPos.x,
        4.2,
        delta,
      );
      planetSystem.position.y = THREE.MathUtils.damp(
        planetSystem.position.y,
        _targetPlanetPos.y + Math.sin(elapsed * 0.45) * 0.09,
        4.2,
        delta,
      );
      planetSystem.position.z = THREE.MathUtils.damp(
        planetSystem.position.z,
        _targetPlanetPos.z,
        4.2,
        delta,
      );
      const nextScale = THREE.MathUtils.damp(planetSystem.scale.x, targetScale, 4.5, delta);
      planetSystem.scale.setScalar(nextScale);

      // Gentle orbital & planetary kinematics
      planetMesh.rotation.y += delta * 0.055;
      orbitalRig.rotation.y += delta * 0.048;
      innerRing.rotation.z -= delta * 0.14;
      outerRing.rotation.z += delta * 0.08;
      starField.rotation.y += delta * 0.008;
      goldenDust.rotation.y -= delta * 0.022;
      goldenDust.position.y = Math.sin(elapsed * 0.35) * 0.18;

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    const handleResize = () => {
      updateResponsiveTargets(reducedMotion);
      if (reducedMotion) {
        requestSingleRender();
      }
    };
    window.addEventListener('resize', handleResize);

    const handleMotionChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      callbackRef.current?.({
        webglSupported: true,
        isSoftwareGl,
        reducedMotion,
      });
      if (reducedMotion) {
        updateResponsiveTargets(true);
        requestSingleRender();
      } else {
        clock.getDelta();
        tick();
      }
    };
    motionQuery.addEventListener('change', handleMotionChange);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
    };
    const handleContextRestored = () => {
      contextLost = false;
      updateResponsiveTargets(reducedMotion);
      if (reducedMotion) requestSingleRender();
      else tick();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    if (reducedMotion) {
      requestSingleRender();
    } else {
      tick();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      motionQuery.removeEventListener('change', handleMotionChange);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      for (const item of disposables) {
        item.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none select-none bg-[#040507]"
      aria-hidden="true"
    >
      {/* Celestial CSS gradient backdrop so there is never an unstyled void before/without WebGL */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 26% 36%, rgba(212, 175, 55, 0.14) 0%, rgba(28, 24, 15, 0.36) 28%, rgba(4, 5, 7, 0.96) 68%, #040507 100%)',
        }}
      />
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />
      {/* Subtle perimeter vignette ensuring clean contrast for foreground typography */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(4, 5, 7, 0.08) 0%, rgba(4, 5, 7, 0.56) 100%)',
        }}
      />
    </div>
  );
}
