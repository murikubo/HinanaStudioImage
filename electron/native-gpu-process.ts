import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { NativeGeometryRequest } from './native-gpu-types';

export function validateGeometry(r: NativeGeometryRequest) {
  const size = (w: number, h: number) =>
    Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w * h <= 32_000_000;
  if (
    !r ||
    !['precision', 'legacy'].includes(r.channel) ||
    typeof r.key !== 'string' ||
    !r.key.length ||
    r.key.length > 200 ||
    !size(r.width, r.height) ||
    !size(r.outputWidth, r.outputHeight) ||
    !Number.isFinite(r.cropWidth) ||
    r.cropWidth <= 0 ||
    !Number.isFinite(r.cropHeight) ||
    r.cropHeight <= 0 ||
    !Number.isFinite(r.offsetX ?? 0) ||
    !Number.isFinite(r.offsetY ?? 0) ||
    Math.abs(r.offsetX ?? 0) > r.width + r.height ||
    Math.abs(r.offsetY ?? 0) > r.width + r.height ||
    ![0, 90, 180, 270, -90, -180, -270].includes(r.rotation) ||
    typeof r.flip !== 'boolean' ||
    !(r.map instanceof Float32Array) ||
    r.map.length !== 129 * 129 * 2 ||
    r.map.some((v) => !Number.isFinite(v) || Math.abs(v) > 1) ||
    (r.source !== undefined &&
      (!(r.source instanceof Float32Array) || r.source.length !== r.width * r.height * 4))
  )
    throw new Error('올바르지 않은 Windows GPU 요청입니다.');
}

/** One persistent hardware device and cached source per renderer/channel. */
export class NativeGPUProcess {
  private child?: ChildProcessWithoutNullStreams;
  private key = '';
  private dimensions = '';
  private queue: Promise<unknown> = Promise.resolve();
  private count = 0;
  private closed = false;
  private pending?: {
    chunks: Buffer[];
    bytes: number;
    expected: number;
    resolve: (data: Float32Array) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private executable: string;
  constructor(executable: string) {
    this.executable = executable;
  }
  stop(message = 'Windows GPU 작업이 종료되었습니다.') {
    const child = this.child;
    this.child = undefined;
    this.key = '';
    this.dimensions = '';
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = undefined;
    }
    child?.kill();
  }
  close() {
    this.closed = true;
    this.stop();
  }
  render(request: NativeGeometryRequest): Promise<Float32Array> {
    validateGeometry(request);
    if (this.closed || this.count >= 4)
      return Promise.reject(new Error('Windows GPU가 사용 중입니다.'));
    this.count++;
    const result = this.queue.then(() => this.execute(request));
    this.queue = result
      .catch(() => {})
      .finally(() => {
        this.count--;
      });
    return result;
  }
  private start() {
    if (this.child) return this.child;
    const child = spawn(this.executable, [], { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    let diagnostic = '';
    child.stderr.on('data', (b: Buffer) => {
      diagnostic = (diagnostic + b.toString()).slice(-2000);
    });
    child.on('error', (e) => {
      if (this.child === child) this.stop(e.message);
    });
    child.stdin.on('error', (e) => {
      if (this.child === child) this.stop(e.message);
    });
    child.on('exit', () => {
      if (this.child === child)
        this.stop(diagnostic || 'Direct3D 11 하드웨어를 사용할 수 없습니다.');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return;
      const p = this.pending;
      if (!p) {
        this.stop('예기치 않은 GPU 응답입니다.');
        return;
      }
      p.chunks.push(chunk);
      p.bytes += chunk.length;
      if (p.bytes > p.expected + 4) {
        this.stop('GPU 응답 크기가 다릅니다.');
        return;
      }
      if (p.bytes !== p.expected + 4) return;
      const data = Buffer.concat(p.chunks, p.bytes);
      if (data.readUInt32LE(0) !== p.expected) {
        this.stop('GPU 응답 크기가 다릅니다.');
        return;
      }
      clearTimeout(p.timer);
      this.pending = undefined;
      // Dedicated ArrayBuffer, aligned independently of Node's buffer pool.
      const result = new Float32Array(p.expected / 4);
      new Uint8Array(result.buffer).set(data.subarray(4));
      p.resolve(result);
    });
    return child;
  }
  private execute(r: NativeGeometryRequest): Promise<Float32Array> {
    if (this.closed) throw new Error('Windows GPU가 종료되었습니다.');
    const dimensions = `${r.width}:${r.height}`;
    if (!r.source && (this.key !== r.key || this.dimensions !== dimensions))
      throw new Error('Windows GPU 원본을 다시 전송해야 합니다.');
    const child = this.start();
    const header = Buffer.alloc(52);
    [
      0x48475032,
      r.width,
      r.height,
      r.outputWidth,
      r.outputHeight,
      r.source?.byteLength || 0,
    ].forEach((n, i) => header.writeUInt32LE(n, i * 4));
    const angle = (r.rotation * Math.PI) / 180;
    [
      r.cropWidth,
      r.cropHeight,
      Math.round(Math.cos(angle)),
      Math.round(Math.sin(angle)),
      r.flip ? -1 : 1,
      r.offsetX ?? 0,
      r.offsetY ?? 0,
    ].forEach((n, i) => header.writeFloatLE(n, 24 + i * 4));
    return new Promise((resolve, reject) => {
      this.pending = {
        chunks: [],
        bytes: 0,
        expected: r.outputWidth * r.outputHeight * 16,
        resolve: (data) => {
          this.key = r.key;
          this.dimensions = dimensions;
          resolve(data);
        },
        reject,
        timer: setTimeout(() => this.stop('Windows GPU 처리 시간이 초과되었습니다.'), 30_000),
      };
      const bytes = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
      child.stdin.write(header);
      child.stdin.write(bytes(r.map));
      if (r.source) child.stdin.write(bytes(r.source));
    });
  }
}
