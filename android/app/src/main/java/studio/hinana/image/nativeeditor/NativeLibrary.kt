package studio.hinana.image.nativeeditor

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

class NativePhoto(
    val id: String,
    var name: String,
    val file: String,
    val width: Int,
    val height: Int,
    var rating: Int = 0,
    var settings: JSONObject = defaults(),
) {
    var rawFile: String? = null
    var metadata = JSONObject()
    val history = mutableListOf<String>()
    var cursor = -1

    fun checkpoint() {
        while (history.size > cursor + 1) history.removeAt(history.lastIndex)
        history.add(archive(settings))
        cursor = history.lastIndex
        if (history.size > 30) {
            history.removeAt(0)
            cursor--
        }
    }

    fun manifest() =
        JSONObject()
            .put("id", id)
            .put("name", name)
            .put("file", file)
            .put("width", width)
            .put("height", height)
            .put("rating", rating)
            .put("adjustments", settings)
            .put("metadata", metadata)
            .put("undo", JSONArray(history))
            .put("undoCursor", cursor)
            .also { rawFile?.let { raw -> it.put("rawFile", raw) } }

    companion object {
        fun archive(settings: JSONObject): String {
            val bytes = java.io.ByteArrayOutputStream()
            java.util.zip.GZIPOutputStream(bytes).use {
                it.write(settings.toString().toByteArray())
            }
            return android.util.Base64.encodeToString(
                bytes.toByteArray(),
                android.util.Base64.NO_WRAP,
            )
        }

        fun unarchive(value: String): JSONObject {
            val packed = android.util.Base64.decode(value, android.util.Base64.DEFAULT)
            val out = java.io.ByteArrayOutputStream()
            java.util.zip.GZIPInputStream(packed.inputStream()).use { input ->
                val buffer = ByteArray(8192)
                var count = 0
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    count += n
                    require(count <= 32 * 1024 * 1024)
                    out.write(buffer, 0, n)
                }
            }
            return NativeValidation.settings(JSONObject(out.toString("UTF-8")))
        }

        val bands = listOf("red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta")

        fun defaults(): JSONObject {
            val a =
                JSONObject()
                    .put("colorSpace", "srgb")
                    .put("precision", "float")
                    .put("dynamicRange", "sdr")
                    .put("hdrPeak", 1000)
                    .put("crop", "original")
                    .put("flip", false)
                    .put("masks", JSONArray())
                    .put("liquify", JSONObject.NULL)
            listOf(
                    "exposure",
                    "contrast",
                    "highlights",
                    "shadows",
                    "whites",
                    "blacks",
                    "temperature",
                    "tint",
                    "vibrance",
                    "saturation",
                    "fade",
                    "vignette",
                    "rotation",
                    "hdrHighlights",
                    "skinSmooth",
                    "skinRedness",
                    "skinBrightness",
                    "curveShadows",
                    "curveMidtones",
                    "curveHighlights",
                )
                .forEach { a.put(it, 0.0) }
            bands.forEach { b ->
                listOf("hue", "saturation", "luminance").forEach { a.put("mixer_${b}_$it", 0.0) }
            }
            return a
        }
    }
}

class NativeLibrary(private val context: Context, rootDirectory: File? = null) {
    val root = (rootDirectory ?: File(context.filesDir, "NativeImageLibrary")).also { it.mkdirs() }
    val work = Executors.newSingleThreadExecutor()
    val photos = mutableListOf<NativePhoto>()
    var restoreError: String? = null
    var onError: ((String) -> Unit)? = null
    var selected = ""
    val current
        get() = photos.firstOrNull { it.id == selected }

    val manifest = File(root, "workspace.json")

