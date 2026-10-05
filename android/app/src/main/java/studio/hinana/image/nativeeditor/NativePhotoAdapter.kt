package studio.hinana.image.nativeeditor

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import java.io.File
import java.util.concurrent.Executors

/** Only visible/recycled cells keep bitmaps; the library never decodes every original. */
class NativePhotoAdapter(
    private val library: NativeLibrary,
    private val select: (NativePhoto) -> Unit,
    private val remove: (NativePhoto) -> Unit,
) : RecyclerView.Adapter<NativePhotoAdapter.Holder>() {
    private var photos = listOf<NativePhoto>()

    fun update(value: List<NativePhoto>) {
        photos = value
        notifyDataSetChanged()
    }

    class Holder(val tile: LinearLayout, val image: ImageView, val title: TextView) :
        RecyclerView.ViewHolder(tile) {
        @Volatile var generation = 0
        var bitmap: Bitmap? = null

        fun clear() {
            generation++
            image.setImageDrawable(null)
            bitmap?.recycle()
            bitmap = null
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, type: Int): Holder {
        val context = parent.context
        val density = context.resources.displayMetrics.density
        val tile =
            LinearLayout(context).also {
                it.orientation = LinearLayout.VERTICAL
                it.setPadding(
                    (8 * density).toInt(),
                    (8 * density).toInt(),
                    (8 * density).toInt(),
                    (8 * density).toInt(),
                )
                it.layoutParams =
                    RecyclerView.LayoutParams(-1, (220 * density).toInt()).also { lp ->
                        lp.setMargins(
                            (6 * density).toInt(),
                            (6 * density).toInt(),
                            (6 * density).toInt(),
                            (6 * density).toInt(),
                        )
                    }
            }
        val image =
            ImageView(context).also {
                it.scaleType = ImageView.ScaleType.CENTER_CROP
                it.setBackgroundColor(Color.rgb(35, 39, 38))
            }
        tile.addView(image, LinearLayout.LayoutParams(-1, 0, 1f))
        val title =
            TextView(context).also {
                it.setTextColor(Color.LTGRAY)
                it.textSize = 12f
                it.maxLines = 2
                it.setPadding(
                    (4 * density).toInt(),
                    (12 * density).toInt(),
                    0,
                    (8 * density).toInt(),
                )
            }
        tile.addView(title)
        return Holder(tile, image, title)
    }

    override fun getItemCount() = photos.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        holder.clear()
        val photo = photos[position]
        val token = holder.generation
        holder.title.text =
            photo.name +
                "\n" +
                "${photo.width} × ${photo.height}" +
                if (photo.rating > 0) "  ★${photo.rating}" else ""
        val density = holder.tile.resources.displayMetrics.density
        holder.tile.background =
            GradientDrawable().also {
                it.setColor(Color.rgb(33, 39, 39))
                it.cornerRadius = 5 * density
                it.setStroke(
                    density.toInt().coerceAtLeast(1),
                    if (photo.id == library.selected) Color.rgb(193, 209, 163)
                    else Color.rgb(50, 60, 61),
                )
            }
        holder.tile.contentDescription = photo.name
        holder.tile.setOnClickListener { select(photo) }
        holder.tile.setOnLongClickListener {
            remove(photo)
            true
        }
        thumbnails.execute {
            if (holder.generation != token) return@execute
            runCatching { NativeRenderer.decode(File(library.root, photo.file), 400) }
                .onSuccess { bitmap ->
                    holder.tile.post {
                        if (holder.generation == token) {
                            holder.bitmap = bitmap
                            holder.image.setImageBitmap(bitmap)
                        } else bitmap.recycle()
                    }
                }
        }
    }

    override fun onViewRecycled(holder: Holder) {
        holder.clear()
        super.onViewRecycled(holder)
    }

    companion object {
        private val thumbnails = Executors.newFixedThreadPool(2)
    }
}
