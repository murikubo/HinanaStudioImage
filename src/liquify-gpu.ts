import { liquifyData, type Liquify } from './liquify.ts';
import { colorContext, type WorkingColorSpace } from './color-space.ts';
let cache:
  | {
      canvas: HTMLCanvasElement;
      gl: WebGL2RenderingContext;
      program: WebGLProgram;
      source: WebGLTexture;
      map: WebGLTexture;
      key: string;
      image?: HTMLImageElement;
    }
  | undefined;
/** One bounded map lookup; the original texture is uploaded only when source/size/color space changes. */
export function warpedImage(
  image: HTMLImageElement,
  value: Liquify,
  scale: number,
  space: WorkingColorSpace,
): HTMLCanvasElement {
  if (!cache) {
    const canvas = document.createElement('canvas'),
      gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl) throw Error('리퀴파이에는 GPU(WebGL 2) 지원이 필요합니다.');
    const program = gl.createProgram()!;
    for (const [type, text] of [
      [
        gl.VERTEX_SHADER,
        `#version 300 es
    out vec2 uv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0,1);}`,
      ],
      [
        gl.FRAGMENT_SHADER,
        `#version 300 es
    precision highp float;uniform sampler2D picture;uniform sampler2D field;in vec2 uv;out vec4 color;
    void main(){vec2 p=vec2(uv.x,1.-uv.y),g=clamp(p,0.,1.)*128.;ivec2 i=ivec2(min(floor(g),vec2(127)));vec2 t=g-vec2(i);
    vec2 d=mix(mix(texelFetch(field,i,0).rg,texelFetch(field,i+ivec2(1,0),0).rg,t.x),mix(texelFetch(field,i+ivec2(0,1),0).rg,texelFetch(field,i+ivec2(1,1),0).rg,t.x),t.y);
    p=clamp(p+d,0.,1.);color=texture(picture,vec2(p.x,1.-p.y));}`,
      ],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(shader) || '리퀴파이 GPU 오류');
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('리퀴파이 GPU 연결 실패');
    cache = { canvas, gl, program, source: gl.createTexture()!, map: gl.createTexture()!, key: '' };
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cache = undefined;
    });
  }
  const { canvas, gl, program, source, map } = cache;
  const w = Math.max(1, Math.round(image.naturalWidth * scale)),
    h = Math.max(1, Math.round(image.naturalHeight * scale));
  const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (w > limit || h > limit)
    throw Error('이 크기의 리퀴파이 출력은 32비트 편집 정밀도로 내보내세요.');
  const key = w + '|' + h + '|' + space;
  if (cache.key !== key || cache.image !== image) {
    canvas.width = w;
    canvas.height = h;
    gl.drawingBufferColorSpace = space === 'display-p3' ? 'display-p3' : 'srgb';
    if ('unpackColorSpace' in gl)
      gl.unpackColorSpace = space === 'display-p3' ? 'display-p3' : 'srgb';
    const stage = document.createElement('canvas');
    stage.width = w;
    stage.height = h;
    colorContext(stage, space).drawImage(image, 0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    stage.width = stage.height = 0;
    cache.key = key;
    cache.image = image;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, map);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RG32F,
    value.width,
    value.height,
    0,
    gl.RG,
    gl.FLOAT,
    liquifyData(value)!,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'picture'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'field'), 1);
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return canvas;
}
