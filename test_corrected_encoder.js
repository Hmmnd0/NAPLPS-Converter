// Test the corrected encoder
// Run with: node test_corrected_encoder.js

// Simple coordinate packing function (matches the corrected encoder)
function packCoordinate12bit(value) {
  // Convert 0.0-1.0 to 0-4095 (12-bit range)
  const scaled = Math.round(value * 4095);
  const clamped = Math.max(0, Math.min(4095, scaled));
  
  // Split into high and low 6 bits
  const high6 = (clamped >> 6) & 0x3F;
  const low6 = clamped & 0x3F;
  
  // Offset each by 0x40 for ASCII safety
  return [0x40 + high6, 0x40 + low6];
}

// Generate NAPLPS data using the corrected approach
function generateCorrectedRectangle() {
  const data = [];
  
  // Telidon header (from working files)
  data.push(0x18); // CANCEL
  data.push(0x1B); // ESC
  data.push(0x45); // 'E'
  data.push(0x1F); // NSR
  data.push(0x40); // NSR data
  data.push(0x40); // NSR data
  data.push(0x0E); // SO (graphics mode)
  data.push(0x20); // RESET
  data.push(0x7F); // Reset data
  data.push(0x4F); // Reset data
  data.push(0x21); // DOMAIN
  data.push(0x4D); // Domain data (4-byte mode)
  data.push(0x40); // Domain data
  data.push(0x40); // Domain data
  data.push(0x40); // Domain data
  data.push(0x40); // Domain data
  
  // Set red color
  data.push(0x3C); // SET_COLOR
  data.push(0x52); // Red (ASCII 'R')
  
  // Set & Poly Filled command (0x37) - NOT rectangle primitive
  data.push(0x37);
  
  // Rectangle coordinates: (0.2, 0.2) to (0.8, 0.8)
  const points = [
    { x: 0.2, y: 0.2 }, // topLeft
    { x: 0.8, y: 0.2 }, // topRight
    { x: 0.8, y: 0.8 }, // bottomRight
    { x: 0.2, y: 0.8 }  // bottomLeft
  ];
  
  // Encode each point
  for (const point of points) {
    const [xh, xl] = packCoordinate12bit(point.x);
    const [yh, yl] = packCoordinate12bit(point.y);
    data.push(xh, xl, yh, yl);
  }
  
  // End graphics
  data.push(0x0F); // SI (Shift In, end of graphics)
  
  return data;
}

// Generate and save the file
const naplpsData = generateCorrectedRectangle();
const buffer = Buffer.from(naplpsData);

// Write to file
const fs = require('fs');
fs.writeFileSync('test_corrected_rectangle.nap', buffer);

console.log('Generated test_corrected_rectangle.nap');
console.log('Hex data:', naplpsData.map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('File size:', buffer.length, 'bytes');

// Also create a hex string version for easy testing
const hexString = naplpsData.map(b => b.toString(16).padStart(2, '0')).join('');
console.log('Hex string:', hexString);

// Compare with our working test file
const workingData = fs.readFileSync('test_rectangle.nap');
const workingHex = Array.from(workingData).map(b => b.toString(16).padStart(2, '0')).join('');

console.log('\nComparison:');
console.log('Working file hex:', workingHex);
console.log('Corrected file hex:', hexString);
console.log('Files match:', workingHex === hexString); 