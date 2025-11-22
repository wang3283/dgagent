import { app } from 'electron';
import path from 'path';
import * as fs from 'fs';
import * as lancedb from '@lancedb/lancedb';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { globalConfig } from '../config/globalConfig';

// Store data in the user's userData directory
let DB_PATH = '';
if (app && app.getPath) {
  DB_PATH = path.join(app.getPath('userData'), 'knowledge-lancedb');
} else {
  // Fallback for testing environments where app is not available immediately
  DB_PATH = path.join(process.cwd(), 'temp-knowledge-lancedb');
}

export interface AIConfig {
  apiKey: string;
  baseUrl?: string;
  chatModel?: string;
  embeddingModel?: string;
}

export class KnowledgeBaseService {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private documents: Array<{ text: string; metadata: Record<string, any> }> = [];
  private readonly SIMPLE_STORAGE_PATH: string;

  constructor() {
    this.ensureDbDir();
    this.SIMPLE_STORAGE_PATH = path.join(DB_PATH, 'documents.json');
    this.loadDocuments();
  }

  private ensureDbDir() {
    if (!fs.existsSync(DB_PATH)) {
      fs.mkdirSync(DB_PATH, { recursive: true });
    }
  }

  private loadDocuments() {
    try {
      if (fs.existsSync(this.SIMPLE_STORAGE_PATH)) {
        const data = fs.readFileSync(this.SIMPLE_STORAGE_PATH, 'utf-8');
        this.documents = JSON.parse(data);
        console.log(`[KB] Loaded ${this.documents.length} documents from storage`);
      }
    } catch (error) {
      console.error('[KB] Failed to load documents:', error);
      this.documents = [];
    }
  }

  private saveDocuments() {
    try {
      fs.writeFileSync(this.SIMPLE_STORAGE_PATH, JSON.stringify(this.documents, null, 2));
      console.log(`[KB] Saved ${this.documents.length} documents to storage`);
    } catch (error) {
      console.error('[KB] Failed to save documents:', error);
    }
  }

  // Get all documents as a single context string
  public getAllDocumentsAsContext(): string {
    if (this.documents.length === 0) {
      return '';
    }
    return this.documents.map((doc, idx) => {
      const source = doc.metadata?.source || 'Unknown';
      return `[Document ${idx + 1}: ${source}]\n${doc.text}`;
    }).join('\n\n---\n\n');
  }

  private async getEmbeddings() {
    const config = globalConfig.getConfig();
    if (!config.apiKey) {
      throw new Error('API Key not set. Please configure it in Settings.');
    }
    return new OpenAIEmbeddings({
      openAIApiKey: config.apiKey,
      modelName: config.embeddingModel || 'text-embedding-3-small',
      configuration: {
        baseURL: config.baseUrl
      }
    });
  }

  private async initDB() {
    if (this.db) return;

    try {
      this.db = await lancedb.connect(DB_PATH);
      
      const tableNames = await this.db.tableNames();
      if (!tableNames.includes('documents')) {
        // Create table with a schema strictly if needed, or use auto-schema from data
        // For simplicity with LangChain/Generic usage, we'll start with sample data or rely on creating it on first insertion
        // LanceDB node implementation often requires creating table with data
      } else {
        this.table = await this.db.openTable('documents');
      }
    } catch (error) {
      console.error('Failed to init LanceDB:', error);
      throw error;
    }
  }

  public async addDocument(text: string, metadata: Record<string, any>) {
    console.log(`[KB] Adding document: ${metadata.source || 'unknown'}`);
    
    // Split text into chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const docs = await splitter.createDocuments([text], [metadata]);

    // Always store in simple storage (as backup and for direct reading)
    for (const doc of docs) {
      this.documents.push({
        text: doc.pageContent,
        metadata: {
          ...metadata,
          timestamp: Date.now()
        }
      });
    }
    this.saveDocuments();

    // Try to use embedding if available
    const config = globalConfig.getConfig();
    if (config.embeddingModel && config.embeddingModel.trim() !== '') {
      try {
        console.log(`[KB] Embedding model configured: ${config.embeddingModel}, using vector storage`);
        await this.addToVectorDB(docs, metadata);
      } catch (error) {
        console.warn(`[KB] Failed to use vector storage, falling back to simple storage:`, error);
      }
    } else {
      console.log(`[KB] No embedding model configured, using simple storage only`);
    }

    console.log(`[KB] Total documents: ${this.documents.length}`);
    return docs.length;
  }

  private async addToVectorDB(docs: any[], metadata: Record<string, any>) {
    await this.initDB();
    
    const embeddingsModel = await this.getEmbeddings();
    const dataToInsert = [];
    
    for (const doc of docs) {
      const vector = await embeddingsModel.embedQuery(doc.pageContent);
      dataToInsert.push({
        vector,
        text: doc.pageContent,
        source: metadata.source || 'unknown',
        type: metadata.type || 'text',
        timestamp: Date.now()
      });
    }

    if (!this.table) {
      this.table = await this.db!.createTable('documents', dataToInsert);
    } else {
      await this.table.add(dataToInsert);
    }
  }