    init {
        try {
            if (manifest.exists()) {
                val json = JSONObject(manifest.readText())
                val items = json.getJSONArray("photos")
                for (i in 0 until items.length()) {
                    val v = items.getJSONObject(i)
                    val file = v.getString("file")
                    require(File(file).name == file)
                    if (File(root, file).exists())
                        photos.add(
                            NativePhoto(
                                    v.getString("id"),
                                    v.getString("name"),
                                    file,
                                    v.getInt("width"),
                                    v.getInt("height"),
                                    v.optInt("rating"),
                                    NativeValidation.settings(v.getJSONObject("adjustments")),
                                )
                                .also { p ->
                                    p.metadata = v.optJSONObject("metadata") ?: JSONObject()
                                    v.optJSONArray("undo")?.let { frames ->
                                        require(frames.length() <= 30)
                                        for (index in 0 until frames.length()) {
                                            val frame = frames.getString(index)
                                            NativePhoto.unarchive(frame)
                                            p.history.add(frame)
                                        }
                                        p.cursor =
                                            v.optInt("undoCursor")
                                                .coerceIn(0, maxOf(0, p.history.size - 1))
                                    }
                                    p.rawFile = v.optString("rawFile").takeIf { it.isNotEmpty() }
                                    p.rawFile?.let { require(File(it).name == it) }
                                }
                        )
                }
                selected = json.optString("selected")
                if (current == null) selected = photos.firstOrNull()?.id ?: ""
            }
        } catch (e: Exception) {
            photos.clear()
            selected = ""
            restoreError = "저장된 작업 공간을 읽지 못했습니다. 기존 저장 파일은 보존됩니다. ${e.message}"
        }
    }

