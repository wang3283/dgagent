import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { aiAgent } from './aiAgent';

const SUMMARY_DIR = path.join(app.getPath('userData'), 'summaries');

// Ensure directory exists
if (!fs.existsSync(SUMMARY_DIR)) {
  fs.mkdirSync(SUMMARY_DIR, { recursive: true });
}

export interface ConversationSummary {
  id: string;
  conversationId: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  title: string;
  summary: string;
  keyPoints: string[];
  participants: string[];
  attachments: Array<{name: string; type: string}>;
  messageCount: number;
  tags: string[];
}

class ConversationSummaryService {
  
  // Generate summary for a conversation
  async generateSummary(conversation: any): Promise<ConversationSummary> {
    console.log('[Summary] Generating summary for conversation:', conversation.id);
    
    // Extract conversation content
    const messages = conversation.messages || [];
    const conversationText = messages
      .map((msg: any) => `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.content}`)
      .join('\n\n');
    
    // Extract attachments info
    const attachments = messages
      .filter((msg: any) => msg.attachments && msg.attachments.length > 0)
      .flatMap((msg: any) => msg.attachments)
      .map((att: any) => ({name: att.name, type: att.type}));
    
    // Use AI to generate summary
    const summaryPrompt = `请为以下对话生成一份简洁的纪要。

对话内容：
${conversationText.substring(0, 4000)}

请以 JSON 格式返回，包含：
{
  "title": "对话主题（10字以内）",
  "summary": "对话摘要（100-200字）",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "tags": ["标签1", "标签2"]
}`;

    try {
      const response = await aiAgent.chat(summaryPrompt);
      
      // Parse AI response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      let summaryData;
      
      if (jsonMatch) {
        summaryData = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback
        summaryData = {
          title: conversation.title || '未命名对话',
          summary: response.substring(0, 200),
          keyPoints: ['对话记录'],
          tags: ['general']
        };
      }
      
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      
      const summary: ConversationSummary = {
        id: `summary_${Date.now()}`,
        conversationId: conversation.id,
        date: dateStr,
        timestamp: date.getTime(),
        title: summaryData.title,
        summary: summaryData.summary,
        keyPoints: summaryData.keyPoints || [],
        participants: ['User', 'AI'],
        attachments: attachments,
        messageCount: messages.length,
        tags: summaryData.tags || []
      };
      
      // Save summary
      await this.saveSummary(summary);
      
      console.log('[Summary] Summary generated:', summary.title);
      return summary;
      
    } catch (error) {
      console.error('[Summary] Failed to generate summary:', error);
      
      // Create basic summary without AI
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0];
      
      const summary: ConversationSummary = {
        id: `summary_${Date.now()}`,
        conversationId: conversation.id,
        date: dateStr,
        timestamp: date.getTime(),
        title: conversation.title || '对话记录',
        summary: `对话包含 ${messages.length} 条消息`,
        keyPoints: [`共 ${messages.length} 条消息`],
        participants: ['User', 'AI'],
        attachments: attachments,
        messageCount: messages.length,
        tags: ['conversation']
      };
      
      await this.saveSummary(summary);
      return summary;
    }
  }
  
  // Save summary to file
  private async saveSummary(summary: ConversationSummary): Promise<void> {
    const filePath = path.join(SUMMARY_DIR, `${summary.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
  }
  
  // Get summaries by date
  async getSummariesByDate(date: string): Promise<ConversationSummary[]> {
    const files = fs.readdirSync(SUMMARY_DIR);
    const summaries: ConversationSummary[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(SUMMARY_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const summary = JSON.parse(content) as ConversationSummary;
        
        if (summary.date === date) {
          summaries.push(summary);
        }
      }
    }
    
    return summaries.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  // Get summaries by date range
  async getSummariesByDateRange(startDate: string, endDate: string): Promise<ConversationSummary[]> {
    const files = fs.readdirSync(SUMMARY_DIR);
    const summaries: ConversationSummary[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(SUMMARY_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const summary = JSON.parse(content) as ConversationSummary;
        
        if (summary.date >= startDate && summary.date <= endDate) {
          summaries.push(summary);
        }
      }
    }
    
    return summaries.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  // Get all summaries grouped by date
  async getAllSummariesGrouped(): Promise<Record<string, ConversationSummary[]>> {
    const files = fs.readdirSync(SUMMARY_DIR);
    const grouped: Record<string, ConversationSummary[]> = {};
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(SUMMARY_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const summary = JSON.parse(content) as ConversationSummary;
        
        if (!grouped[summary.date]) {
          grouped[summary.date] = [];
        }
        grouped[summary.date].push(summary);
      }
    }
    
    // Sort each day's summaries
    Object.keys(grouped).forEach(date => {
      grouped[date].sort((a, b) => b.timestamp - a.timestamp);
    });
    
    return grouped;
  }
  
  // Search summaries
  async searchSummaries(query: string): Promise<ConversationSummary[]> {
    const files = fs.readdirSync(SUMMARY_DIR);
    const summaries: ConversationSummary[] = [];
    const lowerQuery = query.toLowerCase();
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(SUMMARY_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const summary = JSON.parse(content) as ConversationSummary;
        
        // Search in title, summary, keyPoints, tags
        if (
          summary.title.toLowerCase().includes(lowerQuery) ||
          summary.summary.toLowerCase().includes(lowerQuery) ||
          summary.keyPoints.some(point => point.toLowerCase().includes(lowerQuery)) ||
          summary.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
        ) {
          summaries.push(summary);
        }
      }
    }
    
    return summaries.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  // Delete summary
  async deleteSummary(summaryId: string): Promise<void> {
    const filePath = path.join(SUMMARY_DIR, `${summaryId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  
  // Get summary by ID
  async getSummaryById(summaryId: string): Promise<ConversationSummary | null> {
    const filePath = path.join(SUMMARY_DIR, `${summaryId}.json`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ConversationSummary;
    }
    return null;
  }
}

export const conversationSummaryService = new ConversationSummaryService();
