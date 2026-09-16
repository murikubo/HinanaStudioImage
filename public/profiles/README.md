# Output ICC profiles

- display-p3.icc: 520-byte matrix/TRC profile emitted by Chromium/Skia in
  Electron 43.1.1 when exporting a Display P3 Canvas as PNG. Generated using
  `scripts/probe-p3.mjs`; D65 P3 primaries, sRGB transfer curve, ICC v4.
- srgb.icc: sRGB-v4.icc from saucecontrol/Compact-ICC-Profiles (CC0),
  https://github.com/saucecontrol/Compact-ICC-Profiles. License included.

The P3 profile is also embedded in the LibRaw PNG whose output uses LibRaw's
P3-D65 matrix (output_color=7) with the sRGB transfer curve. It must not be used
with cinema DCI white point/gamma-2.6 RGB values.
