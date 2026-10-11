package studio.hinana.image.nativeeditor

import android.graphics.Bitmap
import android.graphics.Gainmap
import java.nio.ByteBuffer
import java.nio.FloatBuffer
import kotlin.math.*

/** Build a new SDR base + quarter-resolution log gainmap from edited linear HDR strips. */
class NativeHDRJpeg(private val width: Int, private val height: Int, peakNits: Double) {
    private val mapWidth = (width + 3) / 4
    private val mapHeight = (height + 3) / 4
    private val ceiling = max(1.0, peakNits / 203.0)

    private fun tone(peak: Double) = if (peak <= .5) peak else .5 + .5 * (1 - exp(-2 * (peak - .5)))

    private val ratioMax = max(1.01, ceiling / tone(ceiling))
    private val logMax = ln(ratioMax)
    private val sums = FloatArray(mapWidth * mapHeight)

    fun row(values: FloatBuffer, sourceRow: Int, outputY: Int, bitmap: Bitmap) {
        val colors = IntArray(width)
        for (x in 0 until width) {
            val i = (sourceRow * width + x) * 4
            val r = max(0.0, values[i].toDouble())
            val g = max(0.0, values[i + 1].toDouble())
            val b = max(0.0, values[i + 2].toDouble())
            val peak = max(r, max(g, b))
            val capped = min(peak, ceiling)
            val mapped = tone(capped)
            val scale = if (peak > 0) mapped / peak else 1.0
            val gain = if (mapped > 0) capped / mapped else 1.0
            sums[(outputY / 4) * mapWidth + x / 4] += (ln(max(1.0, gain)) / logMax).toFloat()
            fun encoded(linear: Double): Int {
                val v = linear * scale
                val e = if (v <= .0031308) v * 12.92 else 1.055 * v.pow(1 / 2.4) - .055
                return (e.coerceIn(0.0, 1.0) * 255).roundToInt()
            }
            colors[x] = android.graphics.Color.rgb(encoded(r), encoded(g), encoded(b))
        }
        bitmap.setPixels(colors, 0, width, 0, outputY, width, 1)
    }

    fun attach(bitmap: Bitmap): Bitmap {
        val map = Bitmap.createBitmap(mapWidth, mapHeight, Bitmap.Config.ALPHA_8)
        val bytes = ByteBuffer.allocate(map.rowBytes * mapHeight)
        for (y in 0 until mapHeight) for (x in 0 until mapWidth) {
            val count = min(4, width - x * 4) * min(4, height - y * 4)
            bytes.put(
                y * map.rowBytes + x,
                (sums[y * mapWidth + x] / count * 255).roundToInt().coerceIn(0, 255).toByte(),
            )
        }
        map.copyPixelsFromBuffer(bytes)
        bitmap.gainmap =
            Gainmap(map).also {
                it.setRatioMin(1f, 1f, 1f)
                it.setRatioMax(ratioMax.toFloat(), ratioMax.toFloat(), ratioMax.toFloat())
                it.setGamma(1f, 1f, 1f)
                it.setEpsilonSdr(0f, 0f, 0f)
                it.setEpsilonHdr(0f, 0f, 0f)
                it.minDisplayRatioForHdrTransition = 1f
                it.displayRatioForFullHdr = ratioMax.toFloat()
            }
        return map
    }
}
