import fs from 'fs';
import path from 'path';
import { app } from 'electron';

// 多层次知识库管理
// 1. 核心知识库 - 用户主动管理的文档
// 2. 对话历史知识库 - 自动积累的对话
// 3. 生成内容知识库 - AI创作的内容

const USER_DATA_PATH = app.getPath('userData');
const CORE_KB_PATH = path.join(USER_DATA_PATH, 'knowledge-base', 'core');
const CONVERSATION_KB_PATH = path.join(USER_DATA_PATH, 'knowledge-base', 'conversations');
const GENERATED_KB_PATH = path.join(USER_DATA_PATH, 'knowledge-base', 'generated');

// 确保目录存在
[CORE_KB_PATH, CONVERSATION_KB_PATH, GENERATED_KB_PATH].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

export enum KBLayer {
  CORE = 'core',           // 核心知识库
  CONVERSATION = 'conversation',  // 对话历史
  GENERATED = 'generated'   // 生成内容
}

export interface KBDocument {
  id: string;
  layer: KBLayer;
  title: string;
  content: string;
  metadata: {
    source?: string;
    type?: string;
    tags?: string[];
    createdAt: number;
    updatedAt: number;
    importance?: 'high' | 'medium' | 'low';
    verified?: boolean;  // 用户是否确认
    [key: string]: any;
  };
}

class MultiLayerKnowledgeBase {
  private documents: Map<KBLayer, KBDocument[]> = new Map([
    [KBLayer.CORE, []],
    [KBLayer.CONVERSATION, []],
    [KBLayer.GENERATED, []]
  ]);

  constructor() {
    this.loadAllLayers();
  }

  // 加载所有层的数据
  private loadAllLayers() {
    Object.values(KBLayer).forEach(layer => {
      this.loadLayer(layer);
    });
  }

  // 加载特定层
  private loadLayer(layer: KBLayer) {
    const layerPath = this.getLayerPath(layer);
    const indexFile = path.join(layerPath, 'index.json');
    
    if (fs.existsSync(indexFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
        this.documents.set(layer, data);
        console.log(`[MultiLayerKB] Loaded ${data.length} documents from ${layer} layer`);
      } catch (error) {
        console.error(`[MultiLayerKB] Error loading ${layer} layer:`, error);
        this.documents.set(layer, []);
      }
    }
  }

  // 保存特定层
  private saveLayer(layer: KBLayer) {
    const layerPath = this.getLayerPath(layer);
    const indexFile = path.join(layerPath, 'index.json');
    const docs = this.documents.get(layer) || [];
    
    fs.writeFileSync(indexFile, JSON.stringify(docs, null, 2));
    console.log(`[MultiLayerKB] Saved ${docs.length} documents to ${layer} layer`);
  }

  // 获取层路径
  private getLayerPath(layer: KBLayer): string {
    switch (layer) {
      case KBLayer.CORE:
        return CORE_KB_PATH;
      case KBLayer.CONVERSATION:
        return CONVERSATION_KB_PATH;
      case KBLayer.GENERATED:
        return GENERATED_KB_PATH;
    }
  }

  // 添加文档到指定层
  public addDocument(layer: KBLayer, doc: Omit<KBDocument, 'id' | 'layer'>): string {
    const id = `${layer}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullDoc: KBDocument = {
      id,
      layer,
      ...doc,
      metadata: {
        ...doc.metadata,
        createdAt: doc.metadata.createdAt || Date.now(),
        updatedAt: Date.now()
      }
    };

    const docs = this.documents.get(layer) || [];
    docs.push(fullDoc);
    this.documents.set(layer, docs);
    this.saveLayer(layer);

    console.log(`[MultiLayerKB] Added document to ${layer}: ${fullDoc.title}`);
    return id;
  }

  // 更新文档
  public updateDocument(id: string, updates: Partial<Omit<KBDocument, 'metadata'>> & { metadata?: Partial<KBDocument['metadata']> }): boolean {
    for (const [layer, docs] of this.documents.entries()) {
      const index = docs.findIndex(d => d.id === id);
      if (index !== -1) {
        docs[index] = {
          ...docs[index],
          ...updates,
          metadata: {
            ...docs[index].metadata,
            ...updates.metadata,
            updatedAt: Date.now()
          }
        };
        this.saveLayer(layer);
        console.log(`[MultiLayerKB] Updated document: ${id}`);
        return true;
      }
    }
    return false;
  }

  // 删除文档
  public deleteDocument(id: string): boolean {
    for (const [layer, docs] of this.documents.entries()) {
      const index = docs.findIndex(d => d.id === id);
      if (index !== -1) {
        docs.splice(index, 1);
        this.saveLayer(layer);
        console.log(`[MultiLayerKB] Deleted document: ${id}`);
        return true;
      }
    }
    return false;
  }

  // 获取特定层的所有文档
  public getDocumentsByLayer(layer: KBLayer): KBDocument[] {
    return this.documents.get(layer) || [];
  }

  // 搜索所有层（可指定层优先级）
  public search(query: string, layers: KBLayer[] = [KBLayer.CORE, KBLayer.GENERATED, KBLayer.CONVERSATION]): KBDocument[] {
    const results: KBDocument[] = [];
    const queryLower = query.toLowerCase();

    layers.forEach(layer => {
      const docs = this.documents.get(layer) || [];
      const matches = docs.filter(doc => 
        doc.title.toLowerCase().includes(queryLower) ||
        doc.content.toLowerCase().includes(queryLower) ||
        doc.metadata.tags?.some(tag => tag.toLowerCase().includes(queryLower))
      );
      results.push(...matches);
    });

    return results;
  }

  // 获取统计信息
  public getStats() {
    return {
      core: this.documents.get(KBLayer.CORE)?.length || 0,
      conversation: this.documents.get(KBLayer.CONVERSATION)?.length || 0,
      generated: this.documents.get(KBLayer.GENERATED)?.length || 0,
      total: Array.from(this.documents.values()).reduce((sum, docs) => sum + docs.length, 0),
      paths: {
        core: CORE_KB_PATH,
        conversation: CONVERSATION_KB_PATH,
        generated: GENERATED_KB_PATH
      }
    };
  }

  // 保存对话到知识库
  public saveConversation(conversationId: string, messages: any[], summary?: string): string {
    const content = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    
    return this.addDocument(KBLayer.CONVERSATION, {
      title: summary || `Conversation ${new Date().toLocaleDateString()}`,
      content,
      metadata: {
        conversationId,
        messageCount: messages.length,
        type: 'conversation',
        tags: ['chat', 'history'],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    });
  }

  // 保存生成的内容
  public saveGeneratedContent(title: string, content: string, metadata: any = {}): string {
    return this.addDocument(KBLayer.GENERATED, {
      title,
      content,
      metadata: {
        ...metadata,
        type: 'generated',
        verified: false,
        tags: ['ai-generated', ...(metadata.tags || [])]
      }
    });
  }

  // 标记生成内容为已确认
  public verifyGeneratedContent(id: string): boolean {
    return this.updateDocument(id, {
      metadata: { verified: true }
    });
  }

  // 清空特定层
  public clearLayer(layer: KBLayer): void {
    this.documents.set(layer, []);
    this.saveLayer(layer);
    console.log(`[MultiLayerKB] Cleared ${layer} layer`);
  }
}

export const multiLayerKB = new MultiLayerKnowledgeBase();
