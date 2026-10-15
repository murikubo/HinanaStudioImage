/** Float RGBA in the caller's working space; no quantization or implicit color conversion. */
export type NativeGeometryRequest = {
  channel: 'precision' | 'legacy';
  key: string;
  source?: Float32Array;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  cropWidth: number;
  cropHeight: number;
  rotation: number;
  flip: boolean;
  map: Float32Array;
};
