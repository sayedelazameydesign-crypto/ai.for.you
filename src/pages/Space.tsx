import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Color, FogExp2, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import {
  ArrowLeft,
  Box,
  Check,
  Copy,
  Cpu,
  FolderHeart,
  Layers,
  Network,
  Orbit,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useWorkspace } from '../hooks'
import { tools } from '../tools/index'
import { PageHeading } from '../components/ui'
import {
  applyCameraOrbit,
  attachStudioLights,
  buildThreeCodeSnippet,
  clampCameraState,
  createCeliaNetworkGraph,
  createProductShowcaseGraph,
  DEFAULT_CAMERA_NETWORK,
  DEFAULT_CAMERA_SHOWCASE,
  disposeObject3D,
  getModelMeta,
  getSwatchMeta,
  pickNetworkNodeId,
  SHOWCASE_MATERIALS,
  SHOWCASE_MODELS,
  SHOWCASE_SWATCHES,
  updateCeliaNetworkGraph,
  updateShowcaseGraph,
} from '../lib/space3d'
import type {
  CeliaNetworkGraph,
  NetworkNodeSpec,
  ProductShowcaseGraph,
  ShowcaseMaterialId,
  ShowcaseModelId,
  ShowcaseSwatchId,
  SpaceMode,
  SphericalCameraState,
} from '../lib/space3d'

const TOOL_HEX: Record<string, string> = {
  purple: '#a78bfa',
  green: '#34d399',
  orange: '#fb923c',
}

