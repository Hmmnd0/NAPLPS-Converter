"use strict";

// Constants
const PI = Math.PI;

// RHINO/NSRC1469 coordinate system constants
const naplps_ONE = 8192;
const naplps_zoom = 4;
const naplps_xpos = 64;
const naplps_ypos = 399;

// NAPLPS/RHINO default color palette (16 colors, 0-8191 range for each channel)
const NAPLPS_PALETTE = [
    { r: 0,    g: 0,    b: 0 },      // Black
    { r: 1024, g: 1024, b: 1024 },  // Gray 1
    { r: 2048, g: 2048, b: 2048 },  // Gray 2
    { r: 3072, g: 3072, b: 3072 },  // Gray 3
    { r: 4096, g: 4096, b: 4096 },  // Gray 4
    { r: 5120, g: 5120, b: 5120 },  // Gray 5
    { r: 6144, g: 6144, b: 6144 },  // Gray 6
    { r: 8191, g: 8191, b: 8191 },  // White
    { r: 0,    g: 0,    b: 7168 },  // Blue
    { r: 0,    g: 5120, b: 7168 },  // Cyan
    { r: 0,    g: 7168, b: 4096 },  // Green
    { r: 2048, g: 7168, b: 0 },     // Yellow-Green
    { r: 7168, g: 7168, b: 0 },     // Yellow
    { r: 7168, g: 2048, b: 0 },     // Orange
    { r: 7168, g: 0,    b: 4096 },  // Magenta
    { r: 5120, g: 0,    b: 7168 }   // Purple
];

// nsrc1469's HSB color conversion system
const NAPLPS_HUE_TABLE = [
    { g: 0, r: 0, b: 7 }, { g: 0, r: 1, b: 7 }, { g: 0, r: 2, b: 7 }, { g: 0, r: 3, b: 7 },
    { g: 0, r: 4, b: 7 }, { g: 0, r: 5, b: 7 }, { g: 0, r: 6, b: 7 }, { g: 0, r: 7, b: 7 },
    { g: 0, r: 7, b: 6 }, { g: 0, r: 7, b: 5 }, { g: 0, r: 7, b: 4 }, { g: 0, r: 7, b: 3 },
    { g: 0, r: 7, b: 2 }, { g: 0, r: 7, b: 1 }, { g: 0, r: 7, b: 0 }, { g: 1, r: 7, b: 0 },
    { g: 2, r: 7, b: 0 }, { g: 3, r: 7, b: 0 }, { g: 4, r: 7, b: 0 }, { g: 5, r: 7, b: 0 },
    { g: 6, r: 7, b: 0 }, { g: 7, r: 7, b: 0 }, { g: 7, r: 6, b: 0 }, { g: 7, r: 5, b: 0 },
    { g: 7, r: 4, b: 0 }, { g: 7, r: 3, b: 0 }, { g: 7, r: 2, b: 0 }, { g: 7, r: 1, b: 0 },
    { g: 7, r: 0, b: 0 }, { g: 7, r: 0, b: 1 }, { g: 7, r: 0, b: 2 }, { g: 7, r: 0, b: 3 },
    { g: 7, r: 0, b: 4 }, { g: 7, r: 0, b: 5 }, { g: 7, r: 0, b: 6 }, { g: 7, r: 0, b: 7 },
    { g: 6, r: 0, b: 7 }, { g: 5, r: 0, b: 7 }, { g: 4, r: 0, b: 7 }, { g: 3, r: 0, b: 7 },
    { g: 2, r: 0, b: 7 }, { g: 1, r: 0, b: 7 }
];

// nsrc1469's HSB to RGB conversion
function hsb2rgb(h, s, b) {
    const hue = NAPLPS_HUE_TABLE[h % 42];
    const sat = Math.max(0, Math.min(7, s));
    const bright = Math.max(0, Math.min(7, b));
    
    const g = ((7 * sat + (hue.g * sat + 4) / 7) * bright + 4) / 7 * 2;
    const r = ((7 * sat + (hue.r * sat + 4) / 7) * bright + 4) / 7 * 2;
    const b_val = ((7 * sat + (hue.b * sat + 4) / 7) * bright + 4) / 7 * 2;
    
    return { r: r * 1024, g: g * 1024, b: b_val * 1024 };
}

// nsrc1469's RGB to HSB conversion
function rgb2hsb(r, g, b) {
    r = Math.floor(r / 124);
    g = Math.floor(g / 124);
    b = Math.floor(b / 1024);
    const max_val = Math.max(g, Math.max(r, b));
    if (!max_val) return { h: 0, s: 0, b: 0 };
    
    const norm_g = (g * 7) / max_val;
    const norm_r = (r * 7) / max_val;
    const norm_b = (b * 7) / max_val;
    
    const sat = 7 - Math.min(norm_g, Math.min(norm_r, norm_b));
    if (!sat) return { h: 0, s: 0, b: max_val };
    
    const adj_g = ((norm_g - 7 + sat) * 7 + sat / 2) / sat;
    const adj_r = ((norm_r - 7 + sat) * 7 + sat / 2) / sat;
    const adj_b = ((norm_b - 7 + sat) * 7 + sat / 2) / sat;
    
    let hue = 0;
    for (let i = 0; i < 42; i++) {
        if (NAPLPS_HUE_TABLE[i].g === adj_g && NAPLPS_HUE_TABLE[i].r === adj_r && NAPLPS_HUE_TABLE[i].b === adj_b) {
            hue = i;
            break;
        }
    }
    
    return { h: hue, s: sat, b: max_val };
}

