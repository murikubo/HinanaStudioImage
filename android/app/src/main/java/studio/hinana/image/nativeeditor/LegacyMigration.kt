package studio.hinana.image.nativeeditor

import android.app.Activity
import android.webkit.*
import android.widget.LinearLayout
import java.io.*
import java.util.UUID
import org.json.JSONObject

/** One-time reader for the Capacitor origin. Editor UI never uses a WebView. */
class LegacyMigration(
    private val activity: Activity,
    private val library: NativeLibrary,
    private val done: () -> Unit,
    private val fixture: JSONObject? = null,
) {
    private var web: WebView? = null
    private var output: OutputStream? = null
    private var current: NativePhoto? = null
    private val pending = mutableListOf<NativePhoto>()
    private var selected = ""

    @Suppress("SetJavaScriptEnabled")
    fun start(parent: LinearLayout) {
        val view = WebView(activity)
        web = view
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.addJavascriptInterface(this, "NativeMigration")
        view.webViewClient =
            object : WebViewClient() {
                override fun shouldInterceptRequest(
                    v: WebView?,
                    request: WebResourceRequest?,
                ): WebResourceResponse? {
                    if (request?.url?.host == "localhost")
                        return WebResourceResponse(
                            "text/html",
                            "UTF-8",
                            ByteArrayInputStream(html.toByteArray()),
                        )
                    return WebResourceResponse(
                        "text/plain",
                        "UTF-8",
                        ByteArrayInputStream(byteArrayOf()),
                    )
                }

                override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?) =
                    request?.url?.host != "localhost"
            }
        parent.addView(view, LinearLayout.LayoutParams(1, 1))
        view.loadUrl("https://localhost/native-migration")
    }

    @JavascriptInterface
    fun post(body: String) {
        library.work.execute {
            try {
                val value = JSONObject(body)
                when (value.getString("kind")) {
                    "start" -> selected = value.optString("selected")
                    "photo" -> {
                        val v = value.getJSONObject("photo")
                        val file = UUID.randomUUID().toString() + "." + value.getString("ext")
                        val p =
                            NativePhoto(
                                v.getString("id"),
                                v.getString("name"),
                                file,
                                v.getInt("width"),
                                v.getInt("height"),
                                v.optInt("rating"),
                                NativeValidation.settings(v.getJSONObject("adjustments")),
                            )
                        p.metadata = v.optJSONObject("metadata") ?: JSONObject()
                        p.cursor = v.optInt("cursor", -1)
                        current = p
                        output = File(library.root, file).outputStream()
                    }
                    "chunk" -> {
                        val encoded = value.getString("data")
                        require(encoded.length <= 65536)
                        output!!.write(
                            android.util.Base64.decode(encoded, android.util.Base64.DEFAULT)
                        )
                    }
                    "history" -> {
                        val p = current!!
                        if (p.history.size < 30)
                            p.history.add(
                                NativePhoto.archive(
                                    NativeValidation.settings(value.getJSONObject("adjustments"))
                                )
                            )
                    }
                    "raw" -> {
                        output?.close()
                        val p = current!!
                        val raw =
                            UUID.randomUUID().toString() +
                                "." +
                                File(p.name).extension.ifEmpty { "dng" }
                        p.rawFile = raw
                        output = File(library.root, raw).outputStream()
                    }
                    "end" -> {
                        output?.close()
                        output = null
                        current?.let { pending.add(it) }
                        current = null
                    }
                    "done" -> {
                        activity.runOnUiThread {
                            library.photos.clear()
                            library.photos.addAll(pending)
                            library.selected = selected
                            if (library.current == null)
                                library.selected = pending.firstOrNull()?.id ?: ""
                            library.persist()
                            web?.removeJavascriptInterface("NativeMigration")
                            web?.stopLoading()
                            (web?.parent as? LinearLayout)?.removeView(web)
                            web?.destroy()
                            web = null
                            done()
                        }
                        return@execute
                    }
                    "failure" -> error(value.optString("message", "기존 작업 공간을 읽지 못했습니다."))
                }
                activity.runOnUiThread { web?.evaluateJavascript("window.nativeAck(null)", null) }
            } catch (e: Exception) {
                output?.close()
                output = null
                activity.runOnUiThread {
                    androidx.appcompat.app.AlertDialog.Builder(activity)
                        .setTitle("작업 공간 이전 실패")
                        .setMessage("${e.message}\n기존 저장소는 보존되어 있습니다. 앱을 다시 열어 재시도해 주세요.")
                        .setPositiveButton("확인", null)
                        .show()
                }
            }
        }
    }

    private val html =
        """<!doctype html><script>
    let ack;window.nativeAck=()=>ack();const send=v=>new Promise(resolve=>{ack=resolve;NativeMigration.post(JSON.stringify(v))});
    (async()=>{try{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('hinana-image',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});${fixture?.let {"await new Promise((resolve,reject)=>{const t=db.transaction('workspace','readwrite');t.objectStore('workspace').put("+it.toString().replace("<","\\u003c")+",'current');t.oncomplete=resolve;t.onerror=()=>reject(t.error)});"}?:""}const project=await new Promise((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();await send({kind:'start',selected:project?.selected||''});for(const p of project?.photos||[]){await send({kind:'photo',ext:p.src.startsWith('data:image/jpeg')?'jpg':p.src.startsWith('data:image/webp')?'webp':'png',photo:{id:p.id,name:p.name,width:p.width,height:p.height,rating:p.rating,adjustments:p.adjustments,metadata:p.metadata,cursor:Math.max(0,(p.cursor||0)-Math.max(0,(p.history?.length||0)-30))}});async function chunks(src){const start=src.indexOf(',')+1;for(let i=start;i<src.length;i+=65536)await send({kind:'chunk',data:src.slice(i,i+65536)})}await chunks(p.src);if(p.rawSource){await send({kind:'raw'});await chunks(p.rawSource)}for(const adjustments of (p.history||[]).slice(-30))await send({kind:'history',adjustments});await send({kind:'end'})}await send({kind:'done'})}catch(e){NativeMigration.post(JSON.stringify({kind:'failure',message:String(e)}))}})();</script>"""
}
