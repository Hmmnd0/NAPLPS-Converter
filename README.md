# NAPLPS Converter

A modern web application that converts PNG images to NAPLPS (North American Presentation Layer Protocol Syntax) format. This tool analyzes images and converts them to vector graphics primitives used in vintage teletext and videotex systems.

## Features

- **Drag & Drop Upload**: Easy file upload with drag-and-drop support
- **Image Analysis**: Advanced edge detection and shape recognition
- **NAPLPS Generation**: Converts detected shapes to NAPLPS primitives
- **Real-time Preview**: See the NAPLPS conversion in real-time
- **Download Support**: Download generated NAPLPS files
- **Modern UI**: Clean, responsive interface built with Next.js and Tailwind CSS

## What is NAPLPS?

NAPLPS (North American Presentation Layer Protocol Syntax) was a graphics language developed in the 1980s for videotex and teletext services. It was used by services like:

- **Prodigy**: The popular online service
- **Cable Television**: Various cable systems for graphics display
- **Teletext Services**: News and information services

NAPLPS supported various graphics primitives:
- Points and lines
- Polygons and rectangles
- Circles and arcs
- Text elements
- Color and fill patterns

## Technical Details

### Image Processing
The application uses advanced computer vision techniques to analyze PNG images:

1. **Edge Detection**: Sobel operator for edge detection
2. **Contour Tracing**: Automatic contour detection and tracing
3. **Shape Recognition**: Detection of lines, circles, and polygons
4. **Color Analysis**: RGB to NAPLPS color mapping

### NAPLPS Encoding
The converter generates NAPLPS data using the ANSI X3.110-1983 standard:

- **Control Characters**: SI/SO for graphics mode
- **Coordinate Encoding**: 6-bit coordinate system
- **Primitive Types**: Point, line, polyline, polygon, rectangle, circle, text
- **Color Support**: 8-color NAPLPS palette

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd naplps-converter
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Building for Production

```bash
npm run build
npm start
```

## Usage

1. **Upload an Image**: Drag and drop a PNG, JPEG, or GIF file onto the upload area
2. **Processing**: The application will analyze the image and detect shapes
3. **Preview**: View the original image alongside the NAPLPS preview
4. **Download**: Click "Download NAPLPS File" to save the generated data

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── page.tsx           # Main page component
│   └── layout.tsx         # Root layout
├── components/             # React components
│   ├── FileUpload.tsx     # File upload component
│   └── NAPLPSViewer.tsx   # NAPLPS preview component
└── lib/                   # Core libraries
    ├── naplps.ts          # NAPLPS encoder
    └── imageProcessor.ts  # Image processing utilities
```

## Technologies Used

- **Next.js 15**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework
- **React Dropzone**: File upload handling
- **Canvas API**: Image processing and rendering

## Historical Context

This project recreates the technology used in early online services and cable television systems. NAPLPS was particularly important for:

- **Prodigy**: One of the first major online services (1984-2001)
- **Cable Television**: Graphics and information displays
- **Teletext**: News and information services
- **Videotex**: Early online information systems

The format was designed to be efficient for low-bandwidth transmission over telephone lines and television signals.

## Contributing

Contributions are welcome! This project is open source and aims to preserve and modernize historical computing technologies.

## License

This project is licensed under the MIT License.

## Acknowledgments

- Original NAPLPS specification (ANSI X3.110-1983)
- Prodigy and other vintage online services
- The retrocomputing community
