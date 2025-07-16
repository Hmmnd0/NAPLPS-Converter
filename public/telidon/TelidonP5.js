"use strict";

// Constants
const PI = Math.PI;

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
        this.maxCoord = 50; // Smaller scale for better visibility of complex shapes

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

        // Extract coordinate data from NAPLPS command
        if (this.cmd && this.cmd.points && this.cmd.points.length > 0) {
            // The NapCmd already has coordinates extracted and stored as [x, y] arrays
            console.log('[TelidonDrawCmd] Found points in command:', this.cmd.points.length);
            this.points = this.cmd.points.map(p => ({
                x: Math.max(0, Math.min(1, p[0] / this.maxCoord)),
                y: Math.max(0, Math.min(1, p[1] / this.maxCoord))
            }));
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
        // Only log commands that have points to draw
        if (this.points.length > 0) {
            console.log('[TelidonDrawCmd] Processing command:', this.cmd.opcode.id, 'with', this.points.length, 'points');
        }
        
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
				this.setColor(this.cmd.col);  
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
                
                // Normalize coordinates to 0-1 range
                const normalizedX = Math.max(0, Math.min(1, xVal / this.maxCoord));
                const normalizedY = Math.max(0, Math.min(1, yVal / this.maxCoord));
                
                this.points.push({
                    x: normalizedX,
                    y: normalizedY
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
                
                const normalizedX = Math.max(0, Math.min(1, xVal / this.maxCoord));
                const normalizedY = Math.max(0, Math.min(1, yVal / this.maxCoord));
                
                this.points.push({
                    x: normalizedX,
                    y: normalizedY
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
                    const normalizedX = Math.max(0, Math.min(1, x / this.maxCoord));
                    const normalizedY = Math.max(0, Math.min(1, y / this.maxCoord));
                    
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
        if (this.p && typeof this.p.color === 'function') {
            this.col = this.p.color(v.x, v.y, v.z);
        }
    }

    drawText(_text) {
        //fill(255);
        //stroke(0);
        this.p.text(_text, this.p.width * 0.0625, this.p.height * 1.25); // TODO position
    }

    drawRect(points, w, h, isFill) { // PVector, w, h
        const p = this.p;
        
        if (isFill) {
            // For filled shapes, set fill and no stroke
            if (p && typeof p.fill === 'function') {
                p.fill(0);
            }
            if (p && typeof p.noStroke === 'function') {
                p.noStroke();
            }
        } else {
            // For outlined shapes, set stroke and no fill
            if (p && typeof p.noFill === 'function') {
                p.noFill();
            }
            if (p && typeof p.stroke === 'function') {
                p.stroke(0);
            }
            if (p && typeof p.strokeWeight === 'function') {
                p.strokeWeight(1);
            }
        }
        
        if (points.length == 2) {
            let x1 = points[0].x * w;
            let y1 = points[0].y * h;
            let x2 = points[1].x * w;
            let y2 = points[1].y * h;
            
            if (p && typeof p.rectMode === 'function') p.rectMode(p.CORNER);
            if (p && typeof p.rect === 'function') {
                p.rect(x1, y1, x2-x1, y2-y1);
                window.NAPLPS_DEBUG.shapesDrawn++;
            }
        } else {
            this.drawPoints(points, w, h);
        }
    }

    drawArc(points, w, h, isFill) { // PVector, w, h
        const p = this.p;
        debugLog('TelidonDrawCmd', 'drawArc called', { 
            points: points.length, 
            isFill: isFill, 
            canvasSize: { width: w, height: h },
            p5Available: !!p 
        });
        
        if (points.length > 0) {
            debugLog('TelidonDrawCmd', 'Arc points', {
                firstPoint: points[0],
                lastPoint: points[points.length - 1],
                allPoints: points.slice(0, 3) // Show first 3 points
            });
        }
        
        if (isFill) {
            // For filled shapes, set fill and no stroke
            if (p && typeof p.fill === 'function') {
                p.fill(0);
                debugLog('TelidonDrawCmd', 'Set fill for arc');
            }
            if (p && typeof p.noStroke === 'function') {
                p.noStroke();
                debugLog('TelidonDrawCmd', 'Set noStroke for arc');
            }
        } else {
            // For outlined shapes, set stroke and no fill
            if (p && typeof p.noFill === 'function') {
                p.noFill();
                debugLog('TelidonDrawCmd', 'Set noFill for arc');
            }
            if (p && typeof p.stroke === 'function') {
                p.stroke(0);
                debugLog('TelidonDrawCmd', 'Set stroke for arc');
            }
            if (p && typeof p.strokeWeight === 'function') {
                p.strokeWeight(1);
                debugLog('TelidonDrawCmd', 'Set strokeWeight for arc');
            }
        }
        
        if (points.length == 2) {
            let x1 = points[0].x * w;
            let y1 = points[0].y * h;
            let x2 = points[1].x * w;
            let y2 = points[1].y * h;
            
            debugLog('TelidonDrawCmd', 'Drawing arc with 2 points', {
                canvasCoords: { x1, y1, x2, y2 },
                dimensions: { width: x2-x1, height: y2-y1 }
            });
            
            if (p && typeof p.ellipseMode === 'function') p.ellipseMode(p.CORNER);
            if (p && typeof p.ellipse === 'function') {
                p.ellipse(x1, y1, x2-x1, x2-x1);
                debugLog('TelidonDrawCmd', 'Arc drawn as ellipse');
                window.NAPLPS_DEBUG.shapesDrawn++;
            }
        } else {
            debugLog('TelidonDrawCmd', 'Drawing arc with multiple points', { pointCount: points.length });
            for (let i=0; i<points.length-1; i++) {
                let x1 = points[i].x * w;
                let y1 = points[i].y * h;
                let x2 = points[i+1].x * w;
                let y2 = points[i+1].y * h;
                if (p && typeof p.arc === 'function') {
                    p.arc(x1, y1, x2-x1, y2-y1, i * (PI/points.length), (i+1) * (PI/points.length));
                    debugLog('TelidonDrawCmd', 'Arc segment drawn', { segment: i, coords: { x1, y1, x2, y2 } });
                }
            }
            window.NAPLPS_DEBUG.shapesDrawn++;
        }
    }

    drawPoints(points, w, h) { // PVector, w, h - for individual points
        const p = this.p;
        
        // Set stroke for points
        if (p && typeof p.stroke === 'function') {
            p.stroke(0);
        }
        if (p && typeof p.strokeWeight === 'function') {
            p.strokeWeight(2);
        }
        if (p && typeof p.noFill === 'function') {
            p.noFill();
        }
        
        // Draw each point
        for (let i=0; i<points.length; i++) {
            let pt = points[i]; // PVector
            let sx = pt.x * w;
            let sy = pt.y * h;
            
            if (p && typeof p.point === 'function') {
                p.point(sx, sy);
            }
        }
        
        window.NAPLPS_DEBUG.shapesDrawn++;
    }
    
    drawLines(points, w, h) { // PVector, w, h
        const p = this.p;
        
        // Set stroke for lines
        if (p && typeof p.stroke === 'function') {
            p.stroke(0);
        }
        if (p && typeof p.strokeWeight === 'function') {
            p.strokeWeight(1);
        }
        if (p && typeof p.noFill === 'function') {
            p.noFill();
        }
        
        // Draw lines between consecutive points
        for (let i=0; i<points.length-1; i++) {
            let pt1 = points[i];
            let pt2 = points[i+1];
            
            let x1 = pt1.x * w;
            let y1 = pt1.y * h;
            let x2 = pt2.x * w;
            let y2 = pt2.y * h;
            
            if (p && typeof p.line === 'function') {
                p.line(x1, y1, x2, y2);
            }
        }
        
        window.NAPLPS_DEBUG.shapesDrawn++;
    }
    
    drawPolygon(points, w, h, isFill) { // PVector, w, h
        const p = this.p;
        
        if (isFill) {
            // For filled shapes, set fill and no stroke
            if (p && typeof p.fill === 'function') {
                p.fill(0);
            }
            if (p && typeof p.noStroke === 'function') {
                p.noStroke();
            }
        } else {
            // For outlined shapes, set stroke and no fill
            if (p && typeof p.noFill === 'function') {
                p.noFill();
            }
            if (p && typeof p.stroke === 'function') {
                p.stroke(0);
            }
            if (p && typeof p.strokeWeight === 'function') {
                p.strokeWeight(1);
            }
        }
        
        if (p && typeof p.beginShape === 'function') {
            p.beginShape();
        }
        
        for (let i=0; i<points.length; i++) {
            let pt = points[i]; // PVector
            // Coordinates are already normalized to 0-1, so just multiply by canvas dimensions
            let sx = pt.x * w;
            let sy = pt.y * h;
            
            if (p && typeof p.vertex === 'function') {
                p.vertex(sx, sy);
            }
        }
        
        if (p && typeof p.endShape === 'function') {
            p.endShape(p.CLOSE);
            window.NAPLPS_DEBUG.shapesDrawn++;
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