import { FaceLandmarker, PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Landmark } from './portrait-ai';
let face: FaceLandmarker | undefined, pose: PoseLandmarker | undefined;
const scope = self as unknown as { postMessage(value: unknown): void };
self.onmessage = async (
  e: MessageEvent<{
    id: number;
    base: string;
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
  }>,
) => {
  const { id, base, rgba, width, height } = e.data;
  try {
    if (!face || !pose) {
      const files = await FilesetResolver.forVisionTasks(`${base}wasm`);
      face = await FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 5,
        minFaceDetectionConfidence: 0.6,
      });
      pose = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${base}pose_landmarker_lite.task`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 5,
        minPoseDetectionConfidence: 0.6,
        outputSegmentationMasks: false,
      });
    }
    const image = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height);
    const points = (list: { x: number; y: number; visibility?: number }[][]): Landmark[][] =>
      list.map((group) =>
        group.map((p) => ({
          x: Math.max(-2, Math.min(2, p.x)),
          y: Math.max(-2, Math.min(2, p.y)),
          ...(p.visibility === undefined ? {} : { visibility: p.visibility }),
        })),
      );
    const faces = points(face.detect(image).faceLandmarks),
      poses = points(pose.detect(image).landmarks);
    scope.postMessage({ id, result: { faces, poses } });
  } catch (error) {
    console.warn('Local portrait inference failed:',error);
    scope.postMessage({ id, error: (error as Error).message });
  }
};