    fun persist(removing: List<String> = emptyList()) {
        val retained = photos.flatMap { listOfNotNull(it.file, it.rawFile) }.toSet()
        if (restoreError != null || work.isShutdown) return
        val data =
            JSONObject()
                .put("version", 1)
                .put("selected", selected)
                .put("photos", JSONArray(photos.map { it.manifest() }))
                .toString()
        work.execute {
            try {
                val temp = File(root, "workspace.tmp")
                temp.writeText(data)
                check(temp.renameTo(manifest)) { "자동 저장 파일 교체 실패" }
                removing
                    .filter { it !in retained && File(it).name == it }
                    .forEach { File(root, it).delete() }
            } catch (e: Exception) {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    onError?.invoke("자동 저장 실패: ${e.message}")
                }
            }
        }
    }

    /** UI-owned model changes; workers publish completed imports atomically on the main thread. */
    fun publish(action: () -> Unit) {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            action()
            return
        }
        val latch = java.util.concurrent.CountDownLatch(1)
        var failure: Throwable? = null
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            try {
                action()
            } catch (e: Throwable) {
                failure = e
            } finally {
                latch.countDown()
            }
        }
        latch.await()
        failure?.let { throw it }
    }

    fun addPhotos(imported: List<NativePhoto>) {
        publish {
            photos.addAll(imported)
            selected = imported.firstOrNull()?.id ?: selected
            persist()
        }
    }

    fun remove(id: String) {
        val removed = photos.filter { it.id == id }.flatMap { listOfNotNull(it.file, it.rawFile) }
        photos.removeAll { it.id == id }
        if (current == null) selected = photos.firstOrNull()?.id ?: ""
        persist(removed)
    }

    fun copyPhoto(uri: Uri): NativePhoto {
        val resolver = context.contentResolver
        var name = "Photo"
        resolver
            .query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) name = it.getString(0) }
        val extension =
            File(name).extension.ifEmpty {
                when (resolver.getType(uri)) {
                    "image/heic" -> "heic"
                    "image/png" -> "png"
                    "image/webp" -> "webp"
                    else -> "jpg"
                }
            }
        val file = UUID.randomUUID().toString() + "." + extension
        val target = File(root, file)
        try {
            resolver.openInputStream(uri)!!.use { input ->
                target.outputStream().use { out ->
                    val buffer = ByteArray(65536)
                    var count = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        count += n
                        require(count <= 256L * 1024 * 1024) { "사진은 256MB 이하를 지원합니다." }
                        out.write(buffer, 0, n)
                    }
                }
            }
            val info = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
            BitmapFactory.decodeFile(target.path, info)
            require(
                info.outWidth > 0 &&
                    info.outHeight > 0 &&
                    info.outWidth.toLong() * info.outHeight <= 100_000_000
            ) {
                "지원되는 이미지인지 확인해 주세요. 최대 100MP입니다."
            }
            val exif = runCatching { ExifInterface(target) }.getOrNull()
            val orientation = exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) ?: 1
            val a = NativePhoto.defaults()
            if (android.os.Build.VERSION.SDK_INT >= 26)
                a.put(
                    "sourceGainP3",
                    info.outColorSpace ==
                        android.graphics.ColorSpace.get(
                            android.graphics.ColorSpace.Named.DISPLAY_P3
                        ),
                )
            a.put("sourceOrientation", orientation)
            if (NativeExport.isHDR(target))
                a.put("dynamicRange", "hdr").put("colorSpace", "display-p3")
            return NativePhoto(
                UUID.randomUUID().toString(),
                name,
                file,
                if (orientation in 5..8) info.outHeight else info.outWidth,
                if (orientation in 5..8) info.outWidth else info.outHeight,
                settings = a,
            )
        } catch (e: Exception) {
            target.delete()
            throw e
        }
    }

    fun importProject(file: File) {
        require(file.length() <= 512L * 1024 * 1024) { "프로젝트는 512MB 이하를 지원합니다." }
        val json = JSONObject(file.readText())
        require(json.getInt("version") in 1..6)
        val items = json.getJSONArray("photos")
        require(items.length() <= 200)
        val imported = mutableListOf<NativePhoto>()
        val ids = mutableSetOf<String>()
        for (i in 0 until items.length()) {
            val v = items.getJSONObject(i)
            val id = v.getString("id")
            require(ids.add(id))
            val source = v.getString("src")
            val prefix = source.substringBefore(',')
            require(
                prefix in
                    listOf(
                        "data:image/png;base64",
                        "data:image/jpeg;base64",
                        "data:image/webp;base64",
                    )
            )
            val ext =
                if (prefix.contains("png")) "png"
                else if (prefix.contains("webp")) "webp" else "jpg"
            val filename = UUID.randomUUID().toString() + "." + ext
            File(root, filename)
                .writeBytes(
                    android.util.Base64.decode(
                        source.substringAfter(','),
                        android.util.Base64.DEFAULT,
                    )
                )
            val a = NativeValidation.settings(v.getJSONObject("adjustments"))
            val w = v.getInt("width")
            val h = v.getInt("height")
            require(w > 0 && h > 0 && w.toLong() * h <= 100_000_000)
            val p =
                NativePhoto(
                    id,
                    v.getString("name"),
                    filename,
                    w,
                    h,
                    v.optInt("rating").coerceIn(0, 5),
                    a,
                )
            p.metadata = v.optJSONObject("metadata") ?: JSONObject()
            if (v.has("rawSource")) {
                val raw = v.getString("rawSource")
                require(
                    raw.startsWith("data:application/octet-stream;base64,") &&
                        raw.length <= 358_000_000
                )
                p.rawFile =
                    UUID.randomUUID().toString() + "." + File(p.name).extension.ifEmpty { "dng" }
                File(root, p.rawFile!!)
                    .writeBytes(
                        android.util.Base64.decode(
                            raw.substringAfter(','),
                            android.util.Base64.DEFAULT,
                        )
                    )
            }
            imported.add(p)
        }
        publish {
            restoreError = null
            photos.clear()
            photos.addAll(imported)
            selected = json.optString("selected")
            if (current == null) selected = photos.firstOrNull()?.id ?: ""
        }
    }

    fun project(): File {
        val out = File(context.cacheDir, "Hinana-Workspace.hinanaimage")
        out.bufferedWriter().use { writer ->
            writer.write("{\"version\":6,\"selected\":${JSONObject.quote(selected)},\"photos\":[")
            photos.forEachIndexed { i, p ->
                if (i > 0) writer.write(",")
                val v = p.manifest()
                v.remove("file")
                v.remove("rawFile")
                v.remove("undo")
                v.remove("undoCursor")
                v.put("history", JSONArray()).put("cursor", 0)
                val mime =
                    when (File(p.file).extension.lowercase()) {
                        "jpg",
                        "jpeg" -> "jpeg"
                        "png" -> "png"
                        "webp" -> "webp"
                        else -> "png"
                    }
                val bytes =
                    if (File(p.file).extension.lowercase() in listOf("png", "jpg", "jpeg", "webp"))
                        File(root, p.file).readBytes()
                    else NativeExport.originalPNG(context, this, p)
                v.put(
                    "src",
                    "data:image/$mime;base64," +
                        android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP),
                )
                p.rawFile?.let {
                    v.put(
                        "rawSource",
                        "data:application/octet-stream;base64," +
                            android.util.Base64.encodeToString(
                                File(root, it).readBytes(),
                                android.util.Base64.NO_WRAP,
                            ),
                    )
                }
                writer.write(v.toString())
            }
            writer.write("]}")
        }
        return out
    }
}
