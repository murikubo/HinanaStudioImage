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
