package studio.hinana.image

import android.content.ContextWrapper
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ColorSpace
import android.opengl.EGL14
import android.opengl.GLES30 as GL
import android.util.Half
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import studio.hinana.image.nativeeditor.*

class NativeEditorTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun isolated(): NativeLibrary {
        val directory =
            File(context.cacheDir, "native-tests-${System.nanoTime()}").also { it.mkdirs() }
        return NativeLibrary(
            object : ContextWrapper(context) {
                override fun getFilesDir() = directory
            }
        )
    }

    private fun <T> gpu(block: () -> T): T {
        val display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        check(EGL14.eglInitialize(display, version, 0, version, 1))
        val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
        val count = IntArray(1)
        check(
            EGL14.eglChooseConfig(
                display,
                intArrayOf(
                    EGL14.EGL_RENDERABLE_TYPE,
                    0x40,
                    EGL14.EGL_SURFACE_TYPE,
                    EGL14.EGL_PBUFFER_BIT,
                    EGL14.EGL_RED_SIZE,
                    8,
                    EGL14.EGL_GREEN_SIZE,
                    8,
                    EGL14.EGL_BLUE_SIZE,
                    8,
                    EGL14.EGL_ALPHA_SIZE,
                    8,
                    EGL14.EGL_NONE,
                ),
                0,
                configs,
                0,
                1,
                count,
                0,
            )
        )
        val native =
            EGL14.eglCreateContext(
                display,
                configs[0],
                EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE),
                0,
            )
        val surface =
            EGL14.eglCreatePbufferSurface(
                display,
                configs[0],
                intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE),
                0,
            )
        check(EGL14.eglMakeCurrent(display, surface, surface, native))
        try {
            return block()
        } finally {
            EGL14.eglMakeCurrent(
                display,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_CONTEXT,
            )
            EGL14.eglDestroySurface(display, surface)
            EGL14.eglDestroyContext(display, native)
            EGL14.eglTerminate(display)
        }
    }

    @Test
    fun liquifyGridGpuExportAndUndo() {
        val library = isolated()
        val file = File(library.root, "liquify.png")
        val original = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        for (y in 0..31) for (x in 0..31) original.setPixel(
            x,
            y,
            android.graphics.Color.rgb(x * 255 / 31, y * 255 / 31, 128),
        )
        file.outputStream().use { original.compress(Bitmap.CompressFormat.PNG, 100, it) }
        original.recycle()
        val photo = NativePhoto("warp", "liquify.png", file.name, 32, 32)
        photo.checkpoint()
        val grid = NativeLiquify(null)
        val started = System.nanoTime()
        grid.push(.35 to .3, .45 to .4, .2, .5, 32, 32)
        android.util.Log.i("HinanaLiquify", "brush ms=" + (System.nanoTime() - started) / 1e6)
        assertArrayEquals(grid.data, NativeLiquify(grid.json()).data, 0f)
        assertEquals(129 * 129 * 2, grid.data.size)
        photo.settings.put("liquify", grid.json())
        photo.checkpoint()
        val output = NativeExport.export(context, library, photo, "png16", "srgb", 0, 95, false)
        val decoded = BitmapFactory.decodeFile(output.path)
        val pixel = decoded.getPixel(14, 12)
        assertTrue(
            "Horizontal push changes source sampling",
            android.graphics.Color.red(pixel) < 14 * 255 / 31 - 3,
        )
        assertTrue(
            "Vertical push changes source sampling",
            android.graphics.Color.green(pixel) < 12 * 255 / 31 - 3,
        )
        assertEquals(128.0, android.graphics.Color.blue(pixel).toDouble(), 2.0)
        decoded.recycle()
        val neutral = NativePhoto.unarchive(photo.history.first())
        assertTrue(neutral.isNull("liquify"))
        assertEquals(
            grid.json().getString("data"),
            NativePhoto.unarchive(photo.history.last()).getJSONObject("liquify").getString("data"),
        )
        library.work.shutdown()
    }

    @Test
    fun gpuMatchesDesktopReference() = gpu {
        val cases =
            JSONArray(
                instrumentation.context.assets
                    .open("editor-reference.json")
                    .bufferedReader()
                    .readText()
            )
        val renderer = NativeRenderer()
        renderer.init()
        val texture = IntArray(1)
        val framebuffer = IntArray(1)
        GL.glGenTextures(1, texture, 0)
        GL.glGenFramebuffers(1, framebuffer, 0)
        for (i in 0 until cases.length()) {
            val item = cases.getJSONObject(i)
            val input = item.getJSONArray("input")
            val width = item.optInt("width", 1)
            val height = item.optInt("height", 1)
            val ow = item.optInt("outputWidth", width)
            val oh = item.optInt("outputHeight", height)
            val buffer =
                ByteBuffer.allocateDirect(width * height * 8).order(ByteOrder.nativeOrder())
            fun encode(x: Double) = if (x <= .0031308) x * 12.92 else 1.055 * x.pow(1 / 2.4) - .055
            for (p in 0 until width * height) {
                val r = input.getDouble(p * 4)
                val g = input.getDouble(p * 4 + 1)
                val b = input.getDouble(p * 4 + 2)
                val linear =
                    doubleArrayOf(
                        1.224745 * r - .224904 * g,
                        -.042058 * r + 1.042081 * g,
                        -.019642 * r - .078655 * g + 1.098537 * b,
                        input.getDouble(p * 4 + 3),
                    )
                for (c in 0..3) buffer.putShort(
                    Half.toHalf((if (c == 3) linear[c] else encode(linear[c])).toFloat())
                )
            }
            buffer.position(0)
            val bitmap =
                Bitmap.createBitmap(
                    width,
                    height,
                    Bitmap.Config.RGBA_F16,
                    true,
                    ColorSpace.get(ColorSpace.Named.EXTENDED_SRGB),
                )
            bitmap.copyPixelsFromBuffer(buffer)
            renderer.photo = NativePhoto("test", "fixture.png", "fixture.png", width, height)
            renderer.settings = item.getJSONObject("adjustments")
            renderer.proof = false
            renderer.upload(bitmap)
            bitmap.recycle()
            GL.glBindTexture(GL.GL_TEXTURE_2D, texture[0])
            GL.glTexImage2D(
                GL.GL_TEXTURE_2D,
                0,
                GL.GL_RGBA16F,
                ow,
                oh,
                0,
                GL.GL_RGBA,
                GL.GL_HALF_FLOAT,
                null,
            )
            GL.glBindFramebuffer(GL.GL_FRAMEBUFFER, framebuffer[0])
            GL.glFramebufferTexture2D(
                GL.GL_FRAMEBUFFER,
                GL.GL_COLOR_ATTACHMENT0,
                GL.GL_TEXTURE_2D,
                texture[0],
                0,
            )
            assertEquals(GL.GL_FRAMEBUFFER_COMPLETE, GL.glCheckFramebufferStatus(GL.GL_FRAMEBUFFER))
            renderer.rebind()
            renderer.draw(
                ow,
                oh,
                mode = 1,
                outputP3 = renderer.settings.optString("colorSpace") == "display-p3",
            )
            val pixels = ByteBuffer.allocateDirect(ow * oh * 16).order(ByteOrder.nativeOrder())
            GL.glReadPixels(0, 0, ow, oh, GL.GL_RGBA, GL.GL_FLOAT, pixels)
            assertEquals(GL.GL_NO_ERROR, GL.glGetError())
            val actual = pixels.asFloatBuffer()
            val expected = item.getJSONArray("expected")
            for (y in 0 until oh) for (x in 0 until ow) for (c in 0..3) assertEquals(
                "${item.getString("name")} pixel $x,$y channel $c",
                expected.getDouble((y * ow + x) * 4 + c),
                actual[((oh - 1 - y) * ow + x) * 4 + c].toDouble(),
                0.006,
            )
        }
        renderer.destroy()
        GL.glDeleteFramebuffers(1, framebuffer, 0)
        GL.glDeleteTextures(1, texture, 0)
    }

    @Test
    fun projectAndHighPrecisionExports() {
        val library = isolated()
        val file = File(library.root, "fixture.jpg")
        val bitmap = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
        for (y in 0 until 480) for (x in 0 until 640) bitmap.setPixel(
            x,
            y,
            if (y < 240) 0xffff0000.toInt() else 0xff0000ff.toInt(),
        )
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 100, it) }
        bitmap.recycle()
        ExifInterface(file).also {
            it.setAttribute(ExifInterface.TAG_MAKE, "Native fixture")
            it.setAttribute(ExifInterface.TAG_ORIENTATION, "1")
            it.saveAttributes()
        }
        val p = NativePhoto("fixture", "fixture.jpg", file.name, 640, 480)
        p.checkpoint()
        p.settings.put("exposure", 0.7)
        p.checkpoint()
        assertEquals(0.0, NativePhoto.unarchive(p.history[0]).getDouble("exposure"), 0.0)
        assertEquals(0.7, NativePhoto.unarchive(p.history[1]).getDouble("exposure"), 0.0)
        library.photos.add(p)
        library.selected = p.id
        library.persist()
        library.work.submit {}.get()
        val restored = NativeLibrary(context, library.root)
        assertEquals(2, restored.current!!.history.size)
        assertEquals(1, restored.current!!.cursor)
        assertEquals(
            0.0,
            NativePhoto.unarchive(restored.current!!.history[0]).getDouble("exposure"),
            0.0,
        )
        restored.work.shutdown()
        val project = library.project()
        val imported = isolated()
        imported.importProject(project)
        assertEquals(1, imported.photos.size)
        assertEquals(0.7, imported.current!!.settings.getDouble("exposure"), 0.0)
        assertArrayEquals(
            file.readBytes(),
            File(imported.root, imported.current!!.file).readBytes(),
        )
        for (format in listOf("jpeg", "png", "png16", "hdr-png", "webp")) {
            val output = NativeExport.export(context, library, p, format, "display-p3", 0, 95, true)
            val exif = ExifInterface(output)
            assertEquals("Native fixture", exif.getAttribute(ExifInterface.TAG_MAKE))
            assertEquals(640, exif.getAttributeInt(ExifInterface.TAG_PIXEL_X_DIMENSION, 0))
            assertEquals(480, exif.getAttributeInt(ExifInterface.TAG_PIXEL_Y_DIMENSION, 0))
            val bounds = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
            BitmapFactory.decodeFile(output.path, bounds)
            assertEquals(format, 640, bounds.outWidth)
            assertEquals(format, 480, bounds.outHeight)
            if (format.contains("png"))
                assertEquals(if (format == "png") 8 else 16, output.readBytes()[24].toInt())
            if (format == "png16") {
                val result = BitmapFactory.decodeFile(output.path)
                assertTrue(
                    "PNG row order",
                    android.graphics.Color.red(result.getPixel(0, 0)) >
                        android.graphics.Color.blue(result.getPixel(0, 0)),
                )
                result.recycle()
            }
            if (format == "hdr-png")
                assertTrue(output.readBytes().toString(Charsets.ISO_8859_1).contains("cICP"))
        }
        imported.work.shutdown()
        library.work.shutdown()
    }

    @Test
    fun hdrPQRoundtripKeepsHighlights() {
        val library = isolated()
        val input = File(library.root, "hdr-source.png")
        val white = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        white.eraseColor(android.graphics.Color.WHITE)
        input.outputStream().use { white.compress(Bitmap.CompressFormat.PNG, 100, it) }
        white.recycle()
        val p = NativePhoto("hdr", "hdr.png", input.name, 32, 32)
        p.settings
            .put("dynamicRange", "hdr")
            .put("colorSpace", "display-p3")
            .put("hdrHighlights", 100)
        val output =
            NativeExport.export(context, library, p, "hdr-png", "display-p3", 0, 100, false)
        assertTrue(NativeExport.isHDR(output))
        val bitmap = NativeRenderer.decode(output, 32)
        val values = FloatArray(3)
        bitmap.getColor(16, 16).components.copyInto(values, endIndex = 3)
        assertTrue(
            "HDR source preserves extended pixel values: ${values.toList()} ${bitmap.config}",
            values.maxOrNull()!! > 1.1f,
        )
        bitmap.recycle()
        library.work.shutdown()
    }

    @Test
    fun legacyWorkspaceMigrationKeepsPhotoSettingsAndRaw() {
        val bitmap = Bitmap.createBitmap(64, 80, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(0xffa05020.toInt())
        val bytes = java.io.ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
        bitmap.recycle()
        val a = NativePhoto.defaults().put("exposure", 0.7)
        val p =
            JSONObject()
                .put("id", "legacy-fixture")
                .put("name", "Legacy fixture.dng")
                .put("width", 64)
                .put("height", 80)
                .put("rating", 4)
                .put("adjustments", a)
                .put("history", JSONArray().put(NativePhoto.defaults()).put(a))
                .put("cursor", 1)
                .put(
                    "src",
                    "data:image/png;base64," +
                        android.util.Base64.encodeToString(
                            bytes.toByteArray(),
                            android.util.Base64.NO_WRAP,
                        ),
                )
                .put("rawSource", "data:application/octet-stream;base64,AQIDBA==")
        val fixture =
            JSONObject()
                .put("version", 5)
                .put("selected", "legacy-fixture")
                .put("photos", JSONArray().put(p))
        val result = File(context.cacheDir, "native-migration-tests/result.json")
        result.delete()
        ActivityScenario.launch<NativeTestActivity>(
                Intent(context, NativeTestActivity::class.java)
                    .putExtra("fixture", fixture.toString())
            )
            .use {
                val deadline = System.currentTimeMillis() + 30000
                while (!result.exists() && System.currentTimeMillis() < deadline) Thread.sleep(100)
                assertTrue("Legacy migration completed", result.exists())
                assertTrue(
                    "Photo, settings, rating and RAW original retained",
                    JSONObject(result.readText()).getBoolean("pass"),
                )
            }
    }
}
