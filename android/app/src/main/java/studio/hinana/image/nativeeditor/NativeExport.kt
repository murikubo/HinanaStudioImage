package studio.hinana.image.nativeeditor

import android.content.Context
import android.graphics.*
import android.opengl.EGL14
import android.opengl.GLES30 as GL
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import java.io.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import java.util.zip.Deflater
import java.util.zip.DeflaterOutputStream
import kotlin.math.*

object NativeExport {
    fun isPQ(file: File): Boolean =
        runCatching {
                file.inputStream().use { raw ->
                    val input = DataInputStream(BufferedInputStream(raw))
                    val signature = ByteArray(8)
                    input.readFully(signature)
                    if (
                        !signature.contentEquals(
                            byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10)
                        )
                    )
                        return@use false
                    while (true) {
                        val length = input.readInt()
                        require(length >= 0 && length <= 256 * 1024 * 1024)
                        val type = ByteArray(4)
                        input.readFully(type)
                        val name = String(type, Charsets.US_ASCII)
                        if (name == "cICP") {
                            val data = ByteArray(length)
                            input.readFully(data)
                            return@use data.size == 4 &&
                                data[0].toInt() == 9 &&
                                data[1].toInt() == 16
                        }
                        if (name == "IDAT" || name == "IEND") return@use false
                        var skip = length.toLong() + 4
                        while (skip > 0) {
                            val n = input.skip(skip)
                            if (n == 0L) {
                                input.readByte()
                                skip--
                            } else skip -= n
                        }
                    }
                    false
                }
            }
            .getOrDefault(false)

    fun isHDR(file: File): Boolean {
        if (isPQ(file)) return true
        if (Build.VERSION.SDK_INT >= 34) {
            val info = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, info)
            if (
                info.outColorSpace == ColorSpace.get(ColorSpace.Named.BT2020_PQ) ||
                    info.outColorSpace == ColorSpace.get(ColorSpace.Named.BT2020_HLG)
            )
                return true
            val bitmap = NativeRenderer.decode(file, 512)
            val hdr = bitmap.hasGainmap()
            bitmap.recycle()
            return hdr
        }
        return false
    }

    fun originalPNG(context: Context, library: NativeLibrary, photo: NativePhoto): ByteArray {
        val neutral =
            NativePhoto(
                photo.id,
                photo.name,
                photo.file,
                photo.width,
                photo.height,
                settings = NativePhoto.defaults(),
            )
        val hdr = isHDR(File(library.root, photo.file))
        neutral.settings
            .put("sourceOrientation", photo.settings.optInt("sourceOrientation", 1))
            .put("sourceGainP3", photo.settings.optBoolean("sourceGainP3"))
            .put("colorSpace", "display-p3")
            .put("dynamicRange", if (hdr) "hdr" else "sdr")
        val output =
            export(
                context,
                library,
                neutral,
                if (hdr) "hdr-png" else "png16",
                "display-p3",
                0,
                100,
                true,
            )
        return output.readBytes()
    }

    fun export(
        context: Context,
        library: NativeLibrary,
        photo: NativePhoto,
        format: String,
        space: String,
        maxSide: Int,
        quality: Int,
        preserve: Boolean,
    ): File {
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
        val eglContext =
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
        check(EGL14.eglMakeCurrent(display, surface, surface, eglContext))
        val renderer = NativeRenderer()
        renderer.init()
        renderer.photo = photo
        renderer.settings = org.json.JSONObject(photo.settings.toString())
        renderer.proof = photo.settings.optString("dynamicRange") == "hdr" && format != "hdr-png"
        val dimensions = renderer.dimensions()
        val scale =
            if (maxSide > 0) min(1.0, maxSide / max(dimensions.first, dimensions.second)) else 1.0
        val width = max(1, (dimensions.first * scale).roundToInt())
        val height = max(1, (dimensions.second * scale).roundToInt())
        val original = File(library.root, photo.file)
        val ext = if (format.contains("png")) "png" else if (format == "webp") "webp" else "jpg"
        val target =
            File(context.cacheDir, File(photo.name).nameWithoutExtension + "-edited." + ext)
        val limit = IntArray(1)
        GL.glGetIntegerv(GL.GL_MAX_TEXTURE_SIZE, limit, 0)
        require(width <= limit[0]) { "출력 폭이 GPU 제한을 넘습니다. 이미지 크기를 줄여 주세요." }
        var bitmap: Bitmap? = null
        try {
            if (!format.contains("png")) {
                require(width.toLong() * height <= 32_000_000) { "32MP 초과 출력은 PNG를 사용해 주세요." }
                bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            }
            val output =
                if (format.contains("png"))
                    NativePNG(
                        target,
                        width,
                        height,
                        if (format == "png") 8 else 16,
                        if (format == "hdr-png") null
                        else
                            context.assets
                                .open(
                                    "profiles/" +
                                        if (space == "display-p3") "display-p3.icc" else "srgb.icc"
                                )
                                .readBytes(),
                        format == "hdr-png",
                    )
                else null
            for (y in 0 until height step 128) {
                val rows = min(128, height - y)
                // Decode only the source rectangle needed by this output strip, including filter
                // borders.
                val crop =
                    sourceRectangle(
                        photo,
                        dimensions,
                        y.toDouble() / height,
                        (y + rows).toDouble() / height,
                    )
                val source =
                    if (Build.VERSION.SDK_INT >= 26 && isPQ(original))
                        NativePQDecoder.decode(original, 0, crop)
                    else if (Build.VERSION.SDK_INT >= 28)
                        ImageDecoder.decodeBitmap(ImageDecoder.createSource(original)) {
                            decoder,
                            _,
                            _ ->
                            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                            decoder.setTargetColorSpace(
                                ColorSpace.get(ColorSpace.Named.EXTENDED_SRGB)
                            )
                            decoder.crop = crop
                        }
                    else
                        BitmapRegionDecoder.newInstance(original.path, false).useCompat {
                            it.decodeRegion(crop, BitmapFactory.Options())
                        }
                renderer.upload(source)
                source.recycle()
                val texture = IntArray(1)
                val fbo = IntArray(1)
                GL.glGenTextures(1, texture, 0)
                GL.glBindTexture(GL.GL_TEXTURE_2D, texture[0])
                GL.glTexImage2D(
                    GL.GL_TEXTURE_2D,
                    0,
                    if (
                        GL.glGetString(GL.GL_EXTENSIONS)?.contains("GL_EXT_color_buffer_float") ==
                            true
                    )
                        GL.GL_RGBA32F
                    else GL.GL_RGBA16F,
                    width,
                    rows,
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
                check(
                    GL.glCheckFramebufferStatus(GL.GL_FRAMEBUFFER) == GL.GL_FRAMEBUFFER_COMPLETE
                ) {
                    "이 기기는 고정밀 GPU 출력에 필요한 RGBA16F를 지원하지 않습니다."
                }
                // Rebind source after creating the output texture.
                renderer.rebind()
                renderer.draw(
                    width,
                    rows,
                    doubleArrayOf(0.0, -y.toDouble() / rows, 1.0, height.toDouble() / rows),
                    crop.left.toDouble() / photo.width to crop.top.toDouble() / photo.height,
                    crop.width().toDouble() / photo.width to
                        crop.height().toDouble() / photo.height,
                    if (format == "hdr-png") 2 else 1,
                    space == "display-p3",
                )
                val pixels =
                    ByteBuffer.allocateDirect(width * rows * 16).order(ByteOrder.nativeOrder())
                GL.glReadPixels(0, 0, width, rows, GL.GL_RGBA, GL.GL_FLOAT, pixels)
                check(GL.glGetError() == GL.GL_NO_ERROR) { "고정밀 픽셀 출력 실패" }
                val floats = pixels.asFloatBuffer()
                for (row in rows - 1 downTo 0) {
                    if (output != null) {
                        val bytes = ByteArray(width * 4 * (if (format == "png") 1 else 2))
                        for (x in 0 until width) {
                            for (c in 0..3) {
                                val linear = floats[(row * width + x) * 4 + c].toDouble()
                                val v =
                                    if (format == "hdr-png" || c == 3) linear else encode(linear)
                                if (format == "png")
                                    bytes[x * 4 + c] =
                                        (v.coerceIn(0.0, 1.0) * 255).roundToInt().toByte()
                                else {
                                    val n = (v.coerceIn(0.0, 1.0) * 65535).roundToInt()
                                    bytes[x * 8 + c * 2] = (n ushr 8).toByte()
                                    bytes[x * 8 + c * 2 + 1] = n.toByte()
                                }
                            }
                        }
                        output.row(bytes)
                    } else {
                        val colors = IntArray(width)
                        for (x in 0 until width) {
                            val i = (row * width + x) * 4
                            fun channel(c: Int): Int {
                                return (encode(floats[i + c].toDouble()).coerceIn(0.0, 1.0) * 255)
                                    .roundToInt()
                            }
                            colors[x] =
                                Color.argb(
                                    (floats[i + 3].coerceIn(0f, 1f) * 255).roundToInt(),
                                    channel(0),
                                    channel(1),
                                    channel(2),
                                )
                        }
                        bitmap!!.setPixels(colors, 0, width, 0, y + rows - 1 - row, width, 1)
                    }
                }
                GL.glDeleteFramebuffers(1, fbo, 0)
                GL.glDeleteTextures(1, texture, 0)
            }
            output?.close()
            if (bitmap != null) {
                target.outputStream().use { stream ->
                    check(
                        bitmap!!.compress(
                            if (format == "webp") {
                                if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY
                                else Bitmap.CompressFormat.WEBP
                            } else Bitmap.CompressFormat.JPEG,
                            quality,
                            stream,
                        )
                    )
                }
            }
            if (!format.contains("png"))
                NativeColorTags.embed(
                    target,
                    context.assets
                        .open(
                            "profiles/" +
                                if (space == "display-p3") "display-p3.icc" else "srgb.icc"
                        )
                        .readBytes(),
                    width,
                    height,
                )
            if (preserve) copyExif(original, target, width, height)
            return target
        } finally {
            bitmap?.recycle()
            renderer.destroy()
            EGL14.eglMakeCurrent(
                display,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_SURFACE,
                EGL14.EGL_NO_CONTEXT,
            )
            EGL14.eglDestroySurface(display, surface)
            EGL14.eglDestroyContext(display, eglContext)
            EGL14.eglTerminate(display)
        }
    }

    private fun encode(x: Double) = if (x <= .0031308) x * 12.92 else 1.055 * x.pow(1 / 2.4) - .055

    private fun sourceRectangle(
        p: NativePhoto,
        d: Pair<Double, Double>,
        top: Double,
        bottom: Double,
    ): Rect {
        val angle = Math.toRadians(p.settings.optDouble("rotation"))
        val c = cos(angle).roundToInt()
        val s = sin(angle).roundToInt()
        val corners =
            listOf(0.0 to top, 1.0 to top, 0.0 to bottom, 1.0 to bottom).map { (x, y) ->
                val dx = (x - .5) * d.first * (if (p.settings.optBoolean("flip")) -1 else 1)
                val dy = (y - .5) * d.second
                (p.width / 2.0 + c * dx + s * dy) to (p.height / 2.0 - s * dx + c * dy)
            }
        val grid = NativeLiquify(p.settings.optJSONObject("liquify"))
        var mx = 24
        var my = 24
        for (i in grid.data.indices step 2) {
            mx = max(mx, 24 + ceil(abs(grid.data[i]) * p.width).toInt())
            my = max(my, 24 + ceil(abs(grid.data[i + 1]) * p.height).toInt())
        }
        return Rect(
            max(0, floor(corners.minOf { it.first }).toInt() - mx),
            max(0, floor(corners.minOf { it.second }).toInt() - my),
            min(p.width, ceil(corners.maxOf { it.first }).toInt() + mx),
            min(p.height, ceil(corners.maxOf { it.second }).toInt() + my),
        )
    }

    private fun copyExif(source: File, dest: File, width: Int, height: Int) {
        val original = ExifInterface(source)
        val result = ExifInterface(dest)
        listOf(
                ExifInterface.TAG_MAKE,
                ExifInterface.TAG_MODEL,
                ExifInterface.TAG_LENS_MODEL,
                ExifInterface.TAG_DATETIME_ORIGINAL,
                ExifInterface.TAG_OFFSET_TIME_ORIGINAL,
                ExifInterface.TAG_EXPOSURE_TIME,
                ExifInterface.TAG_F_NUMBER,
                ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
                ExifInterface.TAG_FOCAL_LENGTH,
                ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM,
                ExifInterface.TAG_EXPOSURE_BIAS_VALUE,
                ExifInterface.TAG_EXPOSURE_PROGRAM,
                ExifInterface.TAG_METERING_MODE,
                ExifInterface.TAG_FLASH,
                ExifInterface.TAG_WHITE_BALANCE,
                ExifInterface.TAG_SOFTWARE,
                ExifInterface.TAG_ARTIST,
                ExifInterface.TAG_COPYRIGHT,
                ExifInterface.TAG_GPS_LATITUDE,
                ExifInterface.TAG_GPS_LATITUDE_REF,
                ExifInterface.TAG_GPS_LONGITUDE,
                ExifInterface.TAG_GPS_LONGITUDE_REF,
                ExifInterface.TAG_GPS_ALTITUDE,
                ExifInterface.TAG_GPS_ALTITUDE_REF,
            )
            .forEach { original.getAttribute(it)?.let { value -> result.setAttribute(it, value) } }
        result.setAttribute(ExifInterface.TAG_ORIENTATION, "1")
        result.setAttribute(ExifInterface.TAG_IMAGE_WIDTH, width.toString())
        result.setAttribute(ExifInterface.TAG_IMAGE_LENGTH, height.toString())
        result.setAttribute(ExifInterface.TAG_PIXEL_X_DIMENSION, width.toString())
        result.setAttribute(ExifInterface.TAG_PIXEL_Y_DIMENSION, height.toString())
        result.saveAttributes()
    }
}

