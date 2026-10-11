package studio.hinana.image.nativeeditor

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.os.Build
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Vulkan resources are owned exclusively by the canvas render thread or export worker. */
class NativeVulkan(assets: AssetManager, surface: Surface? = null, wantsHDR: Boolean = false) {
    private val slots = linkedMapOf<String, Int>()
    private val buffer: ByteBuffer
    private var handle: Long = 0
    private var textureSlot = 0
    val isWindow = surface != null
    val hdrActive
        get() = hdr(handle)

    val maxTextureSize
        get() = limit(handle)

    init {
        var index = 0
        Regex("uniform (float|int|vec[234]) (\\w+)(\\[8\\])?;")
            .findAll(NativeShaders.fragment)
            .forEach {
                slots[it.groupValues[2]] = index
                index += if (it.groupValues[3].isEmpty()) 1 else 8
            }
        buffer = ByteBuffer.allocateDirect(index * 16).order(ByteOrder.nativeOrder())
        handle = create(assets, surface, wantsHDR, buffer.capacity())
    }

    fun set(name: String, vararg values: Float) {
        val start = (slots[name] ?: error("Unknown shader parameter $name")) * 16
        values.forEachIndexed { index, value -> buffer.putFloat(start + index * 4, value) }
    }

    fun array(name: String, values: FloatArray, components: Int) {
        val start = (slots[name] ?: error("Unknown shader parameter $name")) * 16
        values.forEachIndexed { index, value ->
            buffer.putFloat(start + index / components * 16 + index % components * 4, value)
        }
    }

    fun snapshot() =
        ByteArray(buffer.capacity()).also {
            buffer.position(0)
            buffer.get(it)
            buffer.position(0)
        }

    fun restore(bytes: ByteArray) {
        buffer.position(0)
        buffer.put(bytes)
        buffer.position(0)
    }

    fun bind(index: Int) {
        textureSlot = index
    }

    fun uploadBitmap(bitmap: Bitmap) {
        if (
            bitmap.config != Bitmap.Config.ALPHA_8 &&
                bitmap.config != Bitmap.Config.ARGB_8888 &&
                !(Build.VERSION.SDK_INT >= 26 && bitmap.config == Bitmap.Config.RGBA_F16)
        ) {
            val copy = checkNotNull(bitmap.copy(Bitmap.Config.ARGB_8888, false))
            try {
                uploadBitmap(copy)
            } finally {
                copy.recycle()
            }
            return
        }
        uploadBitmapNative(handle, textureSlot, bitmap)
    }

    fun uploadBytes(
        index: Int,
        width: Int,
        height: Int,
        format: Int,
        stride: Int,
        data: ByteBuffer,
    ) {
        upload(handle, index, width, height, format, stride, data)
    }

    fun resize(width: Int, height: Int) = resize(handle, width, height)

    fun draw(width: Int, height: Int, screen: Boolean = isWindow, offscreenTransform: Int = 1) =
        draw(handle, width, height, buffer, screen, offscreenTransform)

    fun pixels(data: ByteBuffer) = pixels(handle, data)

    fun swapSources() = swapSources(handle)

    fun destroy() {
        if (handle != 0L) {
            close(handle)
            handle = 0
        }
    }

    private external fun create(
        assets: AssetManager,
        surface: Surface?,
        hdr: Boolean,
        bytes: Int,
    ): Long

    private external fun uploadBitmapNative(handle: Long, index: Int, bitmap: Bitmap)

    private external fun close(handle: Long)

    private external fun upload(
        handle: Long,
        index: Int,
        width: Int,
        height: Int,
        format: Int,
        stride: Int,
        data: ByteBuffer,
    )

    private external fun resize(handle: Long, width: Int, height: Int)

    private external fun hdr(handle: Long): Boolean

    private external fun limit(handle: Long): Int

    private external fun draw(
        handle: Long,
        width: Int,
        height: Int,
        values: ByteBuffer,
        screen: Boolean,
        transform: Int,
    )

    private external fun pixels(handle: Long, data: ByteBuffer)

    private external fun swapSources(handle: Long)

    companion object {
        init {
            System.loadLibrary("hinana_vulkan")
        }
    }
}
