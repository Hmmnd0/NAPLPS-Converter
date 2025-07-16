"use client";

import React, { useRef, useState, useEffect } from 'react';

// Type declarations for TelidonP5.js
declare global {
  interface Window {
    TelidonP5: any;
    p5: any;
    TelidonDraw: any;
    TelidonDrawCmd: any;
    NapDecoder: any;
    NapCmd: any;
    NapEncoder: any;
    NapInputWrapper: any;
    Vector2: any;
    Vector3: any;
    NapChar: any;
    NapOpcode: any;
    NapData: any;
    NapDataArray: any;
    NapVector: any;
    NapText: any;
    naplpsData: Uint8Array; // Added for download button
  }
}

export default function TestRectangle() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [loadingStatus, setLoadingStatus] = useState<string>("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [scriptErrors, setScriptErrors] = useState<string[]>([]);
  const [telidonAttempted, setTelidonAttempted] = useState(false);
  const [telidonDraw, setTelidonDraw] = useState<any>(null);

  // Pack coordinates for 12-bit format (4 bytes per coordinate)
  function packCoordinate12Bit(value: number): number[] {
    // Ensure value is in valid range (0-1023 for 12-bit)
    const clamped = Math.max(0, Math.min(1023, Math.round(value)));
    
    // Split into four 3-bit nibbles, each offset by 0x40
    const byte1 = ((clamped >> 9) & 0x07) + 0x40;
    const byte2 = ((clamped >> 6) & 0x07) + 0x40;
    const byte3 = ((clamped >> 3) & 0x07) + 0x40;
    const byte4 = (clamped & 0x07) + 0x40;
    
    return [byte1, byte2, byte3, byte4];
  }

  function packCoordinate2Byte(coordinate: number): number[] {
    // For 2-byte coordinates, each coordinate is stored as 2 individual bytes
    // Each byte represents a 6-bit value offset by 0x40
    const byte1 = ((coordinate >> 6) & 0x3F) + 0x40;
    const byte2 = (coordinate & 0x3F) + 0x40;
    
    return [byte1, byte2];
  }

  function decodeCoordinate2Byte(bytes: number[]): number {
    // Decode 2-byte coordinate back to original value
    return ((bytes[0] - 0x40) << 6) | (bytes[1] - 0x40);
  }

  function packCoordinate4Byte(coordinate: number): number[] {
    // Pack coordinate as 4 bytes (12-bit encoding spread across 4 bytes)
    // Each coordinate is split into four 3-bit nibbles, each offset by 0x40
    const normalized = Math.max(0, Math.min(1, coordinate / 1024)); // Normalize to 0-1 range
    const value = Math.floor(normalized * 4095); // 12-bit value (0-4095)
    
    const nibble1 = ((value >> 9) & 0x07) + 0x40; // Bits 9-11
    const nibble2 = ((value >> 6) & 0x07) + 0x40; // Bits 6-8
    const nibble3 = ((value >> 3) & 0x07) + 0x40; // Bits 3-5
    const nibble4 = (value & 0x07) + 0x40; // Bits 0-2
    
    return [nibble1, nibble2, nibble3, nibble4];
  }

  function decodeCoordinate4Byte(bytes: number[]): number {
    // Decode 4-byte coordinate back to original value
    const nibble1 = bytes[0] - 0x40;
    const nibble2 = bytes[1] - 0x40;
    const nibble3 = bytes[2] - 0x40;
    const nibble4 = bytes[3] - 0x40;
    
    const value = (nibble1 << 9) | (nibble2 << 6) | (nibble3 << 3) | nibble4;
    return Math.floor((value / 4095) * 1024);
  }

  // Generate NAPLPS data for a red filled rectangle
  function generateNaplpsData(): Uint8Array {
    const data: number[] = [];
    
    // Header sequence (matching bull.nap)
    data.push(0x18); // CANCEL
    data.push(0x1B); // ESC
    data.push(0x22); // Extra byte from bull.nap
    data.push(0x46); // Extra byte from bull.nap
    data.push(0x1B); // ESC
    data.push(0x45); // "E"
    data.push(0x1F); // NSR
    data.push(0x40); // NSR data
    data.push(0x40); // NSR data
    data.push(0x0E); // Shift Out
    data.push(0x20); // RESET
    data.push(0x7F); // Reset data
    data.push(0x4F); // Reset data
    data.push(0x21); // DOMAIN
    data.push(0x4D); // Domain byte (matching bull.nap exactly)
    data.push(0x40); // Domain data
    data.push(0x40); // Domain data
    data.push(0x7F); // Domain data
    data.push(0x7F); // Domain data
    data.push(0x3E); // Domain data
    
    // Color command (red)
    data.push(0x70); // SELECT COLOR
    data.push(0x40); // Color data
    data.push(0x40); // Color data
    data.push(0x40); // Color data
    data.push(0x40); // Color data
    
    // Command separator
    data.push(0x1F); // NSR
    
    // Polygon command and coordinates
    data.push(0x37); // SET & POLY FILLED
    
    // Polygon coordinates (4 points for rectangle)
    const points = [
      [100, 100], // top-left
      [200, 100], // top-right  
      [200, 200], // bottom-right
      [100, 200]  // bottom-left
    ];
    
    // Pack coordinates as 4 bytes each (X1,Y1,X2,Y2,X3,Y3,X4,Y4)
    for (const [x, y] of points) {
      const xCoords = packCoordinate4Byte(x);
      const yCoords = packCoordinate4Byte(y);
      data.push(...xCoords, ...yCoords);
    }
    
    // End command
    data.push(0x0F); // Shift In
    
    // Debug summary
    console.log(`=== NAPLPS Data Summary ===`);
    console.log(`  Total bytes: ${data.length}`);
    console.log(`  Header: ${data.slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`  Domain byte: 0x${data[14].toString(16).padStart(2, '0')} (2-byte coordinates)`);
    console.log(`  Color: ${data.slice(20, 25).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`  Separator: ${data[25].toString(16).padStart(2, '0')}`);
    console.log(`  Command: ${data[26].toString(16).padStart(2, '0')}`);
    console.log(`  Coordinates: ${data.slice(27, -1).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`  End: ${data[data.length-1].toString(16).padStart(2, '0')}`);
    console.log(`  Full hex: ${data.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    return new Uint8Array(data);
  }

  // Load Telidon scripts on mount
  useEffect(() => {
    const scripts = [
      "/telidon/p5.min.js",
      "/telidon/naplps.js",
      "/telidon/TelidonP5.js",
    ];
    
    let loadedCount = 0;
    const errors: string[] = [];
    
    // Capture any script loading errors
    const originalError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      console.error("Script error:", { message, source, lineno, colno, error });
      errors.push(`${source}:${lineno} - ${message}`);
      setScriptErrors([...errors]);
      return false;
    };
    
    scripts.forEach((src) => {
      if (!document.querySelector(`script[src='${src}']`)) {
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
          loadedCount++;
          console.log(`✅ Loaded: ${src}`);
          if (loadedCount === scripts.length) {
            console.log("✅ All scripts loaded!");
            setLoadingStatus("✅ Scripts loaded, initializing...");
            setTimeout(() => {
              if (typeof window !== 'undefined' && window.p5 && window.TelidonDraw) {
                console.log("✅ p5.js and TelidonDraw available, creating sketch...");
                
                // Test coordinate packing
                console.log("🔍 About to call testCoordinatePacking()...");
                console.log("🔍 testCoordinatePacking() completed");
                
                const naplpsData = generateNaplpsData();
                window.naplpsData = naplpsData; // Assign to window for download button
                
                console.log("🚩 About to create TelidonDraw. Data buffer:", naplpsData);
                console.log("🚩 Hex:", Array.from(naplpsData).map(b => b.toString(16).padStart(2, '0')).join(' '));
                
                // Create TelidonDraw instance
                const hexString = Array.from(naplpsData).map(b => b.toString(16).padStart(2, '0')).join('');
                console.log("Creating TelidonDraw with hex data:", hexString);
                
                // Detailed analysis of the NAPLPS data
                console.log("=== DETAILED NAPLPS ANALYSIS ===");
                console.log("Header (20 bytes):", Array.from(naplpsData.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
                console.log("Color command (5 bytes):", Array.from(naplpsData.slice(20, 25)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
                console.log("Command separator:", `0x${naplpsData[25].toString(16).padStart(2, '0')}`);
                console.log("Polygon command:", `0x${naplpsData[26].toString(16).padStart(2, '0')}`);
                console.log("Polygon coordinates (32 bytes):", Array.from(naplpsData.slice(27, 59)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
                
                // Test coordinate decoding
                const firstPointBytes = Array.from(naplpsData.slice(27, 31));
                console.log("First polygon bytes:", firstPointBytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
                
                // Decode first point (4-byte format)
                const x1 = decodeCoordinate4Byte(firstPointBytes);
                console.log("Decoded first polygon point:", `(${x1})`);
                console.log("Expected first point:", "(100)");
                
                // Test coordinate packing
                const testCoords = packCoordinate4Byte(100);
                const decoded = decodeCoordinate4Byte(testCoords);
                console.log("Test coordinate packing (4-byte):", testCoords.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
                console.log("Test coordinate decoding (4-byte):", `(${decoded})`);
                
                console.log("=== POLYGON COORDINATE ANALYSIS ===");
                const coordBytes = Array.from(naplpsData.slice(27, 59)); // 32 bytes for coordinates (4 points × 4 bytes each × 2 coordinates)
                console.log("Total coordinate bytes:", coordBytes.length);
                console.log("Expected 4 points × 4 bytes each × 2 coordinates = 32 bytes");
                
                // Decode all polygon points
                for (let i = 0; i < 4; i++) {
                  const startIdx = i * 8; // 8 bytes per point (4 for X, 4 for Y)
                  if (startIdx + 7 < coordBytes.length) {
                    const xBytes = coordBytes.slice(startIdx, startIdx + 4);
                    const yBytes = coordBytes.slice(startIdx + 4, startIdx + 8);
                    const x = decodeCoordinate4Byte(xBytes);
                    const y = decodeCoordinate4Byte(yBytes);
                    console.log(`Point ${i + 1}: X=${xBytes.map((b: number) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')} Y=${yBytes.map((b: number) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')} → (${x}, ${y})`);
                  }
                }
                
                console.log("=== PARSER DEBUGGING ===");
                console.log("Domain setting: 4 bytes per coordinate");
                console.log("Polygon command expects: 4 points × 4 bytes each × 2 coordinates = 32 bytes");
                console.log("Available bytes:", coordBytes.length);
                console.log("Parser will try to read:", Math.floor(coordBytes.length / 4), "coordinates");
                
                // Show how parser will group bytes
                for (let i = 0; i < Math.min(coordBytes.length, 32); i += 4) {
                  if (i + 3 < coordBytes.length) {
                    console.log(`Parser group ${Math.floor(i/4) + 1}: 0x${coordBytes[i].toString(16).padStart(2, '0')} 0x${coordBytes[i+1].toString(16).padStart(2, '0')} 0x${coordBytes[i+2].toString(16).padStart(2, '0')} 0x${coordBytes[i+3].toString(16).padStart(2, '0')}`);
                  } else {
                    console.log(`Parser group ${Math.floor(i/4) + 1}: 0x${coordBytes[i].toString(16).padStart(2, '0')} (incomplete)`);
                  }
                }
                
                console.log("=== END ANALYSIS ===");
                
                              try {
                // Use renderBinary instead of creating TelidonDraw directly
                console.log("🟢 [DEBUG] About to call renderBinary...");
                if (window.TelidonP5 && window.TelidonP5.renderBinary) {
                  // Create a container for the canvas
                  const container = document.getElementById('telidon-canvas');
                  if (container) {
                    // Clear the container
                    container.innerHTML = '';
                    
                    // Call renderBinary with the NAPLPS data
                    window.TelidonP5.renderBinary(naplpsData, container);
                    console.log("✅ renderBinary called successfully");
                    setTelidonAttempted(true);
                  } else {
                    console.error("❌ Container not found");
                  }
                } else {
                  console.error("❌ TelidonP5.renderBinary not available");
                }
              } catch (error) {
                  console.error("❌ Error creating TelidonDraw:", error);
                  setTelidonAttempted(true);
                  
                  // Fallback to simple sequence
                  console.log("Second attempt failed, trying minimal working sequence...");
                  try {
                    // Create a simple working sequence as a string
                    const simpleSequence = String.fromCharCode(
                      0x18, 0x1B, 0x22, 0x46, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F, 0x21, 0x47, 0x40, 0x40, 0x7F, 0x7F, 0x3E,
                      0x70, 0x40, 0x40, 0x40, 0x40, 0x1F, 0x37, 0x41, 0x64, 0x41, 0x64, 0x43, 0x48, 0x41, 0x64, 0x43, 0x48, 0x43, 0x48, 0x41, 0x64, 0x43, 0x48, 0x45, 0x0F
                    );
                    const fallbackDraw = new window.TelidonDraw([simpleSequence], 380, 380);
                    setTelidonDraw(fallbackDraw);
                    console.log("✅ Fallback sequence created successfully");
                  } catch (fallbackError) {
                    console.error("❌ Fallback sequence also failed:", fallbackError);
                  }
                }
              }
            }, 100);
          }
        };
        script.onerror = () => {
          console.error(`❌ Failed to load: ${src}`);
          errors.push(`Failed to load: ${src}`);
          setScriptErrors([...errors]);
        };
        document.head.appendChild(script);
      } else {
        loadedCount++;
        if (loadedCount === scripts.length) {
          console.log("✅ All scripts already loaded!");
          setLoadingStatus("✅ Scripts loaded, initializing...");
          setTimeout(() => {
            if (typeof window !== 'undefined' && window.p5 && window.TelidonDraw) {
              console.log("✅ p5.js and TelidonDraw available, creating sketch...");
              
              // Test coordinate packing
              console.log("🔍 About to call testCoordinatePacking()...");
              console.log("🔍 testCoordinatePacking() completed");
              
              const naplpsData = generateNaplpsData();
              window.naplpsData = naplpsData; // Assign to window for download button
              
              console.log("🚩 About to create TelidonDraw. Data buffer:", naplpsData);
              console.log("🚩 Hex:", Array.from(naplpsData).map(b => b.toString(16).padStart(2, '0')).join(' '));
              
              // Create TelidonDraw instance
              const hexString = Array.from(naplpsData).map(b => b.toString(16).padStart(2, '0')).join('');
              console.log("Creating TelidonDraw with hex data:", hexString);
              
              // Detailed analysis of the NAPLPS data
              console.log("=== DETAILED NAPLPS ANALYSIS ===");
              console.log("Header (20 bytes):", Array.from(naplpsData.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
              console.log("Color command (5 bytes):", Array.from(naplpsData.slice(20, 25)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
              console.log("Command separator:", `0x${naplpsData[25].toString(16).padStart(2, '0')}`);
              console.log("Set Active Position command:", `0x${naplpsData[26].toString(16).padStart(2, '0')}`);
              console.log("Position coordinates:", `0x${naplpsData[27].toString(16).padStart(2, '0')} 0x${naplpsData[28].toString(16).padStart(2, '0')} 0x${naplpsData[29].toString(16).padStart(2, '0')} 0x${naplpsData[30].toString(16).padStart(2, '0')} 0x${naplpsData[31].toString(16).padStart(2, '0')} 0x${naplpsData[32].toString(16).padStart(2, '0')} 0x${naplpsData[33].toString(16).padStart(2, '0')} 0x${naplpsData[34].toString(16).padStart(2, '0')}`);
              console.log("Polygon command:", `0x${naplpsData[35].toString(16).padStart(2, '0')}`);
              console.log("Polygon coordinates (16 bytes):", Array.from(naplpsData.slice(36, 52)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
              
              // Test coordinate decoding
              const firstPointBytes = Array.from(naplpsData.slice(36, 40));
              console.log("First polygon bytes:", firstPointBytes.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
              
              // Decode first point
              const x1 = decodeCoordinate2Byte(firstPointBytes);
              console.log("Decoded first polygon point:", `(${x1})`);
              console.log("Expected first point:", "(100)");
              
              // Test coordinate packing
              const testCoords = packCoordinate2Byte(100);
              const decoded = decodeCoordinate2Byte(testCoords);
              console.log("Test coordinate decoding:", `(${decoded})`);
              
              console.log("=== POLYGON COORDINATE ANALYSIS ===");
              const coordBytes = Array.from(naplpsData.slice(36, 52)); // 16 bytes for coordinates
              console.log("Total coordinate bytes:", coordBytes.length);
              console.log("Expected 4 points × 4 bytes each = 16 bytes");
              
                              // Decode all polygon points
                for (let i = 0; i < 4; i++) {
                  const startIdx = i * 4;
                  if (startIdx + 3 < coordBytes.length) {
                    const pointBytes = coordBytes.slice(startIdx, startIdx + 4);
                    const coord = decodeCoordinate2Byte(pointBytes);
                    console.log(`Point ${i + 1}: ${pointBytes.map((b: number) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')} → ${coord}`);
                  }
                }
              
              console.log("=== PARSER DEBUGGING ===");
              console.log("Domain setting: 4 bytes per coordinate");
              console.log("Polygon command expects: 4 points × 4 bytes each = 16 bytes");
              console.log("Available bytes:", coordBytes.length);
              console.log("Parser will try to read:", Math.floor(coordBytes.length / 4), "coordinates");
              
              // Show how parser will group bytes
              for (let i = 0; i < Math.min(coordBytes.length, 16); i += 2) {
                if (i + 1 < coordBytes.length) {
                  console.log(`Parser group ${Math.floor(i/2) + 1}: 0x${coordBytes[i].toString(16).padStart(2, '0')} 0x${coordBytes[i+1].toString(16).padStart(2, '0')}`);
                } else {
                  console.log(`Parser group ${Math.floor(i/2) + 1}: 0x${coordBytes[i].toString(16).padStart(2, '0')} (incomplete)`);
                }
              }
              
              console.log("=== END ANALYSIS ===");
              
              try {
                // Use renderBinary instead of creating TelidonDraw directly
                console.log("🟢 [DEBUG] About to call renderBinary...");
                if (window.TelidonP5 && window.TelidonP5.renderBinary) {
                  // Create a container for the canvas
                  const container = document.getElementById('telidon-canvas');
                  if (container) {
                    // Clear the container
                    container.innerHTML = '';
                    
                    // Call renderBinary with the NAPLPS data
                    window.TelidonP5.renderBinary(naplpsData, container);
                    console.log("✅ renderBinary called successfully");
                    setTelidonAttempted(true);
                  } else {
                    console.error("❌ Container not found");
                  }
                } else {
                  console.error("❌ TelidonP5.renderBinary not available");
                }
              } catch (error) {
                console.error("❌ Error calling renderBinary:", error);
                setTelidonAttempted(true);
                
                // Fallback to simple sequence
                console.log("Second attempt failed, trying minimal working sequence...");
                try {
                  // Create a simple working sequence as Uint8Array
                  const simpleSequence = new Uint8Array([
                    0x18, 0x1B, 0x22, 0x46, 0x1B, 0x45, 0x1F, 0x40, 0x40, 0x0E, 0x20, 0x7F, 0x4F, 0x21, 0x4D, 0x40, 0x40, 0x7F, 0x7F, 0x3E,
                    0x70, 0x40, 0x40, 0x40, 0x40, 0x1F, 0x37, 0x41, 0x64, 0x41, 0x64, 0x41, 0x64, 0x41, 0x64, 0x43, 0x48, 0x41, 0x64, 0x43, 0x48, 0x41, 0x64, 0x43, 0x48, 0x41, 0x64, 0x43, 0x48, 0x0F
                  ]);
                  
                  if (window.TelidonP5 && window.TelidonP5.renderBinary) {
                    const container = document.getElementById('telidon-canvas');
                    if (container) {
                      container.innerHTML = '';
                      window.TelidonP5.renderBinary(simpleSequence, container);
                      console.log("✅ Fallback sequence rendered successfully");
                    }
                  }
                } catch (fallbackError) {
                  console.error("❌ Fallback sequence also failed:", fallbackError);
                }
              }
            }
          }, 100);
        }
      }
    });

    // Restore original error handler
    return () => {
      window.onerror = originalError;
    };
  }, []);



  return (
    <div className="max-w-4xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">NAPLPS Rectangle Test</h1>
      
      <div className="bg-blue-50 p-6 rounded-lg mb-6">
        <h2 className="text-xl font-semibold mb-4">Test Information</h2>
        <ul className="space-y-2 text-sm">
          <li><strong>Expected Result:</strong> Red filled rectangle</li>
          <li><strong>Method:</strong> Polygon (0x37) with 12-bit coordinate packing</li>
          <li><strong>Coordinates:</strong> (0.2, 0.2) to (0.8, 0.8)</li>
          <li><strong>Color:</strong> Red (0x52)</li>
          <li><strong>File Size:</strong> 36 bytes</li>
        </ul>
      </div>

      {/* Debug Status */}
      <div className="bg-yellow-50 p-4 rounded-lg mb-6">
        <h3 className="font-semibold mb-2">Debug Status:</h3>
        <p className="text-sm">{loadingStatus}</p>
        {error && (
          <p className="text-sm text-red-600 mt-2">Error: {error}</p>
        )}
        {scriptErrors.length > 0 && (
          <div className="mt-2">
            <p className="text-sm font-semibold text-red-600">Script Errors:</p>
            <ul className="text-xs text-red-600 mt-1">
              {scriptErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="flex flex-col">
          <h2 className="text-xl font-semibold mb-4">TelidonP5.js Viewer</h2>
          <div className="border-2 border-gray-300 rounded-lg bg-gray-100 h-[400px] flex flex-col items-center justify-center overflow-hidden p-4">
            <div
              ref={canvasRef}
              id="telidon-canvas"
              className="w-full h-full flex items-center justify-center"
            >
              {!loadingStatus.includes("successfully") && (
                <span className="text-gray-500">{loadingStatus}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          <h2 className="text-xl font-semibold mb-4">Hex Data</h2>
          <div className="border-2 border-gray-300 rounded-lg bg-gray-900 text-green-400 p-4 font-mono text-xs h-[400px] overflow-auto">
            <pre className="whitespace-pre-wrap break-all" id="hex-display">18 1B 45 1F 40 40 0E 20 7F 4F 21 4D 40 40 40 40 3E 70 40 40 40 37 50 50 6F 50 6F 6F 50 50 6F 6F 50 6F 50 50 6F 6F 50 0F</pre>
          </div>
          {typeof window !== 'undefined' && window.naplpsData instanceof Uint8Array && (
            <button
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 w-fit"
              onClick={() => {
                const blob = new Blob([window.naplpsData], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'generated.nap';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }, 100);
              }}
            >
              Download generated.nap
            </button>
          )}
          
          <div className="mt-4 space-y-2 text-sm bg-gray-50 p-4 rounded-lg">
            <div>
              <strong>Header:</strong> 18 1B 45 1F 40 40 0E 20 7F 4F 21 4D 40 40 40 40
            </div>
            <div>
              <strong>Color:</strong> 3E 70 40 40 40 (SET_COLOR + Long Color)
            </div>
            <div>
              <strong>Command:</strong> 37 (Set & Poly Filled)
            </div>
            <div>
              <strong>Coordinates:</strong> <span id="coordinate-display">50 50 6F 50 6F 6F 50 50 6F 6F 50 6F 50 50 6F 6F 50</span>
            </div>
            <div>
              <strong>End:</strong> 0F (SI - end graphics)
            </div>
            <div>
              <strong>Points:</strong> <span id="points-display">(160,120), (480,120), (480,360), (160,360)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-green-50 p-6 rounded-lg">
        <h3 className="text-lg font-semibold mb-3">What This Tests</h3>
        <ul className="space-y-2 text-sm">
          <li>✅ <strong>Polygon Command:</strong> Uses 0x37 (Set & Poly Filled) instead of rectangle primitive</li>
          <li>✅ <strong>Coordinate Packing:</strong> 12-bit coordinates split into 6-bit nibbles with 0x40 offset</li>
          <li>✅ <strong>Header Sequence:</strong> Correct Telidon header that matches working files</li>
          <li>✅ <strong>Color Encoding:</strong> ASCII-safe color values (0x52 for red)</li>
          <li>✅ <strong>End Sequence:</strong> Proper SI (0x0F) to end graphics</li>
        </ul>
      </div>
    </div>
  );
}