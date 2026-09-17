const parentPort = process.parentPort;
const models = process.argv[2];
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
let encoder, decoder, embeddings, imageKey;
// Disable arena growth: Chromium's allocator rejects some large aligned allocations.
const options = {
  executionProviders: ['cpu'],
  intraOpNumThreads: 2,
  interOpNumThreads: 1,
  enableCpuMemArena: false,
  enableMemPattern: false,
};
parentPort.on('message', async ({ data: { id, rgba, width, height, points } }) => {
  try {
    encoder ||= await ort.InferenceSession.create(
      path.join(models, 'vision_encoder_quantized.onnx'),
      options,
    );
    decoder ||= await ort.InferenceSession.create(
      path.join(models, 'prompt_encoder_mask_decoder_quantized.onnx'),
      options,
    );
    const key = createHash('sha256').update(rgba).update(`${width}x${height}`).digest('hex');
    if (key !== imageKey) {
      const data = new Float32Array(3 * 1024 * 1024);
      const mean = [0.485, 0.456, 0.406],
        std = [0.229, 0.224, 0.225];
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4,
            alpha = rgba[i + 3] / 255;
          for (let c = 0; c < 3; c++)
            data[c * 1024 * 1024 + y * 1024 + x] =
              ((rgba[i + c] * alpha) / 255 + 1 - alpha - mean[c]) / std[c];
        }
      const next = await encoder.run({
        pixel_values: new ort.Tensor('float32', data, [1, 3, 1024, 1024]),
      });
      if (embeddings) for (const tensor of Object.values(embeddings)) tensor.dispose();
      embeddings = next;
      imageKey = key;
    }
    const coords = Float32Array.from(points.flatMap((p) => [p.x * width, p.y * height]));
    const labels = BigInt64Array.from(points.map((p) => (p.exclude ? 0n : 1n)));
    const output = await decoder.run({
      ...embeddings,
      input_points: new ort.Tensor('float32', coords, [1, 1, points.length, 2]),
      input_labels: new ort.Tensor('int64', labels, [1, 1, points.length]),
    });
    const scores = output.iou_scores.data;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const logits = output.pred_masks.data,
      offset = best * 256 * 256;
    const data = new Uint8Array(width * height);
    // Match SAM post-processing: align_corners=false upsample, crop padding, threshold logits.
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const xx = Math.max(0, Math.min(255, (x + 0.5) / 4 - 0.5)),
          yy = Math.max(0, Math.min(255, (y + 0.5) / 4 - 0.5));
        const x0 = Math.floor(xx),
          y0 = Math.floor(yy),
          x1 = Math.min(255, x0 + 1),
          y1 = Math.min(255, y0 + 1),
          fx = xx - x0,
          fy = yy - y0;
        const a = logits[offset + y0 * 256 + x0] * (1 - fx) + logits[offset + y0 * 256 + x1] * fx;
        const b = logits[offset + y1 * 256 + x0] * (1 - fx) + logits[offset + y1 * 256 + x1] * fx;
        data[y * width + x] = a * (1 - fy) + b * fy > 0 ? 255 : 0;
      }
    for (const tensor of Object.values(output)) tensor.dispose();
    parentPort.postMessage({
      id,
      raster: { width, height, data: Buffer.from(data).toString('base64') },
    });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
