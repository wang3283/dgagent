import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { parseFile } from './utils/parser';
import { knowledgeBase } from './services/knowledgeBase';
import { fillingAgent } from './services/fillingAgent';
import { globalConfig } from './config/globalConfig';
import { aiAgent } from './services/aiAgent';
import { conversationManager } from './services/conversationManager';
import { multiLayerKB, KBLayer } from './services/multiLayerKB';
import { documentWatcher } from './services/documentWatcher';
import { voiceChatService } from './services/voiceChat';
import { conversationSummaryService } from './services/conversationSummary';
import { ttsService } from './services/ttsService';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public');


let win: BrowserWindow | null;
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

// --- IPC Handlers ---

import fs from 'fs';
import dotenv from 'dotenv';

// ... existing imports

ipcMain.handle('load-soysnfdb-config', async () => {
  const targetPath = '/Users/wangxutong/Downloads/SoySNFdb/.env';
  try {
    if (fs.existsSync(targetPath)) {
      const envConfig = dotenv.parse(fs.readFileSync(targetPath));
      return {
        apiKey: envConfig.OPENAI_API_KEY || '',
        baseUrl: envConfig.OPENAI_BASE_URL || '',
        chatModel: envConfig.OPENAI_MODEL_NAME || 'gpt-3.5-turbo',
        // Map other fields if necessary
      };
    }
  } catch (error) {
    console.error('Failed to load external config:', error);
  }
  return null;
});

ipcMain.handle('parse-file', async (_, filePath: string) => {
  try {
    return await parseFile(filePath);
  } catch (error) {
    console.error(error);
    throw error;
  }
});

ipcMain.handle('kb-add-document', async (_, { text, metadata }) => {
  try {
    return await knowledgeBase.addDocument(text, metadata);
  } catch (error) {
    console.error('kb-add-document error:', error);
    throw error;
  }
});

ipcMain.handle('config-get', async () => {
  return globalConfig.getConfig();
});

ipcMain.handle('kb-update-config', async (_, config: any) => {
  console.log('[Main] Updating global config:', config);
  globalConfig.setConfig(config);
  console.log('[Main] Global config updated successfully');
  return true;
});

ipcMain.handle('kb-get-stats', async () => {
  return await knowledgeBase.getStats();
});

ipcMain.handle('kb-get-documents', async () => {
  try {
    return knowledgeBase.getAllDocuments();
  } catch (error) {
    console.error('kb-get-documents error:', error);
    throw error;
  }
});

ipcMain.handle('kb-delete-document', async (_, index: number) => {
  try {
    return knowledgeBase.deleteDocument(index);
  } catch (error) {
    console.error('kb-delete-document error:', error);
    throw error;
  }
});

ipcMain.handle('kb-clear-all', async () => {
  try {
    knowledgeBase.clearAllDocuments();
    return true;
  } catch (error) {
    console.error('kb-clear-all error:', error);
    throw error;
  }
});

ipcMain.handle('kb-reindex', async () => {
  return await knowledgeBase.reindex();
});

ipcMain.handle('fill-form', async (_, payload) => {
  try {
    console.log('[Main] fill-form called');
    const { content, config } = payload;
    
    // If config is provided, update global config
    if (config) {
      console.log('[Main] Updating global config from fill-form request:', config);
      globalConfig.setConfig(config);
    }
    
    return await fillingAgent.processForm(content);
  } catch (error) {
    console.error('fill-form error:', error);
    throw error;
  }
});

// --- New Chat-based IPC Handlers ---

ipcMain.handle('chat-send', async (event, message: string, options?: { displayMessage?: string; attachments?: any[]; mode?: 'chat' | 'agent' }) => {
  try {
    console.log('[Main] chat-send called');
    
    // Callback to send steps to frontend
    const onStep = (step: { type: string; content: string }) => {
      event.sender.send('agent-step', step);
    };

    const mode = options?.mode || 'agent';
    
    // If we have display message and attachments, save the display version to conversation
    if (options?.displayMessage !== undefined && options?.attachments) {
      // Send the full message (with file contents) to AI
      const aiResponse = await aiAgent.chat(message, undefined, onStep, mode);
      
      // But save the display message (without file contents) to conversation history
      // The conversation manager will handle this through the aiAgent
      return aiResponse;
    } else {
      // Normal message without special handling
      return await aiAgent.chat(message, undefined, onStep, mode);
    }
  } catch (error) {
    console.error('chat-send error:', error);
    throw error;
  }
});

