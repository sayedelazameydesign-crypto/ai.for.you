import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as THREE from 'three'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three'
import App from '../src/App'
import {
  applyCameraOrbit,
  attachStudioLights,
  buildThreeCodeSnippet,
  clampCameraState,
  createCeliaNetworkGraph,
  createProductShowcaseGraph,
  createRenderLoopController,
  DEFAULT_CAMERA_NETWORK,
  disposeObject3D,
  getModelMeta,
  getSwatchMeta,
  pickNetworkNodeId,
  SHOWCASE_MATERIALS,
  SHOWCASE_MODELS,
  SHOWCASE_SWATCHES,
  updateCeliaNetworkGraph,
  updateShowcaseGraph,
} from '../src/lib/space3d'
import type { NetworkNodeSpec, ShowcaseConfig } from '../src/lib/space3d'

const SAMPLE_NODES: NetworkNodeSpec[] = [
  { id: 'marketing', label: 'مولّد المحتوى التسويقي', subtitle: 'كتابة تسويقية', route: 'marketing', category: 'tool', count: 3, color: '#a78bfa' },
  { id: 'summary', label: 'ملخّص النصوص', subtitle: 'تلخيص فوري', route: 'summary', category: 'tool', count: 1, color: '#34d399' },
  { id: 'saved-hub', label: 'المكتبة المحفوظة', subtitle: 'عناصر محفوظة', route: 'saved', category: 'library', count: 4, color: '#38bdf8' },
]

beforeEach(() => {
  window.location.hash = '/'
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ configured: false })))
})

