// Median cut quantization for 16-color palette
function medianCutQuantize(imageData: ImageData, colorCount: number): [number, number, number][] {
  // Build initial color list
  const colors: [number, number, number][] = [];
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const a = imageData.data[i + 3];
    if (a > 0) colors.push([r, g, b]);
  }
  // Helper: find channel with max range
  function getRange(cList: [number, number, number][]): number {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const [r, g, b] of cList) {
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
    if (rRange >= gRange && rRange >= bRange) return 0;
    if (gRange >= rRange && gRange >= bRange) return 1;
    return 2;
  }
  // Recursive median cut
  function quantize(cList: [number, number, number][], depth: number): [number, number, number][] {
    if (cList.length === 0) return [];
    if (depth === 0 || cList.length === 1) {
      // Average color
      const avg = cList.reduce((acc: [number, number, number], c: [number, number, number]) => [acc[0]+c[0], acc[1]+c[1], acc[2]+c[2]], [0,0,0]);
      return [[Math.round(avg[0]/cList.length), Math.round(avg[1]/cList.length), Math.round(avg[2]/cList.length)]];
    }
    const channel = getRange(cList);
    cList.sort((a: [number, number, number], b: [number, number, number]) => a[channel] - b[channel]);
    const mid = Math.floor(cList.length / 2);
    return [
      ...quantize(cList.slice(0, mid), depth - 1),
      ...quantize(cList.slice(mid), depth - 1)
    ];
  }
  const depth = Math.round(Math.log2(colorCount));
  return quantize(colors, depth);
}

