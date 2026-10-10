package studio.hinana.image.nativeeditor

import android.util.Base64
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
import org.json.JSONObject

class NativeLiquify(value: JSONObject?) {
    companion object {
        const val SIZE = 129
    }

    val data: FloatArray =
        if (value == null) FloatArray(SIZE * SIZE * 2)
        else {
            require(value.getInt("width") == SIZE && value.getInt("height") == SIZE)
            val text = value.getString("data")
            require(text.length == ((SIZE * SIZE * 8 + 2) / 3) * 4)
            val bytes = Base64.decode(text, Base64.NO_WRAP)
            require(bytes.size == SIZE * SIZE * 8)
            FloatArray(SIZE * SIZE * 2).also {
                ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(it)
                require(it.all { n -> n.isFinite() && abs(n) <= 1 })
            }
        }

    fun json(): JSONObject {
        val buffer = ByteBuffer.allocate(data.size * 4).order(ByteOrder.LITTLE_ENDIAN)
        buffer.asFloatBuffer().put(data)
        return JSONObject()
            .put("width", SIZE)
            .put("height", SIZE)
            .put("data", Base64.encodeToString(buffer.array(), Base64.NO_WRAP))
    }

    private fun sample(old: FloatArray, x: Double, y: Double, c: Int): Double {
        val n = SIZE - 1
        val gx = (x * n).coerceIn(0.0, n.toDouble())
        val gy = (y * n).coerceIn(0.0, n.toDouble())
        val ix = min(n - 1, gx.toInt())
        val iy = min(n - 1, gy.toInt())
        val tx = gx - ix
        val ty = gy - iy
        val p = (iy * SIZE + ix) * 2 + c
        return old[p] * (1 - tx) * (1 - ty) +
            old[p + 2] * tx * (1 - ty) +
            old[p + SIZE * 2] * (1 - tx) * ty +
            old[p + SIZE * 2 + 2] * tx * ty
    }

    fun push(
        from: Pair<Double, Double>,
        to: Pair<Double, Double>,
        radius: Double,
        strength: Double,
        width: Int,
        height: Int,
    ) {
        val rx = radius * min(width, height) / width
        val ry = radius * min(width, height) / height
        val steps =
            ceil(hypot((to.first - from.first) / rx, (to.second - from.second) / ry) / .2)
                .toInt()
                .coerceIn(1, 32)
        val n = SIZE - 1
        for (step in 1..steps) {
            val cx = from.first + (to.first - from.first) * step / steps
            val cy = from.second + (to.second - from.second) * step / steps
            val dx = (to.first - from.first) * strength / steps
            val dy = (to.second - from.second) * strength / steps
            val old = data.copyOf()
            for (y in
                max(0, floor((cy - ry) * n).toInt())..min(n, ceil((cy + ry) * n).toInt())) for (x in
                max(0, floor((cx - rx) * n).toInt())..min(n, ceil((cx + rx) * n).toInt())) {
                val px = x.toDouble() / n
                val py = y.toDouble() / n
                val d = hypot((px - cx) / rx, (py - cy) / ry)
                if (d >= 1) continue
                val weight = (1 - d * d).pow(2)
                val qx = (px - dx * weight).coerceIn(0.0, 1.0)
                val qy = (py - dy * weight).coerceIn(0.0, 1.0)
                val p = (y * SIZE + x) * 2
                data[p] = ((qx + sample(old, qx, qy, 0)).coerceIn(0.0, 1.0) - px).toFloat()
                data[p + 1] = ((qy + sample(old, qx, qy, 1)).coerceIn(0.0, 1.0) - py).toFloat()
            }
        }
    }
}