ipcMain.handle('conversation-new', async () => {
  try {
    const id = conversationManager.createConversation();
    console.log('[Main] Created new conversation:', id);
    return id;
  } catch (error) {
    console.error('conversation-new error:', error);
    throw error;
  }
});

ipcMain.handle('conversation-get-current', async () => {
  try {
    return conversationManager.getCurrentConversation();
  } catch (error) {
    console.error('conversation-get-current error:', error);
    throw error;
  }
});

ipcMain.handle('conversation-get-all', async () => {
  try {
    return conversationManager.getAllConversations();
  } catch (error) {
    console.error('conversation-get-all error:', error);
    throw error;
  }
});

ipcMain.handle('conversation-switch', async (_, id: string) => {
  try {
    return conversationManager.switchConversation(id);
  } catch (error) {
    console.error('conversation-switch error:', error);
    throw error;
  }
});

ipcMain.handle('conversation-delete', async (_, id: string) => {
  try {
    return conversationManager.deleteConversation(id);
  } catch (error) {
    console.error('conversation-delete error:', error);
    throw error;
  }
});

ipcMain.handle('conversation-update-title', async (_, { id, title }: { id: string; title: string }) => {
  try {
    conversationManager.updateConversationTitle(id, title);
    return true;
  } catch (error) {
    console.error('conversation-update-title error:', error);
    throw error;
  }
});

ipcMain.handle('conversation-save-to-kb', async (_, id?: string) => {
  try {
    return await aiAgent.saveConversationToKB(id);
  } catch (error) {
    console.error('conversation-save-to-kb error:', error);
    throw error;
  }
});

ipcMain.handle('select-directory', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Folder',
      buttonLabel: 'Select'
    });
    
    if (result.canceled) {
      return null;
    }
    
    return result.filePaths[0];
  } catch (error) {
    console.error('select-directory error:', error);
    throw error;
  }
});

ipcMain.handle('minimize-window', () => {
  if (win) {
    win.minimize();
  }
});

