export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetection {
  box: FaceBoundingBox;
  score: number;
}

export interface FaceDetector {
  init(): Promise<void>;
  detectFaces(imageBuffer: Buffer): Promise<FaceDetection[]>;
}

/**
 * ----------------------------------------------------------------------------------
 * AWS Rekognition Integration Example:
 * How AWS Rekognition would plug in behind the FaceDetector interface:
 * ----------------------------------------------------------------------------------
 *
 * import { RekognitionClient, DetectFacesCommand } from '@aws-sdk/client-rekognition';
 *
 * export class AwsRekognitionFaceDetector implements FaceDetector {
 *   private client: RekognitionClient;
 *
 *   constructor(region: string = 'us-east-1') {
 *     this.client = new RekognitionClient({ region });
 *   }
 *
 *   async init(): Promise<void> {
 *     // AWS Rekognition is a managed cloud API, no local weights initialization needed
 *   }
 *
 *   async detectFaces(imageBuffer: Buffer): Promise<FaceDetection[]> {
 *     const command = new DetectFacesCommand({
 *       Image: { Bytes: imageBuffer },
 *       Attributes: ['DEFAULT'],
 *     });
 *
 *     const response = await this.client.send(command);
 *     if (!response.FaceDetails) return [];
 *
 *     // AWS returns normalized bounding box [0, 1] relative to width and height
 *     return response.FaceDetails.map((face) => ({
 *       box: {
 *         x: face.BoundingBox?.Left ?? 0,
 *         y: face.BoundingBox?.Top ?? 0,
 *         width: face.BoundingBox?.Width ?? 0,
 *         height: face.BoundingBox?.Height ?? 0,
 *       },
 *       score: (face.Confidence ?? 0) / 100,
 *     }));
 *   }
 * }
 */
