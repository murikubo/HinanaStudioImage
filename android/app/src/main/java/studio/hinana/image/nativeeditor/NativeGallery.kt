package studio.hinana.image.nativeeditor

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/** Publishes the encoded export without decoding it, preserving HDR and EXIF bytes. */
object NativeGallery {
    fun mime(file: File): String =
        when (file.extension.lowercase()) {
            "jpg",
            "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            else -> error("갤러리에 저장할 수 없는 이미지 형식입니다.")
        }

    fun save(context: Context, file: File): Uri {
        val type = mime(file)
        if (Build.VERSION.SDK_INT >= 29) {
            val resolver = context.contentResolver
            val values =
                ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, file.name)
                    put(MediaStore.Images.Media.MIME_TYPE, type)
                    put(
                        MediaStore.Images.Media.RELATIVE_PATH,
                        "${Environment.DIRECTORY_PICTURES}/Hinana Studio Image",
                    )
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            val uri =
                resolver.insert(
                    MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                    values,
                ) ?: error("갤러리에 저장 공간을 만들지 못했습니다.")
            try {
                checkNotNull(resolver.openOutputStream(uri, "w")) { "이미지 파일을 쓰지 못했습니다." }
                    .use { output -> file.inputStream().use { it.copyTo(output) } }
                check(
                    resolver.update(
                        uri,
                        ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) },
                        null,
                        null,
                    ) == 1
                ) {
                    "갤러리에 이미지를 표시하지 못했습니다."
                }
                return uri
            } catch (e: Exception) {
                try {
                    resolver.delete(uri, null, null)
                } catch (_: Exception) {}
                throw e
            }
        }
        @Suppress("DEPRECATION")
        val folder =
            File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "Hinana Studio Image",
            )
        check(folder.isDirectory || folder.mkdirs()) { "갤러리 폴더를 만들지 못했습니다." }
        val target =
            File.createTempFile(file.nameWithoutExtension + "-", ".${file.extension}", folder)
        try {
            file.inputStream().use { input -> target.outputStream().use { input.copyTo(it) } }
            MediaScannerConnection.scanFile(context, arrayOf(target.path), arrayOf(type), null)
            return Uri.fromFile(target)
        } catch (e: Exception) {
            target.delete()
            throw e
        }
    }
}