  // Legacy method for vector-based storage (kept for future use)
  private async addDocumentWithEmbedding(text: string, metadata: Record<string, any>) {
    await this.initDB();
    
    // 1. Split text
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const docs = await splitter.createDocuments([text], [metadata]);

    // 2. Embed
    const embeddingsModel = await this.getEmbeddings();
    
    const dataToInsert = [];
    for (const doc of docs) {
      const vector = await embeddingsModel.embedQuery(doc.pageContent);
      dataToInsert.push({
        vector,
        text: doc.pageContent,
        source: metadata.source || 'unknown',
        type: metadata.type || 'text',
        timestamp: Date.now()
      });
    }

    // 3. Insert into LanceDB
    if (!this.table) {
      // Create table with the first batch of data
      this.table = await this.db!.createTable('documents', dataToInsert);
    } else {
      await this.table.add(dataToInsert);
    }

    return dataToInsert.length; // Return number of chunks added
  }

  // Keyword-based search (fallback mode)
  private keywordSearch(query: string, limit: number = 10) {
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(k => k.length > 1);
    
    console.log(`[KB] Using keyword search with keywords:`, keywords);
    
    // Score each document based on keyword matches
    const scored = this.documents.map(doc => {
      const textLower = doc.text.toLowerCase();
      let score = 0;
      
      // Count keyword occurrences
      for (const keyword of keywords) {
        const matches = (textLower.match(new RegExp(keyword, 'g')) || []).length;
        score += matches;
      }
      
      // Boost score if keyword appears in metadata
      const metadataStr = JSON.stringify(doc.metadata).toLowerCase();
      for (const keyword of keywords) {
        if (metadataStr.includes(keyword)) {
          score += 2;
        }
      }
      
      return { doc, score };
    });
    
    // Sort by score and return top results
    const results = scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => ({
        text: item.doc.text,
        ...item.doc.metadata,
        score: item.score
      }));
    
    console.log(`[KB] Keyword search found ${results.length} relevant documents`);
    return results;
  }

  public async search(query: string, limit: number = 5) {
    const config = globalConfig.getConfig();
    
    // Try vector search if embedding model is configured
    if (config.embeddingModel && config.embeddingModel.trim() !== '') {
      try {
        await this.initDB();
        if (this.table) {
          console.log(`[KB] Using vector search with embedding model: ${config.embeddingModel}`);
          const embeddingsModel = await this.getEmbeddings();
          const queryVector = await embeddingsModel.embedQuery(query);
          const results = await this.table.vectorSearch(queryVector)
            .limit(limit)
            .toArray();
          console.log(`[KB] Vector search found ${results.length} results`);
          return results;
        }
      } catch (error) {
        console.warn(`[KB] Vector search failed, falling back to keyword search:`, error);
      }
    }

    // Fallback: use keyword-based search
    const keywordResults = this.keywordSearch(query, limit);
    
    // If no keyword matches, return recent documents
    if (keywordResults.length === 0) {
      console.log(`[KB] No keyword matches, returning recent documents`);
      return this.documents
        .slice(-limit)
        .map(doc => ({
          text: doc.text,
          ...doc.metadata
        }));
    }
    
    return keywordResults;
  }
  
  public async getStats() {
    // Try to get stats from vector DB first
    const config = globalConfig.getConfig();
    if (config.embeddingModel && config.embeddingModel.trim() !== '') {
      try {
        await this.initDB();
        if (this.table) {
          const count = await this.table.countRows();
          return { 
            count, 
            mode: 'vector',
            storagePath: DB_PATH
          };
        }
      } catch (error) {
        // Fallback to simple storage
      }
    }
    
    // Return simple storage stats
    return { 
      count: this.documents.length, 
      mode: config.embeddingModel ? 'vector (fallback to simple)' : 'simple',
      storagePath: DB_PATH
    };
  }

  // Get all documents with metadata
  public getAllDocuments(): Array<{ text: string; metadata: Record<string, any> }> {
    return this.documents.map(doc => ({
      text: doc.text,
      metadata: doc.metadata
    }));
  }
  
  // Delete a document by index
  public deleteDocument(index: number): boolean {
    if (index >= 0 && index < this.documents.length) {
      this.documents.splice(index, 1);
      this.saveDocuments();
      console.log(`[KB] Deleted document at index ${index}`);
      return true;
    }
    return false;
  }
  
  // Clear all documents
  public clearAllDocuments(): void {
    this.documents = [];
    this.saveDocuments();
    console.log('[KB] Cleared all documents');
  }

  // Reindex all documents into vector DB
  public async reindex(): Promise<{success: boolean, count: number, error?: string}> {
    const config = globalConfig.getConfig();
    if (!config.embeddingModel) {
        return { success: false, count: 0, error: 'No embedding model configured' };
    }

    try {
        console.log('[KB] Starting reindex...');
        
        // Clear existing vector table
        await this.initDB();
        try {
            if ((await this.db!.tableNames()).includes('documents')) {
                await this.db!.dropTable('documents');
            }
        } catch (e) { 
            console.warn('[KB] Failed to drop table during reindex (might not exist):', e);
        }
        this.table = null;

        // Re-add all documents
        let processed = 0;
        for (const doc of this.documents) {
            // Use text splitter to match addDocument logic
            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1000,
                chunkOverlap: 200,
            });
            const chunks = await splitter.createDocuments([doc.text], [doc.metadata]);
            
            // Insert into vector DB
            await this.addToVectorDB(chunks, doc.metadata);
            processed++;
        }
        
        console.log(`[KB] Reindex complete. Processed ${processed} documents.`);
        return { success: true, count: processed };
    } catch (error) {
        console.error('[KB] Reindex failed:', error);
        return { success: false, count: 0, error: (error as Error).message };
    }
  }
}

export const knowledgeBase = new KnowledgeBaseService();
