import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { globalConfig } from '../config/globalConfig';
import { speechToTextService } from './speechToText';
import FormData from 'form-data';

const TEMP_DIR = path.join(app.getPath('userData'), 'temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export interface VoiceChatResult {
  userText: string;
  aiText: string;
  audioPath?: string;
}

class VoiceChatService {
  
  // Convert text to speech using OpenAI TTS API
  public async textToSpeech(text: string): Promise<string> {
    const config = globalConfig.getConfig();
    
    if (!config.apiKey) {
      throw new Error('API Key not configured');
    }

    console.log('[VoiceChat] Converting text to speech...');

    try {
      const response = await fetch(`${config.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: 'alloy', // Options: alloy, echo, fable, onyx, nova, shimmer
          response_format: 'mp3',
          speed: 1.0
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS API error: ${response.status} - ${errorText}`);
      }

      // Save audio to temp file
      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const audioPath = path.join(TEMP_DIR, `tts_${Date.now()}.mp3`);
      fs.writeFileSync(audioPath, audioBuffer);

      console.log('[VoiceChat] TTS completed, saved to:', audioPath);
      return audioPath;
    } catch (error) {
      console.error('[VoiceChat] TTS failed:', error);
      throw error;
    }
  }

  // Process voice input: audio file -> text
  public async processVoiceInput(audioPath: string): Promise<string> {
    console.log('[VoiceChat] Processing voice input...');
    
    try {
      const result = await speechToTextService.transcribe(audioPath);
      console.log('[VoiceChat] Voice input transcribed:', result.text);
      return result.text;
    } catch (error) {
      console.error('[VoiceChat] Voice input processing failed:', error);
      throw error;
    }
  }

  // Clean up old temp files
  public cleanupTempFiles(olderThanMinutes: number = 60): void {
    try {
      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      const maxAge = olderThanMinutes * 60 * 1000;

      files.forEach(file => {
        const filePath = path.join(TEMP_DIR, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          console.log('[VoiceChat] Cleaned up old temp file:', file);
        }
      });
    } catch (error) {
      console.warn('[VoiceChat] Cleanup failed:', error);
    }
  }

  // Get temp directory path
  public getTempDir(): string {
    return TEMP_DIR;
  }
}

export const voiceChatService = new VoiceChatService();
