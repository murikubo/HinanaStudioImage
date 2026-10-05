package studio.hinana.image.nativeeditor

import android.util.Base64
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

object NativeMasks {
    fun coverage(mask: JSONObject, width: Int, height: Int): ByteArray {
        val result = FloatArray(width * height)
        val kind = mask.optString("kind")
        val feather = mask.optDouble("feather", .65)
        val radius = mask.optDouble("radius", .08) * min(width, height)
        fun edge(d: Double, f: Double): Float {
            if (d >= 1) return 0f
            if (f <= 0) return 1f
            val t = ((d - (1 - f)) / f).coerceIn(0.0, 1.0)
            return (1 - t * t * (3 - 2 * t)).toFloat()
        }
        fun segment(points: JSONArray, target: FloatArray, r: Double, f: Double) {
            for (i in 0 until points.length()) {
                val b = points.getJSONObject(i)
                val a = if (i == 0 || b.optBoolean("start")) b else points.getJSONObject(i - 1)
                val ax = a.getDouble("x") * width
                val ay = a.getDouble("y") * height
                val bx = b.getDouble("x") * width
                val by = b.getDouble("y") * height
                val dx = bx - ax
                val dy = by - ay
                val length = dx * dx + dy * dy
                for (y in
                    max(0, floor(min(ay, by) - r).toInt())..min(
                            height - 1,
                            ceil(max(ay, by) + r).toInt(),
                        )) for (x in
                    max(0, floor(min(ax, bx) - r).toInt())..min(
                            width - 1,
                            ceil(max(ax, bx) + r).toInt(),
                        )) {
                    val t =
                        if (length > 0)
                            (((x + .5 - ax) * dx + (y + .5 - ay) * dy) / length).coerceIn(0.0, 1.0)
                        else 0.0
                    val value =
                        edge(hypot(x + .5 - ax - t * dx, y + .5 - ay - t * dy) / max(.5, r), f)
                    target[y * width + x] = max(target[y * width + x], value)
                }
            }
        }
        val points = mask.optJSONArray("points") ?: JSONArray()
        if (kind == "subject") {
            val raster = mask.optJSONObject("raster")
            if (raster != null) {
                val w = raster.getInt("width")
                val h = raster.getInt("height")
                val bytes = Base64.decode(raster.getString("data"), Base64.DEFAULT)
                require(bytes.size == w * h)
                for (y in 0 until height) for (x in 0 until width) {
                    val xx = ((x + .5) / width * w - .5).coerceIn(0.0, w - 1.0)
                    val yy = ((y + .5) / height * h - .5).coerceIn(0.0, h - 1.0)
                    val x0 = floor(xx).toInt()
                    val y0 = floor(yy).toInt()
                    val x1 = min(w - 1, x0 + 1)
                    val y1 = min(h - 1, y0 + 1)
                    val fx = xx - x0
                    val fy = yy - y0
                    fun v(x: Int, y: Int): Double {
                        return (bytes[y * w + x].toInt() and 255) / 255.0
                    }
                    result[y * width + x] =
                        ((v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) +
                                (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy)
                            .toFloat()
                }
            }
        } else if (kind == "brush") segment(points, result, radius, feather)
        else if (points.length() >= 2) {
            val a = points.getJSONObject(0)
            val b = points.getJSONObject(1)
            val ax = a.getDouble("x") * width
            val ay = a.getDouble("y") * height
            val dx = (b.getDouble("x") - a.getDouble("x")) * width
            val dy = (b.getDouble("y") - a.getDouble("y")) * height
            val length = dx * dx + dy * dy
            if (length > .000001)
                for (y in 0 until height) for (x in 0 until width) {
                    result[y * width + x] =
                        if (kind == "radial")
                            edge(
                                hypot(
                                    (x + .5 - ax) / max(.5, abs(dx)),
                                    (y + .5 - ay) / max(.5, abs(dy)),
                                ),
                                feather,
                            )
                        else edge(((x + .5 - ax) * dx + (y + .5 - ay) * dy) / length, feather)
                }
        }
        val strokes = mask.optJSONArray("strokes") ?: JSONArray()
        for (i in 0 until strokes.length()) {
            val stroke = strokes.getJSONObject(i)
            val coverage = FloatArray(result.size)
            segment(
                stroke.getJSONArray("points"),
                coverage,
                stroke.getDouble("radius") * min(width, height),
                stroke.getDouble("feather"),
            )
            for (j in result.indices) result[j] =
                if (stroke.optBoolean("erase")) result[j] * (1 - coverage[j])
                else result[j] + (1 - result[j]) * coverage[j]
        }
        return ByteArray(result.size) { (result[it].coerceIn(0f, 1f) * 255).roundToInt().toByte() }
    }
}
