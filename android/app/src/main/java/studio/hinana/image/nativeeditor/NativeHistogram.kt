package studio.hinana.image.nativeeditor

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.View

class NativeHistogram(context: Context) : View(context) {
    var bins = Array(3) { IntArray(64) }
        set(value) {
            field = value
            invalidate()
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val peak = bins.maxOfOrNull { it.maxOrNull() ?: 1 }?.coerceAtLeast(1) ?: 1
        for (c in 0..2) {
            val path = Path()
            path.moveTo(0f, height.toFloat())
            bins[c].forEachIndexed { i, n ->
                path.lineTo(i / 63f * width, height * (1 - n.toFloat() / peak))
            }
            path.lineTo(width.toFloat(), height.toFloat())
            path.close()
            paint.color = intArrayOf(Color.RED, Color.GREEN, Color.BLUE)[c]
            paint.alpha = 85
            canvas.drawPath(path, paint)
        }
        contentDescription = "미리보기 RGB 히스토그램"
    }
}
