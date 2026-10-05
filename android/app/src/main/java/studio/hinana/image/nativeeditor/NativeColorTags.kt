package studio.hinana.image.nativeeditor

import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Bitmap compression does not describe the shader's chosen output gamut. */
object NativeColorTags {
    fun embed(file: File, profile: ByteArray, width: Int, height: Int) {
        val input = file.readBytes()
        val output =
            if (file.extension == "webp") webP(input, profile, width, height)
            else jpeg(input, profile)
        file.writeBytes(output)
    }

    private fun jpeg(input: ByteArray, profile: ByteArray): ByteArray {
        require(input.size >= 2 && input[0] == 255.toByte() && input[1] == 216.toByte())
        val output = ByteArrayOutputStream()
        output.write(input, 0, 2)
        val chunks = (profile.size + 65518) / 65519
        for (index in 0 until chunks) {
            val first = index * 65519
            val size = minOf(65519, profile.size - first)
            val length = size + 16
            output.write(255)
            output.write(226)
            output.write(length ushr 8)
            output.write(length and 255)
            output.write("ICC_PROFILE\u0000".toByteArray())
            output.write(index + 1)
            output.write(chunks)
            output.write(profile, first, size)
        }
        // Native Bitmap JPEGs have no ICC profile; retain all their coding and EXIF segments.
        output.write(input, 2, input.size - 2)
        return output.toByteArray()
    }

    private fun webP(input: ByteArray, profile: ByteArray, width: Int, height: Int): ByteArray {
        require(input.size >= 12 && String(input, 0, 4) == "RIFF")
        val payload = ByteArrayOutputStream()
        var oldExtended: ByteArray? = null
        val image = ByteArrayOutputStream()
        var index = 12
        var alpha = false
        while (index + 8 <= input.size) {
            val type = String(input, index, 4)
            val size = ByteBuffer.wrap(input, index + 4, 4).order(ByteOrder.LITTLE_ENDIAN).int
            require(size >= 0 && index + 8L + size <= input.size)
            if (type == "VP8X") oldExtended = input.copyOfRange(index + 8, index + 8 + size)
            else if (type != "ICCP") {
                image.write(input, index, 8 + size + (size and 1))
                if (type == "ALPH") alpha = true
            }
            index += 8 + size + (size and 1)
        }
        fun chunk(type: String, bytes: ByteArray) {
            payload.write(type.toByteArray())
            payload.write(
                ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(bytes.size).array()
            )
            payload.write(bytes)
            if (bytes.size % 2 == 1) payload.write(0)
        }
        val extended =
            oldExtended
                ?: ByteArray(10).also { a ->
                    a[0] = (if (alpha) 16 else 0).toByte()
                    for ((i, value) in listOf(width - 1, height - 1).withIndex()) for (byte in
                        0..2) a[4 + i * 3 + byte] = (value ushr (byte * 8)).toByte()
                }
        require(extended.size == 10)
        extended[0] = (extended[0].toInt() or 32).toByte()
        chunk("VP8X", extended)
        chunk("ICCP", profile)
        payload.write(image.toByteArray())
        return "RIFF".toByteArray() +
            ByteBuffer.allocate(4)
                .order(ByteOrder.LITTLE_ENDIAN)
                .putInt(payload.size() + 4)
                .array() +
            "WEBP".toByteArray() +
            payload.toByteArray()
    }
}
