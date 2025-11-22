import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import FormData from 'form-data';
import { globalConfig } from '../config/globalConfig';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath.path);

export interface TranscriptionResult {
  text: string;
  duration?: number;
  language?: string;
}

class SpeechToTextService {
  
  // Extract audio from video file
  private async extractAudio(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[STT] Extracting audio from: ${videoPath}`);
      
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .audioChannels(1)
        .audioFrequency(16000)
        .format('mp3')
        .on('end', () => {
          console.log('[STT] Audio extraction completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('[STT] Audio extraction failed:', err);
          reject(err);
        })
        .save(outputPath);
    });
  }

  // Get audio duration
  private async getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata.format.duration || 0);
        }
      });
    });
  }

  // Transcribe audio using compatible API (OpenAI Whisper format)
  // Supports: OpenAI, Azure OpenAI, 国内兼容服务 (如 dmxapi.cn, api2d.com 等)
  private async transcribeWithWhisper(audioPath: string): Promise<TranscriptionResult> {
    const config = globalConfig.getConfig();
    
    if (!config.apiKey) {
      throw new Error('API Key not configured');
    }

    console.log('[STT] Starting transcription with Whisper-compatible API');
    console.log('[STT] Using endpoint:', config.baseUrl);

    // Read audio file
    const audioBuffer = fs.readFileSync(audioPath);
    
    // Create form data
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: path.basename(audioPath),
      contentType: 'audio/mpeg'
    });
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
    // Auto-detect language for better compatibility
    // formData.append('language', 'zh'); 

    try {
      // Call Whisper-compatible API
      const response = await fetch(`${config.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          ...formData.getHeaders()
        },
        body: formData as any
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[STT] Transcription completed');

      return {
        text: result.text || result.transcription || '',
        language: result.language,
        duration: result.duration
      };
    } catch (error) {
      console.error('[STT] API call failed:', error);
      throw error;
    }
  }

  // Alternative: Use local Whisper (if installed)
  private async transcribeWithLocalWhisper(audioPath: string): Promise<TranscriptionResult> {
    // This would use whisper.cpp or similar local solution
    // For now, return a placeholder
    throw new Error('Local Whisper not implemented yet. Please use API-based transcription.');
  }

  // Main method: transcribe audio or video file
  public async transcribe(filePath: string): Promise<TranscriptionResult> {
    const ext = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'].includes(ext);
    const isAudio = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(ext);
    const isWebM = ext === '.webm';

    if (!isVideo && !isAudio && !isWebM) {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    let audioPath = filePath;
    let tempAudioPath: string | null = null;

    try {
      // If it's a video or WebM, extract/convert audio to MP3 first
      if (isVideo || isWebM) {
        console.log('[STT] Converting to MP3 format...');
        tempAudioPath = path.join(
          path.dirname(filePath),
          `temp_audio_${Date.now()}.mp3`
        );
        await this.extractAudio(filePath, tempAudioPath);
        audioPath = tempAudioPath;
      }

      // Get duration
      const duration = await this.getAudioDuration(audioPath);
      console.log(`[STT] Audio duration: ${duration.toFixed(2)}s`);

      // Check file size (Whisper API has 25MB limit)
      const stats = fs.statSync(audioPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 25) {
        throw new Error(`File too large: ${fileSizeMB.toFixed(2)}MB (max 25MB)`);
      }

      // Transcribe with Whisper
      const result = await this.transcribeWithWhisper(audioPath);
      result.duration = duration;

      return result;
    } finally {
      // Clean up temporary audio file
      if (tempAudioPath && fs.existsSync(tempAudioPath)) {
        try {
          fs.unlinkSync(tempAudioPath);
          console.log('[STT] Cleaned up temporary audio file');
        } catch (err) {
          console.warn('[STT] Failed to clean up temp file:', err);
        }
      }
    }
  }

  // Check if file is audio or video
  public isMediaFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const mediaExts = [
      '.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm',  // Video
      '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'  // Audio
    ];
    return mediaExts.includes(ext);
  }
}

export const speechToTextService = new SpeechToTextService();