function detectWebGLSupport(): boolean {
  if (typeof document === 'undefined') return false
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

export function Space() {
  const { navigate, saved, aiAvailable, mode: engineMode, notify } = useWorkspace()
  const [spaceMode, setSpaceMode] = useState<SpaceMode>('network')
  const [selectedNodeId, setSelectedNodeId] = useState<string>('marketing')
  const [model, setModel] = useState<ShowcaseModelId>('sneaker')
  const [swatch, setSwatch] = useState<ShowcaseSwatchId>('electric')
  const [material, setMaterial] = useState<ShowcaseMaterialId>('studio')
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [autoRotate, setAutoRotate] = useState<boolean>(() => !reducedMotion)
  const [webglReady, setWebglReady] = useState<boolean>(detectWebGLSupport)
  const [copiedCode, setCopiedCode] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      setReducedMotion(media.matches)
      if (media.matches) setAutoRotate(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const nodes = useMemo<NetworkNodeSpec[]>(() => {
    const byTool: Record<string, number> = {}
    for (const item of saved) {
      byTool[item.tool] = (byTool[item.tool] ?? 0) + 1
    }
    return [
      ...tools.map((tool) => ({
        id: tool.id,
        label: tool.title,
        subtitle: tool.description,
        route: tool.id,
        category: 'tool' as const,
        count: byTool[tool.id] ?? 0,
        color: TOOL_HEX[tool.color] ?? '#a78bfa',
      })),
      {
        id: 'saved-hub',
        label: 'المكتبة المحفوظة',
        subtitle: saved.length
          ? `تحتفظ حالياً بـ ${saved.length.toLocaleString('ar-EG')} نتيجة على جهازك.`
          : 'مكتبتك المحلية جاهزة لحفظ المخرجات دون حساب.',
        route: 'saved',
        category: 'library',
        count: saved.length,
        color: '#38bdf8',
      },
      {
        id: 'engine-hub',
        label: aiAvailable ? 'المحرّك المحلي والسحابي' : 'المحرّك المحلي الآمن',
        subtitle: aiAvailable
          ? `الوضع النشط حالياً: ${engineMode === 'ai' ? 'سحابي (Groq)' : 'محلي فوري'} مع توافر الخادم.`
          : 'تعمل جميع الأدوات محلياً على جهازك دون مفاتيح خارجية.',
        route: 'settings',
        category: 'engine',
        count: aiAvailable ? 2 : 1,
        color: '#f472b6',
      },
    ]
  }, [saved, aiAvailable, engineMode])

  const activeNode = nodes.find((item) => item.id === selectedNodeId) ?? nodes[0]
  const activeSwatch = getSwatchMeta(swatch)
  const activeModel = getModelMeta(model)
  const codeSnippet = useMemo(
    () => buildThreeCodeSnippet({ model, swatch, material, autoRotate }),
    [model, swatch, material, autoRotate],
  )

  const stageRef = useRef<HTMLDivElement>(null)
  const cameraStateRef = useRef<SphericalCameraState>({ ...DEFAULT_CAMERA_NETWORK })
  const cameraObjRef = useRef<PerspectiveCamera | null>(null)
  const networkGraphRef = useRef<CeliaNetworkGraph | null>(null)
  const selectedNodeRef = useRef<string>(selectedNodeId)
  const autoRotateRef = useRef<boolean>(autoRotate)
  const reducedMotionRef = useRef<boolean>(reducedMotion)

  useEffect(() => { selectedNodeRef.current = selectedNodeId }, [selectedNodeId])
  useEffect(() => { autoRotateRef.current = autoRotate }, [autoRotate])
  useEffect(() => { reducedMotionRef.current = reducedMotion }, [reducedMotion])

  const syncCamera = useCallback((next: SphericalCameraState) => {
    const clamped = clampCameraState(next)
    cameraStateRef.current = clamped
    if (cameraObjRef.current) {
      applyCameraOrbit(cameraObjRef.current, clamped)
    }
  }, [])

  const resetCamera = useCallback(() => {
    syncCamera(spaceMode === 'network' ? { ...DEFAULT_CAMERA_NETWORK } : { ...DEFAULT_CAMERA_SHOWCASE })
  }, [spaceMode, syncCamera])

  const nudgeZoom = useCallback((delta: number) => {
    syncCamera({
      ...cameraStateRef.current,
      distance: cameraStateRef.current.distance + delta,
    })
  }, [syncCamera])

  const nudgeOrbit = useCallback((dAzimuth: number, dPolar: number) => {
    syncCamera({
      ...cameraStateRef.current,
      azimuth: cameraStateRef.current.azimuth + dAzimuth,
      polar: cameraStateRef.current.polar + dPolar,
    })
  }, [syncCamera])

  // Switch default camera framing when toggling between network and showcase modes.
  useEffect(() => {
    cameraStateRef.current = spaceMode === 'network'
      ? { ...DEFAULT_CAMERA_NETWORK }
      : { ...DEFAULT_CAMERA_SHOWCASE }
  }, [spaceMode])

  // WebGL scene setup & teardown. Disposes every resource on mode/config change and unmount.
  useEffect(() => {
    const host = stageRef.current
    if (!host || !webglReady) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      queueMicrotask(() => setWebglReady(false))
      return
    }
    const width = Math.max(host.clientWidth, 320)
    const height = Math.max(host.clientHeight, 360)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height)
    renderer.domElement.className = 'space-canvas'
    renderer.domElement.setAttribute('aria-hidden', 'true')
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    scene.background = new Color('#0d1021')
    scene.fog = new FogExp2('#0d1021', 0.048)

    const camera = new PerspectiveCamera(48, width / height, 0.1, 100)
    cameraObjRef.current = camera
    applyCameraOrbit(camera, cameraStateRef.current)

    attachStudioLights(scene, spaceMode === 'showcase' ? activeSwatch.glow : '#8b5cf6')

    let netGraph: CeliaNetworkGraph | null = null
    let showGraph: ProductShowcaseGraph | null = null

    if (spaceMode === 'network') {
      netGraph = createCeliaNetworkGraph(nodes)
      networkGraphRef.current = netGraph
      scene.add(netGraph.root)
    } else {
      showGraph = createProductShowcaseGraph({ model, swatch, material, autoRotate: autoRotateRef.current })
      networkGraphRef.current = null
      scene.add(showGraph.root)
    }

    let rafId = 0
    const startTime = performance.now()

    const renderFrame = () => {
      const elapsed = (performance.now() - startTime) / 1000
      if (netGraph) {
        updateCeliaNetworkGraph(
          netGraph,
          elapsed,
          selectedNodeRef.current,
          reducedMotionRef.current || !autoRotateRef.current,
        )
      }
      if (showGraph) {
        updateShowcaseGraph(showGraph, elapsed, autoRotateRef.current, reducedMotionRef.current)
      }
      renderer.render(scene, camera)
      rafId = window.requestAnimationFrame(renderFrame)
    }
    renderFrame()

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          const nextWidth = Math.max(host.clientWidth, 280)
          const nextHeight = Math.max(host.clientHeight, 320)
          camera.aspect = nextWidth / nextHeight
          camera.updateProjectionMatrix()
          renderer.setSize(nextWidth, nextHeight)
        })
      : null
    resizeObserver?.observe(host)

    return () => {
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
      networkGraphRef.current = null
      cameraObjRef.current = null
      disposeObject3D(scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [webglReady, spaceMode, nodes, model, swatch, material, activeSwatch.glow])

  // Pointer drag orbit + click raycasting for 3D network nodes.
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; moved: boolean; az: number; pol: number }>({
    active: false,
    startX: 0,
    startY: 0,
    moved: false,
    az: 0,
    pol: 0,
  })

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      az: cameraStateRef.current.azimuth,
      pol: cameraStateRef.current.polar,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const dx = event.clientX - dragRef.current.startX
    const dy = event.clientY - dragRef.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true
    syncCamera({
      ...cameraStateRef.current,
      azimuth: dragRef.current.az - dx * 0.0085,
      polar: dragRef.current.pol - dy * 0.0075,
    })
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const wasClick = !dragRef.current.moved
    dragRef.current.active = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    if (wasClick && spaceMode === 'network' && networkGraphRef.current && cameraObjRef.current && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
        const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
        const picked = pickNetworkNodeId(networkGraphRef.current, ndcX, ndcY, cameraObjRef.current)
        if (picked) setSelectedNodeId(picked)
      }
    }
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    nudgeZoom(event.deltaY > 0 ? 0.45 : -0.45)
  }

  const handleStageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).tagName === 'BUTTON') return
    if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeOrbit(-0.14, 0) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); nudgeOrbit(0.14, 0) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); nudgeOrbit(0, -0.12) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); nudgeOrbit(0, 0.12) }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); nudgeZoom(-0.45) }
    else if (event.key === '-') { event.preventDefault(); nudgeZoom(0.45) }
    else if (event.key === '0') { event.preventDefault(); resetCamera() }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(codeSnippet)
      setCopiedCode(true)
      notify('نُسخ كود مشهد Three.js إلى الحافظة.')
      setTimeout(() => setCopiedCode(false), 2500)
    } catch {
      notify('تعذّر النسخ التلقائي — يمكنك تحديد الكود ونسخه يدوياً.', 'error')
    }
  }

  const savedByMarketing = saved.filter((item) => item.tool === 'marketing').length
  const savedBySummary = saved.filter((item) => item.tool === 'summary').length
  const savedByCode = saved.filter((item) => item.tool === 'code').length

  return (
    <div className="page-enter space-page">
      <PageHeading
        eyebrow="تجربة اختيارية · Three.js & WebGL"
        title="مساحتك في أبعاد ثلاثة."
        description="استكشف شبكة أدواتك ومكتبتك كعالم تفاعلي حي مستوحى من CeliaOS، أو خصّص مجسّمات ثلاثية الأبعاد بدوران 360° وانسخ كود المشهد مباشرةً — تُحمَّل عند الطلب فقط دون إبطاء الواجهة الأساسية."
        action={<span className="page-tool-icon purple"><Box size={27} /></span>}
      />

      <div className="mode-control space-mode-tabs" role="group" aria-label="وضع العرض ثلاثي الأبعاد">
        <button
          type="button"
          className={spaceMode === 'network' ? 'selected' : ''}
          aria-pressed={spaceMode === 'network'}
          onClick={() => setSpaceMode('network')}
        >
          <Network size={16} />
          <span>شبكة CeliaOS الحية</span>
          <span className="mode-beta">عالم الوكلاء</span>
        </button>
        <button
          type="button"
          className={spaceMode === 'showcase' ? 'selected' : ''}
          aria-pressed={spaceMode === 'showcase'}
          onClick={() => setSpaceMode('showcase')}
        >
          <Orbit size={16} />
          <span>مستعرض ومخصّص 360°</span>
          <span className="mode-beta">معاينة وتصدير</span>
        </button>
      </div>

      <div className="space-grid">
        <section
          ref={stageRef}
          className="space-stage"
          tabIndex={0}
          role="region"
          aria-label="منصة العرض التفاعلي ثلاثي الأبعاد — اسحب للتدوير أو استخدم أسهم لوحة المفاتيح"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onKeyDown={handleStageKeyDown}
        >
          <div className="space-hud-top">
            <span className="space-pill">
              <span className="space-live-dot" />
              {webglReady === false ? 'وضع معاينة متوافق (دون WebGL)' : 'Three.js WebGL · 360° تفاعلي'}
            </span>
            <div className="space-camera-bar" role="toolbar" aria-label="أدوات الكاميرا ثلاثية الأبعاد">
              <button
                type="button"
                className="space-cam-btn"
                aria-pressed={autoRotate && !reducedMotion}
                aria-label={autoRotate ? 'إيقاف الدوران التلقائي' : 'تشغيل الدوران التلقائي'}
                title={autoRotate ? 'إيقاف الدوران التلقائي' : 'تشغيل الدوران التلقائي'}
                onClick={() => setAutoRotate((prev) => !prev)}
              >
                {autoRotate && !reducedMotion ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                type="button"
                className="space-cam-btn"
                aria-label="تكبير المشهد"
                title="تكبير"
                onClick={() => nudgeZoom(-0.55)}
              >
                <ZoomIn size={15} />
              </button>
              <button
                type="button"
                className="space-cam-btn"
                aria-label="تصغير المشهد"
                title="تصغير"
                onClick={() => nudgeZoom(0.55)}
              >
                <ZoomOut size={15} />
              </button>
              <button
                type="button"
                className="space-cam-btn"
                aria-label="إعادة ضبط زاوية الكاميرا"
                title="إعادة ضبط الزاوية"
                onClick={resetCamera}
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>

          {webglReady === false && (
            <div className="space-fallback-card">
              <Box size={32} />
              <h2>العرض التفاعلي جاهز بوضع التوافق</h2>
              <p>
                متصفحك الحالي لا يفعّل WebGL، لذا أوقفنا الرسم ثلاثي الأبعاد تلقائياً حفاظاً على استقرار الجلسة مع بقاء جميع عقد الشبكة وأدوات التخصيص وتوليد كود Three.js فعّالة بالكامل.
              </p>
            </div>
          )}

          {spaceMode === 'network' ? (
            <div className="space-hud-bottom">
              <div className="space-metrics-box">
                <span className="space-metrics-title">نبض المساحة الآن:</span>
                <ul>
                  <li><i className="dot-purple" />محتوى تسويقي: {savedByMarketing.toLocaleString('ar-EG')}</li>
                  <li><i className="dot-green" />ملخّصات: {savedBySummary.toLocaleString('ar-EG')}</li>
                  <li><i className="dot-orange" />فحوص كود: {savedByCode.toLocaleString('ar-EG')}</li>
                </ul>
              </div>
              <div className="space-callout-pills">
                <span><strong>{tools.length.toLocaleString('ar-EG')}</strong> أدوات نشطة</span>
                <span><strong>{saved.length.toLocaleString('ar-EG')}</strong> عنصر محفوظ</span>
                <span><strong>{aiAvailable ? '٢' : '١'}</strong> طبقة تشغيل</span>
              </div>
            </div>
          ) : (
            <div className="space-hud-bottom showcase-hud">
              <div className="space-degree-badge" dir="ltr">360° INTERACTIVE</div>
              <div className="space-quick-swatches" role="group" aria-label="اختيار سريع للون المجسم">
                {SHOWCASE_SWATCHES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`quick-swatch ${swatch === item.id ? 'active' : ''}`}
                    style={{ '--swatch-hex': item.accent } as React.CSSProperties}
                    aria-label={`اللون: ${item.label}`}
                    aria-pressed={swatch === item.id}
                    onClick={() => setSwatch(item.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="panel space-inspector" aria-label="لوحة التحكم والتفاصيل">
          {spaceMode === 'network' ? (
            <>
              <div className="panel-heading">
                <h2><Sparkles size={17} />عُقد عالم CeliaOS</h2>
                <span className="result-mode">متصل بحالتك المحلية</span>
              </div>
              <p className="space-panel-intro">
                اختر أي عقدة من القائمة أو انقر على مجسّمها المداري داخل المشهد لمعاينة حالتها والانتقال إليها فوراً.
              </p>
              <div className="space-node-list" role="list">
                {nodes.map((node) => {
                  const selected = node.id === activeNode.id
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`space-node-item ${selected ? 'selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <span className="space-node-dot" style={{ background: node.color }} />
                      <span className="space-node-copy">
                        <strong>{node.label}</strong>
                        <small>{node.category === 'tool' ? `محفوظات: ${node.count.toLocaleString('ar-EG')}` : node.category === 'library' ? 'ذاكرة الجهاز' : 'حالة المحرك'}</small>
                      </span>
                      <ArrowLeft size={15} />
                    </button>
                  )
                })}
              </div>

              <div className="space-selected-card">
                <div className="space-selected-head">
                  <span className="space-node-dot large" style={{ background: activeNode.color }} />
                  <div>
                    <h3>{activeNode.label}</h3>
                    <span>
                      {activeNode.category === 'tool' ? 'أداة ذكية نشطة' : activeNode.category === 'library' ? 'سجل محلي' : 'نواة التشغيل'}
                    </span>
                  </div>
                </div>
                <p>{activeNode.subtitle}</p>
                <button
                  type="button"
                  className="button button-primary generate-button"
                  onClick={() => navigate(activeNode.route)}
                >
                  {activeNode.category === 'library' ? <FolderHeart size={17} /> : activeNode.category === 'engine' ? <Cpu size={17} /> : <Sparkles size={17} />}
                  <span>
                    {activeNode.category === 'library'
                      ? 'افتح المكتبة المحفوظة'
                      : activeNode.category === 'engine'
                        ? 'افتح إعدادات التشغيل'
                        : `انتقل إلى ${activeNode.label}`}
                  </span>
                  <ArrowLeft size={17} className="submit-arrow" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="panel-heading">
                <h2><Layers size={17} />تخصيص المجسّم والكود</h2>
                <span className="result-mode">{activeModel.label}</span>
              </div>

              <div className="field">
                <span className="space-field-label">١. اختر المجسّم ثلاثي الأبعاد</span>
                <div className="space-model-options">
                  {SHOWCASE_MODELS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={model === item.id ? 'selected' : ''}
                      aria-pressed={model === item.id}
                      onClick={() => setModel(item.id)}
                    >
                      <strong>{item.label}</strong>
                      <small>{item.subtitle}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="space-field-label">٢. اللوحة اللونية ({activeSwatch.label})</span>
                <div className="space-swatch-grid">
                  {SHOWCASE_SWATCHES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`space-swatch-chip ${swatch === item.id ? 'selected' : ''}`}
                      aria-pressed={swatch === item.id}
                      onClick={() => setSwatch(item.id)}
                    >
                      <i style={{ background: item.accent }} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="space-field-label">٣. الخامة وطريقة الرسم</span>
                <div className="platform-options">
                  {SHOWCASE_MATERIALS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={material === item.id ? 'selected' : ''}
                      aria-pressed={material === item.id}
                      onClick={() => setMaterial(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-code-box">
                <div className="space-code-head">
                  <strong>كود مشهد Three.js المطابق لاختيارك</strong>
                  <button type="button" className="text-button" onClick={copyCode}>
                    {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedCode ? 'تم النسخ' : 'نسخ كود Three.js'}</span>
                  </button>
                </div>
                <pre dir="ltr" aria-label="كود Three.js المولّد">{codeSnippet}</pre>
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="honesty-note">
        <Cpu size={20} />
        <div>
          <h3>طبقة ثلاثية الأبعاد مسؤولة في استهلاك الموارد</h3>
          <p>
            لا تُحمَّل مكتبة <code>three</code> مطلقاً عند فتح الصفحة الرئيسية أو الأدوات النصية، بل تُستدعى بحزمة مستقلة عند دخول هذه الصفحة فقط، مع ضبط سقف دقة البكسل (<code>2x</code>) وإيقاف الحركة التلقائية عند تفعيل تقليل الحركة وتحرير ذاكرة البطاقة الرسومية فور مغادرة المشهد.
          </p>
        </div>
      </div>
    </div>
  )
}

export default Space
