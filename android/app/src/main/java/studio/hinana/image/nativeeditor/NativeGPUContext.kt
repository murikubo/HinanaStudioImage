package studio.hinana.image.nativeeditor

import android.content.Context
import android.util.Log
import android.view.Surface
import javax.microedition.khronos.egl.*

/** Vulkan is preferred; GLES remains available for older devices without required formats. */
class NativeGPUContext(
    context: Context,
    surface: Surface? = null,
    wantsHDR: Boolean = false,
    preferVulkan: Boolean = true,
) {
    val renderer: NativeRenderer
    private var egl: EGL10? = null
    private var display: EGLDisplay = EGL10.EGL_NO_DISPLAY
    private var eglContext: EGLContext = EGL10.EGL_NO_CONTEXT
    private var eglSurface: EGLSurface = EGL10.EGL_NO_SURFACE
    private var fallbackHDR = false
    val hdrActive
        get() = if (renderer.usesVulkan) renderer.hdrActive else fallbackHDR

    init {
        var selected: NativeRenderer? = null
        if (preferVulkan) {
            try {
                selected = NativeRenderer(NativeVulkan(context.assets, surface, wantsHDR))
            } catch (e: Throwable) {
                Log.w("HinanaVulkan", "Vulkan unavailable; using GLES compatibility renderer", e)
            }
        }
        if (selected == null) {
            val api = EGLContext.getEGL() as EGL10
            egl = api
            try {
                display = api.eglGetDisplay(EGL10.EGL_DEFAULT_DISPLAY)
                check(api.eglInitialize(display, IntArray(2)))
                val hdr = NativeHDRSurface(wantsHDR) { fallbackHDR = it }
                val config =
                    if (surface != null) hdr.chooseConfig(api, display)
                    else {
                        val configs = arrayOfNulls<EGLConfig>(1)
                        val count = IntArray(1)
                        check(
                            api.eglChooseConfig(
                                display,
                                intArrayOf(
                                    EGL10.EGL_RENDERABLE_TYPE,
                                    0x40,
                                    EGL10.EGL_SURFACE_TYPE,
                                    EGL10.EGL_PBUFFER_BIT,
                                    EGL10.EGL_RED_SIZE,
                                    8,
                                    EGL10.EGL_GREEN_SIZE,
                                    8,
                                    EGL10.EGL_BLUE_SIZE,
                                    8,
                                    EGL10.EGL_ALPHA_SIZE,
                                    8,
                                    EGL10.EGL_NONE,
                                ),
                                configs,
                                1,
                                count,
                            ) && count[0] > 0
                        )
                        checkNotNull(configs[0])
                    }
                eglContext =
                    api.eglCreateContext(
                        display,
                        config,
                        EGL10.EGL_NO_CONTEXT,
                        intArrayOf(0x3098, 3, EGL10.EGL_NONE),
                    )
                eglSurface =
                    if (surface != null) hdr.createWindowSurface(api, display, config, surface)
                    else
                        api.eglCreatePbufferSurface(
                            display,
                            config,
                            intArrayOf(EGL10.EGL_WIDTH, 1, EGL10.EGL_HEIGHT, 1, EGL10.EGL_NONE),
                        )
                check(api.eglMakeCurrent(display, eglSurface, eglSurface, eglContext))
                selected = NativeRenderer().also { it.init() }
            } catch (e: Throwable) {
                closeEGL()
                throw e
            }
        }
        renderer = checkNotNull(selected)
    }

    fun resize(width: Int, height: Int) = renderer.resize(width, height)

    fun present() {
        egl?.let { check(it.eglSwapBuffers(display, eglSurface)) { "GPU 화면 표시 실패" } }
    }

    fun close() {
        try {
            renderer.destroy()
        } finally {
            closeEGL()
        }
    }

    private fun closeEGL() {
        egl?.let {
            it.eglMakeCurrent(
                display,
                EGL10.EGL_NO_SURFACE,
                EGL10.EGL_NO_SURFACE,
                EGL10.EGL_NO_CONTEXT,
            )
            if (eglSurface != EGL10.EGL_NO_SURFACE) it.eglDestroySurface(display, eglSurface)
            if (eglContext != EGL10.EGL_NO_CONTEXT) it.eglDestroyContext(display, eglContext)
            if (display != EGL10.EGL_NO_DISPLAY) it.eglTerminate(display)
        }
        egl = null
    }
}
