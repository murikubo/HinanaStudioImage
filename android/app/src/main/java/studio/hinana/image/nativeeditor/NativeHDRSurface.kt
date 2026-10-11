package studio.hinana.image.nativeeditor

import android.opengl.GLSurfaceView
import javax.microedition.khronos.egl.*

/** Select an actual 10-bit PQ surface; retain an SDR fallback if either step is unsupported. */
class NativeHDRSurface(private val enabled: Boolean, private val changed: (Boolean) -> Unit) :
    GLSurfaceView.EGLConfigChooser, GLSurfaceView.EGLWindowSurfaceFactory {
    @Volatile
    var active = false
        private set

    private var pqConfig = false

    override fun chooseConfig(egl: EGL10, display: EGLDisplay): EGLConfig {
        fun select(bits: Int, alpha: Int): EGLConfig? {
            val result = arrayOfNulls<EGLConfig>(1)
            val count = IntArray(1)
            val attributes =
                intArrayOf(
                    EGL10.EGL_RED_SIZE,
                    bits,
                    EGL10.EGL_GREEN_SIZE,
                    bits,
                    EGL10.EGL_BLUE_SIZE,
                    bits,
                    EGL10.EGL_ALPHA_SIZE,
                    alpha,
                    EGL10.EGL_RENDERABLE_TYPE,
                    0x40,
                    EGL10.EGL_SURFACE_TYPE,
                    EGL10.EGL_WINDOW_BIT,
                    EGL10.EGL_NONE,
                )
            if (!egl.eglChooseConfig(display, attributes, result, 1, count) || count[0] == 0)
                return null
            return result[0]
        }
        val extensions = egl.eglQueryString(display, EGL10.EGL_EXTENSIONS).orEmpty().split(' ')
        if (enabled && "EGL_EXT_gl_colorspace_bt2020_pq" in extensions) {
            val config = select(10, 2)
            if (config != null) {
                pqConfig = true
                return config
            }
        }
        pqConfig = false
        return checkNotNull(select(8, 8)) { "사진 표시용 GPU 구성을 찾지 못했습니다." }
    }

    override fun createWindowSurface(
        egl: EGL10,
        display: EGLDisplay,
        config: EGLConfig,
        nativeWindow: Any,
    ): EGLSurface {
        var surface =
            if (pqConfig)
                egl.eglCreateWindowSurface(
                    display,
                    config,
                    nativeWindow,
                    intArrayOf(0x309D, 0x3340, EGL10.EGL_NONE),
                )
            else EGL10.EGL_NO_SURFACE
        active = pqConfig && surface != null && surface != EGL10.EGL_NO_SURFACE
        if (!active) {
            egl.eglGetError()
            surface = egl.eglCreateWindowSurface(display, config, nativeWindow, null)
        }
        android.util.Log.i(
            "HinanaHDR",
            if (active) "Preview: 10-bit BT.2020 PQ" else "Preview: SDR fallback",
        )
        changed(active)
        return surface ?: EGL10.EGL_NO_SURFACE
    }

    override fun destroySurface(egl: EGL10, display: EGLDisplay, surface: EGLSurface) {
        egl.eglDestroySurface(display, surface)
    }
}
