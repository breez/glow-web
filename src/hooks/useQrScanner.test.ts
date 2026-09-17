import { describe, expect, it } from 'vitest';
import { fullResolutionScanRegion } from './useQrScanner';

describe('fullResolutionScanRegion', () => {
  it('decodes the centered two-thirds square without shrinking it', () => {
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

    expect(fullResolutionScanRegion(video)).toEqual({
      x: 600,
      y: 180,
      width: 720,
      height: 720,
      downScaledWidth: 720,
      downScaledHeight: 720,
    });
  });
});
