import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { speechToTextService } from '../services/speechToText';

// Try to import sharp, but handle if it fails in Electron
let sharp: any = null;
try {
  sharp = require('sharp');
} catch (error) {
  console.warn('[Parser] Sharp not available');
}

// Use node-tesseract-ocr for OCR (works better in Electron)
let tesseract: any = null;
try {
  tesseract = require('node-tesseract-ocr');
  console.log('[Parser] Tesseract OCR loaded successfully');
} catch (error) {
  console.warn('[Parser] Tesseract OCR not available:', error);
}

// PDF parsing helper function
async function parsePDF(filePath: string): Promise<string> {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdfBytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    
    let text = `PDF Document: ${path.basename(filePath)}\n`;
    text += `Pages: ${pages.length}\n`;
    text += `Size: ${(pdfBytes.length / 1024).toFixed(2)} KB\n\n`;
    text += `[PDF content - metadata extracted. For full text extraction, consider using dedicated PDF tools]\n`;
    
    return text;
  } catch (error) {
    console.error('PDF parsing error:', error);
    return `PDF file: ${path.basename(filePath)} (metadata extraction failed)`;
  }
}

// Image parsing with OCR using node-tesseract-ocr
async function parseImage(filePath: string): Promise<string> {
  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    let result = `Image File: ${path.basename(filePath)}\n`;
    result += `Type: ${ext}\n`;
    result += `Size: ${(stats.size / 1024).toFixed(2)} KB\n\n`;
    
    // Try OCR if tesseract is available
    if (tesseract) {
      try {
        console.log(`[Parser] Starting OCR for: ${filePath}`);
        
        const config = {
          lang: 'eng+chi_sim',  // English + Simplified Chinese
          oem: 1,  // LSTM OCR Engine Mode
          psm: 3,  // Automatic page segmentation
        };
        
        const text = await tesseract.recognize(filePath, config);
        
        if (text && text.trim()) {
          result += `OCR Extracted Text:\n${text.trim()}\n`;
          console.log(`[Parser] OCR completed successfully`);
        } else {
          result += `[No text detected in image]\n`;
        }
      } catch (ocrError) {
        console.error('[Parser] OCR failed:', ocrError);
        result += `[OCR failed: ${(ocrError as Error).message}]\n`;
        result += `Note: Make sure Tesseract is installed on your system.\n`;
        result += `Install: brew install tesseract tesseract-lang\n`;
      }
    } else {
      result += `[OCR not available - Tesseract not installed]\n`;
      result += `To enable OCR, install Tesseract:\n`;
      result += `  brew install tesseract tesseract-lang\n`;
    }
    
    return result;
  } catch (error) {
    console.error('Image parsing error:', error);
    return `Image file: ${path.basename(filePath)}\n[Failed to parse image: ${(error as Error).message}]\n`;
  }
}

// PPT parsing (basic metadata)
async function parsePPT(filePath: string): Promise<string> {
  try {
    // For PPTX, we can extract basic info
    const stats = fs.statSync(filePath);
    let text = `PowerPoint Presentation: ${path.basename(filePath)}\n`;
    text += `Size: ${(stats.size / 1024).toFixed(2)} KB\n`;
    text += `\n[PowerPoint content - For detailed extraction, please convert to PDF or use Office tools]\n`;
    
    return text;
  } catch (error) {
    console.error('PPT parsing error:', error);
    return `PowerPoint file: ${path.basename(filePath)} (metadata extraction failed)`;
  }
}

export type ParsedFile = {
  name: string;
  path: string;
  content: string;
  type: 'txt' | 'pdf' | 'docx' | 'excel' | 'ppt' | 'image' | 'audio' | 'video' | 'unknown';
};

// Audio/Video parsing with speech-to-text
async function parseMediaFile(filePath: string, isVideo: boolean): Promise<string> {
  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    let result = `${isVideo ? 'Video' : 'Audio'} File: ${path.basename(filePath)}\n`;
    result += `Type: ${ext}\n`;
    result += `Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB\n\n`;
    
    // Try speech-to-text transcription
    try {
      console.log(`[Parser] Starting speech-to-text for: ${filePath}`);
      result += `🎙️ Transcribing ${isVideo ? 'video' : 'audio'}...\n\n`;
      
      const transcription = await speechToTextService.transcribe(filePath);
      
      if (transcription.duration) {
        const minutes = Math.floor(transcription.duration / 60);
        const seconds = Math.floor(transcription.duration % 60);
        result += `Duration: ${minutes}:${seconds.toString().padStart(2, '0')}\n`;
      }
      
      if (transcription.language) {
        result += `Language: ${transcription.language}\n`;
      }
      
      result += `\n--- Transcription ---\n`;
      result += transcription.text;
      result += `\n--- End of transcription ---\n`;
      
      console.log(`[Parser] Transcription completed successfully`);
    } catch (error) {
      console.error('[Parser] Speech-to-text failed:', error);
      result += `[Transcription failed: ${(error as Error).message}]\n`;
      result += `\nNote: Make sure your API supports Whisper transcription.\n`;
      result += `Supported formats: MP3, MP4, WAV, M4A, AAC, OGG, FLAC\n`;
      result += `Max file size: 25MB\n`;
    }
    
    return result;
  } catch (error) {
    console.error('Media file parsing error:', error);
    return `${isVideo ? 'Video' : 'Audio'} file: ${path.basename(filePath)}\n[Failed to parse: ${(error as Error).message}]\n`;
  }
}

export async function parseFile(filePath: string): Promise<ParsedFile> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  let content = '';
  let type: ParsedFile['type'] = 'unknown';

  try {
    // Text files
    if (ext === '.txt' || ext === '.md') {
      type = 'txt';
      content = fs.readFileSync(filePath, 'utf-8');
    } 
    // PDF files
    else if (ext === '.pdf') {
      type = 'pdf';
      content = await parsePDF(filePath);
    } 
    // Word documents
    else if (ext === '.docx' || ext === '.doc') {
      type = 'docx';
      const result = await mammoth.extractRawText({ path: filePath });
      content = result.value;
    } 
    // Excel files
    else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      type = 'excel';
      const workbook = XLSX.readFile(filePath);
      const sheetNames = workbook.SheetNames;
      
      content = sheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        return `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`;
      }).join('\n\n');
    } 
    // PowerPoint files
    else if (ext === '.pptx' || ext === '.ppt') {
      type = 'ppt';
      content = await parsePPT(filePath);
    } 
    // Image files (with OCR)
    else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'].includes(ext)) {
      type = 'image';
      content = await parseImage(filePath);
    }
    // Audio files (with speech-to-text)
    else if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext)) {
      type = 'audio';
      content = await parseMediaFile(filePath, false);
    }
    // Video files (extract audio and transcribe)
    else if (['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'].includes(ext)) {
      type = 'video';
      content = await parseMediaFile(filePath, true);
    }
    else {
      // Unsupported file type
      content = `Unsupported file type: ${ext}\nFile: ${fileName}`;
    }
  } catch (error) {
    console.error(`Error parsing file ${filePath}:`, error);
    throw new Error(`Failed to parse file: ${(error as Error).message}`);
  }

  return {
    name: fileName,
    path: filePath,
    content: content.trim(),
    type
  };
}