export async function pixelPngToSvg(
  dataUrl: string, 
  onProgress?: (progress: number) => void
): Promise<{ svg: string, palette: Array<{r:number,g:number,b:number}> }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const width = img.width;
      const height = img.height;
      
      console.log(`Image loaded: ${width}x${height} = ${width * height} pixels`);
      
      // Add size limit to prevent browser crashes
      const maxPixels = 1000000; // 1 million pixels max
      if (width * height > maxPixels) {
        reject(`Image too large: ${width}x${height} = ${width * height} pixels. Maximum allowed: ${maxPixels}`);
        return;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('Could not get canvas context');
      
      console.log('Drawing image to canvas...');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      console.log('Got image data, starting pixel processing...');
      
      // Quantize to 16-color palette
      const palette = medianCutQuantize(imageData, 16);
      // Patch: Ensure pure red (or near-red) is in the palette if present in the image
      const colors = [];
      for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];
        const a = imageData.data[i + 3];
        if (a > 0) colors.push([r, g, b]);
      }
      const hasRed = colors.some(([r, g, b]) => r > 200 && g < 80 && b < 80);
      if (hasRed && !palette.some(([r, g, b]) => r > 200 && g < 80 && b < 80)) {
        // Find a red pixel in the image
        const redPixel = colors.find(([r, g, b]) => r > 200 && g < 80 && b < 80);
        if (redPixel) {
          // Ensure redPixel is a tuple of three numbers
          if (Array.isArray(redPixel) && redPixel.length === 3) {
            palette[palette.length - 1] = [redPixel[0], redPixel[1], redPixel[2]];
            console.log('Patched palette to include red:', redPixel);
          } else {
            palette[palette.length - 1] = [255, 0, 0]; // fallback to pure red
            console.log('Patched palette to include fallback red: [255,0,0]');
          }
        }
      }
      // Patch: Always include the most saturated red pixel in the palette
      let maxRedScore = -Infinity;
      let mostRed: [number, number, number] = [255, 0, 0];
      for (const [r, g, b] of colors) {
        const score = r - g - b;
        if (score > maxRedScore) {
          maxRedScore = score;
          mostRed = [r, g, b];
        }
      }
      // Only force if the most red pixel is not already in the palette
      if (!palette.some(([r, g, b]) => r === mostRed[0] && g === mostRed[1] && b === mostRed[2])) {
        palette[palette.length - 1] = mostRed;
        console.log('Patched palette to include most saturated red:', mostRed);
      }
      // Patch: Always include the exact red #921c12 ([146,33,18]) in the palette if present in the image
      const targetRed: [number, number, number] = [146, 28, 18]; // #921c12 is (146,28,18)
      const foundTargetRed = colors.some(([r, g, b]) => Math.abs(r-146)<8 && Math.abs(g-28)<8 && Math.abs(b-18)<8);
      console.log('Found #921c12 in image:', foundTargetRed);
      if (foundTargetRed && !palette.some(([r, g, b]) => Math.abs(r-146)<8 && Math.abs(g-28)<8 && Math.abs(b-18)<8)) {
        palette[palette.length - 1] = targetRed;
        console.log('Patched palette to include #921c12:', targetRed);
      }
      console.log('Final quantized palette:', palette);
      function nearestPaletteColor(r: number, g: number, b: number) {
        let minDist = Infinity;
        let best = palette[0];
        for (const c of palette) {
          const dist = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
          if (dist < minDist) {
            minDist = dist;
            best = c;
          }
        }
        return best;
      }
      // For small images, process all at once for better performance
      if (width * height < 10000) { // Less than 10K pixels
        console.log('Small image detected, processing all pixels at once...');
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges" viewBox="0 0 ${width} ${height}">`;
        let pixelCount = 0;
        
        for (let y = 0; y < height; y++) {
          let x = 0;
          while (x < width) {
            const idx = (y * width + x) * 4;
            if (imageData.data[idx + 3] === 0) { x++; continue; }
            const pal = nearestPaletteColor(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
            const color = `rgb(${pal[0]},${pal[1]},${pal[2]})`;
            let runEnd = x + 1;
            while (runEnd < width) {
              const nextIdx = (y * width + runEnd) * 4;
              if (imageData.data[nextIdx + 3] === 0) break;
              const nextPal = nearestPaletteColor(imageData.data[nextIdx], imageData.data[nextIdx + 1], imageData.data[nextIdx + 2]);
              if (nextPal[0] !== pal[0] || nextPal[1] !== pal[1] || nextPal[2] !== pal[2]) break;
              runEnd++;
            }
            svg += `<rect x="${x}" y="${y}" width="${runEnd - x}" height="1" fill="${color}" />`;
            pixelCount += runEnd - x;
            x = runEnd;
          }
        }
        
        svg += '</svg>';
        console.log(`Generated SVG with ${pixelCount} visible pixels`);
        if (onProgress) onProgress(1);
        resolve({ svg, palette: palette.map(([r,g,b])=>({r,g,b})) });
        return;
      }
      // For larger images, use chunked processing
      console.log('Large image detected, using chunked processing...');
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges" viewBox="0 0 ${width} ${height}">`;
      let pixelCount = 0;
      const totalPixels = width * height;
      // Process in smaller chunks for better progress reporting
      const chunkSize = Math.max(100, Math.floor(totalPixels / 200)); // Process in 200 chunks
      let processedPixels = 0;
      let lastProgressReport = 0;
      const processChunk = (startY: number) => {
        const endY = Math.min(startY + chunkSize, height);
        for (let y = startY; y < endY; y++) {
          let x = 0;
          while (x < width) {
            const idx = (y * width + x) * 4;
            if (imageData.data[idx + 3] === 0) { x++; processedPixels++; continue; }
            const pal = nearestPaletteColor(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
            const color = `rgb(${pal[0]},${pal[1]},${pal[2]})`;
            let runEnd = x + 1;
            while (runEnd < width) {
              const nextIdx = (y * width + runEnd) * 4;
              if (imageData.data[nextIdx + 3] === 0) break;
              const nextPal = nearestPaletteColor(imageData.data[nextIdx], imageData.data[nextIdx + 1], imageData.data[nextIdx + 2]);
              if (nextPal[0] !== pal[0] || nextPal[1] !== pal[1] || nextPal[2] !== pal[2]) break;
              runEnd++;
            }
            svg += `<rect x="${x}" y="${y}" width="${runEnd - x}" height="1" fill="${color}" />`;
            pixelCount += runEnd - x;
            processedPixels += runEnd - x;
            x = runEnd;
          }
        }
        // Report progress more frequently
        const currentProgress = processedPixels / totalPixels;
        if (currentProgress - lastProgressReport >= 0.01 || currentProgress >= 1) { // Report every 1% or when complete
          if (onProgress) {
            console.log(`Progress: ${Math.round(currentProgress * 100)}%`);
            onProgress(currentProgress);
          }
          lastProgressReport = currentProgress;
        }
        // Continue with next chunk or finish
        if (endY < height) {
          // Use requestAnimationFrame for smoother UI updates
          requestAnimationFrame(() => processChunk(endY));
        } else {
          svg += '</svg>';
          console.log(`Generated SVG with ${pixelCount} visible pixels`);
          if (onProgress) {
            onProgress(1); // Ensure 100% is reported
          }
          resolve({ svg, palette: palette.map(([r,g,b])=>({r,g,b})) });
        }
      };
      // Start processing
      processChunk(0);
    };
    img.onerror = (err) => {
      console.error('Image load error:', err);
      reject(err);
    };
    img.src = dataUrl;
  });
} 