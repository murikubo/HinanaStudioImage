package studio.hinana.image

import android.os.Bundle
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import org.json.JSONObject
import studio.hinana.image.nativeeditor.*

/** Isolated native storage; launch only on an emulator with generated fixtures. */
class NativeTestActivity : AppCompatActivity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val root = LinearLayout(this)
        setContentView(root)
        val directory = File(cacheDir, "native-migration-tests")
        directory.deleteRecursively()
        directory.mkdirs()
        val library = NativeLibrary(this, File(directory, "NativeImageLibrary"))
        LegacyMigration(
                this,
                library,
                {
                    library.work.execute {
                        val p = library.current
                        val result =
                            JSONObject()
                                .put(
                                    "pass",
                                    library.photos.size == 1 &&
                                        p?.id == "legacy-fixture" &&
                                        p.settings.getDouble("exposure") == 0.7 &&
                                        p.rating == 4 &&
                                        p.history.size == 2 &&
                                        p.cursor == 1 &&
                                        NativePhoto.unarchive(p.history[0]).getDouble("exposure") ==
                                            0.0 &&
                                        p.rawFile?.let {
                                            File(library.root, it)
                                                .readBytes()
                                                .contentEquals(byteArrayOf(1, 2, 3, 4))
                                        } == true,
                                )
                        File(directory, "result.json").writeText(result.toString())
                    }
                },
                JSONObject(intent.getStringExtra("fixture")!!),
            )
            .start(root)
    }
}