describe('Three.js scene builders, raycasting, disposal and code generation', () => {
  it('builds the CeliaOS network graph, animates waves when allowed, and picks 3D nodes via Raycaster', () => {
    const graph = createCeliaNetworkGraph(SAMPLE_NODES)
    expect(graph.nodeMeshes.size).toBe(3)
    expect(graph.nodeRings.size).toBe(3)
    expect(graph.waveSurface.geometry.getAttribute('color')).toBeTruthy()

    // Reduced motion keeps orbital rotation still while highlighting the active node.
    updateCeliaNetworkGraph(graph, 2.5, 'summary', true)
    expect(graph.orbitGroup.rotation.y).toBe(0)
    expect(graph.nodeMeshes.get('summary')?.scale.x).toBeGreaterThan(1.1)
    expect(graph.nodeMeshes.get('marketing')?.scale.x).toBe(1)

    // Full motion advances orbital rotation and wave displacement.
    updateCeliaNetworkGraph(graph, 2.5, 'marketing', false)
    expect(graph.orbitGroup.rotation.y).toBeGreaterThan(0)

    const camera = new PerspectiveCamera(48, 16 / 9, 0.1, 100)
    applyCameraOrbit(camera, DEFAULT_CAMERA_NETWORK)
    graph.root.updateMatrixWorld(true)

    const targetMesh = graph.nodeMeshes.get('marketing')!
    const worldPos = new Vector3()
    targetMesh.getWorldPosition(worldPos)
    const ndc = worldPos.clone().project(camera)

    expect(pickNetworkNodeId(graph, ndc.x, ndc.y, camera)).toBe('marketing')
    expect(pickNetworkNodeId(graph, 0.99, 0.99, camera)).toBeNull()

    disposeObject3D(graph.root)
    expect(graph.root.children).toHaveLength(0)
  })

  it('builds all 360° showcase models, materials and swatches, and disposes multi-material meshes cleanly', () => {
    for (const model of SHOWCASE_MODELS) {
      for (const material of SHOWCASE_MATERIALS) {
        const swatch = SHOWCASE_SWATCHES[0]
        const graph = createProductShowcaseGraph({
          model: model.id,
          swatch: swatch.id,
          material: material.id,
          autoRotate: true,
        })
        expect(graph.subjectGroup.children).toHaveLength(1)

        let foundPhysical = false
        let foundWireframe = false
        graph.subjectGroup.traverse((obj) => {
          const mesh = obj as Mesh
          if (mesh.material instanceof MeshPhysicalMaterial) foundPhysical = true
          if (mesh.material instanceof MeshStandardMaterial && mesh.material.wireframe) foundWireframe = true
        })
        if (material.id === 'glass') expect(foundPhysical).toBe(true)
        if (material.id === 'wireframe') expect(foundWireframe).toBe(true)

        updateShowcaseGraph(graph, 1.5, false, false)
        expect(graph.subjectGroup.rotation.y).toBe(0)

        updateShowcaseGraph(graph, 1.5, true, true)
        expect(graph.subjectGroup.rotation.y).toBe(0)

        updateShowcaseGraph(graph, 1.5, true, false)
        expect(graph.subjectGroup.rotation.y).toBeGreaterThan(0)

        disposeObject3D(graph.root)
        expect(graph.root.children).toHaveLength(0)
      }
    }

    // Also prove array-material disposal works without throwing.
    const multiGroup = new Group()
    const m1 = new MeshBasicMaterial()
    const m2 = new MeshBasicMaterial()
    const spy1 = vi.spyOn(m1, 'dispose')
    const spy2 = vi.spyOn(m2, 'dispose')
    multiGroup.add(new Mesh(new BoxGeometry(1, 1, 1), [m1, m2]))
    disposeObject3D(multiGroup)
    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)
  })

  it('clamps spherical camera bounds, attaches studio lights, and exports accurate multi-layer Three.js scenes', () => {
    const clamped = clampCameraState({ azimuth: 1.2, polar: -5, distance: 99 })
    expect(clamped.polar).toBeGreaterThanOrEqual(0.42)
    expect(clamped.distance).toBeLessThanOrEqual(9.2)

    const scene = new Scene()
    attachStudioLights(scene, '#38bdf8')
    expect(scene.children.length).toBe(4)

    expect(getSwatchMeta('violet').accent).toBe('#8b6fe8')
    expect(getModelMeta('prism').id).toBe('prism')

    const expectedLayerCounts = { sneaker: 13, pod: 5, prism: 2 } as const

    for (const modelMeta of SHOWCASE_MODELS) {
      for (const materialMeta of SHOWCASE_MATERIALS) {
        const config: ShowcaseConfig = {
          model: modelMeta.id,
          swatch: 'violet',
          material: materialMeta.id,
          autoRotate: materialMeta.id === 'glass',
        }
        const liveGraph = createProductShowcaseGraph(config)
        const liveModel = liveGraph.subjectGroup.children[0] as Group
        expect(liveModel.children).toHaveLength(expectedLayerCounts[modelMeta.id])

        const code = buildThreeCodeSnippet(config)
        expect(code).toContain("import * as THREE from 'three';")
        expect(code).toContain('export { scene, root, subjectGroup, modelGroup, camera, renderer };')

        let rafCalls = 0
        let renderCalls = 0
        const FakeTHREE = {
          ...THREE,
          WebGLRenderer: class {
            domElement = document.createElement('canvas')
            setPixelRatio() {}
            setSize() {}
            render() { renderCalls += 1 }
          },
        }
        const executableBody = code
          .replace(/^import \* as THREE from 'three';\s*/m, '')
          .replace(/export \{ scene, root, subjectGroup, modelGroup, camera, renderer \};\s*$/m, 'return { scene, root, subjectGroup, modelGroup, camera, renderer };')

        const runner = new Function('THREE', 'requestAnimationFrame', 'cancelAnimationFrame', executableBody) as (
          threeNs: typeof FakeTHREE,
          raf: (cb: FrameRequestCallback) => number,
          caf: (id: number) => void,
        ) => { scene: Scene; root: Group; subjectGroup: Group; modelGroup: Group }

        const exported = runner(
          FakeTHREE,
          () => { rafCalls += 1; return rafCalls },
          () => {},
        )

        expect(renderCalls).toBe(1)
        expect(rafCalls).toBe(config.autoRotate ? 1 : 0)
        expect(exported.modelGroup.name).toBe(liveModel.name)
        expect(exported.modelGroup.children).toHaveLength(liveModel.children.length)

        // Compare every mesh layer's geometry type, transform and material against the live Showcase graph.
        exported.modelGroup.children.forEach((child, idx) => {
          const expMesh = child as Mesh
          const liveMesh = liveModel.children[idx] as Mesh
          expect(expMesh.geometry.type).toBe(liveMesh.geometry.type)
          expect(expMesh.position.toArray()).toEqual(liveMesh.position.toArray())
          expect(expMesh.rotation.toArray()).toEqual(liveMesh.rotation.toArray())
          expect(expMesh.scale.toArray()).toEqual(liveMesh.scale.toArray())
          const expMat = expMesh.material as MeshStandardMaterial | MeshPhysicalMaterial
          const liveMat = liveMesh.material as MeshStandardMaterial | MeshPhysicalMaterial
          expect(expMat.type).toBe(liveMat.type)
          expect(expMat.color.getHexString()).toBe(liveMat.color.getHexString())
          expect(expMat.wireframe).toBe(liveMat.wireframe)
          if (liveMat instanceof MeshPhysicalMaterial) {
            expect((expMat as MeshPhysicalMaterial).clearcoat).toBe(liveMat.clearcoat)
          }
        })

        // Also assert the 3-piece glowing 360° turntable pedestal is present in exported root.
        const exportedStageGeos = exported.root.children
          .filter((c): c is Mesh => c instanceof Mesh)
          .map((m) => m.geometry.type)
        expect(exportedStageGeos).toEqual(['CylinderGeometry', 'TorusGeometry', 'RingGeometry'])

        disposeObject3D(exported.root)
        disposeObject3D(liveGraph.root)
        exported.scene.clear()
      }
    }
  })

  it('suspends requestAnimationFrame when paused or hidden and renders single coalesced frames on demand', () => {
    let clockMs = 1000
    let hidden = false
    let nextId = 1
    const queue = new Map<number, FrameRequestCallback>()
    const stateHistory: boolean[] = []
    const observedFrames: Array<{ elapsed: number; animating: boolean }> = []

    const flushNext = () => {
      const first = queue.entries().next()
      if (first.done) return false
      const [id, cb] = first.value
      queue.delete(id)
      cb(clockMs)
      return true
    }

    const loop = createRenderLoopController(
      (elapsed, animating) => observedFrames.push({ elapsed, animating }),
      {
        requestFrame: (cb) => {
          const id = nextId++
          queue.set(id, cb)
          return id
        },
        cancelFrame: (id) => { queue.delete(id) },
        now: () => clockMs,
        isHidden: () => hidden,
        onStateChange: (active) => stateHistory.push(active),
      },
    )

    // Static mount renders synchronously once and leaves zero queued RAF callbacks.
    loop.setContinuous(false)
    loop.renderNow()
    expect(observedFrames).toHaveLength(1)
    expect(observedFrames[0]).toEqual({ elapsed: 0, animating: false })
    expect(queue.size).toBe(0)
    expect(loop.getStats().loopActive).toBe(false)

    // Multiple on-demand requests coalesce into a single RAF callback and return to idle.
    loop.requestRender()
    loop.requestRender()
    loop.requestRender()
    expect(queue.size).toBe(1)
    expect(flushNext()).toBe(true)
    expect(observedFrames).toHaveLength(2)
    expect(queue.size).toBe(0)
    expect(loop.getStats().loopActive).toBe(false)

    // Continuous mode schedules next RAF and accumulates clamped elapsed time.
    loop.setContinuous(true)
    expect(loop.getStats().loopActive).toBe(true)
    expect(queue.size).toBe(1)
    clockMs += 50
    flushNext()
    expect(observedFrames.at(-1)?.elapsed).toBeCloseTo(0.05, 5)
    expect(queue.size).toBe(1)

    // Pausing cancels the pending RAF immediately and preserves elapsedSec without jumping on resume.
    loop.setContinuous(false)
    expect(queue.size).toBe(0)
    expect(loop.getStats().loopActive).toBe(false)
    const frozenElapsed = loop.getStats().elapsedSec
    clockMs += 5000
    loop.setContinuous(true)
    clockMs += 40
    flushNext()
    expect(loop.getStats().elapsedSec).toBeCloseTo(frozenElapsed + 0.04, 5)

    // Tab visibility suspension stops RAF immediately and resumes cleanly when visible again.
    hidden = true
    loop.onVisibilityChange()
    expect(queue.size).toBe(0)
    expect(loop.getStats().loopActive).toBe(false)

    hidden = false
    loop.setContinuous(false)
    loop.onVisibilityChange()
    expect(queue.size).toBe(1)
    flushNext()
    expect(queue.size).toBe(0)

    loop.dispose()
    loop.requestRender()
    expect(queue.size).toBe(0)
    expect(stateHistory.at(-1)).toBe(false)
  })
})

