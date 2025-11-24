import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export class TTSService {
  private readonly TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
  private readonly VOICES = {
    'zh-CN-XiaoxiaoNeural': 'Xiaoxiao (Warm)',
    'zh-CN-YunxiNeural': 'Yunxi (Lively)',
    'zh-CN-YunjianNeural': 'Yunjian (Male, Sports)',
    'zh-CN-YunyangNeural': 'Yunyang (Male, News)',
    'en-US-GuyNeural': 'Guy (Male)',
    'en-US-JennyNeural': 'Jenny (Female)'
  };

  constructor() {}

  public async generateAudio(text: string, voice: string = 'zh-CN-XiaoxiaoNeural'): Promise<string> {
    return new Promise((resolve, reject) => {
      const requestId = uuidv4().replace(/-/g, '');
      const wssUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${this.TRUSTED_CLIENT_TOKEN}&ConnectionId=${requestId}`;
      
      const ws = new WebSocket(wssUrl, {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
        }
      });
      const audioData: Buffer[] = [];

      // Handle handshake errors (like 403)
      ws.on('unexpected-response', (request: any, response: any) => {
        console.error('TTS WebSocket Unexpected Response:', response.statusCode, response.statusMessage);
        if (response.statusCode === 403) {
           console.error('403 Forbidden. Headers:', response.headers);
        }
      });

      // Create temp file path
      const tempDir = app.getPath('temp');
      const fileName = `tts-${Date.now()}.mp3`;
      const filePath = path.join(tempDir, fileName);

      ws.on('open', () => {
        // 1. Send config
        const configMsg = {
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: "false",
                  wordBoundaryEnabled: "false"
                },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3" 
              }
            }
          }
        };
        
        ws.send(`X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(configMsg)}`);

        // 2. Send SSML
        const ssml = `
          <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
            <voice name='${voice}'>
              <prosody pitch='+0Hz' rate='+0%' volume='+0%'>
                ${this.escapeXml(text)}
              </prosody>
            </voice>
          </speak>
        `.trim();

        ws.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}\r\nPath:ssml\r\n\r\n${ssml}`);
      });

      ws.on('message', (data: any, isBinary: boolean) => {
        const buffer = Buffer.from(data);
        
        if (isBinary) {
          // Check for binary audio data tag (Path:audio)
          const headerLen = buffer.readUInt16BE(0);
          const header = buffer.slice(2, 2 + headerLen).toString();
          
          if (header.includes('Path:audio')) {
            const audioContent = buffer.slice(2 + headerLen);
            audioData.push(audioContent);
          }
        } else {
          // Text message (metadata or turn.end)
          const text = buffer.toString();
          if (text.includes('turn.end')) {
            ws.close();
          }
        }
      });

      ws.on('close', () => {
        // Concatenate and save
        if (audioData.length > 0) {
          const finalBuffer = Buffer.concat(audioData);
          fs.writeFileSync(filePath, finalBuffer);
          resolve(filePath);
        } else {
          reject(new Error('No audio data received'));
        }
      });

      ws.on('error', (err: Error) => {
        console.error('TTS WebSocket Error:', err);
        reject(err);
      });
    });
  }

  private escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  }
}

export const ttsService = new TTSService();
