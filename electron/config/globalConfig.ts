import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

// Global configuration singleton
export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  agentName?: string;
  enableVoiceInput?: boolean;
  enableVoiceReply?: boolean;
  voiceType?: string;
  useBrowserSpeech?: boolean;
  useBrowserTTS?: boolean;
}

class GlobalConfigManager {
  private config: AppConfig;

  constructor() {
    // Load config from file or use defaults
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    // Default config
    const defaults: AppConfig = {
      baseUrl: '',
      apiKey: '',
      chatModel: '',
      embeddingModel: '',
      agentName: 'AI Assistant',
      enableVoiceInput: false,
      enableVoiceReply: false,
      voiceType: 'alloy',
      useBrowserSpeech: true,
      useBrowserTTS: true
    };

    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const loaded = JSON.parse(data);
        console.log('[GlobalConfig] Loaded config from file:', loaded);
        // Merge with defaults to ensure all fields exist
        return { ...defaults, ...loaded };
      }
    } catch (error) {
      console.error('[GlobalConfig] Failed to load config:', error);
    }

    // Return defaults if file doesn't exist or loading failed
    return defaults;
  }

  private saveConfig() {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
      console.log('[GlobalConfig] Config saved to file');
    } catch (error) {
      console.error('[GlobalConfig] Failed to save config:', error);
    }
  }

  public setConfig(newConfig: Partial<AppConfig>) {
    console.log('[GlobalConfig] Updating config:', newConfig);
    this.config = { ...this.config, ...newConfig };
    this.saveConfig(); // 自动保存
    console.log('[GlobalConfig] Current config:', this.config);
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public get baseUrl(): string {
    return this.config.baseUrl;
  }

  public get apiKey(): string {
    return this.config.apiKey;
  }

  public get chatModel(): string {
    return this.config.chatModel;
  }

  public get embeddingModel(): string {
    return this.config.embeddingModel;
  }
}

export const globalConfig = new GlobalConfigManager();
