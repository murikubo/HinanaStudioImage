# RAW runtime notices

Windows/Linux RAW decoding uses @colorhythm/libraw-wasm 1.1.1 (MIT),
https://github.com/colorhythm/libraw-wasm. Its unmodified WebAssembly binary is
bundled with the application. The source and build instructions are available
at that repository's release/tag for the package version.

LibRaw is available under LGPL 2.1 or CDDL 1.0; this distribution uses the CDDL
option. LibRaw COPYRIGHT and both license texts are included alongside this
notice. Refer to COPYRIGHT for the included third-party components.

PNG encoding: pngjs (MIT), https://github.com/pngjs/pngjs.
EXIF serialization: piexifjs (MIT), https://github.com/hMatoba/piexifjs.
EXIF reading: exifr (MIT), https://github.com/MikeKovarik/exifr.
Dependency license files are also included with their bundled npm packages.

Output sRGB ICC: Compact-ICC-Profiles by Clinton Ingram (CC0 1.0),
https://github.com/saucecontrol/Compact-ICC-Profiles. The license and profile
provenance are included in `dist/profiles/`. The Display P3 profile was generated
by a P3 Canvas PNG export from Chromium/Skia in Electron 43.1.1.

High-precision PNG codec: fast-png 8.0.0 (MIT), https://github.com/image-js/fast-png.
Compression: fflate (MIT), https://github.com/101arrowz/fflate.
Binary buffers: iobuffer (MIT), https://github.com/image-js/iobuffer.
Their license texts are included in dist/licenses.

Subject segmentation: Xenova/slimsam-77-uniform (Apache-2.0), quantized ONNX
conversion of nielsr/slimsam-77-uniform, based on SlimSAM and Segment Anything.
https://huggingface.co/Xenova/slimsam-77-uniform
https://github.com/czg1225/SlimSAM
https://github.com/facebookresearch/segment-anything
Pinned model revision: 5850ab45f587c112167512ffef949107115e26a0.
Unmodified encoder and prompt decoder are included; SHA-256 hashes are recorded
in scripts/fetch-subject-model.mjs. Apache-2.0 license accompanies the application.

Inference runtime: ONNX Runtime 1.30.0 (MIT),
https://github.com/microsoft/onnxruntime. Its license and third-party notices
are included with the bundled npm package and in dist/licenses.