describe('Optional #/space 3D workspace UI & fallback integration', () => {
  it('opens lazily from the dashboard, switches modes, configures 3D models, copies code and navigates to tools', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<App />)

    // Launch from the optional dashboard 3D banner.
    await user.click(screen.getByRole('button', { name: /افتح الفضاء ثلاثي الأبعاد/ }))
    expect(window.location.hash).toBe('#/space')

    // Lazy chunk resolves to the 3D workspace heading.
    expect(await screen.findByRole('heading', { level: 1, name: 'مساحتك في أبعاد ثلاثة.' })).toBeTruthy()
    // In jsdom WebGL is absent, so the graceful fallback card renders without crashing.
    expect(screen.getByText(/وضع معاينة متوافق/)).toBeTruthy()

    // Keyboard controls on the stage region work cleanly.
    const stage = screen.getByRole('region', { name: /منصة العرض التفاعلي ثلاثي الأبعاد/ })
    stage.focus()
    await user.keyboard('{ArrowLeft}{ArrowUp}+-0')

    // Camera toolbar buttons operate cleanly.
    await user.click(screen.getByRole('button', { name: /الدوران التلقائي/ }))
    await user.click(screen.getByRole('button', { name: 'تكبير المشهد' }))
    await user.click(screen.getByRole('button', { name: 'تصغير المشهد' }))
    await user.click(screen.getByRole('button', { name: 'إعادة ضبط زاوية الكاميرا' }))

    // Switch to 360° Showcase mode, change model, swatch and material, and copy code.
    await user.click(screen.getByRole('button', { name: /مستعرض ومخصّص 360°/ }))
    await user.click(screen.getByRole('button', { name: /بلّورة متعدّدة الأوجه/ }))
    await user.click(screen.getByRole('button', { name: 'اللون: بنفسجي Celia' }))
    await user.click(screen.getByRole('button', { name: 'شبكي هندسي' }))

    const codePre = screen.getByLabelText('كود Three.js المولّد')
    expect(codePre.textContent).toContain('TorusKnotGeometry')
    expect(codePre.textContent).toContain('wireframe: true')
    expect(codePre.textContent).toContain('#8b6fe8')

    await user.click(screen.getByRole('button', { name: /نسخ كود Three\.js/ }))
    expect(writeText).toHaveBeenCalledTimes(1)

    // Switch back to CeliaOS Network mode, inspect Summary node, and navigate to it.
    await user.click(screen.getByRole('button', { name: /شبكة CeliaOS الحية/ }))
    await user.click(screen.getByRole('button', { name: /ملخّص النصوص.*محفوظات/ }))
    await user.click(screen.getByRole('button', { name: 'انتقل إلى ملخّص النصوص' }))
    expect(window.location.hash).toBe('#/summary')
  })
})
