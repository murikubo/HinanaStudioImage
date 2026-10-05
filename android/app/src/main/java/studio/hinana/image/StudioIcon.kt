package studio.hinana.image

import android.graphics.*
import android.graphics.drawable.Drawable

/** Small stroke icons shared by the native studio toolbars. */
class StudioIcon(private val name: String, color: Int) : Drawable() {
    private val paint =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 1.6f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

    override fun draw(canvas: Canvas) {
        canvas.save()
        canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
        canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
        fun line(vararg xy: Float) {
            val path = Path()
            path.moveTo(xy[0], xy[1])
            for (i in 2 until xy.size step 2) path.lineTo(xy[i], xy[i + 1])
            canvas.drawPath(path, paint)
        }
        when (name) {
            "검색" -> {
                canvas.drawCircle(10f, 10f, 6f, paint)
                line(15f, 15f, 21f, 21f)
            }
            "맞춤" -> {
                line(4f, 9f, 4f, 4f, 9f, 4f)
                line(15f, 4f, 20f, 4f, 20f, 9f)
                line(4f, 15f, 4f, 20f, 9f, 20f)
                line(15f, 20f, 20f, 20f, 20f, 15f)
            }
            "확대" -> {
                canvas.drawCircle(10f, 10f, 6f, paint)
                line(15f, 15f, 21f, 21f)
                line(10f, 7f, 10f, 13f)
                line(7f, 10f, 13f, 10f)
            }
            "열기" -> line(3f, 19f, 3f, 5f, 9f, 5f, 11f, 8f, 21f, 8f, 18f, 19f, 3f, 19f)
            "ⓘ",
            "정보" -> {
                canvas.drawCircle(12f, 12f, 9f, paint)
                line(12f, 11f, 12f, 16f)
                line(12f, 7f, 12f, 7.1f)
            }
            "저장" -> {
                canvas.drawRoundRect(4f, 3f, 20f, 21f, 2f, 2f, paint)
                canvas.drawRect(8f, 3f, 16f, 9f, paint)
                canvas.drawRect(8f, 14f, 16f, 21f, paint)
            }
            "내보내기" -> {
                line(12f, 3f, 12f, 16f)
                line(7f, 11f, 12f, 16f, 17f, 11f)
                line(4f, 20f, 20f, 20f)
            }
            "사진 추가" -> {
                line(12f, 4f, 12f, 20f)
                line(4f, 12f, 20f, 12f)
            }
            "사진" -> {
                canvas.drawRoundRect(5f, 3f, 21f, 19f, 2f, 2f, paint)
                line(2f, 7f, 2f, 22f, 17f, 22f)
                line(6f, 16f, 11f, 10f, 16f, 16f, 20f, 12f)
                canvas.drawCircle(17f, 7f, 1f, paint)
            }
            "편집" -> {
                for (y in listOf(6f, 12f, 18f)) line(3f, y, 21f, y)
                canvas.drawCircle(8f, 6f, 2f, paint)
                canvas.drawCircle(16f, 12f, 2f, paint)
                canvas.drawCircle(10f, 18f, 2f, paint)
            }
            "색상·톤",
            "프리셋" -> {
                canvas.drawOval(3f, 3f, 21f, 21f, paint)
                for (p in listOf(8f to 7f, 14f to 6f, 18f to 11f, 7f to 13f)) canvas.drawCircle(
                    p.first,
                    p.second,
                    1f,
                    paint,
                )
                line(20f, 16f, 13f, 16f, 12f, 21f)
            }
            "마스크" -> {
                canvas.drawCircle(12f, 12f, 8f, paint)
                canvas.drawCircle(12f, 12f, 3f, paint)
            }
            "자르기" -> {
                line(6f, 2f, 6f, 18f, 22f, 18f)
                line(2f, 6f, 18f, 6f, 18f, 22f)
            }
            "회전" -> {
                canvas.drawArc(4f, 4f, 20f, 20f, 20f, 290f, false, paint)
                line(15f, 3f, 20f, 4f, 19f, 9f)
            }
            "반전",
            "원본" -> {
                line(3f, 8f, 20f, 8f, 16f, 4f)
                line(21f, 16f, 4f, 16f, 8f, 20f)
            }
            "↶",
            "↷" -> {
                if (name == "↷") canvas.scale(-1f, 1f, 12f, 12f)
                line(8f, 4f, 3f, 9f, 8f, 14f)
                line(3f, 9f, 14f, 9f)
                canvas.drawArc(10f, 9f, 21f, 20f, -90f, 210f, false, paint)
            }
        }
        canvas.restore()
    }

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
    }

    override fun setColorFilter(filter: ColorFilter?) {
        paint.colorFilter = filter
    }

    @Deprecated("Deprecated in Java") override fun getOpacity() = PixelFormat.TRANSLUCENT
}