ipcMain.handle('maximize-window', () => {
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

// --- Multi-Layer Knowledge Base Handlers ---

ipcMain.handle('mlkb-get-stats', async () => {
  try {
    return multiLayerKB.getStats();
  } catch (error) {
    console.error('mlkb-get-stats error:', error);
    throw error;
  }
});

ipcMain.handle('mlkb-get-documents', async (_, layer?: string) => {
  try {
    if (layer) {
      return multiLayerKB.getDocumentsByLayer(layer as KBLayer);
    }
    // Return all layers
    return {
      core: multiLayerKB.getDocumentsByLayer(KBLayer.CORE),
      conversation: multiLayerKB.getDocumentsByLayer(KBLayer.CONVERSATION),
      generated: multiLayerKB.getDocumentsByLayer(KBLayer.GENERATED)
    };
  } catch (error) {
    console.error('mlkb-get-documents error:', error);
    throw error;
  }
});

ipcMain.handle('mlkb-delete-document', async (_, id: string) => {
  try {
    return multiLayerKB.deleteDocument(id);
  } catch (error) {
    console.error('mlkb-delete-document error:', error);
    throw error;
  }
});

ipcMain.handle('mlkb-save-generated', async (_, { title, content, metadata }: any) => {
  try {
    return multiLayerKB.saveGeneratedContent(title, content, metadata);
  } catch (error) {
    console.error('mlkb-save-generated error:', error);
    throw error;
  }
});

ipcMain.handle('mlkb-verify-content', async (_, id: string) => {
  try {
    return multiLayerKB.verifyGeneratedContent(id);
  } catch (error) {
    console.error('mlkb-verify-content error:', error);
    throw error;
  }
});

// --- Document Watcher Handlers ---

ipcMain.handle('watcher-add-path', async (_, dirPath: string) => {
  try {
    documentWatcher.addWatchPath(dirPath);
    return true;
  } catch (error) {
    console.error('watcher-add-path error:', error);
    throw error;
  }
});

ipcMain.handle('watcher-remove-path', async (_, dirPath: string) => {
  try {
    documentWatcher.removeWatchPath(dirPath);
    return true;
  } catch (error) {
    console.error('watcher-remove-path error:', error);
    throw error;
  }
});

ipcMain.handle('watcher-get-paths', async () => {
  try {
    return documentWatcher.getWatchedPaths();
  } catch (error) {
    console.error('watcher-get-paths error:', error);
    throw error;
  }
});

// --- Voice Chat Handlers ---

ipcMain.handle('voice-to-text', async (_, audioPath: string) => {
  try {
    return await voiceChatService.processVoiceInput(audioPath);
  } catch (error) {
    console.error('voice-to-text error:', error);
    throw error;
  }
});

ipcMain.handle('text-to-speech', async (_, text: string, voiceType?: string) => {
  try {
    // Use Edge TTS (free and high quality)
    // Default to Xiaoxiao (Warm) for Chinese if no voice provided
    const voice = voiceType || 'zh-CN-XiaoxiaoNeural';
    return await ttsService.generateAudio(text, voice);
  } catch (error) {
    console.error('text-to-speech error:', error);
    throw error;
  }
});

ipcMain.handle('get-temp-dir', async () => {
  try {
    return voiceChatService.getTempDir();
  } catch (error) {
    console.error('get-temp-dir error:', error);
    throw error;
  }
});

ipcMain.handle('save-audio-file', async (_, filePath: string, data: number[]) => {
  try {
    const fs = require('fs');
    const buffer = Buffer.from(data);
    fs.writeFileSync(filePath, buffer);
    console.log('[Main] Audio file saved:', filePath);
    return filePath;
  } catch (error) {
    console.error('save-audio-file error:', error);
    throw error;
  }
});

// --- Conversation Summary Handlers ---

ipcMain.handle('summary-generate', async (_, conversationId: string) => {
  try {
    const conversations = await conversationManager.getAllConversations();
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    return await conversationSummaryService.generateSummary(conversation);
  } catch (error) {
    console.error('summary-generate error:', error);
    throw error;
  }
});

ipcMain.handle('summary-get-by-date', async (_, date: string) => {
  try {
    return await conversationSummaryService.getSummariesByDate(date);
  } catch (error) {
    console.error('summary-get-by-date error:', error);
    throw error;
  }
});

ipcMain.handle('summary-get-by-range', async (_, startDate: string, endDate: string) => {
  try {
    return await conversationSummaryService.getSummariesByDateRange(startDate, endDate);
  } catch (error) {
    console.error('summary-get-by-range error:', error);
    throw error;
  }
});

ipcMain.handle('summary-get-all-grouped', async () => {
  try {
    return await conversationSummaryService.getAllSummariesGrouped();
  } catch (error) {
    console.error('summary-get-all-grouped error:', error);
    throw error;
  }
});

ipcMain.handle('summary-search', async (_, query: string) => {
  try {
    return await conversationSummaryService.searchSummaries(query);
  } catch (error) {
    console.error('summary-search error:', error);
    throw error;
  }
});

ipcMain.handle('summary-delete', async (_, summaryId: string) => {
  try {
    return await conversationSummaryService.deleteSummary(summaryId);
  } catch (error) {
    console.error('summary-delete error:', error);
    throw error;
  }
});

ipcMain.handle('ai-edit-text', async (_, prompt: string) => {
  try {
    return await aiAgent.chat(prompt);
  } catch (error) {
    console.error('ai-edit-text error:', error);
    throw error;
  }
});

// --------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    // Frameless window with transparency
    frame: false,
    transparent: true,
    vibrancy: 'under-window', // macOS blur effect
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
  });

  // Clear cache in dev mode
  const isDev = process.env.VITE_DEV_SERVER_URL || process.argv.includes('--dev');
  
  if (isDev) {
    win.webContents.session.clearCache();
    // Fallback to hardcoded localhost if env var is missing but we know it's dev
    const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    win.loadURL(url);
    win.webContents.openDevTools(); // Open DevTools automatically in dev
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'));
  }

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString());
  });
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);