private fun <T> BitmapRegionDecoder.useCompat(block: (BitmapRegionDecoder) -> T): T =
    try {
        block(this)
    } finally {
        recycle()
    }

private class NativePNG(
    file: File,
    width: Int,
    height: Int,
    depth: Int,
    profile: ByteArray?,
    hdr: Boolean,
) : Closeable {
    private val out = DataOutputStream(BufferedOutputStream(FileOutputStream(file)))
    private val deflater = Deflater(6)
    private val pending = ByteArrayOutputStream()
    private val zipped = DeflaterOutputStream(pending, deflater, 65536)

    init {
        out.write(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10))
        val header =
            ByteBuffer.allocate(13)
                .putInt(width)
                .putInt(height)
                .put(depth.toByte())
                .put(6)
                .put(0)
                .put(0)
                .put(0)
                .array()
        chunk("IHDR", header)
        if (profile != null) {
            val compressed = ByteArrayOutputStream()
            DeflaterOutputStream(compressed).use { it.write(profile) }
            chunk("iCCP", "Hinana".toByteArray() + byteArrayOf(0, 0) + compressed.toByteArray())
        }
        if (hdr) chunk("cICP", byteArrayOf(9, 16, 0, 1))
    }

    private fun chunk(type: String, bytes: ByteArray) {
        val name = type.toByteArray()
        val crc = CRC32()
        crc.update(name)
        crc.update(bytes)
        out.writeInt(bytes.size)
        out.write(name)
        out.write(bytes)
        out.writeInt(crc.value.toInt())
    }

    fun row(bytes: ByteArray) {
        zipped.write(0)
        zipped.write(bytes)
        if (pending.size() > 65536) {
            chunk("IDAT", pending.toByteArray())
            pending.reset()
        }
    }

    override fun close() {
        zipped.finish()
        if (pending.size() > 0) chunk("IDAT", pending.toByteArray())
        chunk("IEND", byteArrayOf())
        deflater.end()
        out.close()
    }
}
