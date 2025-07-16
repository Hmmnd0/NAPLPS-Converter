/**
 * Converts an image (data URL) to SVG using ImageTracerJS.
 * @param dataUrl The image as a data URL (PNG, JPEG, etc.)
 * @param options Optional ImageTracer options
 * @returns SVG string
 */
export async function rasterToSVG(
  dataUrl: string,
  options: any = {}
): Promise<string> {
  if (typeof window === 'undefined') {
    throw new Error('ImageTracerJS can only be used in the browser.');
  }
  const ImageTracer = (await import('imagetracerjs')).default;
  return new Promise((resolve, reject) => {
    ImageTracer.imageToSVG(
      dataUrl,
      (svgString: string) => resolve(svgString),
      options
    );
  });
} 