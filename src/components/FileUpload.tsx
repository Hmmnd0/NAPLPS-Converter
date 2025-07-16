'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing?: boolean;
}

export default function FileUpload({ onFileSelect, isProcessing = false }: FileUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file && file.type.startsWith('image/')) {
      onFileSelect(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/gif': ['.gif']
    },
    multiple: false,
    disabled: isProcessing
  });

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive 
            ? 'border-blue-500 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400'
          }
          ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {preview ? (
          <div className="space-y-4">
            <img 
              src={preview} 
              alt="Preview" 
              className="max-w-full max-h-64 mx-auto rounded-lg shadow-md"
            />
            <p className="text-sm text-gray-600">
              {isProcessing ? 'Processing image...' : 'Drop a new image here or click to select'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-medium text-gray-900">
                {isDragActive ? 'Drop the image here' : 'Upload an image'}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                Drag and drop a PNG, JPEG, or GIF file here, or click to browse
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 