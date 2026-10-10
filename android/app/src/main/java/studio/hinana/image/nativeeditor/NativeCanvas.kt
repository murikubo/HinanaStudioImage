package studio.hinana.image.nativeeditor

import android.content.Context
import android.graphics.*
import android.opengl.GLSurfaceView
import android.os.Build
import android.view.*
import java.io.File
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.*
import org.json.JSONObject

class NativeCanvas(context: Context) : GLSurfaceView(context), GLSurfaceView.Renderer {
    val engine = NativeRenderer()
    private var file = ""
    private var library: NativeLibrary? = null
    private var tileOrigin = 0.0 to 0.0
    private var tileSize = 1.0 to 1.0
    var onZoom: ((String) -> Unit)? = null
    var onHistogram: ((Array<IntArray>) -> Unit)? = null
    private var thumbnail: Bitmap? = null
    private var histogramDirty = true
    @Volatile private var ready = false
    @Volatile private var disposed = false
    @Volatile private var decodeRevision = 0
    private val decodeWork = java.util.concurrent.Executors.newSingleThreadExecutor()
    private var zoom = 1.0
    private var panX = 0.0
    private var panY = 0.0
    var showOverlay = true
    var selectedMask = ""
    var liquify = false
    var liquifyRadius = .1
    var liquifyStrength = .5
    var onLiquify: ((JSONObject?, Boolean) -> Unit)? = null
    private var warp: NativeLiquify? = null
    private var warpStart: JSONObject? = null
    private var warpPoint: Pair<Double, Double>? = null
    private var warpTime = 0L
    private var warpChanged = false
    var maskTool = "ai"
    var onStroke: ((List<Pair<Double, Double>>) -> Unit)? = null
    var error: ((String) -> Unit)? = null
    private val points = mutableListOf<Pair<Double, Double>>()
    private var lastX = 0f
    private var lastY = 0f
    private val pinch =
        ScaleGestureDetector(
            context,
            object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
                override fun onScale(detector: ScaleGestureDetector): Boolean {
                    val old = scale()
                    val anchorX =
                        (detector.focusX - (width - engine.dimensions().first * old) / 2 - panX) /
                            old
                    val anchorY =
                        (detector.focusY - (height - engine.dimensions().second * old) / 2 - panY) /
                            old
                    zoom = max(.01 / fit(), min(4.0 / fit(), zoom * detector.scaleFactor))
                    val next = scale()
                    panX =
                        detector.focusX -
                            (width - engine.dimensions().first * next) / 2 -
                            anchorX * next
                    panY =
                        detector.focusY -
                            (height - engine.dimensions().second * next) / 2 -
                            anchorY * next
                    clamp()
                    requestRender()
                    return true
                }

                override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
                    points.clear()
                    return true
                }
            },
        )
    private val taps =
        GestureDetector(
            context,
            object : GestureDetector.SimpleOnGestureListener() {
                override fun onDown(e: MotionEvent) = true

                override fun onDoubleTap(e: MotionEvent): Boolean {
                    setZoom(0)
                    return true
                }
            },
        )

    init {
        setEGLContextClientVersion(3)
        setEGLConfigChooser(8, 8, 8, 8, 0, 0)
        setRenderer(this)
        renderMode = RENDERMODE_WHEN_DIRTY
        preserveEGLContextOnPause = true
        contentDescription = "사진 편집 미리보기 · 두 손가락 확대·축소"
    }

    private fun install(
        bitmap: Bitmap,
        origin: Pair<Double, Double>,
        size: Pair<Double, Double>,
        token: Int,
        thumb: Bitmap? = null,
    ) {
        if (disposed || token != decodeRevision) {
            bitmap.recycle()
            thumb?.recycle()
            return
        }
        queueEvent {
            try {
                if (ready && !disposed && token == decodeRevision) {
                    engine.upload(bitmap)
                    tileOrigin = origin
                    tileSize = size
                    if (thumb != null) {
                        thumbnail?.recycle()
                        thumbnail = thumb
                        histogramDirty = true
                    }
                    requestRender()
                } else thumb?.recycle()
            } catch (e: Exception) {
                post { if (!disposed) error?.invoke(e.message ?: "사진 표시 실패") }
            } finally {
                bitmap.recycle()
            }
        }
    }

    fun load(lib: NativeLibrary) {
        library = lib
        histogramDirty = true
        val p = lib.current
        val next = p?.file ?: ""
        val snapshot = p?.settings?.toString() ?: NativePhoto.defaults().toString()
        if (next != file) {
            file = next
            zoom = 1.0
            panX = 0.0
            panY = 0.0
        }
        val token = ++decodeRevision
        queueEvent {
            engine.photo = p
            engine.settings = JSONObject(snapshot)
            requestRender()
        }
        if (p == null || disposed) return
        decodeWork.execute {
            if (disposed || token != decodeRevision) return@execute
            try {
                val bitmap = NativeRenderer.decode(File(lib.root, p.file))
                val thumb = NativeRenderer.decode(File(lib.root, p.file), 64)
                install(bitmap, 0.0 to 0.0, 1.0 to 1.0, token, thumb)
            } catch (e: Exception) {
                post {
                    if (!disposed && token == decodeRevision) error?.invoke(e.message ?: "이미지 오류")
                }
            }
        }
    }

    fun changed(compare: Boolean, proof: Boolean) {
        if (warp == null) histogramDirty = true
        val p = library?.current
        val snapshot = p?.settings?.toString() ?: NativePhoto.defaults().toString()
        val geometry =
            engine.settings.optInt("rotation") != p?.settings?.optInt("rotation") ||
                engine.settings.optString("crop") != p?.settings?.optString("crop") ||
                engine.settings.optBoolean("flip") != p?.settings?.optBoolean("flip")
        queueEvent {
            engine.photo = p
            engine.settings = JSONObject(snapshot)
            engine.compare = compare
            engine.proof = proof
            requestRender()
        }
        if (geometry) {
            zoom = 1.0
            panX = 0.0
            panY = 0.0
            refreshTile()
            reportZoom()
        }
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        try {
            engine.init()
            ready = true
            post { library?.let { load(it) } }
        } catch (e: Exception) {
            post { error?.invoke(e.message ?: "GPU 초기화 오류") }
        }
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        clamp()
    }

    private fun fit(): Double {
        val d = engine.dimensions()
        return max(.0001, min(width / max(1.0, d.first), height / max(1.0, d.second)))
    }

    private fun scale() = fit() * zoom

    fun setZoom(percent: Int) {
        zoom = if (percent == 0) 1.0 else percent / 100.0 / fit()
        panX = 0.0
        panY = 0.0
        clamp()
        refreshTile()
        reportZoom()
        requestRender()
    }

    private fun reportZoom() {
        onZoom?.invoke(if (abs(zoom - 1) < .0001) "맞춤" else "${(scale()*100).roundToInt()}%")
    }

    private fun refreshTile() {
        val p = library?.current ?: return
        val root = library!!.root
        val zoomNow = zoom
        val sx = panX
        val sy = panY
        val vw = width
        val vh = height
        val dimensions = engine.dimensions()
        val ratio = scale()
        val a = JSONObject(p.settings.toString())
        val grid = NativeLiquify(a.optJSONObject("liquify"))
        var marginX = 24f
        var marginY = 24f
        for (i in grid.data.indices step 2) {
            marginX = max(marginX, 24 + abs(grid.data[i]) * p.width)
            marginY = max(marginY, 24 + abs(grid.data[i + 1]) * p.height)
        }
        val drawingWarp = warp != null
        val token = ++decodeRevision
        if (disposed) return
        decodeWork.execute {
            if (disposed || token != decodeRevision) return@execute
            try {
                if (Build.VERSION.SDK_INT < 28 || zoomNow <= 1.01 || drawingWarp) {
                    val bitmap = NativeRenderer.decode(File(root, p.file))
                    install(bitmap, 0.0 to 0.0, 1.0 to 1.0, token)
                } else {
                    val angle = Math.toRadians(a.optDouble("rotation"))
                    val c = cos(angle).roundToInt()
                    val n = sin(angle).roundToInt()
                    val corners =
                        listOf(0 to 0, vw to 0, 0 to vh, vw to vh).map { (x, y) ->
                            val dx =
                                ((x - (vw - dimensions.first * ratio) / 2 - sx) / ratio -
                                    dimensions.first / 2) * (if (a.optBoolean("flip")) -1 else 1)
                            val dy =
                                (y - (vh - dimensions.second * ratio) / 2 - sy) / ratio -
                                    dimensions.second / 2
                            (p.width / 2.0 + c * dx + n * dy) to (p.height / 2.0 - n * dx + c * dy)
                        }
                    val crop =
                        Rect(
                            max(0, floor(corners.minOf { it.first }).toInt() - marginX.toInt()),
                            max(0, floor(corners.minOf { it.second }).toInt() - marginY.toInt()),
                            min(
                                p.width,
                                ceil(corners.maxOf { it.first }).toInt() + marginX.toInt(),
                            ),
                            min(
                                p.height,
                                ceil(corners.maxOf { it.second }).toInt() + marginY.toInt(),
                            ),
                        )
                    if (crop.width() > 0 && crop.height() > 0) {
                        val factor =
                            min(1.0, sqrt(4_000_000.0 / (crop.width().toDouble() * crop.height())))
                        val bitmap =
                            if (NativeExport.isPQ(File(root, p.file)))
                                NativePQDecoder.decode(
                                    File(root, p.file),
                                    max(
                                        1,
                                        (max(crop.width(), crop.height()) * factor).roundToInt(),
                                    ),
                                    crop,
                                )
                            else
                                ImageDecoder.decodeBitmap(
                                    ImageDecoder.createSource(File(root, p.file))
                                ) { decoder, info, _ ->
                                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                                    decoder.setTargetColorSpace(
                                        ColorSpace.get(ColorSpace.Named.EXTENDED_SRGB)
                                    )
                                    decoder.setTargetSize(
                                        max(1, (info.size.width * factor).roundToInt()),
                                        max(1, (info.size.height * factor).roundToInt()),
                                    )
                                    decoder.crop =
                                        Rect(
                                            (crop.left * factor).roundToInt(),
                                            (crop.top * factor).roundToInt(),
                                            (crop.right * factor).roundToInt(),
                                            (crop.bottom * factor).roundToInt(),
                                        )
                                }
                        install(
                            bitmap,
                            crop.left.toDouble() / p.width to crop.top.toDouble() / p.height,
                            crop.width().toDouble() / p.width to
                                crop.height().toDouble() / p.height,
                            token,
                        )
                    }
                }
                requestRender()
            } catch (e: Exception) {
                post {
                    if (!disposed && token == decodeRevision)
                        error?.invoke(e.message ?: "사진 영역을 읽지 못했습니다.")
                }
            }
        }
    }

    private fun clamp() {
        val d = engine.dimensions()
        val s = scale()
        val x = max(0.0, (d.first * s - width) / 2)
        val y = max(0.0, (d.second * s - height) / 2)
        panX = panX.coerceIn(-x, x)
        panY = panY.coerceIn(-y, y)
    }

    override fun onDetachedFromWindow() {
        disposed = true
        decodeRevision++
        decodeWork.shutdownNow()
        super.onDetachedFromWindow()
        thumbnail?.recycle()
        thumbnail = null
    }

    override fun onDrawFrame(gl: GL10?) {
        if (!ready) return
        try {
            if (histogramDirty && thumbnail != null) {
                histogramDirty = false
                val bins = engine.histogram(thumbnail!!)
                post { onHistogram?.invoke(bins) }
            }
            val d = engine.dimensions()
            val s = scale()
            val w = d.first * s
            val h = d.second * s
            engine.overlayID = if (showOverlay) selectedMask else ""
            engine.draw(
                width,
                height,
                doubleArrayOf(
                    ((width - w) / 2 + panX) / width,
                    ((height - h) / 2 + panY) / height,
                    w / width,
                    h / height,
                ),
                tileOrigin,
                tileSize,
            )
        } catch (e: Exception) {
            post { error?.invoke(e.message ?: "렌더링 오류") }
        }
    }

    private fun point(e: MotionEvent): Pair<Double, Double>? {
        val p = library?.current ?: return null
        val d = engine.dimensions()
        val s = scale()
        val x = (e.x - (width - d.first * s) / 2 - panX) / s
        val y = (e.y - (height - d.second * s) / 2 - panY) / s
        if (x < 0 || y < 0 || x > d.first || y > d.second) return null
        val angle = Math.toRadians(p.settings.optDouble("rotation"))
        val c = cos(angle).roundToInt()
        val n = sin(angle).roundToInt()
        val dx = (x - d.first / 2) * (if (p.settings.optBoolean("flip")) -1 else 1)
        val dy = y - d.second / 2
        return (0.5 + (c * dx + n * dy) / p.width).coerceIn(0.0, 1.0) to
            (0.5 + (-n * dx + c * dy) / p.height).coerceIn(0.0, 1.0)
    }

    private fun cancelWarp() {
        if (warpChanged) onLiquify?.invoke(warpStart, false)
        warp = null
        warpPoint = null
        warpChanged = false
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        pinch.onTouchEvent(e)
        taps.onTouchEvent(e)
        if (e.pointerCount > 1 || pinch.isInProgress) {
            cancelWarp()
            points.clear()
            if (e.actionMasked == MotionEvent.ACTION_POINTER_UP) {
                refreshTile()
                reportZoom()
            }
            return true
        }
        if (liquify && !engine.compare) {
            val photo = library?.current ?: return true
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    warpStart = photo.settings.optJSONObject("liquify")
                    warp = NativeLiquify(warpStart)
                    warpPoint = point(e)
                    warpTime = 0
                    warpChanged = false
                    refreshTile()
                    parent.requestDisallowInterceptTouchEvent(true)
                }
                MotionEvent.ACTION_MOVE,
                MotionEvent.ACTION_UP -> {
                    val p = point(e)
                    val from = warpPoint
                    val commit = e.actionMasked == MotionEvent.ACTION_UP
                    if (p != null && from != null && (commit || e.eventTime - warpTime >= 33)) {
                        if (hypot(p.first - from.first, p.second - from.second) > .000001)
                            warpChanged = true
                        warp?.push(
                            from,
                            p,
                            liquifyRadius,
                            liquifyStrength,
                            photo.width,
                            photo.height,
                        )
                        warpPoint = p
                        warpTime = e.eventTime
                        if (warpChanged) onLiquify?.invoke(warp?.json(), commit)
                    } else if (commit && warpChanged) onLiquify?.invoke(warp?.json(), true)
                    if (commit) {
                        warp = null
                        warpPoint = null
                        refreshTile()
                        parent.requestDisallowInterceptTouchEvent(false)
                    }
                }
                MotionEvent.ACTION_CANCEL -> cancelWarp()
            }
            return true
        }
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastX = e.x
                lastY = e.y
                points.clear()
                point(e)?.let { points.add(it) }
            }
            MotionEvent.ACTION_MOVE -> {
                if (selectedMask.isNotEmpty()) {
                    point(e)?.let { if (points.size < 1024) points.add(it) }
                } else {
                    panX += e.x - lastX
                    panY += e.y - lastY
                    clamp()
                    requestRender()
                }
                lastX = e.x
                lastY = e.y
            }
            MotionEvent.ACTION_POINTER_UP -> {
                points.clear()
                refreshTile()
                reportZoom()
            }
            MotionEvent.ACTION_UP -> {
                refreshTile()
                reportZoom()
                if (selectedMask.isNotEmpty() && points.isNotEmpty())
                    onStroke?.invoke(points.toList())
                points.clear()
                performClick()
            }
            MotionEvent.ACTION_CANCEL -> points.clear()
        }
        return true
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }
}
