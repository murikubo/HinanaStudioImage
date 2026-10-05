package studio.hinana.image.nativeeditor

import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.Rect
import android.util.Half
import java.io.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import java.util.zip.InflaterInputStream
import kotlin.math.*

/** Streaming Rec.2020/PQ PNG reader; Android ImageDecoder does not consistently honor cICP. */
object NativePQDecoder {
    fun decode(file: File, maxSide: Int = 2300, region: Rect? = null): Bitmap {
        file.inputStream().buffered().use { raw ->
            val input = DataInputStream(raw)
            val signature = ByteArray(8)
            input.readFully(signature)
            require(signature.contentEquals(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10)))
            require(input.readInt() == 13)
            val type = ByteArray(4)
            input.readFully(type)
            require(String(type) == "IHDR")
            val header = ByteArray(13)
            input.readFully(header)
            val crc =
                CRC32().also {
                    it.update(type)
                    it.update(header)
                }
            require(input.readInt().toLong().and(0xffffffffL) == crc.value)
            val h = ByteBuffer.wrap(header)
            val width = h.int
            val height = h.int
            val depth = h.get().toInt() and 255
            val color = h.get().toInt() and 255
            require(
                width > 0 &&
                    height > 0 &&
                    width.toLong() * height <= 100_000_000 &&
                    depth in listOf(8, 16) &&
                    color in listOf(0, 2, 4, 6)
            )
            require(h.get().toInt() == 0 && h.get().toInt() == 0 && h.get().toInt() == 0) {
                "인터레이스 HDR PNG는 지원하지 않습니다."
            }
            val channels =
                when (color) {
                    0 -> 1
                    2 -> 3
                    4 -> 2
                    else -> 4
                }
            val unit = depth / 8
            val pixelBytes = channels * unit
            val crop = region ?: Rect(0, 0, width, height)
            require(
                crop.left >= 0 &&
                    crop.top >= 0 &&
                    crop.right <= width &&
                    crop.bottom <= height &&
                    crop.width() > 0 &&
                    crop.height() > 0
            )
            val factor =
                if (maxSide > 0) min(1.0, maxSide.toDouble() / max(crop.width(), crop.height()))
                else 1.0
            val ow = max(1, (crop.width() * factor).roundToInt())
            val oh = max(1, (crop.height() * factor).roundToInt())
            require(ow.toLong() * oh <= 8_000_000) { "HDR 이미지 해독 영역이 너무 큽니다." }
            val pixels = ByteBuffer.allocateDirect(ow * oh * 8).order(ByteOrder.nativeOrder())
            var previous = ByteArray(width * pixelBytes)
            var row = ByteArray(previous.size)
            var nextY = 0
            val ys =
                IntArray(oh) {
                    crop.top + min(crop.height() - 1, floor((it + .5) * crop.height() / oh).toInt())
                }
            val xs =
                IntArray(ow) {
                    crop.left + min(crop.width() - 1, floor((it + .5) * crop.width() / ow).toInt())
                }
            DataInputStream(InflaterInputStream(IDATStream(input))).use { zipped ->
                for (y in 0..ys.last()) {
                    val filter = zipped.readUnsignedByte()
                    zipped.readFully(row)
                    for (i in row.indices) {
                        val left = if (i >= pixelBytes) row[i - pixelBytes].toInt() and 255 else 0
                        val up = previous[i].toInt() and 255
                        val diagonal =
                            if (i >= pixelBytes) previous[i - pixelBytes].toInt() and 255 else 0
                        val predictor =
                            when (filter) {
                                0 -> 0
                                1 -> left
                                2 -> up
                                3 -> (left + up) / 2
                                4 -> paeth(left, up, diagonal)
                                else -> error("PNG 필터 형식 오류")
                            }
                        row[i] = ((row[i].toInt() and 255) + predictor).toByte()
                    }
                    while (nextY < oh && ys[nextY] == y) {
                        for (x in xs) {
                            val offset = x * pixelBytes
                            fun channel(index: Int): Double {
                                val p = offset + index * unit
                                return if (unit == 1) (row[p].toInt() and 255) / 255.0
                                else
                                    (((row[p].toInt() and 255) shl 8) +
                                        (row[p + 1].toInt() and 255)) / 65535.0
                            }
                            val r = pq(channel(0))
                            val g = if (channels < 3) r else pq(channel(1))
                            val b = if (channels < 3) r else pq(channel(2))
                            val a =
                                if (color == 4) channel(1) else if (color == 6) channel(3) else 1.0
                            val srgb =
                                doubleArrayOf(
                                    1.660491 * r - .587641 * g - .07285 * b,
                                    -.12455 * r + 1.1329 * g - .008349 * b,
                                    -.018151 * r - .100579 * g + 1.11873 * b,
                                )
                            srgb.forEach {
                                pixels.putShort(Half.toHalf((encode(it) * a).toFloat()))
                            }
                            pixels.putShort(Half.toHalf(a.toFloat()))
                        }
                        nextY++
                    }
                    val swap = previous
                    previous = row
                    row = swap
                }
            }
            pixels.position(0)
            return Bitmap.createBitmap(
                    ow,
                    oh,
                    Bitmap.Config.RGBA_F16,
                    true,
                    ColorSpace.get(ColorSpace.Named.EXTENDED_SRGB),
                )
                .also { it.copyPixelsFromBuffer(pixels) }
        }
    }

    private fun pq(v: Double): Double {
        val p = v.pow(32.0 / 2523)
        return (max(0.0, p - 3424.0 / 4096) / (2413.0 / 128 - 2392.0 / 128 * p)).pow(
            16384.0 / 2610
        ) * 10000 / 203
    }

    private fun encode(v: Double): Double =
        sign(v) * (if (abs(v) <= .0031308) abs(v) * 12.92 else 1.055 * abs(v).pow(1 / 2.4) - .055)

    private fun paeth(a: Int, b: Int, c: Int): Int {
        val p = a + b - c
        val pa = abs(p - a)
        val pb = abs(p - b)
        val pc = abs(p - c)
        return if (pa <= pb && pa <= pc) a else if (pb <= pc) b else c
    }

    private class IDATStream(val input: DataInputStream) : InputStream() {
        private var remaining = 0
        private var done = false
        private var crc = CRC32()
        private var started = false

        private fun advance(): Boolean {
            if (started) {
                require(input.readInt().toLong().and(0xffffffffL) == crc.value) { "PNG 데이터 체크섬 오류" }
                started = false
            }
            while (!done) {
                val count = input.readInt()
                require(count >= 0 && count <= 256 * 1024 * 1024)
                val type = ByteArray(4)
                input.readFully(type)
                val name = String(type, Charsets.US_ASCII)
                if (name == "IDAT") {
                    remaining = count
                    crc = CRC32().also { it.update(type) }
                    started = true
                    if (count > 0) return true
                    require(input.readInt().toLong().and(0xffffffffL) == crc.value)
                    started = false
                } else {
                    var skip = count.toLong() + 4
                    while (skip > 0) {
                        val n = input.skip(skip)
                        if (n == 0L) {
                            input.readByte()
                            skip--
                        } else skip -= n
                    }
                    if (name == "IEND") done = true
                }
            }
            return false
        }

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 255
        }

        override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            if (remaining == 0 && !advance()) return -1
            val n = input.read(bytes, offset, min(length, remaining))
            if (n < 0) throw EOFException()
            remaining -= n
            crc.update(bytes, offset, n)
            return n
        }

        override fun close() {
            input.close()
        }
    }
}
