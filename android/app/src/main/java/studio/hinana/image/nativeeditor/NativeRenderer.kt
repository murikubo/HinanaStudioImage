package studio.hinana.image.nativeeditor

import android.graphics.*
import android.opengl.GLES30 as GL
import android.opengl.GLUtils
import android.os.Build
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
import org.json.JSONObject

class NativeRenderer {
    private var warpKey = ""
    private var maskKey = ""
    var overlayID = ""
    private var program = 0
    private val textures = IntArray(6)
    private var bitmapWidth = 1
    private var bitmapHeight = 1
    var photo: NativePhoto? = null
    var settings = NativePhoto.defaults()
    var compare = false
    var proof = true
    private val vertices =
        ByteBuffer.allocateDirect(32).order(ByteOrder.nativeOrder()).asFloatBuffer().also {
            it.put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
            it.position(0)
        }

    fun init() {
        fun shader(type: Int, source: String): Int {
            val id = GL.glCreateShader(type)
            GL.glShaderSource(id, source)
            GL.glCompileShader(id)
            val status = IntArray(1)
            GL.glGetShaderiv(id, GL.GL_COMPILE_STATUS, status, 0)
            check(status[0] != 0) { GL.glGetShaderInfoLog(id) }
            return id
        }
        maskKey = ""
        warpKey = ""
        program = GL.glCreateProgram()
        val v = shader(GL.GL_VERTEX_SHADER, NativeShaders.vertex)
        val f = shader(GL.GL_FRAGMENT_SHADER, NativeShaders.fragment)
        GL.glAttachShader(program, v)
        GL.glAttachShader(program, f)
        GL.glLinkProgram(program)
        val status = IntArray(1)
        GL.glGetProgramiv(program, GL.GL_LINK_STATUS, status, 0)
        check(status[0] != 0) { GL.glGetProgramInfoLog(program) }
        GL.glDeleteShader(v)
        GL.glDeleteShader(f)
        GL.glGenTextures(6, textures, 0)
    }

    private fun uniform(name: String) = GL.glGetUniformLocation(program, name)

    fun one(name: String, v: Double) {
        GL.glUniform1f(uniform(name), v.toFloat())
    }

    fun two(name: String, x: Double, y: Double) {
        GL.glUniform2f(uniform(name), x.toFloat(), y.toFloat())
    }

    fun three(name: String, x: Double, y: Double, z: Double) {
        GL.glUniform3f(uniform(name), x.toFloat(), y.toFloat(), z.toFloat())
    }

    fun four(name: String, x: Double, y: Double, z: Double, w: Double) {
        GL.glUniform4f(uniform(name), x.toFloat(), y.toFloat(), z.toFloat(), w.toFloat())
    }

    fun upload(bitmap: Bitmap) {
        bitmapWidth = bitmap.width
        bitmapHeight = bitmap.height
        bind(0)
        if (Build.VERSION.SDK_INT >= 26 && bitmap.config == Bitmap.Config.RGBA_F16) {
            val buffer =
                ByteBuffer.allocateDirect(bitmap.allocationByteCount).order(ByteOrder.nativeOrder())
            bitmap.copyPixelsToBuffer(buffer)
            buffer.position(0)
            GL.glPixelStorei(GL.GL_UNPACK_ROW_LENGTH, bitmap.rowBytes / 8)
            GL.glTexImage2D(
                GL.GL_TEXTURE_2D,
                0,
                GL.GL_RGBA16F,
                bitmap.width,
                bitmap.height,
                0,
                GL.GL_RGBA,
                GL.GL_HALF_FLOAT,
                buffer,
            )
            GL.glPixelStorei(GL.GL_UNPACK_ROW_LENGTH, 0)
        } else GLUtils.texImage2D(GL.GL_TEXTURE_2D, 0, bitmap, 0)
        GL.glUseProgram(program)
        one("gainEnabled", 0.0)
        one("gainP3", if (photo?.settings?.optBoolean("sourceGainP3") == true) 1.0 else 0.0)
        if (Build.VERSION.SDK_INT >= 34 && bitmap.hasGainmap()) {
            val gain = bitmap.gainmap!!
            if (Build.VERSION.SDK_INT >= 36) {
                if (gain.alternativeImagePrimaries != null)
                    one(
                        "gainP3",
                        if (
                            gain.alternativeImagePrimaries ==
                                ColorSpace.get(ColorSpace.Named.DISPLAY_P3)
                        )
                            1.0
                        else 0.0,
                    )
                if (gain.gainmapDirection == Gainmap.GAINMAP_DIRECTION_HDR_TO_SDR) {
                    one("gainEnabled", 0.0)
                    return
                }
            }
            bind(1)
            GLUtils.texImage2D(GL.GL_TEXTURE_2D, 0, gain.gainmapContents, 0)
            one("gainEnabled", 1.0)
            fun array(name: String, v: FloatArray) {
                GL.glUniform3fv(uniform(name), 1, v, 0)
            }
            array("gainMin", gain.ratioMin)
            array("gainMax", gain.ratioMax)
            array("gainGamma", gain.gamma)
            array("epsilonSdr", gain.epsilonSdr)
            array("epsilonHdr", gain.epsilonHdr)
        }
    }

