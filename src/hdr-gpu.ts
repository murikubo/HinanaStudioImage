/// <reference types="@webgpu/types" />
import type { WorkingColorSpace } from './color-space';
let device: GPUDevice | undefined;
let pipeline: GPURenderPipeline | undefined;
let pending: Promise<boolean> | undefined;
const shader = `
@group(0) @binding(0) var pixels: texture_2d<f32>;
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(positions[index], 0, 1);
}
@fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let rgba = textureLoad(pixels, vec2i(position.xy), 0);
  return vec4f(rgba.rgb * rgba.a, rgba.a);
}`;
export function gpuHDRSupported() {
  return !!device && !!pipeline;
}
/** Probe the actual configuration, rather than treating navigator.gpu as HDR support. */
export function prepareGPUHDR(): Promise<boolean> {
  return (pending ??= (async () => {
    let candidate: GPUDevice | undefined;
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return false;
      candidate = await adapter.requestDevice({
        requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
      });
      candidate.pushErrorScope('validation');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgpu');
      if (!context) {
        candidate.destroy();
        return false;
      }
      context.configure({
        device: candidate,
        format: 'rgba16float',
        colorSpace: 'display-p3',
        toneMapping: { mode: 'extended' },
        alphaMode: 'premultiplied',
      });
      const configuration = context.getConfiguration();
      const module = candidate.createShaderModule({ code: shader });
      const result = await candidate.createRenderPipelineAsync({
        layout: candidate.createPipelineLayout({
          bindGroupLayouts: [
            candidate.createBindGroupLayout({
              entries: [
                {
                  binding: 0,
                  visibility: GPUShaderStage.FRAGMENT,
                  texture: { sampleType: 'unfilterable-float' },
                },
              ],
            }),
          ],
        }),
        vertex: { module, entryPoint: 'vertex' },
        fragment: { module, entryPoint: 'fragment', targets: [{ format: 'rgba16float' }] },
      });
      context.unconfigure();
      const error = await candidate.popErrorScope();
      if (error || configuration?.toneMapping?.mode !== 'extended') {
        candidate.destroy();
        return false;
      }
      device = candidate;
      pipeline = result;
      void candidate.lost.then(() => {
        device = undefined;
        pipeline = undefined;
        window.dispatchEvent(new Event('hinana-hdr-capability-change'));
      });
      return true;
    } catch {
      candidate?.destroy();
      return false;
    }
  })());
}
/** Encoded RGB in the canvas color space, with values above SDR white retained. */
export function paintGPUHDR(
  canvas: HTMLCanvasElement,
  pixels: Float32Array,
  colorSpace: WorkingColorSpace,
) {
  if (
    !device ||
    !pipeline ||
    canvas.width > device.limits.maxTextureDimension2D ||
    canvas.height > device.limits.maxTextureDimension2D
  )
    return false;
  const context = canvas.getContext('webgpu');
  if (!context) return false;
  context.configure({
    device,
    format: 'rgba16float',
    colorSpace,
    alphaMode: 'premultiplied',
    toneMapping: { mode: 'extended' },
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const texture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    pixels as Float32Array<ArrayBuffer>,
    { bytesPerRow: canvas.width * 16 },
    [canvas.width, canvas.height],
  );
  const commands = device.createCommandEncoder();
  const pass = commands.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 0],
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: texture.createView() }],
    }),
  );
  pass.draw(3);
  pass.end();
  device.queue.submit([commands.finish()]);
  // Destruction is deferred by WebGPU until submitted commands have finished.
  texture.destroy();
  canvas.dataset.hdrBackend = 'webgpu';
  return true;
}
