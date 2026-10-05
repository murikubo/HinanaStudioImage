package studio.hinana.image

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import java.io.File
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject
import studio.hinana.image.nativeeditor.*

class MainActivity : AppCompatActivity() {
    private lateinit var library: NativeLibrary
    private lateinit var root: LinearLayout
    private lateinit var body: LinearLayout
    private lateinit var canvas: NativeCanvas
    private lateinit var controls: LinearLayout
    private var libraryVisible = false
    private var migrating = false
    private var starsOnly = false
    private var showOverlay = true
    private var selectedPanel = "편집"
    private var selectedMask = ""
    private var tool = "add"
    private var comparing = false
    private lateinit var bottom: LinearLayout
    private var panelTabs: LinearLayout? = null
    private val muted = Color.rgb(137, 145, 146)
    private val accent = Color.rgb(207, 223, 178)

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setTheme(R.style.AppTheme_NoActionBar)
        library = NativeLibrary(this)
        library.onError = { alert(it) }
        migrating = !library.manifest.exists()
        root =
            LinearLayout(this).also {
                it.orientation = LinearLayout.VERTICAL
                it.setBackgroundColor(Color.rgb(20, 23, 24))
            }
        setContentView(root)
        library.restoreError?.let { alert(it) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val system = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(system.left, system.top, system.right, system.bottom)
            insets
        }
        val header = row()
        header.addView(
            ImageView(this).also {
                it.setImageBitmap(
                    assets.open("app-icon.png").use { stream ->
                        BitmapFactory.decodeStream(
                            stream,
                            null,
                            BitmapFactory.Options().also { options -> options.inSampleSize = 16 },
                        )
                    }
                )
                it.contentDescription = "Hinana Studio Image"
            },
            LinearLayout.LayoutParams(dp(32), dp(32)),
        )
        header.addView(
            TextView(this).also {
                it.text = "HINANA\nStudio Image"
                it.setPadding(dp(8), 0, 0, 0)
                it.gravity = Gravity.CENTER_VERTICAL
                it.setTextColor(Color.rgb(213, 216, 215))
                it.textSize = 12f
            },
            LinearLayout.LayoutParams(0, dp(52), 1f),
        )
        header.addView(iconButton("열기") { pick(true) })
        header.addView(
            iconButton("ⓘ") {
                alert(
                    "HINANA Studio Image\nVer. ${BuildConfig.VERSION_NAME}\n개발/제작자 비나래\n네이티브 GPU 편집기"
                )
            }
        )
        header.addView(iconButton("저장") { job { share(library.project()) } })
        header.addView(iconButton("내보내기") { exportDialog() })
        header.setBackgroundColor(Color.rgb(27, 29, 30))
        root.addView(header, LinearLayout.LayoutParams(-1, dp(60)))
        root.addView(divider())
        body = LinearLayout(this).also { it.orientation = LinearLayout.VERTICAL }
        root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        bottom = row()
        bottom.setBackgroundColor(Color.rgb(27, 29, 30))
        root.addView(divider())
        root.addView(bottom, LinearLayout.LayoutParams(-1, dp(64)))
        updateNavigation()
        if (migrating) body.addView(text("기존 작업 공간을 네이티브 저장소로 옮기는 중…"))
        if (!library.manifest.exists())
            LegacyMigration(
                    this,
                    library,
                    {
                        migrating = false
                        enableButtons(root)
                        showEditor()
                    },
                )
                .start(root)
        else showEditor()
    }

    private fun enableButtons(view: View) {
        if (view is Button) view.isEnabled = true
        if (view is android.view.ViewGroup)
            for (i in 0 until view.childCount) enableButtons(view.getChildAt(i))
    }

    private fun dp(n: Int) = (n * resources.displayMetrics.density).roundToInt()

    private fun row() =
        LinearLayout(this).also {
            it.orientation = LinearLayout.HORIZONTAL
            it.gravity = Gravity.CENTER_VERTICAL
            it.setPadding(dp(8), 0, dp(8), 0)
        }

    private fun button(title: String, action: () -> Unit) =
        Button(this).also {
            it.isEnabled = !migrating
            it.text = title
            it.setTextColor(Color.rgb(185, 191, 187))
            it.textSize = 12f
            it.isAllCaps = false
            it.minWidth = 0
            it.minimumWidth = 0
            it.setPadding(dp(10), 0, dp(10), 0)
            it.setOnClickListener { action() }
            it.contentDescription = title
            val shape =
                GradientDrawable().also { d ->
                    d.setColor(Color.TRANSPARENT)
                    d.cornerRadius = dp(4).toFloat()
                    d.setStroke(dp(1), Color.rgb(60, 65, 62))
                }
            it.background =
                RippleDrawable(ColorStateList.valueOf(Color.argb(50, 207, 223, 178)), shape, null)
            val layout = LinearLayout.LayoutParams(-2, dp(42))
            layout.setMargins(dp(3), dp(3), dp(3), dp(3))
            it.layoutParams = layout
        }

    private fun divider() =
        View(this).also {
            it.setBackgroundColor(Color.rgb(48, 52, 53))
            it.layoutParams = LinearLayout.LayoutParams(-1, dp(1))
        }

    private fun iconButton(title: String, action: () -> Unit): Button =
        button(title, action).also {
            it.text = ""
            it.background = RippleDrawable(ColorStateList.valueOf(0x20ffffff), null, null)
            it.setCompoundDrawablesWithIntrinsicBounds(null, null, null, null)
            val icon = StudioIcon(title, muted).also { d -> d.setBounds(0, 0, dp(21), dp(21)) }
            it.setCompoundDrawables(icon, null, null, null)
            it.setPadding(dp(10), 0, dp(10), 0)
            it.layoutParams = LinearLayout.LayoutParams(dp(42), dp(44))
        }

    private fun updateNavigation() {
        if (!::bottom.isInitialized) return
        bottom.removeAllViews()
        listOf("사진 추가", "사진", "편집", "프리셋").forEach { title ->
            val active =
                if (title == "사진") libraryVisible
                else
                    !libraryVisible &&
                        (if (title == "프리셋") selectedPanel == title
                        else title == "편집" && selectedPanel != "프리셋")
            val item =
                button(title) {
                    when (title) {
                        "사진 추가" -> pick(false)
                        "사진" -> showLibrary()
                        else -> {
                            selectedPanel = title
                            showEditor()
                        }
                    }
                }
            val color = if (active) accent else muted
            item.setTextColor(color)
            val icon = StudioIcon(title, color).also { it.setBounds(0, 0, dp(22), dp(22)) }
            item.setCompoundDrawables(null, icon, null, null)
            item.compoundDrawablePadding = dp(5)
            item.gravity = Gravity.CENTER
            item.setPadding(0, dp(7), 0, dp(5))
            item.background =
                RippleDrawable(
                    ColorStateList.valueOf(0x20ffffff),
                    GradientDrawable().also {
                        it.setColor(if (active) Color.rgb(36, 40, 36) else Color.TRANSPARENT)
                    },
                    null,
                )
            bottom.addView(item, LinearLayout.LayoutParams(0, -1, 1f))
        }
    }

    private fun updateTabs() {
        val tabs = panelTabs ?: return
        for (i in 0 until tabs.childCount) {
            val tab = tabs.getChildAt(i) as Button
            val active = tab.contentDescription == selectedPanel
            val color = if (active) accent else muted
            tab.setTextColor(color)
            val icon =
                StudioIcon(tab.contentDescription.toString(), color).also {
                    it.setBounds(0, 0, dp(14), dp(14))
                }
            tab.setCompoundDrawables(icon, null, null, null)
            tab.compoundDrawablePadding = dp(4)
            tab.setPadding(dp(6), 0, dp(6), 0)
            tab.textSize = 11f
            tab.background =
                android.graphics.drawable
                    .LayerDrawable(
                        arrayOf(
                            GradientDrawable().also { it.setColor(Color.TRANSPARENT) },
                            GradientDrawable().also {
                                it.setColor(if (active) accent else Color.TRANSPARENT)
                            },
                        )
                    )
                    .also {
                        it.setLayerGravity(1, Gravity.BOTTOM)
                        it.setLayerHeight(1, dp(2))
                        it.setLayerInset(1, dp(12), 0, dp(12), 0)
                    }
        }
    }

    private fun styleSlider(bar: SeekBar) {
        bar.progressTintList = ColorStateList.valueOf(Color.rgb(129, 139, 134))
        bar.progressBackgroundTintList = ColorStateList.valueOf(Color.rgb(70, 76, 74))
        bar.splitTrack = false
        bar.thumb =
            GradientDrawable().also {
                it.shape = GradientDrawable.OVAL
                it.setSize(dp(13), dp(13))
                it.setColor(Color.rgb(30, 33, 32))
                it.setStroke(dp(2), Color.rgb(165, 177, 163))
            }
        bar.minimumHeight = dp(28)
    }

    private fun text(title: String) =
        TextView(this).also {
            it.text = title
            it.setTextColor(Color.LTGRAY)
            it.textSize = 13f
            it.setPadding(dp(10), dp(8), dp(10), dp(8))
        }

    private fun pick(project: Boolean) {
        val intent =
            Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(if (project) "*/*" else "image/*")
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, !project)
        startActivityForResult(intent, if (project) 101 else 100)
    }

    @Deprecated("Activity result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data == null) return
        val uris =
            if (data.clipData != null)
                (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri }
            else listOfNotNull(data.data)
        job {
            if (requestCode == 101) {
                val temp = File(cacheDir, "incoming.hinanaimage")
                contentResolver.openInputStream(uris.first())!!.use { input ->
                    temp.outputStream().use { input.copyTo(it) }
                }
                library.importProject(temp)
            } else {
                require(library.photos.size < 200) { "작업 공간은 최대 200장까지 지원합니다." }
                val added =
                    uris.take(minOf(20, 200 - library.photos.size)).map { library.copyPhoto(it) }
                library.addPhotos(added)
            }
            library.persist()
            runOnUiThread { showEditor() }
        }
    }

    private fun job(action: () -> Unit) {
        val busy =
            AlertDialog.Builder(this)
                .setTitle("처리 중…")
                .setView(ProgressBar(this))
                .setCancelable(false)
                .create()
        busy.show()
        library.work.execute {
            try {
                action()
            } catch (e: Exception) {
                runOnUiThread { alert(e.message ?: "작업 실패") }
            } finally {
                runOnUiThread { busy.dismiss() }
            }
        }
    }

    private fun alert(message: String) {
        AlertDialog.Builder(this)
            .setTitle("Hinana Studio Image")
            .setMessage(message)
            .setPositiveButton("확인", null)
            .show()
    }

    private fun share(file: File) {
        runOnUiThread {
            val uri =
                FileProvider.getUriForFile(this, "${BuildConfig.APPLICATION_ID}.fileprovider", file)
            startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND)
                        .setType(
                            if (file.extension == "hinanaimage")
                                "application/vnd.hinana.image-project"
                            else "image/${file.extension}"
                        )
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
                    "저장·공유",
                )
            )
        }
    }

    private fun showLibrary() {
        libraryVisible = true
        updateNavigation()
        if (::canvas.isInitialized) canvas.onPause()
        body.removeAllViews()
        val search =
            EditText(this).also {
                it.hint = "사진 검색"
                it.setTextColor(Color.WHITE)
            }
        body.addView(search)
        body.addView(
            button(if (starsOnly) "별표 사진만 · 켜짐" else "별표 사진만") {
                starsOnly = !starsOnly
                showLibrary()
            }
        )
        val recycler = RecyclerView(this)
        recycler.layoutManager =
            GridLayoutManager(this, if (resources.configuration.screenWidthDp >= 700) 4 else 2)
        val adapter =
            NativePhotoAdapter(
                library,
                {
                    library.selected = it.id
                    library.persist()
                    showEditor()
                },
                { photo ->
                    AlertDialog.Builder(this)
                        .setTitle("라이브러리에서 삭제")
                        .setMessage("${photo.name}\n사진과 보정 내역을 작업 공간에서 제거합니다. 원본 사진은 유지됩니다.")
                        .setNegativeButton("취소", null)
                        .setPositiveButton("삭제") { _, _ ->
                            library.remove(photo.id)
                            showLibrary()
                        }
                        .show()
                },
            )
        recycler.adapter = adapter
        body.addView(recycler, LinearLayout.LayoutParams(-1, 0, 1f))
        fun populate(query: String) {
            adapter.update(
                library.photos.filter {
                    it.name.contains(query, true) && (!starsOnly || it.rating > 0)
                }
            )
        }
        search.addTextChangedListener(
            object : android.text.TextWatcher {
                override fun beforeTextChanged(
                    s: CharSequence?,
                    start: Int,
                    count: Int,
                    after: Int,
                ) {}

                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    populate(s.toString())
                }

                override fun afterTextChanged(e: android.text.Editable?) {}
            }
        )
        populate("")
    }

    private fun showEditor() {
        libraryVisible = false
        updateNavigation()
        if (::canvas.isInitialized) canvas.onPause()
        body.removeAllViews()
        val p = library.current
        if (p == null) {
            body.addView(text("사진을 추가해 편집을 시작하세요."))
            return
        }
        val wide = resources.configuration.screenWidthDp >= 700
        val stage =
            LinearLayout(this).also {
                it.orientation = if (wide) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
            }
        body.addView(stage, LinearLayout.LayoutParams(-1, 0, 1f))
        val preview = LinearLayout(this).also { it.orientation = LinearLayout.VERTICAL }
        val tools = LinearLayout(this).also { it.orientation = LinearLayout.VERTICAL }
        stage.addView(
            preview,
            if (wide) LinearLayout.LayoutParams(0, -1, 1f)
            else LinearLayout.LayoutParams(-1, 0, 1.1f),
        )
        stage.addView(
            tools,
            if (wide) LinearLayout.LayoutParams(dp(330), -1)
            else LinearLayout.LayoutParams(-1, 0, 1f),
        )
        preview.addView(text("${p.name} · ${p.width} × ${p.height}"))
        canvas = NativeCanvas(this)
        canvas.error = { alert(it) }
        canvas.onStroke = { maskStroke(it) }
        canvas.selectedMask = if (selectedPanel == "마스크") selectedMask else ""
        preview.addView(canvas, LinearLayout.LayoutParams(-1, 0, 1f))
        canvas.load(library)
        val actions = row()
        actions.addView(
            iconButton("자르기") {
                choices("사진 비율", listOf("original", "1:1", "4:5", "3:2", "16:9")) {
                    edit { a -> a.put("crop", it) }
                }
            }
        )
        actions.addView(
            iconButton("회전") { edit { it.put("rotation", (it.optInt("rotation") + 90) % 360) } }
        )
        actions.addView(iconButton("반전") { edit { it.put("flip", !it.optBoolean("flip")) } })
        actions.addView(iconButton("↶") { undo(false) })
        actions.addView(iconButton("↷") { undo(true) })
        actions.addView(
            iconButton("원본") {
                comparing = !comparing
                canvas.changed(comparing, true)
            }
        )
        val zoomButton =
            button("맞춤") {
                choices("사진 확대", listOf("맞춤", "10%", "25%", "50%", "100%", "200%")) {
                    canvas.setZoom(it.removeSuffix("%").toIntOrNull() ?: 0)
                }
            }
        actions.addView(zoomButton)
        canvas.onZoom = { zoomButton.text = it }
        val actionScroll = HorizontalScrollView(this)
        actionScroll.addView(actions)
        preview.addView(actionScroll)
        val histogram = NativeHistogram(this)
        tools.addView(histogram, LinearLayout.LayoutParams(-1, dp(36)))
        canvas.onHistogram = { histogram.bins = it }
        val tabs = row()
        panelTabs = tabs
        listOf("편집", "색상·톤", "마스크", "정보").forEach { panel ->
            tabs.addView(
                button(panel) {
                    selectedPanel = panel
                    updateTabs()
                    updateNavigation()
                    showControls()
                },
                LinearLayout.LayoutParams(0, dp(44), 1f),
            )
        }
        tools.setBackgroundColor(Color.rgb(30, 32, 33))
        tools.addView(tabs)
        tools.addView(divider())
        updateTabs()
        val scroll = ScrollView(this)
        controls = LinearLayout(this).also { it.orientation = LinearLayout.VERTICAL }
        scroll.addView(controls)
        tools.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        showControls()
    }

    private fun undo(forward: Boolean) {
        val p = library.current ?: return
        val next = p.cursor + if (forward) 1 else -1
        if (next in p.history.indices) {
            p.cursor = next
            p.settings = NativePhoto.unarchive(p.history[next])
            library.persist()
            canvas.changed(false, true)
            showControls()
        }
    }

    private fun edit(action: (JSONObject) -> Unit) {
        val p = library.current ?: return
        if (p.history.isEmpty()) p.checkpoint()
        action(p.settings)
        p.checkpoint()
        library.persist()
        canvas.changed(comparing, true)
    }

    private fun choices(title: String, options: List<String>, done: (String) -> Unit) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setItems(options.toTypedArray()) { _, which -> done(options[which]) }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun slider(title: String, key: String, min: Double = -100.0, max: Double = 100.0) {
        val p = library.current ?: return
        val label =
            text("%.2f".format(p.settings.optDouble(key))).also {
                it.setTextColor(accent)
                it.gravity = Gravity.END
            }
        val labels = row()
        labels.addView(text(title), LinearLayout.LayoutParams(0, -2, 1f))
        labels.addView(label)
        controls.addView(labels)
        val bar = SeekBar(this)
        styleSlider(bar)
        bar.max = 1000
        bar.progress =
            (((p.settings.optDouble(key) - min) / (max - min)) * 1000)
                .roundToInt()
                .coerceIn(0, 1000)
        bar.contentDescription = title
        bar.setOnSeekBarChangeListener(
            object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(s: SeekBar?) {
                    if (p.history.isEmpty()) p.checkpoint()
                }

                override fun onProgressChanged(s: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    val value = min + (max - min) * progress / 1000
                    label.text = "%.2f".format(value)
                    p.settings.put(key, value)
                    canvas.changed(comparing, true)
                }

                override fun onStopTrackingTouch(s: SeekBar?) {
                    p.checkpoint()
                    library.persist()
                }
            }
        )
        controls.addView(bar)
    }

    private fun toggle(title: String, value: Boolean, done: (Boolean) -> Unit) {
        controls.addView(
            Switch(this).also {
                it.text = title
                it.setTextColor(Color.LTGRAY)
                it.isChecked = value
                it.setOnCheckedChangeListener { _, checked -> done(checked) }
            }
        )
    }

    private fun showControls() {
        controls.removeAllViews()
        canvas.selectedMask = if (selectedPanel == "마스크") selectedMask else ""
        val p = library.current ?: return
        when (selectedPanel) {
            "편집" -> {
                slider("노출", "exposure", -3.0, 3.0)
                listOf(
                        "대비" to "contrast",
                        "하이라이트" to "highlights",
                        "그림자" to "shadows",
                        "흰색" to "whites",
                        "검정" to "blacks",
                        "색온도" to "temperature",
                        "색조" to "tint",
                        "생동감" to "vibrance",
                        "채도" to "saturation",
                    )
                    .forEach { slider(it.first, it.second) }
                slider("페이드", "fade", 0.0, 100.0)
                slider("비네팅", "vignette", 0.0, 100.0)
                slider("피부 부드러움", "skinSmooth", 0.0, 100.0)
                slider("붉은 기 감소", "skinRedness", 0.0, 100.0)
                slider("피부 밝기", "skinBrightness", 0.0, 100.0)
                controls.addView(
                    button("작업 색공간 · ${p.settings.optString("colorSpace")}") {
                        choices("작업 색공간", listOf("srgb", "display-p3")) { value ->
                            edit { it.put("colorSpace", value) }
                            showControls()
                        }
                    }
                )
                controls.addView(
                    button("편집 정밀도 · ${p.settings.optString("precision")}") {
                        choices("편집 정밀도", listOf("float", "legacy")) { value ->
                            edit {
                                it.put("precision", value)
                                if (value == "legacy") it.put("dynamicRange", "sdr")
                            }
                            showControls()
                        }
                    }
                )
                toggle("HDR 편집", p.settings.optString("dynamicRange") == "hdr") { value ->
                    edit {
                        it.put("dynamicRange", if (value) "hdr" else "sdr")
                        if (value) it.put("precision", "float")
                    }
                    showControls()
                }
                if (p.settings.optString("dynamicRange") == "hdr") {
                    controls.addView(
                        button("HDR 최대 밝기") {
                            choices("HDR 최대 밝기", listOf("400", "1000", "2000", "4000")) { value ->
                                edit { it.put("hdrPeak", value.toInt()) }
                            }
                        }
                    )
                    slider("HDR 하이라이트 확장", "hdrHighlights", 0.0, 100.0)
                    controls.addView(text("현재 화면은 SDR 변환 미리보기입니다. HDR 데이터와 16비트 출력은 유지됩니다."))
                }
            }
            "색상·톤" -> {
                slider("어두운 영역", "curveShadows")
                slider("중간 영역", "curveMidtones")
                slider("밝은 영역", "curveHighlights")
                NativePhoto.bands
                    .zip(listOf("빨강", "주황", "노랑", "초록", "청록", "파랑", "보라", "자홍"))
                    .forEach { (band, name) ->
                        controls.addView(text(name))
                        listOf("hue", "saturation", "luminance")
                            .zip(listOf("색상", "채도", "명도"))
                            .forEach { (key, label) -> slider(label, "mixer_${band}_$key") }
                    }
            }
            "마스크" -> maskControls()
            "정보" -> {
                controls.addView(text(p.name))
                val exif = runCatching {
                    androidx.exifinterface.media.ExifInterface(File(library.root, p.file))
                }
                    .getOrNull()
                listOf(
                        "Make",
                        "Model",
                        "LensModel",
                        "DateTimeOriginal",
                        "ExposureTime",
                        "FNumber",
                        "PhotographicSensitivity",
                        "FocalLength",
                        "Software",
                        "Artist",
                        "Copyright",
                        "GPSLatitude",
                        "GPSLongitude",
                        "GPSAltitude",
                    )
                    .forEach { key ->
                        exif?.getAttribute(key)?.let { controls.addView(text("$key · $it")) }
                    }
                controls.addView(
                    button("별표 · ${p.rating}") {
                        choices("별표", (0..5).map { it.toString() }) {
                            p.rating = it.toInt()
                            library.persist()
                            showControls()
                        }
                    }
                )
            }
            "프리셋" -> {
                listOf("오리지널", "알파인", "골든 아워", "소프트 필름", "딥 포레스트", "모노크롬").forEach { name ->
                    controls.addView(button(name) { preset(name) })
                }
            }
        }
        controls.addView(
            button("모든 보정 초기화") {
                edit { a ->
                    val reset = NativePhoto.defaults()
                    a.keys().asSequence().toList().forEach { a.remove(it) }
                    reset.keys().forEach { a.put(it, reset.get(it)) }
                }
                showControls()
            }
        )
    }

    private fun preset(name: String) {
        val presets =
            mapOf(
                "알파인" to
                    mapOf(
                        "contrast" to 14.0,
                        "shadows" to 22.0,
                        "temperature" to -9.0,
                        "vibrance" to 18.0,
                        "highlights" to -22.0,
                    ),
                "골든 아워" to
                    mapOf(
                        "temperature" to 24.0,
                        "exposure" to .15,
                        "highlights" to -25.0,
                        "shadows" to 15.0,
                        "fade" to 8.0,
                        "vibrance" to 12.0,
                    ),
                "소프트 필름" to
                    mapOf(
                        "contrast" to -12.0,
                        "saturation" to -16.0,
                        "fade" to 22.0,
                        "temperature" to 10.0,
                        "shadows" to 16.0,
                        "vignette" to 16.0,
                    ),
                "딥 포레스트" to
                    mapOf(
                        "exposure" to -.25,
                        "contrast" to 22.0,
                        "highlights" to -30.0,
                        "saturation" to -12.0,
                        "temperature" to -6.0,
                        "vignette" to 24.0,
                    ),
                "모노크롬" to
                    mapOf(
                        "saturation" to -100.0,
                        "contrast" to 24.0,
                        "highlights" to -15.0,
                        "shadows" to 12.0,
                        "fade" to 5.0,
                    ),
            )
        edit { a ->
            val reset = NativePhoto.defaults()
            reset.keys().forEach {
                if (
                    it !in
                        listOf(
                            "masks",
                            "colorSpace",
                            "dynamicRange",
                            "hdrPeak",
                            "sourceOrientation",
                        )
                )
                    a.put(it, reset.get(it))
            }
            presets[name]?.forEach { (key, v) -> a.put(key, v) }
        }
    }

    private fun maskControls() {
        controls.addView(text("영역을 선택한 다음 로컬 노출·대비 등을 조절하세요."))
        val p = library.current ?: return
        val masks = p.settings.optJSONArray("masks") ?: JSONArray()
        controls.addView(
            button("새 마스크 만들기") {
                choices("마스크 종류", listOf("브러시", "선형 그라디언트", "원형 그라디언트")) { name ->
                    if (masks.length() >= 8) {
                        alert("사진당 마스크는 최대 8개입니다.")
                        return@choices
                    }
                    val kind =
                        when (name) {
                            "브러시" -> "brush"
                            "선형 그라디언트" -> "linear"
                            else -> "radial"
                        }
                    val id = java.util.UUID.randomUUID().toString()
                    edit {
                        val m =
                            JSONObject()
                                .put("id", id)
                                .put("name", name)
                                .put("kind", kind)
                                .put(
                                    "points",
                                    if (kind == "brush") JSONArray()
                                    else
                                        JSONArray(
                                            listOf(
                                                JSONObject()
                                                    .put("x", .5)
                                                    .put("y", if (kind == "linear") .25 else .5),
                                                JSONObject()
                                                    .put("x", if (kind == "linear") .5 else .75)
                                                    .put("y", .75),
                                            )
                                        ),
                                )
                                .put("radius", .08)
                                .put("feather", .65)
                                .put("opacity", 1)
                                .put("enabled", true)
                                .put("inverted", false)
                                .put("exposure", 0)
                                .put("contrast", 0)
                                .put("saturation", 0)
                                .put("temperature", 0)
                        it.getJSONArray("masks").put(m)
                    }
                    selectedMask = id
                    showControls()
                }
            }
        )
        for (i in 0 until masks.length()) {
            val m = masks.getJSONObject(i)
            controls.addView(
                button(m.getString("name")) {
                    selectedMask = m.getString("id")
                    showControls()
                }
            )
        }
        val mask =
            (0 until masks.length())
                .map { masks.getJSONObject(it) }
                .firstOrNull { it.optString("id") == selectedMask }
        canvas.selectedMask = selectedMask
        if (mask != null) {
            toggle("선택 영역 표시", showOverlay) { value ->
                showOverlay = value
                canvas.showOverlay = value
                canvas.requestRender()
            }
            if (mask.optString("kind") == "subject") {
                controls.addView(
                    button("피사체 다듬기 · $tool") {
                        choices("피사체 브러시", listOf("add", "erase")) {
                            tool = it
                            showControls()
                        }
                    }
                )
            }
            toggle("마스크 사용", mask.optBoolean("enabled")) { value ->
                edit { mask.put("enabled", value) }
            }
            toggle("선택 영역 반전", mask.optBoolean("inverted")) { value ->
                edit { mask.put("inverted", value) }
            }
            listOf(
                    "opacity",
                    "feather",
                    "radius",
                    "exposure",
                    "contrast",
                    "saturation",
                    "temperature",
                )
                .forEach { key ->
                    controls.addView(
                        text(
                            mapOf(
                                "opacity" to "마스크 강도",
                                "feather" to "경계 부드러움",
                                "radius" to "브러시 크기",
                                "exposure" to "로컬 노출",
                                "contrast" to "로컬 대비",
                                "saturation" to "로컬 채도",
                                "temperature" to "로컬 색온도",
                            )[key] ?: key
                        )
                    )
                    val bar = SeekBar(this)
                    bar.progressTintList = ColorStateList.valueOf(accent)
                    bar.thumbTintList = ColorStateList.valueOf(accent)
                    bar.max = 1000
                    val min =
                        if (key == "exposure") -3.0
                        else if (key in listOf("contrast", "saturation", "temperature")) -100.0
                        else if (key == "radius") .005 else 0.0
                    val max =
                        if (key == "exposure") 3.0
                        else if (key in listOf("opacity", "feather")) 1.0
                        else if (key == "radius") .5 else 100.0
                    bar.progress = ((mask.optDouble(key) - min) / (max - min) * 1000).roundToInt()
                    bar.setOnSeekBarChangeListener(
                        object : SeekBar.OnSeekBarChangeListener {
                            override fun onStartTrackingTouch(s: SeekBar?) {
                                if (p.history.isEmpty()) p.checkpoint()
                            }

                            override fun onProgressChanged(
                                s: SeekBar?,
                                progress: Int,
                                user: Boolean,
                            ) {
                                if (user) {
                                    mask.put(key, min + (max - min) * progress / 1000)
                                    canvas.changed(comparing, true)
                                }
                            }

                            override fun onStopTrackingTouch(s: SeekBar?) {
                                edit {}
                            }
                        }
                    )
                    controls.addView(bar)
                }
            controls.addView(
                button("마스크 삭제") {
                    edit { a ->
                        val left = JSONArray()
                        for (i in 0 until masks.length()) {
                            val m = masks.getJSONObject(i)
                            if (m.optString("id") != selectedMask) left.put(m)
                        }
                        a.put("masks", left)
                    }
                    selectedMask = ""
                    showControls()
                }
            )
        }
    }

    private fun maskStroke(points: List<Pair<Double, Double>>) {
        val p = library.current ?: return
        val masks = p.settings.getJSONArray("masks")
        val mask =
            (0 until masks.length())
                .map { masks.getJSONObject(it) }
                .firstOrNull { it.optString("id") == selectedMask } ?: return
        edit {
            val data = mask.getJSONArray("points")
            if (mask.optString("kind") == "subject") {
                val strokes = mask.optJSONArray("strokes") ?: JSONArray()
                val count =
                    (0 until strokes.length()).sumOf {
                        strokes.getJSONObject(it).getJSONArray("points").length()
                    }
                if (strokes.length() < 128 && count < 4096) {
                    strokes.put(
                        JSONObject()
                            .put(
                                "points",
                                JSONArray(
                                    points.take(4096 - count).map {
                                        JSONObject().put("x", it.first).put("y", it.second)
                                    }
                                ),
                            )
                            .put("radius", mask.optDouble("radius", .08))
                            .put("feather", mask.optDouble("feather", .65))
                            .put("erase", tool == "erase")
                    )
                    mask.put("strokes", strokes)
                }
            } else if (mask.optString("kind") == "brush") {
                points.take(max(0, 1024 - data.length())).forEachIndexed { i, (x, y) ->
                    data.put(JSONObject().put("x", x).put("y", y).put("start", i == 0))
                }
            } else {
                mask.put(
                    "points",
                    JSONArray(
                        listOf(points.first(), points.last()).map {
                            JSONObject().put("x", it.first).put("y", it.second)
                        }
                    ),
                )
            }
        }
    }

    private fun exportDialog() {
        val p = library.current ?: return
        val options = listOf("JPEG", "PNG · 8비트", "PNG · 16비트", "PNG · 16비트 HDR PQ", "WebP")
        choices("파일 형식", options) { label ->
            val format = listOf("jpeg", "png", "png16", "hdr-png", "webp")[options.indexOf(label)]
            fun dimensions(space: String, quality: Int) {
                choices("이미지 크기", listOf("원본", "4096", "2048")) { size ->
                    fun save(preserve: Boolean) {
                        job {
                            share(
                                NativeExport.export(
                                    this,
                                    library,
                                    p,
                                    format,
                                    space,
                                    size.toIntOrNull() ?: 0,
                                    quality,
                                    preserve,
                                )
                            )
                        }
                    }
                    AlertDialog.Builder(this)
                        .setTitle("EXIF 메타데이터 보존")
                        .setMessage("촬영 정보·GPS를 포함한 원본 EXIF를 유지할까요?")
                        .setNegativeButton("제외") { _, _ -> save(false) }
                        .setPositiveButton("보존") { _, _ -> save(true) }
                        .show()
                }
            }
            fun quality(space: String) {
                if (format == "jpeg" || format == "webp")
                    choices("출력 품질", listOf("100", "95", "85", "70")) { value ->
                        dimensions(space, value.toInt())
                    }
                else dimensions(space, 100)
            }
            if (format == "hdr-png") quality("display-p3")
            else
                choices("출력 색공간", listOf("sRGB", "Display P3")) { space ->
                    quality(if (space == "sRGB") "srgb" else "display-p3")
                }
        }
    }

    override fun onConfigurationChanged(configuration: android.content.res.Configuration) {
        super.onConfigurationChanged(configuration)
        if (libraryVisible) showLibrary() else showEditor()
    }

    override fun onDestroy() {
        if (::library.isInitialized) library.work.shutdown()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (::canvas.isInitialized) canvas.onResume()
    }

    override fun onPause() {
        if (::canvas.isInitialized) canvas.onPause()
        super.onPause()
        if (::library.isInitialized && !migrating) library.persist()
    }
}
