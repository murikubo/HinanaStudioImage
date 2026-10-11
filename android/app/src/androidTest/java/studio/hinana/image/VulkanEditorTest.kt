package studio.hinana.image

import android.graphics.*
import android.opengl.GLES30 as GL
import androidx.test.platform.app.InstrumentationRegistry
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import studio.hinana.image.nativeeditor.*

class VulkanEditorTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun pixels(
        renderer: NativeRenderer,
        width: Int,
        height: Int,
        mode: Int = 1,
        p3: Boolean = false,
    ): FloatArray {
        val buffer = ByteBuffer.allocateDirect(width * height * 16).order(ByteOrder.nativeOrder())
        renderer.draw(width, height, mode = mode, outputP3 = p3)
        renderer.readPixels(width, height, buffer)
        return FloatArray(width * height * 4).also { buffer.asFloatBuffer().get(it) }
    }

    private fun glPixels(
        renderer: NativeRenderer,
        width: Int,
        height: Int,
        mode: Int,
        p3: Boolean,
    ): FloatArray {
        val texture = IntArray(1)
        val fbo = IntArray(1)
        GL.glGenTextures(1, texture, 0)
        GL.glBindTexture(GL.GL_TEXTURE_2D, texture[0])
        GL.glTexImage2D(
            GL.GL_TEXTURE_2D,
            0,
            GL.GL_RGBA32F,
            width,
            height,
            0,
            GL.GL_RGBA,
            GL.GL_FLOAT,
            null,
        )
        GL.glGenFramebuffers(1, fbo, 0)
        GL.glBindFramebuffer(GL.GL_FRAMEBUFFER, fbo[0])
        GL.glFramebufferTexture2D(
            GL.GL_FRAMEBUFFER,
            GL.GL_COLOR_ATTACHMENT0,
            GL.GL_TEXTURE_2D,
            texture[0],
            0,
        )
        check(GL.glCheckFramebufferStatus(GL.GL_FRAMEBUFFER) == GL.GL_FRAMEBUFFER_COMPLETE)
        try {
            return pixels(renderer, width, height, mode, p3)
        } finally {
            GL.glBindFramebuffer(GL.GL_FRAMEBUFFER, 0)
            GL.glDeleteFramebuffers(1, fbo, 0)
            GL.glDeleteTextures(1, texture, 0)
        }
    }

    private fun compare(
        bitmap: Bitmap,
        settings: JSONObject,
        width: Int,
        height: Int,
        mode: Int,
        p3: Boolean,
        tolerance: Float = .003f,
    ) {
        val vk = NativeGPUContext(context)
        assertTrue("Tests must actually run Vulkan", vk.renderer.usesVulkan)
        val gl = NativeGPUContext(context, preferVulkan = false)
        try {
            for (r in listOf(vk.renderer, gl.renderer)) {
                r.photo =
                    NativePhoto(
                        "fixture",
                        "fixture.png",
                        "fixture.png",
                        bitmap.width,
                        bitmap.height,
                    )
                r.settings = JSONObject(settings.toString())
                r.proof = false
                r.upload(bitmap)
            }
            val expected = glPixels(gl.renderer, width, height, mode, p3)
            val actual = pixels(vk.renderer, width, height, mode, p3)
            for (i in actual.indices) assertEquals(
                "pixel $i mode $mode",
                expected[i],
                actual[i],
                tolerance,
            )
            val before = pixels(vk.renderer, width, height, mode, p3)
            val histogram = vk.renderer.histogram(bitmap)
            histogram.forEach { assertEquals(4096, it.sum()) }
            assertArrayEquals(
                "Histogram preserves preview source/uniforms",
                before,
                pixels(vk.renderer, width, height, mode, p3),
                .0001f,
            )
        } finally {
            gl.close()
            vk.close()
        }
    }

    @Test
    fun editsMasksLiquifyGeometryAndPrecisionMatchGles() {
        val bitmap = Bitmap.createBitmap(31, 27, Bitmap.Config.ARGB_8888)
        for (y in 0 until 27) for (x in 0 until 31) bitmap.setPixel(
            x,
            y,
            Color.rgb(x * 8, y * 9, (x + y) * 4),
        )
        try {
            val settings =
                NativePhoto.defaults()
                    .put("exposure", .4)
                    .put("contrast", 9)
                    .put("temperature", -7)
                    .put("saturation", 11)
                    .put("curveShadows", 3)
                    .put("mixer_blue_hue", 17)
                    .put("skinSmooth", 35)
            val grid = NativeLiquify(null)
            grid.push(.35 to .3, .47 to .41, .23, .7, 31, 27)
            settings.put("liquify", grid.json())
            val mask =
                JSONObject(
                    """{"id":"mask","kind":"linear","points":[{"x":0.2,"y":0.1},{"x":0.8,"y":0.9}],"feather":0.6,"exposure":0.6,"contrast":5,"saturation":-15,"temperature":8,"opacity":0.7,"enabled":true}"""
                )
            settings.put("masks", JSONArray().put(mask))
            for (space in listOf("srgb", "display-p3")) {
                settings.put("colorSpace", space)
                for (rotation in listOf(0, 90, 180, 270)) {
                    settings
                        .put("rotation", rotation)
                        .put("flip", rotation == 90)
                        .put("crop", "4:3")
                    compare(bitmap, settings, 24, 18, 1, space == "display-p3")
                }
            }
            settings.put("precision", "legacy")
            compare(bitmap, settings, 24, 18, 0, false, .008f)
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun oddStrideHdrGainmapAndPqMatchGles() {
        if (android.os.Build.VERSION.SDK_INT < 34) return
        val base = Bitmap.createBitmap(13, 17, Bitmap.Config.ARGB_8888)
        base.eraseColor(0xffbbaacc.toInt())
        val map = Bitmap.createBitmap(431, 575, Bitmap.Config.ALPHA_8)
        val bytes = ByteBuffer.allocate(map.rowBytes * map.height)
        for (y in 0 until map.height) for (x in 0 until map.rowBytes) bytes.put(
            ((x + y * 7) % 256).toByte()
        )
        bytes.rewind()
        map.copyPixelsFromBuffer(bytes)
        base.gainmap =
            Gainmap(map).also {
                it.setRatioMin(1f, 1f, 1f)
                it.setRatioMax(4f, 4f, 4f)
                it.setEpsilonSdr(0f, 0f, 0f)
                it.setEpsilonHdr(0f, 0f, 0f)
            }
        try {
            val settings =
                NativePhoto.defaults()
                    .put("dynamicRange", "hdr")
                    .put("hdrPeak", 2000)
                    .put("colorSpace", "display-p3")
            compare(base, settings, 13, 17, 1, true, .004f)
            compare(base, settings, 13, 17, 2, false, .001f)
            compare(base, settings, 13, 17, 3, false, .001f)
        } finally {
            base.recycle()
            map.recycle()
        }
    }

    @Test
    fun floatHdrRetainsExtendedRangeAndRepeatedUploads() {
        val bitmap =
            Bitmap.createBitmap(
                17,
                13,
                Bitmap.Config.RGBA_F16,
                true,
                ColorSpace.get(ColorSpace.Named.EXTENDED_SRGB),
            )
        val buffer =
            ByteBuffer.allocate(bitmap.rowBytes * bitmap.height).order(ByteOrder.nativeOrder())
        val encoded = (1.055 * 4.0.pow(1 / 2.4) - .055).toFloat()
        for (y in 0 until bitmap.height) {
            buffer.position(y * bitmap.rowBytes)
            for (x in 0 until bitmap.width) for (v in
                floatArrayOf(encoded, encoded, encoded, 1f)) buffer.putShort(
                android.util.Half.toHalf(v)
            )
        }
        buffer.rewind()
        bitmap.copyPixelsFromBuffer(buffer)
        val gpu = NativeGPUContext(context)
        assertTrue(gpu.renderer.usesVulkan)
        try {
            val r = gpu.renderer
            r.photo = NativePhoto("float", "float.png", "float.png", 17, 13)
            r.settings = NativePhoto.defaults().put("dynamicRange", "hdr")
            r.proof = false
            repeat(25) {
                r.upload(bitmap)
                val out = pixels(r, 17, 13)
                assertEquals(4f, out[0], .01f)
                assertEquals(1f, out[3], .0001f)
            }
        } finally {
            gpu.close()
            bitmap.recycle()
        }
    }

    @Test
    fun stripExportPreservesRowsGeometryAndHdrColor() {
        val directory =
            java.io.File(context.cacheDir, "vk-strips-${System.nanoTime()}").also { it.mkdirs() }
        val library = NativeLibrary(context, directory)
        val bitmap = Bitmap.createBitmap(257, 259, Bitmap.Config.ARGB_8888)
        for (y in 0 until 259) for (x in 0 until 257) bitmap.setPixel(
            x,
            y,
            Color.rgb(x * 255 / 256, y * 255 / 258, (x + y) * 255 / 514),
        )
        val input = java.io.File(directory, "strips.png")
        input.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        val photo = NativePhoto("strips", "strips.png", input.name, 257, 259)
        photo.settings
            .put("colorSpace", "display-p3")
            .put("dynamicRange", "hdr")
            .put("exposure", 1.1)
            .put("rotation", 90)
            .put("flip", true)
        val grid = NativeLiquify(null)
        grid.push(.4 to .4, .48 to .43, .2, .6, 257, 259)
        photo.settings.put("liquify", grid.json())
        try {
            for (format in listOf("png16", "hdr-png")) {
                val output =
                    NativeExport.export(context, library, photo, format, "display-p3", 0, 95, false)
                val saved = java.io.File(directory, "vk-$format.png")
                output.copyTo(saved, true)
                NativeExport.export(
                    context,
                    library,
                    photo,
                    format,
                    "display-p3",
                    0,
                    95,
                    false,
                    preferVulkan = false,
                )
                val actual =
                    if (format == "hdr-png") NativePQDecoder.decode(saved, 0)
                    else NativeRenderer.decode(saved, 1024)
                val expected =
                    if (format == "hdr-png") NativePQDecoder.decode(output, 0)
                    else NativeRenderer.decode(output, 1024)
                try {
                    assertEquals(expected.width, actual.width)
                    assertEquals(expected.height, actual.height)
                    val a =
                        ByteBuffer.allocate(actual.rowBytes * actual.height)
                            .order(ByteOrder.nativeOrder())
                    actual.copyPixelsToBuffer(a)
                    val e =
                        ByteBuffer.allocate(expected.rowBytes * expected.height)
                            .order(ByteOrder.nativeOrder())
                    expected.copyPixelsToBuffer(e)
                    assertEquals(Bitmap.Config.RGBA_F16, actual.config)
                    for (y in 0 until actual.height) for (x in 0 until actual.width) for (c in
                        0..3) {
                        val av =
                            android.util.Half.toFloat(
                                a.getShort(y * actual.rowBytes + x * 8 + c * 2)
                            )
                        val ev =
                            android.util.Half.toFloat(
                                e.getShort(y * expected.rowBytes + x * 8 + c * 2)
                            )
                        assertEquals("$format row $y column $x component $c", ev, av, .004f)
                    }
                } finally {
                    actual.recycle()
                    expected.recycle()
                }
            }
        } finally {
            library.work.shutdown()
            directory.deleteRecursively()
        }
    }

    @Test
    fun windowSurfacePinchPanAndResumeStayVulkan() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory =
            java.io.File(context.cacheDir, "vk-window-${System.nanoTime()}").also { it.mkdirs() }
        val library = NativeLibrary(context, directory)
        val bitmap = Bitmap.createBitmap(1600, 1200, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.rgb(110, 180, 210))
        val file = java.io.File(directory, "window.png")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        val photo = NativePhoto("window", "window.png", file.name, 1600, 1200)
        library.photos.add(photo)
        library.selected = photo.id
        try {
            androidx.test.core.app.ActivityScenario.launch(MainActivity::class.java).use { scenario
                ->
                var canvas: NativeCanvas? = null
                var error: String? = null
                scenario.onActivity {
                    val root = android.widget.FrameLayout(it)
                    canvas =
                        NativeCanvas(it).also { view ->
                            view.error = { error = it }
                            root.addView(view, android.widget.FrameLayout.LayoutParams(-1, -1))
                            view.load(library)
                        }
                    it.setContentView(root)
                }
                val view = checkNotNull(canvas)
                fun waitFor(condition: () -> Boolean) {
                    val until = android.os.SystemClock.uptimeMillis() + 10000
                    while (!condition() && android.os.SystemClock.uptimeMillis() < until) android.os
                        .SystemClock
                        .sleep(20)
                    assertTrue("Surface rendering must complete", condition())
                }
                waitFor { view.framesRendered > 0 }
                assertEquals("Vulkan", view.rendererName)
                val before = view.framesRendered
                scenario.onActivity {
                    view.setZoom(50)
                    view.liquify = false
                    view.selectedMask = ""
                }
                val start = android.os.SystemClock.uptimeMillis()
                fun event(action: Int, span: Float, pointers: Int) {
                    instrumentation.runOnMainSync {
                        val props =
                            Array(pointers) {
                                android.view.MotionEvent.PointerProperties().also { p ->
                                    p.id = it
                                    p.toolType = android.view.MotionEvent.TOOL_TYPE_FINGER
                                }
                            }
                        val coords =
                            Array(pointers) {
                                android.view.MotionEvent.PointerCoords().also { p ->
                                    p.x = view.width / 2f + (if (it == 0) -span / 2 else span / 2)
                                    p.y = view.height / 2f
                                    p.pressure = 1f
                                    p.size = 1f
                                }
                            }
                        val e =
                            android.view.MotionEvent.obtain(
                                start,
                                android.os.SystemClock.uptimeMillis(),
                                action,
                                pointers,
                                props,
                                coords,
                                0,
                                0,
                                1f,
                                1f,
                                0,
                                0,
                                android.view.InputDevice.SOURCE_TOUCHSCREEN,
                                0,
                            )
                        view.onTouchEvent(e)
                        e.recycle()
                    }
                }
                event(android.view.MotionEvent.ACTION_DOWN, 200f, 1)
                event(android.view.MotionEvent.ACTION_POINTER_DOWN or (1 shl 8), 200f, 2)
                repeat(20) {
                    event(android.view.MotionEvent.ACTION_MOVE, 200f + it * 12, 2)
                    android.os.SystemClock.sleep(16)
                }
                event(android.view.MotionEvent.ACTION_POINTER_UP or (1 shl 8), 428f, 2)
                event(android.view.MotionEvent.ACTION_UP, 428f, 1)
                waitFor { view.framesRendered > before }
                instrumentation.runOnMainSync {
                    val down =
                        android.view.MotionEvent.obtain(
                            start,
                            start,
                            android.view.MotionEvent.ACTION_DOWN,
                            view.width / 2f,
                            view.height / 2f,
                            0,
                        )
                    view.onTouchEvent(down)
                    down.recycle()
                    val move =
                        android.view.MotionEvent.obtain(
                            start,
                            start + 30,
                            android.view.MotionEvent.ACTION_MOVE,
                            view.width / 2f + 50,
                            view.height / 2f + 25,
                            0,
                        )
                    view.onTouchEvent(move)
                    move.recycle()
                    val up =
                        android.view.MotionEvent.obtain(
                            start,
                            start + 60,
                            android.view.MotionEvent.ACTION_UP,
                            view.width / 2f + 50,
                            view.height / 2f + 25,
                            0,
                        )
                    view.onTouchEvent(up)
                    up.recycle()
                }
                val beforeResume = view.framesRendered
                scenario.onActivity { view.onPause() }
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
                scenario.onActivity {
                    view.onResume()
                    view.setZoom(0)
                }
                val restored = view
                waitFor { restored.framesRendered > beforeResume && restored.engine.usesVulkan }
                assertEquals("Vulkan", restored.rendererName)
                assertNull("Window lifecycle must not report GPU errors", error)
                val display =
                    (context.getSystemService(android.content.Context.WINDOW_SERVICE)
                            as android.view.WindowManager)
                        .defaultDisplay
                if (
                    display.hdrCapabilities.supportedHdrTypes.contains(
                        android.view.Display.HdrCapabilities.HDR_TYPE_HDR10
                    )
                )
                    assertTrue("HDR PQ surface restored", restored.hdrDisplayActive)
            }
        } finally {
            library.work.shutdown()
            directory.deleteRecursively()
        }
    }

    @Test
    fun displayPreRotationPreservesPixelsAndPhotoAdjustments() {
        val bridge = NativeVulkan(context.assets)
        val renderer = NativeRenderer(bridge)
        val width = 6
        val height = 4
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        for (y in 0 until height) for (x in 0 until width) bitmap.setPixel(
            x,
            y,
            Color.rgb(30 + x * 35, 20 + y * 50, 50 + x * 20 + y * 10),
        )
        val photo = NativePhoto("orientation", "orientation.png", "orientation.png", width, height)
        renderer.photo = photo
        renderer.settings =
            NativePhoto.defaults().put("rotation", 90).put("exposure", .2).put("temperature", 7)
        renderer.proof = false
        val adjustments = renderer.settings.toString()
        try {
            renderer.upload(bitmap)
            val original = pixels(renderer, width, height)
            for (transform in listOf(1, 2, 4, 8, 16, 32, 64, 128)) {
                val quarter = transform in listOf(2, 8, 32, 128)
                val pw = if (quarter) height else width
                val ph = if (quarter) width else height
                bridge.draw(pw, ph, false, transform)
                val data = ByteBuffer.allocateDirect(pw * ph * 16).order(ByteOrder.nativeOrder())
                bridge.pixels(data)
                val actual = data.asFloatBuffer()
                for (y in 0 until height) for (x in 0 until width) {
                    val mx = if (transform >= 16) width - 1 - x else x
                    val rotation =
                        when (transform) {
                            2,
                            32 -> 90
                            4,
                            64 -> 180
                            8,
                            128 -> 270
                            else -> 0
                        }
                    val dx =
                        when (rotation) {
                            90 -> height - 1 - y
                            180 -> width - 1 - mx
                            270 -> y
                            else -> mx
                        }
                    val dy =
                        when (rotation) {
                            90 -> mx
                            180 -> height - 1 - y
                            270 -> width - 1 - mx
                            else -> y
                        }
                    for (c in 0..3) assertEquals(
                        "transform $transform pixel $x,$y component $c",
                        original[((height - 1 - y) * width + x) * 4 + c],
                        actual[((ph - 1 - dy) * pw + dx) * 4 + c],
                        .001f,
                    )
                }
                assertEquals(
                    "Display rotation cannot change edits",
                    adjustments,
                    renderer.settings.toString(),
                )
                assertArrayEquals(
                    "Export pixels stay unchanged",
                    original,
                    pixels(renderer, width, height),
                    .0001f,
                )
            }
        } finally {
            renderer.destroy()
            bitmap.recycle()
        }
    }
}
