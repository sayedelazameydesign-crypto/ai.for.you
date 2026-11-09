import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Raycaster,
  RingGeometry,
  Scene,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
} from 'three'
import type { Route } from '../workspace'

export type SpaceMode = 'network' | 'showcase'
export type ShowcaseModelId = 'sneaker' | 'pod' | 'prism'
export type ShowcaseMaterialId = 'studio' | 'glass' | 'wireframe'
export type ShowcaseSwatchId = 'electric' | 'violet' | 'emerald' | 'coral' | 'obsidian'

export interface NetworkNodeSpec {
  id: string
  label: string
  subtitle: string
  route: Route
  category: 'tool' | 'library' | 'engine'
  count: number
  color: string
}

export interface ShowcaseModelMeta {
  id: ShowcaseModelId
  label: string
  subtitle: string
}

export interface ShowcaseSwatchMeta {
  id: ShowcaseSwatchId
  label: string
  primary: string
  accent: string
  trim: string
  glow: string
}

export interface ShowcaseMaterialMeta {
  id: ShowcaseMaterialId
  label: string
  hint: string
}

export interface ShowcaseConfig {
  model: ShowcaseModelId
  swatch: ShowcaseSwatchId
  material: ShowcaseMaterialId
  autoRotate: boolean
}

export interface SphericalCameraState {
  azimuth: number
  polar: number
  distance: number
}

export const SHOWCASE_MODELS: readonly ShowcaseModelMeta[] = [
  {
    id: 'sneaker',
    label: 'حذاء رياضي هندسي',
    subtitle: 'مجسّم عرض منتجات متعدّد الطبقات بدوران 360°',
  },
  {
    id: 'pod',
    label: 'نواة Celia الذكية',
    subtitle: 'وحدة مكتبية بحلقات مدارية وعدسة مضيئة',
  },
  {
    id: 'prism',
    label: 'بلّورة متعدّدة الأوجه',
    subtitle: 'عقدة هندسية متشابكة لاختبار الإضاءة والانعكاس',
  },
]

export const SHOWCASE_SWATCHES: readonly ShowcaseSwatchMeta[] = [
  {
    id: 'electric',
    label: 'أزرق سيبراني',
    primary: '#e8edf7',
    accent: '#2794eb',
    trim: '#f05a7e',
    glow: '#38bdf8',
  },
  {
    id: 'violet',
    label: 'بنفسجي Celia',
    primary: '#ede7fb',
    accent: '#8b6fe8',
    trim: '#c084fc',
    glow: '#a78bfa',
  },
  {
    id: 'emerald',
    label: 'زمردي هادئ',
    primary: '#e8f5ef',
    accent: '#2ea982',
    trim: '#6ee7b7',
    glow: '#34d399',
  },
  {
    id: 'coral',
    label: 'مرجاني دافئ',
    primary: '#f9ece6',
    accent: '#e06d53',
    trim: '#f59e0b',
    glow: '#fb923c',
  },
  {
    id: 'obsidian',
    label: 'ليلي مذهّب',
    primary: '#2b2d42',
    accent: '#eab308',
    trim: '#818cf8',
    glow: '#facc15',
  },
]

export const SHOWCASE_MATERIALS: readonly ShowcaseMaterialMeta[] = [
  { id: 'studio', label: 'معدني مصقول', hint: 'خامة استوديو متوازنة الإضاءة والخشونة' },
  { id: 'glass', label: 'زجاجي لامع', hint: 'طبقة Clearcoat عاكسة تبرز الحواف المنحنية' },
  { id: 'wireframe', label: 'شبكي هندسي', hint: 'عرض الخطوط المضلّعة لفحص البنية ثلاثية الأبعاد' },
]

export const DEFAULT_CAMERA_NETWORK: SphericalCameraState = {
  azimuth: 0.42,
  polar: 1.24,
  distance: 6.4,
}

export const DEFAULT_CAMERA_SHOWCASE: SphericalCameraState = {
  azimuth: -0.52,
  polar: 1.18,
  distance: 5.2,
}

export function getSwatchMeta(id: ShowcaseSwatchId): ShowcaseSwatchMeta {
  return SHOWCASE_SWATCHES.find((item) => item.id === id) ?? SHOWCASE_SWATCHES[0]
}

export function getModelMeta(id: ShowcaseModelId): ShowcaseModelMeta {
  return SHOWCASE_MODELS.find((item) => item.id === id) ?? SHOWCASE_MODELS[0]
}

export function clampCameraState(state: SphericalCameraState): SphericalCameraState {
  return {
    azimuth: state.azimuth,
    polar: Math.min(2.45, Math.max(0.42, state.polar)),
    distance: Math.min(9.2, Math.max(2.9, state.distance)),
  }
}

export function applyCameraOrbit(
  camera: PerspectiveCamera,
  state: SphericalCameraState,
  target = new Vector3(0, 0.08, 0),
): void {
  const clamped = clampCameraState(state)
  const sinPolar = Math.sin(clamped.polar)
  camera.position.set(
    target.x + clamped.distance * sinPolar * Math.sin(clamped.azimuth),
    target.y + clamped.distance * Math.cos(clamped.polar),
    target.z + clamped.distance * sinPolar * Math.cos(clamped.azimuth),
  )
  camera.lookAt(target)
  camera.updateMatrixWorld()
}

