import { app } from 'electron';
import path from 'path';
import * as fs from 'fs';
import * as lancedb from '@lancedb/lancedb';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import MiniSearch from 'minisearch';
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
  private documents: Array<{ id: string; text: string; metadata: Record<string, any> }> = [];
  private miniSearch: MiniSearch;
  private readonly SIMPLE_STORAGE_PATH: string;

  constructor() {
    this.ensureDbDir();
    this.SIMPLE_STORAGE_PATH = path.join(DB_PATH, 'documents.json');
    
    // Initialize MiniSearch
    this.miniSearch = new MiniSearch({
      fields: ['text', 'source'], // fields to index for full-text search
      storeFields: ['text', 'metadata'], // fields to return with search results
      searchOptions: {
        boost: { source: 2 }, // boost 'source' (filename) matches
        fuzzy: 0.2, // allow minor typos
        prefix: true
      }
    });

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
        
        // Rebuild MiniSearch index
        if (this.documents.length > 0) {
          this.miniSearch.addAll(this.documents.map(doc => ({
            id: doc.id || Math.random().toString(36).substring(7),
            text: doc.text,
            source: doc.metadata?.source || '',
            metadata: doc.metadata
          })));
        }
        
        console.log(`[KB] Loaded ${this.documents.length} documents and indexed in MiniSearch`);
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
      const id = Math.random().toString(36).substring(7);
      const docEntry = {
        id,
        text: doc.pageContent,
        metadata: {
          ...metadata,
          timestamp: Date.now()
        }
      };
      
      this.documents.push(docEntry);
      
      // Add to MiniSearch
      this.miniSearch.add({
        id,
        text: docEntry.text,
        source: (metadata.source as string) || '',
        metadata: docEntry.metadata
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

  // Keyword-based search (legacy, now using MiniSearch)
  private keywordSearch(query: string, limit: number = 10) {
    // This method is replaced by MiniSearch but kept for reference if needed
    return [];
  }

  public async search(query: string, limit: number = 5) {
    const config = globalConfig.getConfig();
    let vectorResults: any[] = [];
    let miniSearchResults: any[] = [];
    
    // 1. Vector Search (Semantic) - Optional
    if (config.embeddingModel && config.embeddingModel.trim() !== '') {
      try {
        await this.initDB();
        if (this.table) {
          console.log(`[KB] Using vector search with embedding model: ${config.embeddingModel}`);
          const embeddingsModel = await this.getEmbeddings();
          const queryVector = await embeddingsModel.embedQuery(query);
          vectorResults = await this.table.vectorSearch(queryVector)
            .limit(limit)
            .toArray();
          console.log(`[KB] Vector search found ${vectorResults.length} results`);
        }
      } catch (error) {
        console.warn(`[KB] Vector search failed:`, error);
      }
    }

    // 2. MiniSearch (Full-text / Keyword)
    try {
      const results = this.miniSearch.search(query, { fuzzy: 0.2, prefix: true });
      miniSearchResults = results.slice(0, limit).map(r => ({
        text: r.text,
        ...r.metadata,
        score: r.score
      }));
      console.log(`[KB] MiniSearch found ${miniSearchResults.length} results`);
    } catch (error) {
      console.error('[KB] MiniSearch failed:', error);
    }
    
    // 3. Hybrid Merge (Deduplicate by text content)
    // Combine results, prioritizing vector results but including unique keyword matches
    const combined = [...vectorResults];
    
    for (const kwResult of miniSearchResults) {
      // Check if this text is already in vector results (fuzzy matching or exact)
      const exists = vectorResults.some(v => v.text === kwResult.text);
      if (!exists) {
        combined.push(kwResult);
      }
    }
    
    // If still no results, return nothing (Agent will handle fallback)
    if (combined.length === 0) {
      console.log(`[KB] No matches found`);
      return [];
    }
    
    // Limit total results
    return combined.slice(0, limit * 2); // Return slightly more for hybrid
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
