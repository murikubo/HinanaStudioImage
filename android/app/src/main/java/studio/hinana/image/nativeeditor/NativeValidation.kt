package studio.hinana.image.nativeeditor

import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

object NativeValidation {
    fun settings(input: JSONObject): JSONObject {
        val a = NativePhoto.defaults()
        a.put("precision", "legacy")
        input.keys().forEach { a.put(it, input.get(it)) }
        require(
            a.optString("colorSpace") in listOf("srgb", "display-p3") &&
                a.optString("precision") in listOf("legacy", "float") &&
                a.optString("dynamicRange") in listOf("sdr", "hdr") &&
                a.optDouble("hdrPeak") in listOf(400.0, 1000.0, 2000.0, 4000.0) &&
                (a.optString("dynamicRange") != "hdr" || a.optString("precision") == "float")
        ) {
            "지원하지 않는 보정 설정입니다."
        }
        require(
            a.optString("crop") in listOf("original", "1:1", "4:5", "3:2", "16:9") &&
                a.optDouble("rotation") in listOf(0.0, 90.0, 180.0, 270.0) &&
                a.get("flip") is Boolean
        )
        NativePhoto.defaults().keys().forEach { key ->
            if (
                NativePhoto.defaults().get(key) is Number && key !in listOf("rotation", "hdrPeak")
            ) {
                require(a.get(key) is Number)
                val n = a.getDouble(key)
                require(n.isFinite() && abs(n) <= if (key == "exposure") 3 else 100)
                if (key.startsWith("skin") || key == "hdrHighlights") require(n >= 0)
            }
        }
        NativeLiquify(a.optJSONObject("liquify"))
        require(a.isNull("liquify") || a.opt("liquify") is JSONObject)
        val masks = a.getJSONArray("masks")
        require(masks.length() <= 8)
        val ids = mutableSetOf<String>()
        fun points(values: JSONArray, limit: Int) {
            require(values.length() <= limit)
            for (i in 0 until values.length()) {
                val p = values.getJSONObject(i)
                require(p.getDouble("x") in 0.0..1.0 && p.getDouble("y") in 0.0..1.0)
            }
        }
        for (i in 0 until masks.length()) {
            val m = masks.getJSONObject(i)
            require(
                ids.add(m.getString("id")) &&
                    m.getString("id").length <= 80 &&
                    m.getString("name").length <= 80
            )
            val kind = m.getString("kind")
            require(
                kind in listOf("brush", "linear", "radial", "subject") &&
                    m.get("enabled") is Boolean &&
                    m.get("inverted") is Boolean
            )
            val ps = m.getJSONArray("points")
            points(ps, if (kind == "subject") 32 else 1024)
            if (kind == "linear" || kind == "radial") require(ps.length() == 2)
            require(
                m.getDouble("radius") in .005..0.5 &&
                    m.getDouble("feather") in 0.0..1.0 &&
                    m.getDouble("opacity") in 0.0..1.0 &&
                    abs(m.getDouble("exposure")) <= 3
            )
            listOf("contrast", "saturation", "temperature").forEach {
                require(abs(m.getDouble(it)) <= 100)
            }
            if (m.has("raster")) {
                val raster = m.getJSONObject("raster")
                val w = raster.getInt("width")
                val h = raster.getInt("height")
                require(
                    kind == "subject" &&
                        w in 1..1024 &&
                        h in 1..1024 &&
                        raster.getString("data").length <= 1_398_104 &&
                        android.util.Base64.decode(
                                raster.getString("data"),
                                android.util.Base64.DEFAULT,
                            )
                            .size == w * h
                )
            }
            if (kind == "subject" && ps.length() > 0)
                require(!ps.getJSONObject(0).optBoolean("exclude") && m.has("raster"))
            if (m.has("strokes")) {
                val strokes = m.getJSONArray("strokes")
                require(kind == "subject" && m.has("raster") && strokes.length() <= 128)
                var count = 0
                for (j in 0 until strokes.length()) {
                    val stroke = strokes.getJSONObject(j)
                    val path = stroke.getJSONArray("points")
                    points(path, 4096)
                    count += path.length()
                    require(
                        path.length() > 0 &&
                            count <= 4096 &&
                            stroke.get("erase") is Boolean &&
                            stroke.getDouble("radius") in .005..0.5 &&
                            stroke.getDouble("feather") in 0.0..1.0
                    )
                }
            }
        }
        return a
    }
}