    private fun bind(index: Int) {
        GL.glActiveTexture(GL.GL_TEXTURE0 + index)
        GL.glBindTexture(GL.GL_TEXTURE_2D, textures[index])
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MIN_FILTER, GL.GL_LINEAR)
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MAG_FILTER, GL.GL_LINEAR)
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_WRAP_S, GL.GL_CLAMP_TO_EDGE)
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_WRAP_T, GL.GL_CLAMP_TO_EDGE)
    }

    fun dimensions(): Pair<Double, Double> {
        val p = photo ?: return 1.0 to 1.0
        var w = p.width.toDouble()
        var h = p.height.toDouble()
        if (settings.optInt("rotation") % 180 == 90) {
            val t = w
            w = h
            h = t
        }
        val ratio = settings.optString("crop").split(':').mapNotNull { it.toDoubleOrNull() }
        if (ratio.size == 2) {
            val r = ratio[0] / ratio[1]
            if (w / h > r) w = (h * r).roundToInt().toDouble()
            else h = (w / r).roundToInt().toDouble()
        }
        return w to h
    }

    private fun liquify() {
        val value = settings.optJSONObject("liquify")
        one("warpEnabled", if (value == null) 0.0 else 1.0)
        GL.glUniform1i(uniform("warpMap"), 5)
        val key = value?.optString("data") ?: ""
        if (value == null || key == warpKey) return
        val grid = NativeLiquify(value)
        val buffer = ByteBuffer.allocateDirect(grid.data.size * 4).order(ByteOrder.nativeOrder())
        buffer.asFloatBuffer().put(grid.data)
        bind(5)
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MIN_FILTER, GL.GL_NEAREST)
        GL.glTexParameteri(GL.GL_TEXTURE_2D, GL.GL_TEXTURE_MAG_FILTER, GL.GL_NEAREST)
        GL.glTexImage2D(
            GL.GL_TEXTURE_2D,
            0,
            GL.GL_RG32F,
            NativeLiquify.SIZE,
            NativeLiquify.SIZE,
            0,
            GL.GL_RG,
            GL.GL_FLOAT,
            buffer,
        )
        warpKey = key
    }

    private fun masks() {
        val masks = settings.optJSONArray("masks") ?: org.json.JSONArray()
        require(masks.length() <= 8)
        val key =
            org.json
                .JSONArray()
                .also { list ->
                    for (i in 0 until masks.length()) {
                        val m = org.json.JSONObject(masks.getJSONObject(i).toString())
                        listOf(
                                "exposure",
                                "contrast",
                                "saturation",
                                "temperature",
                                "opacity",
                                "inverted",
                                "enabled",
                                "name",
                            )
                            .forEach { m.remove(it) }
                        list.put(m)
                    }
                }
                .toString()
        if (key + (photo?.id ?: "") != maskKey) {
            maskKey = key + (photo?.id ?: "")
            val p = photo
            if (p != null && masks.length() > 0) {
                val scale = min(1.0, 1024.0 / max(p.width, p.height))
                val width = max(1, (p.width * scale).roundToInt())
                val height = max(1, (p.height * scale).roundToInt())
                val data = ByteBuffer.allocateDirect(width * height * masks.length())
                for (i in 0 until masks.length()) data.put(
                    NativeMasks.coverage(masks.getJSONObject(i), width, height)
                )
                data.position(0)
                bind(2)
                GL.glPixelStorei(GL.GL_UNPACK_ALIGNMENT, 1)
                GL.glTexImage2D(
                    GL.GL_TEXTURE_2D,
                    0,
                    GL.GL_R8,
                    width,
                    height * masks.length(),
                    0,
                    GL.GL_RED,
                    GL.GL_UNSIGNED_BYTE,
                    data,
                )
                GL.glPixelStorei(GL.GL_UNPACK_ALIGNMENT, 4)
            }
        }
        GL.glUniform1i(uniform("maskCount"), masks.length())
        val edits = FloatArray(32)
        val flags = FloatArray(32)
        for (i in 0 until masks.length()) {
            val m = masks.getJSONObject(i)
            listOf("exposure", "contrast", "saturation", "temperature").forEachIndexed { j, k ->
                edits[i * 4 + j] = m.optDouble(k).toFloat()
            }
            flags[i * 4] = if (m.optBoolean("inverted")) 1f else 0f
            flags[i * 4 + 1] = m.optDouble("opacity", 1.0).toFloat()
            flags[i * 4 + 2] =
                if (m.optBoolean("enabled", true) && (m.optJSONArray("points")?.length() ?: 0) > 0)
                    1f
                else 0f
            flags[i * 4 + 3] = if (m.optString("id") == overlayID) 1f else 0f
        }
        GL.glUniform4fv(uniform("maskEdits"), 8, edits, 0)
        GL.glUniform4fv(uniform("maskFlags"), 8, flags, 0)
        one("maskOverlay", if (overlayID.isEmpty()) 0.0 else 1.0)
    }

    fun draw(
        width: Int,
        height: Int,
        viewport: DoubleArray = doubleArrayOf(0.0, 0.0, 1.0, 1.0),
        tileOrigin: Pair<Double, Double> = 0.0 to 0.0,
        tileSize: Pair<Double, Double> = 1.0 to 1.0,
        mode: Int = 0,
        outputP3: Boolean = false,
    ) {
        GL.glViewport(0, 0, width, height)
        GL.glUseProgram(program)
        GL.glClearColor(.07f, .08f, .085f, 1f)
        GL.glClear(GL.GL_COLOR_BUFFER_BIT)
        val p = photo ?: return
        val a = settings
        fun n(key: String) = a.optDouble(key, 0.0)
        GL.glUniform1i(uniform("source"), 0)
        GL.glUniform1i(uniform("gainmap"), 1)
        GL.glUniform1i(uniform("coverage"), 2)
        two("dimensions", p.width.toDouble(), p.height.toDouble())
        val dim = dimensions()
        two("outputSize", dim.first, dim.second)
        two("tileOrigin", tileOrigin.first, tileOrigin.second)
        two("tileSize", tileSize.first, tileSize.second)
        four("viewport", viewport[0], viewport[1], viewport[2], viewport[3])
        one("rotation", n("rotation"))
        one("flip", if (a.optBoolean("flip")) 1.0 else 0.0)
        one(
            "sourceOrientation",
            if (android.os.Build.VERSION.SDK_INT >= 28) 1.0
            else a.optDouble("sourceOrientation", 1.0),
        )
        one("exposure", if (compare) 0.0 else n("exposure"))
        four("light", n("contrast"), n("shadows"), n("highlights"), n("whites"))
        four("balance", n("blacks"), n("temperature"), n("tint"), n("saturation"))
        four("finish", n("vibrance"), n("fade"), n("vignette"), 0.0)
        three("curveAdjustment", n("curveShadows"), n("curveMidtones"), n("curveHighlights"))
        three("skinSettings", n("skinSmooth"), n("skinRedness"), n("skinBrightness"))
        val angle = Math.toRadians(n("rotation"))
        val c = cos(angle).roundToInt()
        val sn = sin(angle).roundToInt()
        val direction = if (a.optBoolean("flip")) -1 else 1
        val radius =
            max(1.0, min(12.0, (min(dim.first, dim.second) * .003).roundToInt().toDouble()))
        four(
            "pixelStep",
            c * direction * radius / (p.width * tileSize.first),
            -sn * direction * radius / (p.height * tileSize.second),
            sn * radius / (p.width * tileSize.first),
            c * radius / (p.height * tileSize.second),
        )
        val bands = FloatArray(24)
        NativePhoto.bands.forEachIndexed { i, b ->
            listOf("hue", "saturation", "luminance").forEachIndexed { j, k ->
                bands[i * 3 + j] = n("mixer_${b}_$k").toFloat()
            }
        }
        GL.glUniform3fv(uniform("bands"), 8, bands, 0)
        one("p3", if (a.optString("colorSpace") == "display-p3") 1.0 else 0.0)
        one("legacy", if (a.optString("precision") == "legacy") 1.0 else 0.0)
        one("hdr", if (a.optString("dynamicRange") == "hdr") 1.0 else 0.0)
        one("hdrPeak", a.optDouble("hdrPeak", 1000.0))
        one("hdrHighlights", if (compare) 0.0 else n("hdrHighlights"))
        one("proof", if (proof) 1.0 else 0.0)
        one("compare", if (compare) 1.0 else 0.0)
        one("exportMode", mode.toDouble())
        one("outputP3", if (outputP3) 1.0 else 0.0)
        masks()
        liquify()
        rebind()
        GL.glEnableVertexAttribArray(0)
        GL.glVertexAttribPointer(0, 2, GL.GL_FLOAT, false, 8, vertices)
        GL.glDrawArrays(GL.GL_TRIANGLE_STRIP, 0, 4)
        check(GL.glGetError() == GL.GL_NO_ERROR) { "GPU 렌더링 오류" }
    }

    fun rebind() {
        for (i in listOf(0, 1, 2, 5)) bind(i)
    }

    fun histogram(bitmap: Bitmap): Array<IntArray> {
        val oldWidth = bitmapWidth
        val oldHeight = bitmapHeight
        val oldOverlay = overlayID
        val names =
            listOf(
                "gainEnabled",
                "gainP3",
                "gainMin",
                "gainMax",
                "gainGamma",
                "epsilonSdr",
                "epsilonHdr",
            )
        val gain =
            names.associateWith {
                val values = FloatArray(if (it == "gainEnabled" || it == "gainP3") 1 else 3)
                GL.glGetUniformfv(program, uniform(it), values, 0)
                values
            }
        fun swap() {
            val source = textures[0]
            textures[0] = textures[3]
            textures[3] = source
            val map = textures[1]
            textures[1] = textures[4]
            textures[4] = map
        }
        val target = IntArray(1)
        val fbo = IntArray(1)
        swap()
        try {
            upload(bitmap)
            overlayID = ""
            GL.glGenTextures(1, target, 0)
            GL.glBindTexture(GL.GL_TEXTURE_2D, target[0])
            GL.glTexImage2D(
                GL.GL_TEXTURE_2D,
                0,
                GL.GL_RGBA8,
                64,
                64,
                0,
                GL.GL_RGBA,
                GL.GL_UNSIGNED_BYTE,
                null,
            )
            GL.glGenFramebuffers(1, fbo, 0)
            GL.glBindFramebuffer(GL.GL_FRAMEBUFFER, fbo[0])
            GL.glFramebufferTexture2D(
                GL.GL_FRAMEBUFFER,
                GL.GL_COLOR_ATTACHMENT0,
                GL.GL_TEXTURE_2D,
                target[0],
                0,
            )
            check(GL.glCheckFramebufferStatus(GL.GL_FRAMEBUFFER) == GL.GL_FRAMEBUFFER_COMPLETE)
            draw(64, 64)
            val buffer = ByteBuffer.allocateDirect(64 * 64 * 4)
            GL.glReadPixels(0, 0, 64, 64, GL.GL_RGBA, GL.GL_UNSIGNED_BYTE, buffer)
            val bins = Array(3) { IntArray(64) }
            for (i in 0 until 64 * 64) for (c in 0..2) bins[c][
                (buffer[i * 4 + c].toInt() and 255) / 4]++
            return bins
        } finally {
            swap()
            bitmapWidth = oldWidth
            bitmapHeight = oldHeight
            overlayID = oldOverlay
            GL.glUseProgram(program)
            gain.forEach { (name, values) ->
                if (values.size == 1) one(name, values[0].toDouble())
                else GL.glUniform3fv(uniform(name), 1, values, 0)
            }
            GL.glBindFramebuffer(GL.GL_FRAMEBUFFER, 0)
            GL.glDeleteFramebuffers(1, fbo, 0)
            GL.glDeleteTextures(1, target, 0)
            rebind()
        }
    }

    fun destroy() {
        GL.glDeleteTextures(6, textures, 0)
        GL.glDeleteProgram(program)
    }

    companion object {
        fun decode(file: File, maxSide: Int = 2300): Bitmap {
            if (NativeExport.isPQ(file)) {
                require(Build.VERSION.SDK_INT >= 26) { "HDR PNG는 Android 8 이상에서 지원합니다." }
                return NativePQDecoder.decode(file, maxSide)
            }
            if (Build.VERSION.SDK_INT >= 28)
                return ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _
                    ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.EXTENDED_SRGB))
                    val scale =
                        min(1.0, maxSide.toDouble() / max(info.size.width, info.size.height))
                    decoder.setTargetSize(
                        max(1, (info.size.width * scale).roundToInt()),
                        max(1, (info.size.height * scale).roundToInt()),
                    )
                }
            val bounds = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.path, bounds)
            val options = BitmapFactory.Options()
            while (
                max(bounds.outWidth, bounds.outHeight) / max(1, options.inSampleSize) > maxSide
            ) options.inSampleSize = if (options.inSampleSize == 0) 2 else options.inSampleSize * 2
            return BitmapFactory.decodeFile(file.path, options) ?: error("사진을 읽지 못했습니다.")
        }
    }
}
