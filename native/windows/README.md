# Windows GPU geometry

`GpuGeometry.cs` hosts a persistent **hardware Direct3D 11 / DirectCompute** device.
The host uses the Windows .NET Framework and P/Invoke; the pixel computation is an
HLSL `cs_5_0` shader executed by the GPU, with no WebGL/ANGLE or CPU WARP device.
`npm run build:native` compiles it with the Windows Framework64 C# compiler. No
Visual Studio, NuGet packages, vendor SDK, or separately installed .NET runtime is
needed on supported Windows 10/11 systems. Packaging copies the executable to
`resources/gpu/hinana-gpu.exe`.

Both legacy and float editing use the shader when liquify is active, including
exports. Crop, quarter-turn rotation, flip, displacement-map interpolation and
alpha-aware image resampling run together on the GPU. Float input/output preserves
linear HDR values in the precision path; color conversion, exposure, color tools,
local masks, codecs and UI remain in their existing paths. Legacy resampling now
samples the original image directly rather than a previously resized warp canvas.
Small differences from its former multi-stage WebGL/Canvas resampling are expected.

The Electron sandbox stays enabled. An asynchronous, origin-checked IPC bridge
talks to the helper through binary pipes; the main process performs no GPU waits.
Each renderer has at most two helpers (one per precision path). Source buffers
remain on the GPU across brush updates; output and staging buffers are reused by
size. Every request carries a 129 x 129 float2 displacement map. Images are limited
to 32MP; unsupported devices, lost devices, helper exits and timeouts fall back to
the previous CPU (float) or WebGL (legacy) path for that source. Reloading/changing
the source permits a retry. Closing the window or quitting kills its helpers.

The little-endian pipe request is: magic `0x48475032`, source width/height, output
width/height, upload byte count (six uint32 values total), crop width/height,
cosine/sine, flip sign, oriented crop offsets X/Y (seven float32 values), displacement map, then optional float4
source pixels. A response is byte count (uint32) followed by float4 output pixels.
All requests are serialized and bounded; cached sources are checked against a key
and dimensions before use. The native COM vtable slots follow the Windows SDK's
`ID3D11Device` and `ID3D11DeviceContext` definitions.

Validation: `node --experimental-strip-types --test tests/native-gpu.test.ts`
checks actual hardware output against the CPU reference across HDR, alpha,
liquify, rotations, flips, crops, output sizes, source caching, and helper restart.
`node tests/native-gpu-smoke.mjs` checks the packaged app's real renderer, IPC,
precision worker, legacy path, undo, and fallback with an isolated user profile.

This is a partial GPU pipeline. Readback and IPC still copy output pixels, and
later adjustments still use CPU loops. Measure end-to-end brush latency on the
target hardware before claiming a speed improvement.