// Global debug state
window.NAPLPS_DEBUG = {
    totalCommands: 0,
    drawingCommands: 0,
    controlCommands: 0,
    pointsExtracted: 0,
    shapesDrawn: 0,
    errors: [],
    lastCommand: null,
    canvasSize: { width: 0, height: 0 },
    coordinateStats: {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        normalizedMinX: Infinity,
        normalizedMaxX: -Infinity,
        normalizedMinY: Infinity,
        normalizedMaxY: -Infinity
    }
};

// Debug utility functions
function debugLog(category, message, data = null) {
    // Re-enable key debug logging for troubleshooting
    if (category === 'TelidonDrawCmd' && (message.includes('Sample coordinates') || message.includes('Coordinate ranges'))) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[${timestamp}] [${category}] ${message}`, data || '');
    }
}

function updateDebugStats(command, points = []) {
    window.NAPLPS_DEBUG.totalCommands++;
    window.NAPLPS_DEBUG.lastCommand = command;
    
    if (command && command.opcode) {
        const opcode = command.opcode.id;
        if (opcode.includes('POINT') || opcode.includes('LINE') || opcode.includes('ARC') || opcode.includes('RECT')) {
            window.NAPLPS_DEBUG.drawingCommands++;
        } else {
            window.NAPLPS_DEBUG.controlCommands++;
        }
    }
    
    if (points && points.length > 0) {
        window.NAPLPS_DEBUG.pointsExtracted += points.length;
        
        // Track coordinate ranges
        points.forEach(point => {
            if (point.x !== undefined && point.y !== undefined) {
                window.NAPLPS_DEBUG.coordinateStats.minX = Math.min(window.NAPLPS_DEBUG.coordinateStats.minX, point.x);
                window.NAPLPS_DEBUG.coordinateStats.maxX = Math.max(window.NAPLPS_DEBUG.coordinateStats.maxX, point.x);
                window.NAPLPS_DEBUG.coordinateStats.minY = Math.min(window.NAPLPS_DEBUG.coordinateStats.minY, point.y);
                window.NAPLPS_DEBUG.coordinateStats.maxY = Math.max(window.NAPLPS_DEBUG.coordinateStats.maxY, point.y);
            }
        });
    }
}

function printDebugSummary() {
    // Temporarily disable debug summary to stop the loop
    // console.log('=== NAPLPS DEBUG SUMMARY ===');
    // console.log('Total Commands:', window.NAPLPS_DEBUG.totalCommands);
    // console.log('Drawing Commands:', window.NAPLPS_DEBUG.drawingCommands);
    // console.log('Control Commands:', window.NAPLPS_DEBUG.controlCommands);
    // console.log('Points Extracted:', window.NAPLPS_DEBUG.pointsExtracted);
    // console.log('Shapes Drawn:', window.NAPLPS_DEBUG.shapesDrawn);
    // console.log('Canvas Size:', window.NAPLPS_DEBUG.canvasSize);
    // console.log('Coordinate Ranges:', window.NAPLPS_DEBUG.coordinateStats);
    // console.log('Last Command:', window.NAPLPS_DEBUG.lastCommand);
    // if (window.NAPLPS_DEBUG.errors.length > 0) {
    //     console.log('Errors:', window.NAPLPS_DEBUG.errors);
    // }
    // console.log('===========================');
}

// 5. Drawing class--this is where it all comes together.
// p5.js-specific drawing code is separated here.
class TelidonDraw {
	    
    constructor(_filePath, _w, _h, p) { // string, number, number, p5 instance
        debugLog('TelidonDraw', 'Constructor called', { filePath: _filePath, width: _w, height: _h, p5Available: !!p });
        
        if (typeof NapDecoder === 'undefined') {
            const error = 'NapDecoder not available!';
            console.error('[TelidonDraw]', error);
            window.NAPLPS_DEBUG.errors.push(error);
            throw new Error(error);
        }
        
        this.decoder = new NapDecoder(_filePath); 
        this.drawCmds = []; // NapDrawCmd[]
        this.counter = 0;
        this.finished = false;
        this.p = p;
        
        debugLog('TelidonDraw', 'Decoder created', { 
            commands: this.decoder.cmds.length,
            version: this.decoder.version 
        });
        
        for (let i=0; i<this.decoder.cmds.length; i++) {
            let cmd = this.decoder.cmds[i]; // NapCmd
            let drawCmd = new TelidonDrawCmd(cmd, _w, _h, p);
            this.drawCmds.push(drawCmd);
            
            // Track coordinate stats for this command
            if (drawCmd.points && drawCmd.points.length > 0) {
                drawCmd.points.forEach(point => {
                    if (point.x !== undefined && point.y !== undefined) {
                        window.NAPLPS_DEBUG.coordinateStats.normalizedMinX = Math.min(window.NAPLPS_DEBUG.coordinateStats.normalizedMinX, point.x);
                        window.NAPLPS_DEBUG.coordinateStats.normalizedMaxX = Math.max(window.NAPLPS_DEBUG.coordinateStats.normalizedMaxX, point.x);
                        window.NAPLPS_DEBUG.coordinateStats.normalizedMinY = Math.min(window.NAPLPS_DEBUG.coordinateStats.normalizedMinY, point.y);
                        window.NAPLPS_DEBUG.coordinateStats.normalizedMaxY = Math.max(window.NAPLPS_DEBUG.coordinateStats.normalizedMaxY, point.y);
                    }
                });
            }
        }
        
        window.NAPLPS_DEBUG.canvasSize = { width: _w, height: _h };
        debugLog('TelidonDraw', 'Constructor completed', { 
            drawCommands: this.drawCmds.length,
            p5Available: !!this.p 
        });
    }

    draw() {
        const p = this.p;
        
        if (this.decoder.version === 699 && p && typeof p.background === 'function') {
            p.background(127);
        }
        
        for (let i=0; i<this.drawCmds.length; i++) {
            let drawCmd = this.drawCmds[i];
            if (!drawCmd.moveScanline) this.counter++;
            if (i === this.counter || !drawCmd.moveScanline) {
                drawCmd.draw();
            }
            if (!drawCmd.finished) this.finished = false;
        }
        
        // Only set finished after all commands are processed
        this.finished = true;
    }

}

class TelidonDrawCmd {
   
    constructor(_cmd, _w, _h, p) { // NapCmd, number, number, p5 instance
        this.cmd = _cmd; // NapCmd
        this.w = _w;
        this.h = _h;
        this.p = p;
        //this.tex = createGraphics(w, h); // PGraphics
        //this.tex.scale(1/pixelDensity());
        this.scanPos = this.h; // float
        this.scanDelta = 5; // float
        this.moveScanline = false;
        this.progressiveDraw = true;
        this.labelPoints = false;
        this.col = (p && typeof p.color === 'function') ? p.color(0) : null;
        this.thickness = 1;
        this.text = "";
        this.markTime = 0;
        this.progressiveDrawInterval = 66;
        this.extraLoopCounter = 0;

        this.points = [];
        this.pointsIndex = 0;
        this.maxCoord = 100000; // Increased to make shapes larger - coordinates are being normalized to very small values
        console.log('[TelidonDrawCmd] maxCoord set to', this.maxCoord);

        console.log('[TelidonDrawCmd] Constructor called', { 
            opcode: _cmd.opcode.id,
            dataLength: _cmd.data ? _cmd.data.length : 0,
            pointsLength: _cmd.points ? _cmd.points.length : 0,
            hasPoints: !!_cmd.points,
            hasData: !!_cmd.data,
            p5Available: !!p 
        });
        
        // Debug: Log the actual command structure for first few commands
        if (this.points.length < 3) {
            console.log('[TelidonDrawCmd] Command structure:', {
                opcode: _cmd.opcode,
                data: _cmd.data ? _cmd.data.slice(0, 3) : null,
                points: _cmd.points ? _cmd.points.slice(0, 3) : null,
                coords: _cmd.coords ? _cmd.coords.slice(0, 3) : null,
                vertices: _cmd.vertices ? _cmd.vertices.slice(0, 3) : null,
                allProperties: Object.keys(_cmd),
                cmdType: typeof _cmd,
                hasRawData: !!_cmd.rawData,
                hasProcessedData: !!_cmd.processedData,
                fullCommand: _cmd
            });
        }
        
        // Debug: Log the actual points from naplps.js for first few commands
        if (_cmd.points && _cmd.points.length > 0) {
            console.log('[TelidonDrawCmd] Raw points from naplps.js:', _cmd.points.slice(0, 5));
        }

        // Extract coordinate data from NAPLPS command
        if (this.cmd && this.cmd.points && this.cmd.points.length > 0) {
            // The NapCmd already has coordinates extracted and stored as [x, y] arrays
            console.log('[TelidonDrawCmd] Found points in command:', this.cmd.points.length);
            console.log('[TelidonDrawCmd] First few points from naplps.js:', this.cmd.points.slice(0, 3));
            
            // RHINO-style coordinate system
            const ONE = 8192; // base coordinate system
            const zoom = 2; // RHINO's default zoom - reduced from 4 to make shapes larger
            const xpos = 64; // RHINO's default left x pos
            const ypos = 399; // RHINOs default under y pos
            
            // RHINO's scaling functions
            const SCALE = (d) => ((d) >> zoom);
            const X_SCALE = (d) => (xpos + (SCALE(d)));
            const Y_SCALE = (d) => (ypos - (SCALE(d)));
            
            this.points = this.cmd.points.map(p => {
                // Use RHINO's coordinate approach
                const rawX = p[0];
                const rawY = p[1];
                
                // Apply RHINO scaling
                const scaledX = X_SCALE(rawX);
                const scaledY = Y_SCALE(rawY);
                
                // Convert to canvas coordinates (0-1 range)
                const canvasX = scaledX /800; // Assuming 800x600 canvas
                const canvasY = scaledY /600; // Assuming 800x600 canvas // Assuming 600
                
                console.log(`[TelidonDrawCmd] RHINO conversion: raw(${rawX}, ${rawY}) -> scaled(${scaledX}, ${scaledY}) -> canvas(${canvasX}, ${canvasY})`);
                
                return {
                    x: canvasX,
                    y: canvasY
                };
            });
            console.log('[TelidonDrawCmd] Converted', this.points.length, 'points from command');
        } else if (this.cmd && this.cmd.data && this.cmd.data.length > 0) {
            // Fallback: try to extract coordinates from raw data
            console.log('[TelidonDrawCmd] No points found, trying to extract from data for', this.cmd.opcode.id);
            this.extractPointsFromData();
            console.log('[TelidonDrawCmd] Points extracted for', this.cmd.opcode.id, ':', this.points.length, 'points');
        } else {
            console.log('[TelidonDrawCmd] No data or points for', this.cmd.opcode.id, '- data length:', this.cmd.data ? this.cmd.data.length : 0, 'points length:', this.cmd.points ? this.cmd.points.length : 0);
        }

        if (!this.progressiveDraw) {
            for (let point of this.points) {
                if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) {
                    this.points.push(point);
                }
            }
        }
        this.finished = false;
        
        updateDebugStats(this.cmd, this.points);
    }
    
    update() {
        //if (this.moveScanline) {
            //this.scanPos -= this.scanDelta;
            //if (this.scanPos <= 0) this.moveScanline = false;
        //}
        if (safeMillis() > this.markTime + this.progressiveDrawInterval) {
            if (this.progressiveDraw && this.pointsIndex < this.points.length) {
                this.pointsIndex++;
                this.markTime = safeMillis();
            }
        }

        if (!this.finished && this.pointsIndex >= this.points.length) {
            if (this.extraLoopCounter < this.progressiveDrawInterval) {
                this.extraLoopCounter++;
            } else {
                this.finished = true;
            }
        }
    }
    
    draw() {
        // *** IMPORTANT STEP 3 of 3 ***
        // This is where the decoded commands finally get drawn to the screen.
        // Log all commands, including control commands like SET COLOR
        console.log('[TelidonDrawCmd] Processing command:', this.cmd.opcode.id, 'with', this.points.length, 'points');
        
        switch(this.cmd.opcode.id) {
        	//~ ~ ~ ~ ~ CONTROL CODES ~ ~ ~ ~ ~
            case("Shift-Out"): // graphics mode, we're here by default
           		debugLog('TelidonDrawCmd', 'Shift-Out (graphics mode)');
                break;
            case("Shift-In"): // text mode, data that follows is text
                debugLog('TelidonDrawCmd', 'Shift-In (text mode)', { text: this.cmd.text });
                this.drawText(this.cmd.text);               
                break;
            case("CANCEL"):
           		debugLog('TelidonDrawCmd', 'CANCEL');
                break;
            case("ESC"):
           		debugLog('TelidonDrawCmd', 'ESC');
                break;
            case("NSR"): // Non-Selective Reset
           		debugLog('TelidonDrawCmd', 'NSR (Non-Selective Reset)');
                break;
            //~ ~ ~ PDI (PICTURE DESCRIPTION INSTRUCTION) CODES ~ ~ ~ ~ ~
            //~ ~ ~ ENVIRONMENT, part 1 ~ ~ ~
            case("RESET"):
                debugLog('TelidonDrawCmd', 'RESET');
                // TODO
                break;
            case("DOMAIN"): // header information
                debugLog('TelidonDrawCmd', 'DOMAIN');
                // Extract domain settings for coordinate processing
                if (this.cmd.data && this.cmd.data.length > 0) {
                    // Parse domain settings to get coordinate format
                    console.log('[TelidonDrawCmd] DOMAIN command with data:', this.cmd.data.length, 'bytes');
                }
                break;
            case("TEXT"):
                debugLog('TelidonDrawCmd', 'TEXT');
                // Handle text rendering
                if (this.cmd.text) {
                    console.log('[TelidonDrawCmd] TEXT command:', this.cmd.text);
                }
                break;
            case("TEXTURE"):
                debugLog('TelidonDrawCmd', 'TEXTURE');
                // Handle texture settings
                console.log('[TelidonDrawCmd] TEXTURE command');
                break;
            //~ ~ ~ POINTS ~ ~ ~
            case("POINT SET ABS"):
                debugLog('TelidonDrawCmd', 'POINT SET ABS', { points: this.points.length });
        		this.drawPoints(this.points, this.w, this.h);
                break;
            case("POINT SET REL"):
                debugLog('TelidonDrawCmd', 'POINT SET REL', { points: this.points.length });
        		this.drawPoints(this.points, this.w, this.h);
                break;
            case("POINT ABS"):
                debugLog('TelidonDrawCmd', 'POINT ABS', { points: this.points.length });
        		this.drawPoints(this.points, this.w, this.h);
                break;
            case("POINT REL"):
                debugLog('TelidonDrawCmd', 'POINT REL', { points: this.points.length });
        		this.drawPoints(this.points, this.w, this.h);
                break;
            //~ ~ ~ LINES ~ ~ ~
            case("LINE ABS"):
                debugLog('TelidonDrawCmd', 'LINE ABS', { points: this.points.length });
        		this.drawLines(this.points, this.w, this.h);
                break;
            case("LINE REL"):
                debugLog('TelidonDrawCmd', 'LINE REL', { points: this.points.length });
        		this.drawLines(this.points, this.w, this.h);
                break;
            case("SET & LINE ABS"):
                debugLog('TelidonDrawCmd', 'SET & LINE ABS', { points: this.points.length });
        		this.drawLines(this.points, this.w, this.h);
                break;
            case("SET & LINE REL"):
                debugLog('TelidonDrawCmd', 'SET & LINE REL', { points: this.points.length });
        		this.drawLines(this.points, this.w, this.h);
            	break;
            //~ ~ ~ ARCS ~ ~ ~
            case("ARC OUTLINED"):
                debugLog('TelidonDrawCmd', 'ARC OUTLINED', { points: this.points.length });
        		this.drawArc(this.points, this.w, this.h, false);
                break;
            case("ARC FILLED"):
                debugLog('TelidonDrawCmd', 'ARC FILLED', { points: this.points.length });
        		this.drawArc(this.points, this.w, this.h, true);
                break;
            case("SET & ARC OUTLINED"):
                debugLog('TelidonDrawCmd', 'SET & ARC OUTLINED', { points: this.points.length });
        		this.drawArc(this.points, this.w, this.h, false);
                break;
            case("SET & ARC FILLED"):
                debugLog('TelidonDrawCmd', 'SET & ARC FILLED', { points: this.points.length });
        		this.drawArc(this.points, this.w, this.h, true);
            	break;
            //~ ~ ~ RECTANGLES ~ ~ ~
            case("RECT OUTLINED"):
                debugLog('TelidonDrawCmd', 'RECT OUTLINED', { points: this.points.length });
        		this.drawRect(this.points, this.w, this.h, false);
                break;
            case("RECT FILLED"):
                debugLog('TelidonDrawCmd', 'RECT FILLED', { points: this.points.length });
        		this.drawRect(this.points, this.w, this.h, true);
                break;
            case("SET & RECT OUTLINED"):
                debugLog('TelidonDrawCmd', 'SET & RECT OUTLINED', { points: this.points.length });
        		this.drawRect(this.points, this.w, this.h, false);
                break;
            case("SET & RECT FILLED"):
                debugLog('TelidonDrawCmd', 'SET & RECT FILLED', { points: this.points.length });
        		this.drawRect(this.points, this.w, this.h, true);
            	break;
            //~ ~ ~ POLYGONS ~ ~ ~
            case("POLY OUTLINED"):
                debugLog('TelidonDrawCmd', 'POLY OUTLINED', { points: this.points.length });
        		this.drawPolygon(this.points, this.w, this.h, false);
                break;
            case("POLY FILLED"):
                debugLog('TelidonDrawCmd', 'POLY FILLED', { points: this.points.length });
        		this.drawPolygon(this.points, this.w, this.h, true);
                break;
            case("SET & POLY OUTLINED"): // relative points after first 
                debugLog('TelidonDrawCmd', 'SET & POLY OUTLINED', { points: this.points.length });
        		this.drawPolygon(this.points, this.w, this.h, false);
                break;
            case("SET & POLY FILLED"): // relative points after first 
                debugLog('TelidonDrawCmd', 'SET & POLY FILLED', { points: this.points.length });
                console.log(`[TelidonDrawCmd] SET & POLY FILLED: ${this.points.length} points, canvas: ${this.w}x${this.h}`);
                if (this.points.length > 0) {
                    console.log(`[TelidonDrawCmd] First point: (${this.points[0].x}, ${this.points[0].y}) -> canvas(${this.points[0].x * this.w}, ${this.points[0].y * this.h})`);
                    console.log(`[TelidonDrawCmd] Last point: (${this.points[this.points.length-1].x}, ${this.points[this.points.length-1].y}) -> canvas(${this.points[this.points.length-1].x * this.w}, ${this.points[this.points.length-1].y * this.h})`);
                }
        		this.drawPolygon(this.points, this.w, this.h, true);
                break;
            //~ ~ ~ INCREMENTALS ~ ~ ~
            case("FIELD"):
                debugLog('TelidonDrawCmd', 'FIELD');
				// TODO	            
                break;
            case("INCREMENTAL POINT"):
                debugLog('TelidonDrawCmd', 'INCREMENTAL POINT');
				// TODO	            
                break;
            case("INCREMENTAL LINE"):
                debugLog('TelidonDrawCmd', 'INCREMENTAL LINE');
				// TODO	            
                break;
            case("INCREMENTAL POLY FILLED"):
                debugLog('TelidonDrawCmd', 'INCREMENTAL POLY FILLED');
				// TODO	            
                break;
            //~ ~ ~ ENVIRONMENT, part 2 ~ ~ ~ 
            case("SET COLOR"): // this picks a color
                debugLog('TelidonDrawCmd', 'SET COLOR', { color: this.cmd.col });
                console.log(`[TelidonDrawCmd] SET COLOR: ${JSON.stringify(this.cmd.col)}`);
                // Handle color from naplps.js - should be a Vector3 object with x,y,z properties
                if (this.cmd.col && typeof this.cmd.col.x !== 'undefined' && typeof this.cmd.col.y !== 'undefined' && typeof this.cmd.col.z !== 'undefined') {
                    this.setColor(this.cmd.col);
                } else if (typeof window.naplps_lastColor !== 'undefined' && window.naplps_lastColor) {
                    // Fallback to global color from naplps.js
                    console.log(`[TelidonDrawCmd] SET COLOR: Using global naplps_lastColor: ${JSON.stringify(window.naplps_lastColor)}`);
                    this.setColor(window.naplps_lastColor);
                } else {
                    console.log(`[TelidonDrawCmd] SET COLOR: Invalid color object: ${JSON.stringify(this.cmd.col)}`);
                }
                break;
            case("WAIT"):
                debugLog('TelidonDrawCmd', 'WAIT');
				// TODO	            
                break;
            case("SELECT COLOR"): // this sets the color mode
                debugLog('TelidonDrawCmd', 'SELECT COLOR', { color: this.cmd.col });
				this.setColor(this.cmd.col);           
                break
            case("BLINK"):
				// TODO	            
                break;
            default:
                break;    
    	}
        
        // TODO faster pixel drawing https://p5js.org/reference/#/p5/pixels
        //if (this.moveScanline) {
            /*
            this.tex.loadPixels();
            for (let x=0; x < this.tex.width; x++) {
                for (let y=0; y < this.tex.height; y++) {
                    let loc = 4 * (x + y*this.tex.width);
                    if (y <= this.scanPos) {
                        this.tex.pixels[loc] = 0;
                        this.tex.pixels[loc + 1] = 0;
                        this.tex.pixels[loc + 2] = 0;
                        this.tex.pixels[loc + 3] = 0;
                    }
                }
            }
            this.tex.updatePixels();
            */
            //image(this.tex.get(0, this.scanPos, this.tex.width, this.tex.height), 0, this.scanPos);
        //} else {        
            //image(this.tex, 0, 0);
        //}
    }
    
    run() {
        this.update();
        this.draw();
    }

    extractPointsFromData() {
        if (!this.cmd || !this.cmd.data) {
            return;
        }
        
        // Get the number of bytes per coordinate from the domain settings
        const bytesPerCoord = this.cmd.pointBytes || 3; // Default to 3 bytes per coordinate
        const pointByteLength = bytesPerCoord * 2; // X and Y coordinates
        
        if (this.cmd.data.length < pointByteLength) {
            return;
        }
        
        // Process all coordinate pairs in the data
        for (let i = 0; i <= this.cmd.data.length - pointByteLength; i += pointByteLength) {
            // Extract X coordinate bytes
            const xBytes = [];
            for (let j = 0; j < bytesPerCoord; j++) {
                if (i + j < this.cmd.data.length) {
                    xBytes.push(this.cmd.data[i + j].c.charCodeAt(0));
                }
            }
            
            // Extract Y coordinate bytes
            const yBytes = [];
            for (let j = 0; j < bytesPerCoord; j++) {
                if (i + bytesPerCoord + j < this.cmd.data.length) {
                    yBytes.push(this.cmd.data[i + bytesPerCoord + j].c.charCodeAt(0));
                }
            }
            
            if (xBytes.length === bytesPerCoord && yBytes.length === bytesPerCoord) {
                // Decode coordinates using the same method as naplps.js
                const xVal = this.decodeCoord(xBytes);
                const yVal = this.decodeCoord(yBytes);
                
                // Normalize coordinates to 0-1 range using NAPLPS coordinate range (0-4095)
                const x = xVal / 4095;
                const y = yVal / 4095;
                console.log(`[TelidonDrawCmd] Converting: raw(${xVal}, ${yVal}) -> normalized(${x}, ${y})`);
                
                this.points.push({
                    x: x,
                    y: y
                });
            }
        }
    }
    
    decodeCoord(bytes) {
        let result = 0;
        for (let i = 0; i < bytes.length; i++) {
            const value = (bytes[i] & 0x3F); // strip high 2 bits
            result = (result << 6) | value;
        }
        return result;
    }
    
    extractPointsFromRawData() {
        // Similar to extractPointsFromData but for rawData
        const bytesPerCoord = this.cmd.pointBytes || 3;
        const pointByteLength = bytesPerCoord * 2;
        
        for (let i = 0; i <= this.cmd.rawData.length - pointByteLength; i += pointByteLength) {
            const xBytes = [];
            const yBytes = [];
            
            for (let j = 0; j < bytesPerCoord; j++) {
                if (i + j < this.cmd.rawData.length) {
                    xBytes.push(this.cmd.rawData[i + j]);
                }
            }
            
            for (let j = 0; j < bytesPerCoord; j++) {
                if (i + bytesPerCoord + j < this.cmd.rawData.length) {
                    yBytes.push(this.cmd.rawData[i + bytesPerCoord + j]);
                }
            }
            
            if (xBytes.length === bytesPerCoord && yBytes.length === bytesPerCoord) {
                const xVal = this.decodeCoord(xBytes);
                const yVal = this.decodeCoord(yBytes);
                
                // Normalize coordinates to 0-1 range using NAPLPS coordinate range (0-4095)
                const x = xVal / 4095;
                const y = yVal / 4095;
                
                this.points.push({
                    x: x,
                    y: y
                });
            }
        }
    }
    
    extractPointsFromProcessedData() {
        // Try to extract coordinates from processed data
        for (let i = 0; i < this.cmd.processedData.length; i += 2) {
            if (i + 1 < this.cmd.processedData.length) {
                const x = this.cmd.processedData[i];
                const y = this.cmd.processedData[i + 1];
                
                if (typeof x === 'number' && typeof y === 'number') {
                    // Normalize coordinates to 0-1 range using NAPLPS coordinate range (0-4095)
                    const normalizedX = x / 4095;
                    const normalizedY = y / 4095;
                    
                    this.points.push({
                        x: normalizedX,
                        y: normalizedY
                    });
                }
            }
        }
    }
 
    setBackground(v) {
        if (this.p && typeof this.p.background === 'function' && typeof this.p.color === 'function') {
            this.p.background(this.p.color(v.x, v.y, v.z));
        }
    }

    setColor(v) {
        console.log(`[TelidonDrawCmd] setColor called with: ${JSON.stringify(v)}`);
        if (this.p && typeof this.p.color === 'function') {
            // Handle Vector3 object from naplps.js
            if (v && typeof v.x !== 'undefined' && typeof v.y !== 'undefined' && typeof v.z !== 'undefined') {
                // nsrc1469s color handling: Use RGB values directly
                this.col = this.p.color(v.x, v.y, v.z);
                console.log(`[TelidonDrawCmd] Created p5 color from Vector3 ${this.col} (R:${v.x}, G:${v.y}, B:${v.z})`);
            } else if (typeof v === 'number') {
                // nsrc1469s palette lookup: Treat as color index
                const colorIndex = Math.floor(v) % NAPLPS_PALETTE.length;
                const paletteColor = NAPLPS_PALETTE[colorIndex];
                this.col = this.p.color(paletteColor.r, paletteColor.g, paletteColor.b);
                console.log(`[TelidonDrawCmd] Created p5 color from palette index ${colorIndex}: ${this.col} (R:${paletteColor.r}, G:${paletteColor.g}, B:${paletteColor.b})`);
            } else {
                console.log(`[TelidonDrawCmd] Invalid color object: ${JSON.stringify(v)}`);
            }
        } else {
            console.log(`TelidonDrawCmd] p5available or color function not found`);
        }
    }

    drawText(_text) {
        //fill(255);
        //stroke(0);
        this.p.text(_text, this.p.width * 0.0625, this.p.height * 1.25); // TODO position
    }

    drawRect(points, w, h, isFill) { // PVector, w, h
        if (!this.p || points.length < 2) {
            console.log(`[TelidonDrawCmd] drawRect: Invalid points or p5 not available`);
            return;
        }

        // RHINO's rectangle drawing algorithm
        console.log(`[TelidonDrawCmd] drawRect: ${points.length} points, fill: ${isFill}`);

        if (points.length == 2) {
            // RHINO's approach: Two points define rectangle corners
            const x1 = points[0].x * w;
            const y1 = points[0].y * h;
            const x2 = points[1].x * w;
            const y2 = points[1].y * h;
            
            console.log(`[TelidonDrawCmd] Drawing rect: (${x1}, ${y1}) to (${x2}, ${y2})`);

            if (isFill) {                // RHINO's filled rectangle
                if (this.col) {
                    this.p.fill(this.col);
                    this.p.noStroke();
                } else {
                    this.p.fill(255);
                    this.p.noStroke();
                }
                this.p.rectMode(this.p.CORNER);
                this.p.rect(x1, y1, x2-x1, y2-y1);
            } else {                // RHINO's outlined rectangle
                if (this.col) {
                    this.p.stroke(this.col);
                    this.p.noFill();
                } else {
                    this.p.stroke(255);
                    this.p.noFill();
                }
                this.p.rectMode(this.p.CORNER);
                this.p.rect(x1, y1, x2-x1, y2-y1);
            }
        } else {
            // Multiple points - treat as polygon
            this.drawPolygon(points, w, h, isFill);
        }
    }

    drawArc(points, w, h, isFill) { // PVector, w, h
        if (!this.p || points.length < 2) {
            console.log(`[TelidonDrawCmd] drawArc: Invalid points or p5 not available`);
            return;
        }

        // nsrc1469 drawing algorithm
        console.log(`[TelidonDrawCmd] drawArc: ${points.length} points, fill: ${isFill}`);

        if (points.length === 2) { // nsrc1469proach: Two points - draw as line
            this.drawLines(points, w, h);
            return;
        }

        if (points.length === 3) { // nsrc1469ic arc calculation
            const p0 = points[0];
            const p1 = points[1];
            const p2 = points[2];
            // Convert to canvas coordinates
            const x0 = p0.x * w;
            const y0 = p0.y * h;
            const x1 = p1.x * w;
            const y1 = p1.y * h;
            const x2 = p2.x * w;
            const y2 = p2.y * h;
            
            // nsrc1469's center calculation
            const dx1 = x0 - x2;
            const dy1 = y0 - y2;
            const dx2 = x1 - x2;
            const dy2 = y1 - y2;
            
            const det = 2 * (dx1 * dy2 - dx2 * dy1);
            let centerX, centerY;
            
            if (Math.abs(det) < 0.001) { // Degenerate case - draw as line
                this.drawLines(points, w, h);
                return;
            }
            
            // nsrc1469's center calculation formula
            centerX = (dy2 * (dx1*dx1 + dy1*dy1) - dy1 * (dx2*dx2 + dy2*dy2)) / det;
            centerY = (dx1 * (dx2*dx2 + dy2*dy2) - dx2 * (dx1*dx1 + dy1*dy1)) / det;
            
            centerX += x2;
            centerY += y2;
            
            // Calculate radius
            const radius = Math.sqrt((centerX - x0) * (centerX - x0) + (centerY - y0) * (centerY - y0));
            // nsrc1469's angle calculation
            const angle1 = Math.atan2(y0 - centerY, x0 - centerX);
            const angle2 = Math.atan2(y2 - centerY, x2 - centerX);
            
            // Determine arc direction
            let startAngle = angle1;
            let endAngle = angle2;
            
            // nsrc1469rc direction logic
            const angleDiff = endAngle - startAngle;
            if (angleDiff > Math.PI) {
                endAngle -= 2 * Math.PI;
            } else if (angleDiff < -Math.PI) {
                endAngle += 2 * Math.PI;
            }
            
            // Draw the arc
            if (this.col) {
                if (isFill) {
                    this.p.fill(this.col);
                    this.p.noStroke();
                } else {
                    this.p.stroke(this.col);
                    this.p.noFill();
                }
            } else {
                if (isFill) {
                    this.p.fill(255);
                    this.p.noStroke();
                } else {
                    this.p.stroke(255);
                    this.p.noFill();
                }
            }
            
            // nsrc1469rawing
            this.p.arc(centerX, centerY, radius * 2, radius * 2, startAngle, endAngle);
            
        } else {
            // Multiple points - draw as polyline
            this.drawLines(points, w, h);
        }
    }

    drawPoints(points, w, h) { // PVector, w, h - for individual points
        if (!this.p || points.length < 1) {
            console.log(`[TelidonDrawCmd] drawPoints: Invalid points or p5 not available`);
            return;
        }

        // RHINO's point drawing algorithm
        console.log(`[TelidonDrawCmd] drawPoints: ${points.length} points`);

        // Set fill color for points
        if (this.col) {
            this.p.fill(this.col);
            this.p.noStroke();
        } else {
            this.p.fill(255);
            this.p.noStroke();
        }

        // RHINO's approach: Draw each point as a small rectangle
        // This matches RHINO's point() function which draws a pixel or small box
        for (let i = 0; i < points.length; i++) {
            const x = points[i].x * w;
            const y = points[i].y * h;
            
            // RHINO's point size handling - draw a 2x2 pixel for visibility
            this.p.rect(x - 1, y - 1, 2, 2);
        }
    }
    
    drawPolygon(points, w, h, isFill) {
        if (!this.p || points.length < 3) {
            console.log(`[TelidonDrawCmd] drawPolygon: Invalid points or p5 not available`);
            return;
        }

        // RHINO-style polygon drawing with proper coordinate transformation
        const canvasPoints = points.map(p => ({
            x: p.x * w,
            y: p.y * h
        }));

        console.log(`[TelidonDrawCmd] drawPolygon: ${points.length} points, fill: ${isFill}`);

        if (isFill) {
            // RHINO's scan-line polygon fill algorithm
            this.drawPolygonFill(canvasPoints);
        } else {
            // RHINOs outline drawing
            this.drawPolygonOutline(canvasPoints);
        }
    }

    // RHINO's scan-line polygon fill algorithm
    drawPolygonFill(points) {
        if (!this.p || points.length < 3) return;

        // Set fill color
        if (this.col) {
            this.p.fill(this.col);
            this.p.noStroke();
        } else {
            this.p.fill(255);
            this.p.noStroke();
        }

        // RHINOs approach: Use p5's built-in polygon fill
        // This is more efficient than implementing scan-line fill in JavaScript
        this.p.beginShape();
        for (let i = 0; i < points.length; i++) {
            this.p.vertex(points[i].x, points[i].y);
        }
        this.p.endShape(this.p.CLOSE);
    }

    // RHINOs outline drawing
    drawPolygonOutline(points) {
        if (!this.p || points.length < 2) return;

        // Set stroke color
        if (this.col) {
            this.p.stroke(this.col);
            this.p.noFill();
        } else {
            this.p.stroke(255);
            this.p.noFill();
        }

        // RHINO's approach: Draw connected lines
        this.p.beginShape();
        for (let i = 0; i < points.length; i++) {
            this.p.vertex(points[i].x, points[i].y);
        }
        this.p.endShape(this.p.CLOSE);
    }

    drawLines(points, w, h) {
        if (!this.p || points.length < 2) {
            console.log(`[TelidonDrawCmd] drawLines: Invalid points or p5 not available`);
            return;
        }

        // RHINO's Bresenham line drawing algorithm
        console.log(`[TelidonDrawCmd] drawLines: ${points.length} points`);

        // Set stroke color
        if (this.col) {
            this.p.stroke(this.col);
            this.p.noFill();
        } else {
            this.p.stroke(255);
            this.p.noFill();
        }

        // RHINO's approach: Draw connected lines using p5e function
        for (let i = 0; i < points.length - 1; i++) {
            const x1 = points[i].x * w;
            const y1 = points[i].y * h;
            const x2 = points[i + 1].x * w;
            const y2 = points[i + 1].y * h;
            
            // RHINO's coordinate transformation applied
            this.p.line(x1, y1, x2, y2);
        }
    }
    
}

// Export classes to global scope for browser usage
if (typeof window !== 'undefined') {
    console.log('[TelidonP5.js] Exporting classes to window...');
    window.TelidonDraw = TelidonDraw;
    window.TelidonDrawCmd = TelidonDrawCmd;
    // Add TelidonP5.renderBinary for viewer compatibility
    console.log('[TelidonP5.js] Creating window.TelidonP5...');
    window.TelidonP5 = {
        renderBinary: function(bytes, container) {
            debugLog('renderBinary', 'Function called', {
                bytesLength: bytes.length,
                hasContainer: !!container,
                containerType: container ? container.tagName : 'none'
            });
            
            // Reset debug state
            window.NAPLPS_DEBUG = {
                totalCommands: 0,
                drawingCommands: 0,
                controlCommands: 0,
                pointsExtracted: 0,
                shapesDrawn: 0,
                errors: [],
                lastCommand: null,
                canvasSize: { width: 0, height: 0 },
                coordinateStats: {
                    minX: Infinity,
                    maxX: -Infinity,
                    minY: Infinity,
                    maxY: -Infinity,
                    normalizedMinX: Infinity,
                    normalizedMaxX: -Infinity,
                    normalizedMinY: Infinity,
                    normalizedMaxY: -Infinity
                }
            };
            
            // Remove any previous canvas
            if (container) {
                container.innerHTML = '';
                debugLog('renderBinary', 'Cleared container');
            }
            
            // Create a p5 sketch
            new window.p5(function(p) {
                let telidonDraw;
                
                p.setup = function() {
                    debugLog('renderBinary', 'p5 setup called');
                    const canvas = p.createCanvas(400, 400);
                    
                    if (container) {
                        canvas.parent(container);
                        debugLog('renderBinary', 'Canvas attached to container');
                    }
                    
                    p.background(240);
                    debugLog('renderBinary', 'Background set to gray');
                    
                    try {
                        // Check if all required dependencies are available
                        if (typeof window.NapDecoder === 'undefined') {
                            const error = 'NapDecoder not available!';
                            console.error('[renderBinary]', error);
                            window.NAPLPS_DEBUG.errors.push(error);
                            return;
                        }
                        
                        debugLog('renderBinary', 'Dependencies check passed', {
                            NapDecoder: typeof window.NapDecoder,
                            TelidonDraw: typeof window.TelidonDraw,
                            p5: typeof p
                        });
                        
                        // Convert Uint8Array to string for NapDecoder
                        const naplpsString = String.fromCharCode(...bytes);
                        debugLog('renderBinary', 'NAPLPS string created', {
                            originalBytes: bytes.length,
                            stringLength: naplpsString.length,
                            firstFewChars: naplpsString.substring(0, 20)
                        });
                        
                        telidonDraw = new window.TelidonDraw([naplpsString], 400, 400, p);
                        debugLog('renderBinary', 'TelidonDraw created', {
                            commands: telidonDraw.drawCmds.length,
                            p5Available: !!telidonDraw.p,
                            canvasSize: { width: 400, height: 400 }
                        });
                        
                        window.NAPLPS_DEBUG.canvasSize = { width: 400, height: 400 };
                        
                    } catch (error) {
                        const errorMsg = `Error creating TelidonDraw: ${error.message}`;
                        console.error('[renderBinary]', errorMsg);
                        window.NAPLPS_DEBUG.errors.push(errorMsg);
                        debugLog('renderBinary', 'Error in setup', { error: error.message, stack: error.stack });
                    }
                };
                
                p.draw = function() {
                    if (telidonDraw && !telidonDraw.finished) {
                        telidonDraw.draw();
                    } else if (telidonDraw) {
                        debugLog('renderBinary', 'Drawing finished');
                        // Print final debug summary
                        printDebugSummary();
                    }
                };
            });
        }
    };
}

// Patch: safeMillis returns millis() if available, else Date.now()
function safeMillis() {
  return (typeof millis === 'function') ? millis() : Date.now();
}

// Confirm script loaded
console.log('[TelidonP5.js] Script loaded successfully, window.TelidonP5 available:', typeof window.TelidonP5 !== 'undefined');