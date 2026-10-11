package studio.hinana.image.nativeeditor

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.*
import java.util.concurrent.CountDownLatch

/** Demand-driven render thread. UI gestures never wait for shader work or decoding. */
open class NativeRenderView(context: Context) : SurfaceView(context), SurfaceHolder.Callback {
    @Volatile
    var engine = NativeRenderer()
        private set

    var onHDRChanged: (() -> Unit)? = null
    @Volatile private var gpu: NativeGPUContext? = null
    @Volatile private var activeHDR = false
    val hdrDisplayActive
        get() = activeHDR

    val rendererName
        get() = if (engine.usesVulkan) "Vulkan" else "OpenGL ES"

    private val thread = HandlerThread("Hinana Vulkan").also { it.start() }
    private val worker = Handler(thread.looper)
    @Volatile private var paused = false
    @Volatile private var detached = false
    @Volatile
    var framesRendered = 0L
        private set

    private val draw = Runnable {
        if (!paused && !detached && gpu != null && width > 0 && height > 0) {
            try {
                renderFrame()
                gpu?.present()
                framesRendered++
            } catch (e: Exception) {
                renderError(e)
            }
        }
    }

    init {
        holder.addCallback(this)
    }

    protected open fun renderReady() {}

    protected open fun renderLost() {}

    protected open fun renderResized() {}

    protected open fun renderFrame() {}

    protected open fun renderError(error: Exception) {}

    fun queueEvent(action: () -> Unit) {
        if (!detached) worker.post { if (!detached) action() }
    }

    fun requestRender() {
        if (!detached) {
            worker.removeCallbacks(draw)
            worker.post(draw)
        }
    }

    fun onPause() {
        paused = true
        worker.removeCallbacks(draw)
    }

    fun onResume() {
        paused = false
        requestRender()
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        queueEvent {
            try {
                val wantsHDR =
                    Build.VERSION.SDK_INT >= 26 &&
                        (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
                            .defaultDisplay
                            .hdrCapabilities
                            .supportedHdrTypes
                            .contains(Display.HdrCapabilities.HDR_TYPE_HDR10)
                gpu = NativeGPUContext(context, holder.surface, wantsHDR)
                engine = gpu!!.renderer
                activeHDR = gpu!!.hdrActive
                renderReady()
            } catch (e: Exception) {
                renderError(e)
            }
        }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        queueEvent {
            try {
                gpu?.resize(width, height)
                activeHDR = gpu?.hdrActive == true
                renderResized()
                post { onHDRChanged?.invoke() }
                requestRender()
            } catch (e: Exception) {
                renderError(e)
            }
        }
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        // SurfaceHolder requires all window GPU access to end before this callback returns.
        val done = CountDownLatch(1)
        worker.post {
            try {
                activeHDR = false
                renderLost()
                gpu?.close()
                gpu = null
            } finally {
                done.countDown()
            }
        }
        done.await()
    }

    override fun onDetachedFromWindow() {
        detached = true
        worker.removeCallbacks(draw)
        super.onDetachedFromWindow()
        holder.removeCallback(this)
        val done = CountDownLatch(1)
        worker.post {
            try {
                activeHDR = false
                renderLost()
                gpu?.close()
                gpu = null
            } finally {
                done.countDown()
            }
        }
        done.await()
        thread.quitSafely()
    }
}
