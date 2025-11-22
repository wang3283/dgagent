import { app } from 'electron';
import path from 'path';
import * as fs from 'fs';

// Conversation data path
let CONV_PATH = '';
if (app && app.getPath) {
  CONV_PATH = path.join(app.getPath('userData'), 'conversations');
} else {
  CONV_PATH = path.join(process.cwd(), 'temp-conversations');
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: Array<{
    type: 'file' | 'image';
    path: string;
    name: string;
  }>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  metadata?: {
    topics?: string[];
    people?: string[];
    keyFacts?: string[];
  };
}

export class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private currentConversationId: string | null = null;
  private readonly STORAGE_FILE: string;

  constructor() {
    this.ensureDir();
    this.STORAGE_FILE = path.join(CONV_PATH, 'conversations.json');
    this.loadConversations();
  }

  private ensureDir() {
    if (!fs.existsSync(CONV_PATH)) {
      fs.mkdirSync(CONV_PATH, { recursive: true });
    }
  }

  private loadConversations() {
    try {
      if (fs.existsSync(this.STORAGE_FILE)) {
        const data = fs.readFileSync(this.STORAGE_FILE, 'utf-8');
        const convArray: Conversation[] = JSON.parse(data);
        this.conversations = new Map(convArray.map(c => [c.id, c]));
        console.log(`[ConvManager] Loaded ${this.conversations.size} conversations`);
      }
    } catch (error) {
      console.error('[ConvManager] Failed to load conversations:', error);
      this.conversations = new Map();
    }
  }

  private saveConversations() {
    try {
      const convArray = Array.from(this.conversations.values());
      fs.writeFileSync(this.STORAGE_FILE, JSON.stringify(convArray, null, 2));
      console.log(`[ConvManager] Saved ${convArray.length} conversations`);
    } catch (error) {
      console.error('[ConvManager] Failed to save conversations:', error);
    }
  }

  // Create a new conversation
  public createConversation(title?: string): string {
    const id = Date.now().toString();
    const conversation: Conversation = {
      id,
      title: title || 'New Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.conversations.set(id, conversation);
    this.currentConversationId = id;
    this.saveConversations();
    
    console.log(`[ConvManager] Created conversation: ${id}`);
    return id;
  }

  // Add a message to current conversation
  public addMessage(role: 'user' | 'assistant', content: string, attachments?: Message['attachments']): Message {
    if (!this.currentConversationId) {
      this.createConversation();
    }

    const conversation = this.conversations.get(this.currentConversationId!);
    if (!conversation) {
      throw new Error('Current conversation not found');
    }

    const message: Message = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: Date.now(),
      attachments
    };

    conversation.messages.push(message);
    conversation.updatedAt = Date.now();

    // Don't auto-generate title here anymore - will be done by AI
    // Just use a temporary title for now
    if (conversation.messages.length === 1 && role === 'user' && conversation.title === 'New Conversation') {
      conversation.title = 'Generating title...';
    }

    this.saveConversations();
    return message;
  }
  
  // Update conversation title
  public updateConversationTitle(conversationId: string, title: string): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.title = title;
      this.saveConversations();
      console.log(`[ConvManager] Updated conversation title: ${title}`);
    }
  }

  // Get current conversation
  public getCurrentConversation(): Conversation | null {
    if (!this.currentConversationId) return null;
    return this.conversations.get(this.currentConversationId) || null;
  }

  // Get all conversations
  public getAllConversations(): Conversation[] {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Switch to a conversation
  public switchConversation(id: string): boolean {
    if (this.conversations.has(id)) {
      this.currentConversationId = id;
      return true;
    }
    return false;
  }

  // Delete a conversation
  public deleteConversation(id: string): boolean {
    const deleted = this.conversations.delete(id);
    if (deleted) {
      if (this.currentConversationId === id) {
        this.currentConversationId = null;
      }
      this.saveConversations();
    }
    return deleted;
  }

  // Get recent messages for context (from current conversation)
  public getRecentMessages(limit: number = 10): Message[] {
    const conversation = this.getCurrentConversation();
    if (!conversation) return [];
    
    return conversation.messages.slice(-limit);
  }

  // Search across all conversations
  public searchConversations(query: string, limit: number = 10): Array<{conversation: Conversation, message: Message}> {
    const queryLower = query.toLowerCase();
    const results: Array<{conversation: Conversation, message: Message}> = [];

    for (const conversation of this.conversations.values()) {
      for (const message of conversation.messages) {
        if (message.content.toLowerCase().includes(queryLower)) {
          results.push({ conversation, message });
          if (results.length >= limit) break;
        }
      }
      if (results.length >= limit) break;
    }

    return results;
  }

  // Get conversation summary for knowledge base
  public getConversationSummary(conversationId?: string): string {
    const id = conversationId || this.currentConversationId;
    if (!id) return '';

    const conversation = this.conversations.get(id);
    if (!conversation) return '';

    return conversation.messages
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');
  }

  // Get all conversations as context (for knowledge base)
  public getAllConversationsAsContext(limit: number = 5): string {
    const recent = this.getAllConversations().slice(0, limit);
    
    return recent.map(conv => {
      const date = new Date(conv.updatedAt).toLocaleDateString();
      const summary = conv.messages
        .slice(-3) // Last 3 messages
        .map(msg => `${msg.role}: ${msg.content.substring(0, 200)}`)
        .join('\n');
      
      return `[Conversation: ${conv.title} - ${date}]\n${summary}`;
    }).join('\n\n---\n\n');
  }
}

export const conversationManager = new ConversationManager();
