import fs from 'fs';
import path from 'path';
import * as chokidar from 'chokidar';
import { parseFile } from '../utils/parser';
import { multiLayerKB, KBLayer } from './multiLayerKB';

// 文档监视服务 - 自动索引指定目录的文件
class DocumentWatcherService {
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private watchedPaths: Set<string> = new Set();

  // 添加监视目录
  public addWatchPath(dirPath: string): void {
    if (this.watchedPaths.has(dirPath)) {
      console.log(`[DocWatcher] Already watching: ${dirPath}`);
      return;
    }

    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory does not exist: ${dirPath}`);
    }

    console.log(`[DocWatcher] Starting to watch: ${dirPath}`);

    const watcher = chokidar.watch(dirPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false, // Process existing files
      depth: 2, // Watch 2 levels deep
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    watcher
      .on('add', (filePath) => this.handleFileAdded(filePath))
      .on('change', (filePath) => this.handleFileChanged(filePath))
      .on('unlink', (filePath) => this.handleFileDeleted(filePath))
      .on('error', (error) => console.error(`[DocWatcher] Error:`, error));

    this.watchers.set(dirPath, watcher);
    this.watchedPaths.add(dirPath);
  }

  // 移除监视目录
  public removeWatchPath(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
      this.watchedPaths.delete(dirPath);
      console.log(`[DocWatcher] Stopped watching: ${dirPath}`);
    }
  }

  // 获取所有监视的路径
  public getWatchedPaths(): string[] {
    return Array.from(this.watchedPaths);
  }

  // 处理文件添加
  private async handleFileAdded(filePath: string): Promise<void> {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const supportedExts = [
        '.txt', '.md',                                    // Text
        '.pdf',                                           // PDF
        '.docx', '.doc',                                  // Word
        '.xlsx', '.xls', '.csv',                          // Excel
        '.pptx', '.ppt',                                  // PowerPoint
        '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'  // Images
      ];
      
      if (!supportedExts.includes(ext)) {
        return; // Skip unsupported files
      }

      console.log(`[DocWatcher] New file detected: ${filePath}`);
      
      // Parse the file
      const parsed = await parseFile(filePath);
      
      // Add to core knowledge base
      multiLayerKB.addDocument(KBLayer.CORE, {
        title: parsed.name,
        content: parsed.content,
        metadata: {
          source: filePath,
          type: parsed.type,
          tags: ['auto-indexed', 'watched-folder'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          autoIndexed: true
        }
      });

      console.log(`[DocWatcher] Indexed file: ${parsed.name}`);
    } catch (error) {
      console.error(`[DocWatcher] Error processing file ${filePath}:`, error);
    }
  }

  // 处理文件修改
  private async handleFileChanged(filePath: string): Promise<void> {
    try {
      console.log(`[DocWatcher] File changed: ${filePath}`);
      
      // Find existing document
      const docs = multiLayerKB.getDocumentsByLayer(KBLayer.CORE);
      const existing = docs.find(d => d.metadata.source === filePath);
      
      if (existing) {
        // Re-parse and update
        const parsed = await parseFile(filePath);
        multiLayerKB.updateDocument(existing.id, {
          content: parsed.content,
          metadata: {
            updatedAt: Date.now()
          }
        });
        console.log(`[DocWatcher] Updated file: ${parsed.name}`);
      } else {
        // Treat as new file
        await this.handleFileAdded(filePath);
      }
    } catch (error) {
      console.error(`[DocWatcher] Error updating file ${filePath}:`, error);
    }
  }

  // 处理文件删除
  private handleFileDeleted(filePath: string): void {
    try {
      console.log(`[DocWatcher] File deleted: ${filePath}`);
      
      // Find and remove from knowledge base
      const docs = multiLayerKB.getDocumentsByLayer(KBLayer.CORE);
      const existing = docs.find(d => d.metadata.source === filePath);
      
      if (existing) {
        multiLayerKB.deleteDocument(existing.id);
        console.log(`[DocWatcher] Removed from KB: ${filePath}`);
      }
    } catch (error) {
      console.error(`[DocWatcher] Error removing file ${filePath}:`, error);
    }
  }

  // 停止所有监视
  public stopAll(): void {
    this.watchers.forEach((watcher, dirPath) => {
      watcher.close();
      console.log(`[DocWatcher] Stopped watching: ${dirPath}`);
    });
    this.watchers.clear();
    this.watchedPaths.clear();
  }
}

export const documentWatcher = new DocumentWatcherService();
