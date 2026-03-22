export async function pixelPngToSvg(
  dataUrl: string,
  onProgress?: (progress: number) => void
): Promise<{ svg: string; palette: Array<{ r: number; g: number; b: number }> }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const { width, height } = img;

      const maxPixels = 1_000_000;
      if (width * height > maxPixels) {
        reject(`Image too large: ${width}x${height} = ${width * height} pixels. Maximum allowed: ${maxPixels}`);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject('Could not get canvas context'); return; }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);

      // Transfer the pixel buffer to the worker (zero-copy)
      const worker = new Worker(new URL('./pixelToSvg.worker.ts', import.meta.url));
      worker.postMessage(
        { buffer: imageData.data.buffer, width, height },
        [imageData.data.buffer]
      );

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          onProgress?.(msg.progress);
        } else if (msg.type === 'result') {
          worker.terminate();
          resolve({ svg: msg.svg, palette: msg.palette });
        } else if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };
    };

    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}