/** Dispose every geometry and material inside an Object3D subtree to prevent GPU memory leaks. */
export function disposeObject3D(root: Object3D): void {
  root.traverse((child) => {
    const maybeMesh = child as Mesh | Line | Points
    if (maybeMesh.geometry instanceof BufferGeometry) {
      maybeMesh.geometry.dispose()
    }
    const rawMaterial = (maybeMesh as { material?: Material | Material[] }).material
    if (Array.isArray(rawMaterial)) {
      for (const material of rawMaterial) material.dispose()
    } else if (rawMaterial instanceof Material) {
      rawMaterial.dispose()
    }
  })
  root.clear()
}

export interface CeliaNetworkGraph {
  root: Group
  coreMesh: Mesh
  haloMesh: Mesh
  waveLines: LineSegments
  waveSurface: Mesh
  baseWavePositions: Float32Array
  baseSurfacePositions: Float32Array
  orbitGroup: Group
  nodeMeshes: Map<string, Mesh>
  nodeRings: Map<string, Mesh>
  starField: Points
}

function buildWaveGeometry(radius: number, detail: number): {
  geometry: IcosahedronGeometry
  basePositions: Float32Array
} {
  const geometry = new IcosahedronGeometry(radius, detail)
  const positionAttr = geometry.attributes.position as BufferAttribute
  const basePositions = new Float32Array(positionAttr.array.length)
  basePositions.set(positionAttr.array as ArrayLike<number>)

  const colors = new Float32Array(positionAttr.count * 3)
  const cyan = new Color('#2dd4bf')
  const sky = new Color('#38bdf8')
  const violet = new Color('#8b5cf6')
  const magenta = new Color('#ec4899')
  const scratch = new Color()

  for (let i = 0; i < positionAttr.count; i++) {
    const yNorm = (positionAttr.getY(i) / radius + 1) * 0.5
    const xNorm = (positionAttr.getX(i) / radius + 1) * 0.5
    const blend = Math.min(1, Math.max(0, yNorm * 0.65 + xNorm * 0.35))
    if (blend < 0.33) {
      scratch.copy(magenta).lerp(violet, blend / 0.33)
    } else if (blend < 0.68) {
      scratch.copy(violet).lerp(sky, (blend - 0.33) / 0.35)
    } else {
      scratch.copy(sky).lerp(cyan, (blend - 0.68) / 0.32)
    }
    colors[i * 3] = scratch.r
    colors[i * 3 + 1] = scratch.g
    colors[i * 3 + 2] = scratch.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return { geometry, basePositions }
}

function displaceWavePositions(
  attr: BufferAttribute,
  base: Float32Array,
  time: number,
): void {
  const vertex = new Vector3()
  for (let i = 0; i < attr.count; i++) {
    const idx = i * 3
    vertex.set(base[idx], base[idx + 1], base[idx + 2])
    const length = vertex.length() || 1
    const nx = vertex.x / length
    const ny = vertex.y / length
    const nz = vertex.z / length
    const waveA = Math.sin(nx * 3.4 + time * 1.15) * Math.cos(ny * 3.1 - time * 0.85)
    const waveB = Math.sin((ny + nz) * 4.2 + time * 0.9) * 0.55
    const scale = 1 + (waveA * 0.16 + waveB * 0.09)
    attr.setXYZ(i, base[idx] * scale, base[idx + 1] * scale, base[idx + 2] * scale)
  }
  attr.needsUpdate = true
}

function createStarField(count: number, minRadius: number, maxRadius: number): Points {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const palette = [new Color('#93c5fd'), new Color('#c4b5fd'), new Color('#67e8f9')]
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random distribution so tests and snapshots are reproducible.
    const seedA = Math.sin((i + 1) * 12.9898) * 43758.5453
    const seedB = Math.sin((i + 1) * 78.233) * 24634.6345
    const seedC = Math.sin((i + 1) * 39.425) * 15731.7432
    const u = seedA - Math.floor(seedA)
    const v = seedB - Math.floor(seedB)
    const w = seedC - Math.floor(seedC)
    const theta = u * Math.PI * 2
    const phi = Math.acos(2 * v - 1)
    const r = minRadius + w * (maxRadius - minRadius)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.72
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    const tint = palette[i % palette.length]
    colors[i * 3] = tint.r
    colors[i * 3 + 1] = tint.g
    colors[i * 3 + 2] = tint.b
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  const material = new PointsMaterial({
    size: 0.045,
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  })
  return new Points(geometry, material)
}

/** Build the CeliaOS live 3D network scene (glowing core + organic wave mesh + interactive workspace nodes). */
export function createCeliaNetworkGraph(nodes: readonly NetworkNodeSpec[]): CeliaNetworkGraph {
  const root = new Group()
  root.name = 'celia-network-root'

  // Glowing golden-rose central core inspired by the CeliaOS neural hub reference.
  const coreMesh = new Mesh(
    new SphereGeometry(0.76, 36, 36),
    new MeshStandardMaterial({
      color: '#ffe4b5',
      emissive: '#ffbe6b',
      emissiveIntensity: 1.35,
      roughness: 0.18,
      metalness: 0.08,
    }),
  )
  coreMesh.name = 'celia-core'
  root.add(coreMesh)

  const haloMesh = new Mesh(
    new SphereGeometry(1.02, 32, 32),
    new MeshBasicMaterial({
      color: '#fbbf24',
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  )
  root.add(haloMesh)

  // Organic undulating wireframe shell around the core.
  const { geometry: surfaceGeo, basePositions: baseSurfacePositions } = buildWaveGeometry(1.92, 4)
  const waveSurface = new Mesh(
    surfaceGeo,
    new MeshBasicMaterial({
      vertexColors: true,
      wireframe: true,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
  )
  root.add(waveSurface)

  const { geometry: outerWaveGeo, basePositions: baseWavePositions } = buildWaveGeometry(2.22, 3)
  const waveLines = new LineSegments(
    outerWaveGeo,
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
    }),
  )
  root.add(waveLines)

  // Orbital guide ring.
  const guideRing = new Mesh(
    new RingGeometry(2.82, 2.85, 96),
    new MeshBasicMaterial({
      color: '#6366f1',
      side: DoubleSide,
      transparent: true,
      opacity: 0.25,
    }),
  )
  guideRing.rotation.x = Math.PI / 2.25
  root.add(guideRing)

  const orbitGroup = new Group()
  orbitGroup.name = 'celia-orbit-nodes'
  const nodeMeshes = new Map<string, Mesh>()
  const nodeRings = new Map<string, Mesh>()

  const total = Math.max(nodes.length, 1)
  nodes.forEach((node, index) => {
    const angle = (index / total) * Math.PI * 2 - Math.PI * 0.35
    const radius = 2.85
    const yOffset = Math.sin(index * 1.7) * 0.55
    const position = new Vector3(
      Math.cos(angle) * radius,
      yOffset,
      Math.sin(angle) * radius,
    )

    const orbSize = 0.2 + Math.min(node.count, 10) * 0.008
    const nodeMesh = new Mesh(
      new SphereGeometry(orbSize, 24, 24),
      new MeshStandardMaterial({
        color: node.color,
        emissive: node.color,
        emissiveIntensity: 0.65,
        roughness: 0.25,
        metalness: 0.35,
      }),
    )
    nodeMesh.position.copy(position)
    nodeMesh.userData = { nodeId: node.id, route: node.route, label: node.label }
    orbitGroup.add(nodeMesh)
    nodeMeshes.set(node.id, nodeMesh)

    const ringMesh = new Mesh(
      new TorusGeometry(orbSize + 0.11, 0.018, 12, 42),
      new MeshBasicMaterial({
        color: node.color,
        transparent: true,
        opacity: 0.72,
      }),
    )
    ringMesh.position.copy(position)
    ringMesh.lookAt(0, 0, 0)
    orbitGroup.add(ringMesh)
    nodeRings.set(node.id, ringMesh)

    // Radial connection filament from the core halo to each node.
    const mid = position.clone().multiplyScalar(0.52)
    mid.y += 0.22
    const curve = new QuadraticBezierCurve3(new Vector3(0, 0, 0), mid, position)
    const lineGeo = new BufferGeometry().setFromPoints(curve.getPoints(24))
    const line = new Line(
      lineGeo,
      new LineBasicMaterial({
        color: node.color,
        transparent: true,
        opacity: 0.42,
      }),
    )
    orbitGroup.add(line)
  })

  root.add(orbitGroup)

  const starField = createStarField(180, 3.6, 7.4)
  root.add(starField)

  // Seed initial wave shape so reduced-motion still displays an organic sculpture.
  displaceWavePositions(
    waveSurface.geometry.attributes.position as BufferAttribute,
    baseSurfacePositions,
    0.85,
  )
  displaceWavePositions(
    waveLines.geometry.attributes.position as BufferAttribute,
    baseWavePositions,
    1.25,
  )

  return {
    root,
    coreMesh,
    haloMesh,
    waveLines,
    waveSurface,
    baseWavePositions,
    baseSurfacePositions,
    orbitGroup,
    nodeMeshes,
    nodeRings,
    starField,
  }
}

export function updateCeliaNetworkGraph(
  graph: CeliaNetworkGraph,
  elapsedSec: number,
  selectedNodeId: string | null,
  reducedMotion: boolean,
): void {
  if (!reducedMotion) {
    displaceWavePositions(
      graph.waveSurface.geometry.attributes.position as BufferAttribute,
      graph.baseSurfacePositions,
      elapsedSec,
    )
    displaceWavePositions(
      graph.waveLines.geometry.attributes.position as BufferAttribute,
      graph.baseWavePositions,
      elapsedSec * 0.8 + 0.6,
    )
    graph.waveSurface.rotation.y = elapsedSec * 0.09
    graph.waveLines.rotation.y = -elapsedSec * 0.06
    graph.orbitGroup.rotation.y = elapsedSec * 0.14
    graph.starField.rotation.y = elapsedSec * 0.025
    const pulse = 1 + Math.sin(elapsedSec * 2.1) * 0.045
    graph.coreMesh.scale.setScalar(pulse)
    graph.haloMesh.scale.setScalar(1 + Math.sin(elapsedSec * 1.6) * 0.07)
  }

  for (const [id, ring] of graph.nodeRings.entries()) {
    const active = id === selectedNodeId
    ring.scale.setScalar(active ? 1.42 : 1)
    const mat = ring.material as MeshBasicMaterial
    mat.opacity = active ? 1 : 0.48
  }
  for (const [id, mesh] of graph.nodeMeshes.entries()) {
    const active = id === selectedNodeId
    mesh.scale.setScalar(active ? 1.25 : 1)
    const mat = mesh.material as MeshStandardMaterial
    mat.emissiveIntensity = active ? 1.15 : 0.58
  }
}

export function pickNetworkNodeId(
  graph: CeliaNetworkGraph,
  ndcX: number,
  ndcY: number,
  camera: Camera,
): string | null {
  graph.root.updateMatrixWorld(true)
  const raycaster = new Raycaster()
  raycaster.setFromCamera(new Vector2(ndcX, ndcY), camera)
  const targets = Array.from(graph.nodeMeshes.values())
  const hits = raycaster.intersectObjects(targets, false)
  const hitId = hits[0]?.object?.userData?.nodeId
  return typeof hitId === 'string' ? hitId : null
}

/* ---------- Mode 2: 360° Interactive Product / Artifact Showcase ---------- */

export interface ProductShowcaseGraph {
  root: Group
  subjectGroup: Group
  turntableRingOuter: Mesh
  turntableRingInner: Mesh
  starField: Points
}

function createConfiguredMaterial(
  colorHex: string,
  materialKind: ShowcaseMaterialId,
  options: { metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number } = {},
): Material {
  if (materialKind === 'wireframe') {
    return new MeshStandardMaterial({
      color: colorHex,
      emissive: options.emissive ?? colorHex,
      emissiveIntensity: options.emissiveIntensity ?? 0.55,
      wireframe: true,
      roughness: 0.3,
      metalness: 0.2,
    })
  }
  if (materialKind === 'glass') {
    return new MeshPhysicalMaterial({
      color: colorHex,
      emissive: options.emissive ?? '#000000',
      emissiveIntensity: options.emissiveIntensity ?? 0,
      roughness: options.roughness ?? 0.12,
      metalness: options.metalness ?? 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      reflectivity: 0.95,
    })
  }
  return new MeshStandardMaterial({
    color: colorHex,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
    roughness: options.roughness ?? 0.32,
    metalness: options.metalness ?? 0.45,
  })
}

function buildSneakerModel(swatch: ShowcaseSwatchMeta, materialKind: ShowcaseMaterialId): Group {
  const group = new Group()
  group.name = 'model-sneaker'

  const primaryMat = createConfiguredMaterial(swatch.primary, materialKind, { roughness: 0.42, metalness: 0.18 })
  const accentMat = createConfiguredMaterial(swatch.accent, materialKind, {
    roughness: 0.24,
    metalness: 0.52,
    emissive: swatch.accent,
    emissiveIntensity: 0.18,
  })
  const trimMat = createConfiguredMaterial(swatch.trim, materialKind, {
    roughness: 0.26,
    metalness: 0.48,
    emissive: swatch.trim,
    emissiveIntensity: 0.2,
  })
  const soleMat = createConfiguredMaterial('#f8fafc', materialKind, { roughness: 0.35, metalness: 0.1 })

  // Sculpted athletic midsole.
  const soleShape = new Shape()
  soleShape.moveTo(-1.28, -0.32)
  soleShape.quadraticCurveTo(-0.4, -0.44, 0.95, -0.36)
  soleShape.quadraticCurveTo(1.42, -0.28, 1.35, -0.06)
  soleShape.quadraticCurveTo(0.85, 0.04, -0.2, 0.08)
  soleShape.quadraticCurveTo(-1.12, 0.14, -1.32, -0.06)
  soleShape.quadraticCurveTo(-1.38, -0.22, -1.28, -0.32)

  const midsoleGeo = new ExtrudeGeometry(soleShape, {
    depth: 0.76,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: 0.07,
    bevelThickness: 0.07,
  })
  midsoleGeo.center()
  const midsole = new Mesh(midsoleGeo, soleMat)
  midsole.position.set(0, -0.34, 0)
  group.add(midsole)

  // Glowing outsole tread strip.
  const outsole = new Mesh(new BoxGeometry(2.52, 0.08, 0.82), accentMat)
  outsole.position.set(0.02, -0.56, 0)
  group.add(outsole)

  // Upper woven body shell.
  const upper = new Mesh(new CapsuleGeometry(0.42, 1.38, 12, 24), primaryMat)
  upper.rotation.z = Math.PI / 2 - 0.14
  upper.scale.set(1, 1, 0.92)
  upper.position.set(-0.04, 0.05, 0)
  group.add(upper)

  // Ankle collar & heel counter clip.
  const collar = new Mesh(new CylinderGeometry(0.36, 0.44, 0.56, 24), accentMat)
  collar.position.set(-0.68, 0.36, 0)
  collar.rotation.z = 0.22
  group.add(collar)

  const heelClip = new Mesh(new TorusGeometry(0.41, 0.075, 14, 28, Math.PI * 1.15), trimMat)
  heelClip.position.set(-0.78, 0.06, 0)
  heelClip.rotation.y = Math.PI / 2
  heelClip.rotation.x = -0.25
  group.add(heelClip)

  // Dynamic aerodynamic side vector fins (both sides).
  for (const side of [-1, 1]) {
    const fin = new Mesh(new BoxGeometry(1.12, 0.14, 0.05), accentMat)
    fin.position.set(0.02, 0.08, side * 0.41)
    fin.rotation.z = 0.24
    group.add(fin)

    const airWindow = new Mesh(new CapsuleGeometry(0.055, 0.36, 8, 12), trimMat)
    airWindow.rotation.z = Math.PI / 2
    airWindow.position.set(-0.62, -0.34, side * 0.39)
    group.add(airWindow)
  }

  // Laces across the instep.
  for (let i = 0; i < 4; i++) {
    const lace = new Mesh(new CylinderGeometry(0.028, 0.028, 0.54, 10), trimMat)
    lace.rotation.x = Math.PI / 2
    lace.position.set(-0.14 + i * 0.19, 0.36 - i * 0.055, 0)
    group.add(lace)
  }

  // Stylized floating tilt matching studio product photography.
  group.rotation.z = 0.22
  group.position.y = 0.26
  return group
}

function buildPodModel(swatch: ShowcaseSwatchMeta, materialKind: ShowcaseMaterialId): Group {
  const group = new Group()
  group.name = 'model-pod'

  const bodyMat = createConfiguredMaterial(swatch.primary, materialKind, { roughness: 0.22, metalness: 0.58 })
  const accentMat = createConfiguredMaterial(swatch.accent, materialKind, {
    roughness: 0.18,
    metalness: 0.65,
    emissive: swatch.accent,
    emissiveIntensity: 0.28,
  })
  const coreMat = createConfiguredMaterial(swatch.trim, materialKind, {
    roughness: 0.12,
    metalness: 0.2,
    emissive: swatch.glow,
    emissiveIntensity: 0.65,
  })

  const capsule = new Mesh(new CapsuleGeometry(0.66, 0.72, 18, 36), bodyMat)
  group.add(capsule)

  const visorBand = new Mesh(new CylinderGeometry(0.69, 0.69, 0.28, 40), accentMat)
  visorBand.position.y = 0.16
  group.add(visorBand)

  const lens = new Mesh(new SphereGeometry(0.24, 24, 24), coreMat)
  lens.position.set(0, 0.16, 0.56)
  group.add(lens)

  const gyroA = new Mesh(new TorusGeometry(1.08, 0.032, 14, 64), accentMat)
  gyroA.rotation.x = Math.PI / 2.8
  group.add(gyroA)

  const gyroB = new Mesh(new TorusGeometry(1.24, 0.022, 12, 64), coreMat)
  gyroB.rotation.y = Math.PI / 3
  gyroB.rotation.x = -Math.PI / 5
  group.add(gyroB)

  group.position.y = 0.22
  return group
}

function buildPrismModel(swatch: ShowcaseSwatchMeta, materialKind: ShowcaseMaterialId): Group {
  const group = new Group()
  group.name = 'model-prism'

  const knotMat = createConfiguredMaterial(swatch.accent, materialKind, {
    roughness: 0.18,
    metalness: 0.68,
    emissive: swatch.accent,
    emissiveIntensity: 0.2,
  })
  const innerMat = createConfiguredMaterial(swatch.trim, materialKind, {
    roughness: 0.15,
    metalness: 0.35,
    emissive: swatch.glow,
    emissiveIntensity: 0.5,
  })

  const knot = new Mesh(new TorusKnotGeometry(0.84, 0.24, 128, 22), knotMat)
  group.add(knot)

  const gem = new Mesh(new OctahedronGeometry(0.46, 0), innerMat)
  group.add(gem)

  group.position.y = 0.24
  return group
}

export function createProductShowcaseGraph(config: ShowcaseConfig): ProductShowcaseGraph {
  const root = new Group()
  root.name = 'celia-showcase-root'
  const swatch = getSwatchMeta(config.swatch)

  // Glowing 360° holographic platform.
  const pedestal = new Mesh(
    new CylinderGeometry(1.75, 1.92, 0.12, 64),
    new MeshStandardMaterial({
      color: '#14172b',
      roughness: 0.28,
      metalness: 0.72,
    }),
  )
  pedestal.position.y = -0.95
  root.add(pedestal)

  const turntableRingOuter = new Mesh(
    new TorusGeometry(1.98, 0.022, 12, 96),
    new MeshBasicMaterial({
      color: swatch.glow,
      transparent: true,
      opacity: 0.75,
    }),
  )
  turntableRingOuter.rotation.x = Math.PI / 2
  turntableRingOuter.position.y = -0.88
  root.add(turntableRingOuter)

  const turntableRingInner = new Mesh(
    new RingGeometry(1.18, 1.48, 72),
    new MeshBasicMaterial({
      color: swatch.accent,
      side: DoubleSide,
      transparent: true,
      opacity: 0.22,
    }),
  )
  turntableRingInner.rotation.x = -Math.PI / 2
  turntableRingInner.position.y = -0.87
  root.add(turntableRingInner)

  const subjectGroup = new Group()
  subjectGroup.name = 'showcase-subject'
  const modelMesh = config.model === 'sneaker'
    ? buildSneakerModel(swatch, config.material)
    : config.model === 'pod'
      ? buildPodModel(swatch, config.material)
      : buildPrismModel(swatch, config.material)
  subjectGroup.add(modelMesh)
  root.add(subjectGroup)

  const starField = createStarField(140, 3.2, 6.8)
  root.add(starField)

  return {
    root,
    subjectGroup,
    turntableRingOuter,
    turntableRingInner,
    starField,
  }
}

export function updateShowcaseGraph(
  graph: ProductShowcaseGraph,
  elapsedSec: number,
  autoRotate: boolean,
  reducedMotion: boolean,
): void {
  if (reducedMotion || !autoRotate) return
  graph.subjectGroup.rotation.y = elapsedSec * 0.62
  graph.subjectGroup.position.y = Math.sin(elapsedSec * 1.8) * 0.07
  graph.turntableRingOuter.scale.setScalar(1 + Math.sin(elapsedSec * 2.2) * 0.025)
  graph.starField.rotation.y = -elapsedSec * 0.03
}

/** Build standard studio lighting shared by both 3D modes. */
export function attachStudioLights(scene: Scene, glowHex = '#8b5cf6'): void {
  const ambient = new AmbientLight('#dbe4ff', 0.85)
  const keyLight = new DirectionalLight('#ffffff', 2.1)
  keyLight.position.set(4, 5, 6)
  const rimLight = new DirectionalLight(glowHex, 1.45)
  rimLight.position.set(-5, 3, -4)
  const coreLight = new PointLight('#fbbf24', 1.6, 12)
  coreLight.position.set(0, 0.4, 1.5)
  scene.add(ambient, keyLight, rimLight, coreLight)
}

export interface RenderLoopStats {
  frames: number
  loopActive: boolean
  continuous: boolean
  elapsedSec: number
}

export interface RenderLoopEnv {
  requestFrame?: (cb: FrameRequestCallback) => number
  cancelFrame?: (id: number) => void
  now?: () => number
  isHidden?: () => boolean
  onStateChange?: (loopActive: boolean) => void
}

export interface RenderLoopController {
  /** Enable or pause continuous animation without losing accumulated elapsed time. */
  setContinuous: (enabled: boolean) => void
  /** Coalesce a single on-demand frame render when the loop is idle. */
  requestRender: () => void
  /** Render one frame synchronously (e.g. after a scene swap) and sync loop scheduling. */
  renderNow: () => void
  /** Suspend RAF while the tab is hidden; resume or paint once when visible again. */
  onVisibilityChange: () => void
  /** Cancel any scheduled frame and prevent future callbacks. */
  dispose: () => void
  /** Read loop counters without triggering React state updates. */
  getStats: () => RenderLoopStats
}

/**
 * Demand-driven WebGL render scheduler.
 * When `continuous` is false or the document is hidden, zero background RAF callbacks run;
 * camera orbit, zoom, resize and selection wake the renderer for a single coalesced frame.
 */
export function createRenderLoopController(
  onFrame: (elapsedSec: number, animating: boolean) => void,
  env: RenderLoopEnv = {},
): RenderLoopController {
  const requestFrame = env.requestFrame ?? ((cb: FrameRequestCallback) => window.requestAnimationFrame(cb))
  const cancelFrame = env.cancelFrame ?? ((id: number) => window.cancelAnimationFrame(id))
  const now = env.now ?? (() => performance.now())
  const isHidden = env.isHidden ?? (() => typeof document !== 'undefined' && document.hidden)

  let continuous = false
  let disposed = false
  let rafId = 0
  let frames = 0
  let elapsedSec = 0
  let lastTickMs: number | null = null
  let reportedActive: boolean | null = null

  const emitState = (active: boolean) => {
    if (reportedActive === active) return
    reportedActive = active
    env.onStateChange?.(active)
  }

  const cancelScheduled = () => {
    if (rafId !== 0) {
      cancelFrame(rafId)
      rafId = 0
    }
    lastTickMs = null
  }

  const tick: FrameRequestCallback = (timestampMs) => {
    rafId = 0
    if (disposed || isHidden()) {
      lastTickMs = null
      emitState(false)
      return
    }
    const animating = continuous
    if (animating) {
      const currentMs = Number.isFinite(timestampMs) ? timestampMs : now()
      if (lastTickMs !== null) {
        elapsedSec += Math.min(Math.max(0, (currentMs - lastTickMs) / 1000), 0.1)
      }
      lastTickMs = currentMs
    } else {
      lastTickMs = null
    }
    frames += 1
    onFrame(elapsedSec, animating)

    if (!disposed && continuous && !isHidden()) {
      rafId = requestFrame(tick)
      emitState(true)
    } else {
      emitState(false)
    }
  }

  const syncContinuousLoop = () => {
    if (disposed || isHidden() || !continuous) {
      cancelScheduled()
      emitState(false)
      return
    }
    if (rafId === 0) {
      lastTickMs = now()
      rafId = requestFrame(tick)
    }
    emitState(true)
  }

  return {
    setContinuous(enabled: boolean) {
      continuous = enabled
      syncContinuousLoop()
    },
    requestRender() {
      if (disposed || isHidden() || rafId !== 0) return
      rafId = requestFrame(tick)
    },
    renderNow() {
      if (disposed) return
      if (isHidden()) {
        cancelScheduled()
        emitState(false)
        return
      }
      frames += 1
      onFrame(elapsedSec, continuous)
      if (continuous) {
        if (rafId === 0) {
          lastTickMs = now()
          rafId = requestFrame(tick)
        }
        emitState(true)
      } else {
        cancelScheduled()
        emitState(false)
      }
    },
    onVisibilityChange() {
      if (disposed) return
      if (isHidden()) {
        cancelScheduled()
        emitState(false)
      } else if (continuous) {
        syncContinuousLoop()
      } else if (rafId === 0) {
        rafId = requestFrame(tick)
      }
    },
    dispose() {
      disposed = true
      cancelScheduled()
      emitState(false)
    },
    getStats() {
      return {
        frames,
        loopActive: !disposed && continuous && !isHidden() && rafId !== 0,
        continuous,
        elapsedSec,
      }
    },
  }
}

function buildExportedMaterialFactory(materialKind: ShowcaseMaterialId): string {
  if (materialKind === 'wireframe') {
    return `function createConfiguredMaterial(colorHex, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: options.emissive ?? colorHex,
    emissiveIntensity: options.emissiveIntensity ?? 0.55,
    wireframe: true,
    roughness: 0.3,
    metalness: 0.2,
  });
}`
  }
  if (materialKind === 'glass') {
    return `function createConfiguredMaterial(colorHex, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: colorHex,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
    roughness: options.roughness ?? 0.12,
    metalness: options.metalness ?? 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    reflectivity: 0.95,
  });
}`
  }
  return `function createConfiguredMaterial(colorHex, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
    roughness: options.roughness ?? 0.32,
    metalness: options.metalness ?? 0.45,
  });
}`
}

function buildExportedModelBlock(model: ShowcaseModelId, swatch: ShowcaseSwatchMeta): string {
  if (model === 'sneaker') {
    return `const modelGroup = new THREE.Group();
modelGroup.name = 'model-sneaker';

const primaryMat = createConfiguredMaterial('${swatch.primary}', { roughness: 0.42, metalness: 0.18 });
const accentMat = createConfiguredMaterial('${swatch.accent}', {
  roughness: 0.24,
  metalness: 0.52,
  emissive: '${swatch.accent}',
  emissiveIntensity: 0.18,
});
const trimMat = createConfiguredMaterial('${swatch.trim}', {
  roughness: 0.26,
  metalness: 0.48,
  emissive: '${swatch.trim}',
  emissiveIntensity: 0.2,
});
const soleMat = createConfiguredMaterial('#f8fafc', { roughness: 0.35, metalness: 0.1 });

const soleShape = new THREE.Shape();
soleShape.moveTo(-1.28, -0.32);
soleShape.quadraticCurveTo(-0.4, -0.44, 0.95, -0.36);
soleShape.quadraticCurveTo(1.42, -0.28, 1.35, -0.06);
soleShape.quadraticCurveTo(0.85, 0.04, -0.2, 0.08);
soleShape.quadraticCurveTo(-1.12, 0.14, -1.32, -0.06);
soleShape.quadraticCurveTo(-1.38, -0.22, -1.28, -0.32);

const midsoleGeo = new THREE.ExtrudeGeometry(soleShape, {
  depth: 0.76,
  bevelEnabled: true,
  bevelSegments: 4,
  steps: 1,
  bevelSize: 0.07,
  bevelThickness: 0.07,
});
midsoleGeo.center();
const midsole = new THREE.Mesh(midsoleGeo, soleMat);
midsole.position.set(0, -0.34, 0);
modelGroup.add(midsole);

const outsole = new THREE.Mesh(new THREE.BoxGeometry(2.52, 0.08, 0.82), accentMat);
outsole.position.set(0.02, -0.56, 0);
modelGroup.add(outsole);

const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.38, 12, 24), primaryMat);
upper.rotation.z = Math.PI / 2 - 0.14;
upper.scale.set(1, 1, 0.92);
upper.position.set(-0.04, 0.05, 0);
modelGroup.add(upper);

const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.56, 24), accentMat);
collar.position.set(-0.68, 0.36, 0);
collar.rotation.z = 0.22;
modelGroup.add(collar);

const heelClip = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.075, 14, 28, Math.PI * 1.15), trimMat);
heelClip.position.set(-0.78, 0.06, 0);
heelClip.rotation.y = Math.PI / 2;
heelClip.rotation.x = -0.25;
modelGroup.add(heelClip);

for (const side of [-1, 1]) {
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.14, 0.05), accentMat);
  fin.position.set(0.02, 0.08, side * 0.41);
  fin.rotation.z = 0.24;
  modelGroup.add(fin);

  const airWindow = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.36, 8, 12), trimMat);
  airWindow.rotation.z = Math.PI / 2;
  airWindow.position.set(-0.62, -0.34, side * 0.39);
  modelGroup.add(airWindow);
}

for (let i = 0; i < 4; i++) {
  const lace = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.54, 10), trimMat);
  lace.rotation.x = Math.PI / 2;
  lace.position.set(-0.14 + i * 0.19, 0.36 - i * 0.055, 0);
  modelGroup.add(lace);
}

modelGroup.rotation.z = 0.22;
modelGroup.position.y = 0.26;`
  }

  if (model === 'pod') {
    return `const modelGroup = new THREE.Group();
modelGroup.name = 'model-pod';

const bodyMat = createConfiguredMaterial('${swatch.primary}', { roughness: 0.22, metalness: 0.58 });
const accentMat = createConfiguredMaterial('${swatch.accent}', {
  roughness: 0.18,
  metalness: 0.65,
  emissive: '${swatch.accent}',
  emissiveIntensity: 0.28,
});
const coreMat = createConfiguredMaterial('${swatch.trim}', {
  roughness: 0.12,
  metalness: 0.2,
  emissive: '${swatch.glow}',
  emissiveIntensity: 0.65,
});

const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.66, 0.72, 18, 36), bodyMat);
modelGroup.add(capsule);

const visorBand = new THREE.Mesh(new THREE.CylinderGeometry(0.69, 0.69, 0.28, 40), accentMat);
visorBand.position.y = 0.16;
modelGroup.add(visorBand);

const lens = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 24), coreMat);
lens.position.set(0, 0.16, 0.56);
modelGroup.add(lens);

const gyroA = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.032, 14, 64), accentMat);
gyroA.rotation.x = Math.PI / 2.8;
modelGroup.add(gyroA);

const gyroB = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.022, 12, 64), coreMat);
gyroB.rotation.y = Math.PI / 3;
gyroB.rotation.x = -Math.PI / 5;
modelGroup.add(gyroB);

modelGroup.position.y = 0.22;`
  }

  return `const modelGroup = new THREE.Group();
modelGroup.name = 'model-prism';

const knotMat = createConfiguredMaterial('${swatch.accent}', {
  roughness: 0.18,
  metalness: 0.68,
  emissive: '${swatch.accent}',
  emissiveIntensity: 0.2,
});
const innerMat = createConfiguredMaterial('${swatch.trim}', {
  roughness: 0.15,
  metalness: 0.35,
  emissive: '${swatch.glow}',
  emissiveIntensity: 0.5,
});

const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.84, 0.24, 128, 22), knotMat);
modelGroup.add(knot);

const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), innerMat);
modelGroup.add(gem);

modelGroup.position.y = 0.24;`
}

/** Generate clean, runnable Three.js ES module code reconstructing the exact multi-layer 3D model and stage. */
export function buildThreeCodeSnippet(config: ShowcaseConfig): string {
  const swatch = getSwatchMeta(config.swatch)
  const materialFactory = buildExportedMaterialFactory(config.material)
  const modelBlock = buildExportedModelBlock(config.model, swatch)

  const loopBlock = config.autoRotate
    ? `const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;
let reducedMotion = Boolean(motionQuery?.matches);
let rafId = 0;
let elapsedSec = 0;
let lastTickMs = performance.now();

function shouldAnimate() {
  return !reducedMotion && !document.hidden;
}

function stopLoop() {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function renderFrame(now = performance.now()) {
  rafId = 0;
  if (document.hidden) return;
  if (shouldAnimate()) {
    elapsedSec += Math.min(Math.max(0, (now - lastTickMs) / 1000), 0.1);
    lastTickMs = now;
    subjectGroup.rotation.y = elapsedSec * 0.62;
    subjectGroup.position.y = Math.sin(elapsedSec * 1.8) * 0.07;
    turntableRingOuter.scale.setScalar(1 + Math.sin(elapsedSec * 2.2) * 0.025);
  }
  renderer.render(scene, camera);
  if (shouldAnimate()) {
    rafId = requestAnimationFrame(renderFrame);
  }
}

motionQuery?.addEventListener?.('change', (event) => {
  reducedMotion = event.matches;
  if (!shouldAnimate()) {
    stopLoop();
  } else if (rafId === 0) {
    lastTickMs = performance.now();
    rafId = requestAnimationFrame(renderFrame);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!shouldAnimate()) {
    stopLoop();
  } else if (rafId === 0) {
    lastTickMs = performance.now();
    rafId = requestAnimationFrame(renderFrame);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!shouldAnimate()) renderer.render(scene, camera);
});

renderFrame();`
    : `// الدوران التلقائي متوقف — يُرسم المشهد عند الطلب فقط دون حلقة requestAnimationFrame مستمرة
function renderOnce() {
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderOnce();
});

renderOnce();`

  return `import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d1021');
scene.fog = new THREE.FogExp2('#0d1021', 0.048);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(-2.39, 2.06, 4.18);
camera.lookAt(0, 0.08, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

${materialFactory}

const root = new THREE.Group();
root.name = 'celia-showcase-root';

const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.75, 1.92, 0.12, 64),
  new THREE.MeshStandardMaterial({ color: '#14172b', roughness: 0.28, metalness: 0.72 }),
);
pedestal.position.y = -0.95;
root.add(pedestal);

const turntableRingOuter = new THREE.Mesh(
  new THREE.TorusGeometry(1.98, 0.022, 12, 96),
  new THREE.MeshBasicMaterial({ color: '${swatch.glow}', transparent: true, opacity: 0.75 }),
);
turntableRingOuter.rotation.x = Math.PI / 2;
turntableRingOuter.position.y = -0.88;
root.add(turntableRingOuter);

const turntableRingInner = new THREE.Mesh(
  new THREE.RingGeometry(1.18, 1.48, 72),
  new THREE.MeshBasicMaterial({ color: '${swatch.accent}', side: THREE.DoubleSide, transparent: true, opacity: 0.22 }),
);
turntableRingInner.rotation.x = -Math.PI / 2;
turntableRingInner.position.y = -0.87;
root.add(turntableRingInner);

const subjectGroup = new THREE.Group();
subjectGroup.name = 'showcase-subject';

${modelBlock}

subjectGroup.add(modelGroup);
root.add(subjectGroup);
scene.add(root);

const ambient = new THREE.AmbientLight('#dbe4ff', 0.85);
const keyLight = new THREE.DirectionalLight('#ffffff', 2.1);
keyLight.position.set(4, 5, 6);
const rimLight = new THREE.DirectionalLight('${swatch.glow}', 1.45);
rimLight.position.set(-5, 3, -4);
const coreLight = new THREE.PointLight('#fbbf24', 1.6, 12);
coreLight.position.set(0, 0.4, 1.5);
scene.add(ambient, keyLight, rimLight, coreLight);

${loopBlock}

export { scene, root, subjectGroup, modelGroup, camera, renderer };`
}
