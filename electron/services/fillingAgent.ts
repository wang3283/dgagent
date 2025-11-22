import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { knowledgeBase } from './knowledgeBase';
import { globalConfig } from '../config/globalConfig';

export class FillingAgentService {
  private getModel() {
    const config = globalConfig.getConfig();
    console.log('[FillingAgent] getModel called with global config:', config);
    
    if (!config.apiKey) {
      throw new Error('API Key not set. Please configure it in Settings.');
    }
    
    console.log('[FillingAgent] Creating ChatOpenAI with apiKey:', config.apiKey.substring(0, 10) + '...');
    
    return new ChatOpenAI({
      apiKey: config.apiKey,  // Changed from openAIApiKey
      modelName: config.chatModel || 'gpt-3.5-turbo', 
      temperature: 0,
      configuration: {
        baseURL: config.baseUrl
      }
    });
  }

  // Step 1: Analyze the form to find fields
  // For simplicity, we assume the first row of an Excel/CSV are headers
  public async analyzeFormFields(csvContent: string): Promise<string[]> {
    // Simple heuristic: take the first line as headers
    // In a real app, use LLM to identify headers vs data
    const firstLine = csvContent.split('\n')[0];
    if (!firstLine) return [];
    
    return firstLine.split(',').map(field => field.trim()).filter(f => f.length > 0);
  }

  // Step 2: Generate content for a specific field
  public async generateFieldContent(field: string, formContext?: string): Promise<string> {
    try {
      console.log(`[FillingAgent] Generating content for field: "${field}"`);
      
      // Try to search knowledge base (will use vector search if available, or return all docs)
      let knowledgeContext = '';
      try {
        const searchResults = await knowledgeBase.search(`My ${field}`, 5);
        console.log(`[FillingAgent] Found ${searchResults.length} results from KB`);
        
        if (searchResults.length > 0) {
          // If we got limited results (vector search), use them directly
          // If we got all documents (simple mode), also use them
          knowledgeContext = searchResults.map(r => r.text).join('\n\n');
        } else {
          // No results, try to get all documents as fallback
          knowledgeContext = knowledgeBase.getAllDocumentsAsContext();
        }
      } catch (kbError) {
        console.warn(`[FillingAgent] Knowledge Base error:`, kbError);
        // Try direct document reading as last resort
        knowledgeContext = knowledgeBase.getAllDocumentsAsContext();
      }

      console.log(`[FillingAgent] Using context with ${knowledgeContext.length} characters`);

      // Generate answer using LLM with available context
      console.log(`[FillingAgent] Calling LLM for field: "${field}"`);
      const model = this.getModel();
      
      let promptText = '';
      if (knowledgeContext) {
        promptText = `You are an expert form-filling assistant. 
Fill in the field "{field}" based on the provided personal information from my knowledge base.

My Personal Information:
---
{context}
---

Field to fill: "{field}"

Rules:
- Extract the exact information from the knowledge base above
- Be concise and accurate
- If the information is not found in the knowledge base, say "[Not Found]"
- Output ONLY the value to fill, no explanations or additional text`;
      } else {
        promptText = `You are an expert form-filling assistant.
Analyze the form and suggest a reasonable value for the field "{field}".

Form content:
---
{context}
---

Field to fill: "{field}"

Rules:
- Provide a reasonable placeholder or example value
- Be concise
- Output ONLY the value to fill, no explanations`;
      }

      const prompt = PromptTemplate.fromTemplate(promptText);
      const chain = prompt.pipe(model).pipe(new StringOutputParser());

      const answer = await chain.invoke({
        field,
        context: knowledgeContext || formContext || 'No context available'
      });

      console.log(`[FillingAgent] Generated answer for "${field}": ${answer.substring(0, 50)}...`);
      return answer.trim();
    } catch (error) {
      console.error(`[FillingAgent] Error generating content for field "${field}":`, error);
      throw error;
    }
  }

  // Step 3: Process the whole form
  public async processForm(csvContent: string) {
    const fields = await this.analyzeFormFields(csvContent);
    const results: Record<string, string> = {};

    for (const field of fields) {
      // Skip empty or irrelevant fields check could go here
      results[field] = await this.generateFieldContent(field);
    }

    return results;
  }
}

export const fillingAgent = new FillingAgentService();
