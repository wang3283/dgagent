import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, ToolMessage, AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import fs from 'fs/promises';
import { globalConfig } from '../config/globalConfig';
import { knowledgeBase } from './knowledgeBase';
import { conversationManager } from './conversationManager';
import { pythonService } from './pythonService';

// Tools
const readFileTool = tool(
  async ({ path }) => {
    try {
      const content = await fs.readFile(path, 'utf-8');
      return content.substring(0, 5000); // Limit size
    } catch (error) {
      return `Error reading file: ${error}`;
    }
  },
  {
    name: "read_file",
    description: "Read content of a file from the local filesystem. Use this to analyze code or documents.",
    schema: z.object({
      path: z.string().describe("The absolute path to the file to read"),
    }),
  }
);

const createPlanTool = tool(
  async ({ steps }) => {
    return `Plan created with ${steps.length} steps. execute them one by one.`;
  },
  {
    name: "create_plan",
    description: "Create a step-by-step plan for a complex task. Call this BEFORE executing other tools.",
    schema: z.object({
      steps: z.array(z.string()).describe("List of steps to execute"),
    }),
  }
);

const markStepCompletedTool = tool(
  async ({ step_index }) => {
    return `Step ${step_index} marked as completed.`;
  },
  {
    name: "mark_step_completed",
    description: "Mark a step in the plan as completed. Call this after finishing a step.",
    schema: z.object({
      step_index: z.number().describe("The 0-based index of the step that was completed"),
    }),
  }
);

export class AIAgentService {
  private getModel() {
    const config = globalConfig.getConfig();
    console.log('[AIAgent] Creating model with config');
    
    if (!config.apiKey) {
      throw new Error('API Key not set. Please configure it in Settings.');
    }
    
    return new ChatOpenAI({
      apiKey: config.apiKey,
      modelName: config.chatModel || 'gpt-3.5-turbo', 
      temperature: 0.7,
      configuration: {
        baseURL: config.baseUrl
      }
    });
  }

  // Generate image using OpenAI/compatible API
  private async generateImage(prompt: string): Promise<string> {
    try {
      const config = globalConfig.getConfig();
      if (!config.apiKey) {
        return "Error: API Key is missing. Please configure it in Settings.";
      }

      console.log(`[AIAgent] Generating image for prompt: ${prompt}`);
      
      // Use configured base URL or default OpenAI
      const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
      const url = `${baseUrl}/images/generations`.replace('//images', '/images'); // Handle potential double slash if baseUrl ends with /

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: "dall-e-3", // Default to dall-e-3, many APIs map this to their best model
          prompt: prompt,
          n: 1,
          size: "1024x1024"
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Image generation failed: ${error}`);
      }

      const data = await response.json();
      const imageUrl = data.data[0].url;
      
      // Return markdown image syntax
      return `Here is the generated image:\n\n![${prompt}](${imageUrl})`;
    } catch (error) {
      console.error('[AIAgent] Image generation error:', error);
      return `Failed to generate image: ${(error as Error).message}`;
    }
  }

  // PubMed Search Helper
  private async searchPubMed(query: string, maxResults: number = 20): Promise<string> {
    try {
      // 1. Search for IDs (get total count first)
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=${maxResults}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      
      if (!searchData.esearchresult || !searchData.esearchresult.idlist || searchData.esearchresult.idlist.length === 0) {
        return "No PubMed results found.";
      }
      
      const totalCount = parseInt(searchData.esearchresult.count);
      const ids = searchData.esearchresult.idlist.join(',');
      
      // 2. Get Summaries
      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids}&retmode=json`;
      const summaryRes = await fetch(summaryUrl);
      const summaryData = await summaryRes.json();
      
      const resultIds = searchData.esearchresult.idlist;
      let output = `PubMed Search Results (showing ${resultIds.length} of ${totalCount} total):\n\n`;
      
      // Table header
      output += `| # | Title | Source | Year | PMID |\n`;
      output += `|---|-------|--------|------|------|\n`;
      
      // Table rows
      let index = 1;
      for (const id of resultIds) {
        const doc = summaryData.result[id];
        if (doc) {
          const title = doc.title.replace(/\|/g, '\\|'); // Escape pipes in title
          const source = doc.source.replace(/\|/g, '\\|');
          const year = doc.pubdate || 'N/A';
          output += `| ${index} | [${title}](https://pubmed.ncbi.nlm.nih.gov/${id}/) | ${source} | ${year} | ${id} |\n`;
          index++;
        }
      }
      
      // If there are more than 1000 results, prompt user
      if (totalCount > 1000) {
        output += `\n⚠️ Note: This search returned ${totalCount} results in total. `;
        output += `Currently showing the first ${resultIds.length}. `;
        output += `If you need all results, please let me know and I can retrieve them in batches (this may take some time and consume more tokens).`;
      } else if (totalCount > maxResults) {
        output += `\n💡 Tip: There are ${totalCount} results total. Currently showing the first ${resultIds.length}. `;
        output += `Let me know if you'd like to see more.`;
      }
      
      return output;
    } catch (error) {
      console.error("PubMed Search Error:", error);
      return `Error searching PubMed: ${(error as Error).message}`;
    }
  }
  
  // PubMed Full Search (for batch retrieval)
  private async searchPubMedFull(query: string, batchSize: number = 100): Promise<string> {
    try {
      // 1. Get total count
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=0`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      
      const totalCount = parseInt(searchData.esearchresult.count);
      
      if (totalCount === 0) {
        return "No PubMed results found.";
      }
      
      // Limit to 1000 for safety (API limit is 10000 but we want to be reasonable)
      const maxFetch = Math.min(totalCount, 1000);
      let allResults: Array<{title: string, source: string, year: string, pmid: string}> = [];
      
      // 2. Fetch in batches
      for (let start = 0; start < maxFetch; start += batchSize) {
        const batchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retstart=${start}&retmax=${batchSize}`;
        const batchRes = await fetch(batchUrl);
        const batchData = await batchRes.json();
        
        if (batchData.esearchresult && batchData.esearchresult.idlist) {
          const ids = batchData.esearchresult.idlist.join(',');
          
          // Get summaries for this batch
          const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids}&retmode=json`;
          const summaryRes = await fetch(summaryUrl);
          const summaryData = await summaryRes.json();
          
          for (const id of batchData.esearchresult.idlist) {
            const doc = summaryData.result[id];
            if (doc) {
              allResults.push({
                title: doc.title.replace(/\|/g, '\\|'),
                source: doc.source.replace(/\|/g, '\\|'),
                year: doc.pubdate || 'N/A',
                pmid: id
              });
            }
          }
        }
        
        // Be nice to NCBI servers - add small delay between batches
        if (start + batchSize < maxFetch) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      let output = `PubMed Full Search Results (${allResults.length} of ${totalCount} total):\n\n`;
      
      // Table header
      output += `| # | Title | Source | Year | PMID |\n`;
      output += `|---|-------|--------|------|------|\n`;
      
      // Table rows
      allResults.forEach((result, idx) => {
        output += `| ${idx + 1} | [${result.title}](https://pubmed.ncbi.nlm.nih.gov/${result.pmid}/) | ${result.source} | ${result.year} | ${result.pmid} |\n`;
      });
      
      if (totalCount > 1000) {
        output += `\n\n⚠️ Note: Only the first 1000 results were retrieved (out of ${totalCount} total).`;
      }
      
      return output;
    } catch (error) {
      console.error("PubMed Full Search Error:", error);
      return `Error searching PubMed: ${(error as Error).message}`;
    }
  }

  // Helper to read image as base64
  private async getImageData(path: string): Promise<string> {
    try {
        const buffer = await fs.readFile(path);
        return buffer.toString('base64');
    } catch (e) {
        console.error(`Failed to read image ${path}`, e);
        return '';
    }
  }

  // Build message content with images
  private async buildUserMessageContent(text: string, attachments?: any[]): Promise<any> {
    if (!attachments || attachments.length === 0) {
        return text;
    }
    
    const imageAttachments = attachments.filter(a => a.type && a.type.startsWith('image/'));
    
    if (imageAttachments.length === 0) {
        return text;
    }
    
    const content: any[] = [{ type: 'text', text: text }];
    
    for (const img of imageAttachments) {
        const base64 = await this.getImageData(img.path);
        if (base64) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: `data:${img.type};base64,${base64}`
                }
            });
        }
    }
    
    return content;
  }

  // Main chat function with Agent Loop
  public async chat(
    userMessage: string, 
    attachments?: any[],
    onStep?: (step: { type: string; content: string }) => void,
    mode: 'chat' | 'agent' = 'agent'
  ): Promise<string> {
    try {
      console.log(`[AIAgent] Processing user message: "${userMessage.substring(0, 50)}..." (Mode: ${mode})`);
      
      // 1. Add user message to conversation history
      conversationManager.addMessage('user', userMessage, attachments);
      
      // 2. Check if this is the first message
      const currentConv = conversationManager.getCurrentConversation();
      const isFirstMessage = currentConv && currentConv.messages.length === 1;
      
      // 3. Gather context (skip KB search if user has attachments, as they're asking about the attachments)
      const skipKBSearch = attachments && attachments.length > 0;
      const context = await this.gatherContext(userMessage, skipKBSearch);
      
      // 4. Setup Model
      const model = this.getModel();

      // 5. Build History Messages (Common for both modes)
      // Convert history to LangChain messages
      const recentMessages = conversationManager.getRecentMessages(20);
      console.log(`[AIAgent] Recent messages count: ${recentMessages.length}`);
      
      const historyMessages: any[] = [];
      let lastAssistantMessage = ''; // Track last assistant message for context injection

      for (let i = 0; i < recentMessages.length - 1; i++) {
          const msg = recentMessages[i];
          if (!msg || typeof msg.content !== 'string') {
            console.warn(`[AIAgent] Invalid message at index ${i}:`, msg);
            continue;
          }
          try {
            // Only add messages that have content
            if (msg.content.trim().length > 0) {
              if (msg.role === 'user') {
                historyMessages.push(new HumanMessage(msg.content));
              } else {
                historyMessages.push(new AIMessage(msg.content));
                lastAssistantMessage = msg.content; // Update last assistant message
              }
            }
          } catch (err) {
            console.error(`[AIAgent] Failed to create message at index ${i}:`, err);
          }
      }
      console.log(`[AIAgent] Constructed ${historyMessages.length} history messages`);

      // --- CHAT MODE ---
      if (mode === 'chat') {
        const config = globalConfig.getConfig();
        const agentName = config.agentName || 'AI Assistant';

        // Pro-level System Prompt
        const systemPrompt = `You are ${agentName}, an advanced AI assistant designed to provide top-tier, professional, and human-like assistance.

CORE IDENTITY:
- You are intelligent, empathetic, and highly capable.
- Your responses should be indistinguishable from a top-level human expert.
- You are proactive: anticipate user needs beyond the literal question.

LANGUAGE RULE (CRITICAL):
- **ALWAYS reply in the SAME LANGUAGE as the user.**
- If the user speaks Chinese, you MUST reply in Chinese.
- If the user speaks English, reply in English.
- Do not switch languages unless explicitly asked (e.g., "Translate to English").

THINKING PROCESS (MANDATORY):
- Before answering, you MUST provide a short "thinking" block enclosed in <thinking> tags.
- Inside <thinking>, briefly analyze the user's intent, context, and potential pitfalls.
- This helps you organize your thoughts and provide a better answer.
- Example: <thinking>User is asking about X. Context implies Y. I should focus on Z.</thinking>
- **CRITICAL**: The <thinking> block is NOT the answer. You must provide the ACTUAL ANSWER after the </thinking> tag.

COMMUNICATION STYLE:
- **Natural & Fluid**: Avoid robotic phrases like "I have found..." or "Based on the context...". Just answer naturally.
- **Concise but Complete**: Get to the point directly, but provide necessary depth when needed.
- **Context Aware**: Always maintain the thread of conversation. Refer back to previous messages implicitly.
- **Personality**: Be helpful, warm, and confident. Not overly formal, but always professional.

KNOWLEDGE USAGE (CRITICAL):
- You have access to "Reference Documents" (RAG).
- **Usage Rule**: Use the knowledge ONLY if it directly answers the user's specific question.
- **Integration**: If you use the knowledge, weave it naturally into your answer. Do NOT say "According to document X...". Just state the facts.
- **Fallback**: If the documents don't contain the answer, rely on your general knowledge, but be honest if you are unsure.

INTERACTION RULES:
1. **Direct Action**: If the user asks you to do something (e.g., "Translate this", "Summarize this"), DO IT IMMEDIATELY. Do not ask for confirmation.
2. **No Meta-Talk**: Do not explain *how* you are answering (e.g., "I will now process your request"). Just provide the result.
3. **Identity**: If asked "Who are you?", answer simply that you are ${agentName}.

**LANGUAGE SWITCHING PROTOCOL (STRICT):**
If the user asks to change language (e.g., "Speak Chinese", "用中文", "English please"):
1. Do NOT just say "Okay" or "I will".
2. You MUST **IMMEDIATELY REWRITE/TRANSLATE** your *previous response* in the requested language.
3. Treat it as a command: "Translate previous message to [Language]".

**VOICE CAPABILITY (IMPORTANT):**
- You HAVE the ability to speak via the system's Text-to-Speech engine.
- If the user asks for a "voice reply", "speak this", "read this out", or "tell me in voice":
  - DO NOT say "I cannot speak" or "I am a text AI".
  - Instead, simply generate the TEXT response naturally. The system will automatically read your text out loud to the user.
  - You can verify this by saying: "Sure, here is the information (which I am reading out to you)..."

**AUTO-ESCALATION (CRITICAL):**
If the user asks for something that requires TOOLS you don't have in this mode (e.g., reading local files, searching personal knowledge base, searching PubMed, complex multi-step planning), DO NOT say "I cannot do that".
Instead, output EXACTLY and ONLY this string:
\`[NEEDS_AGENT_CAPABILITIES]\`
This will automatically switch the system to Agent mode to handle the request.

Your goal is to make the user feel understood and efficiently supported, providing a "Pro" experience similar to leading AI models.`;

        // In Chat mode, we don't automatically inject KB context
        // Users can switch to Agent mode if they need KB search
        const contextBlock = '';

        const userContent = await this.buildUserMessageContent(
            `${contextBlock}\nUser Question: ${userMessage}`,
            attachments
        );

        const messages = [
            new SystemMessage(systemPrompt),
            ...historyMessages,
            new HumanMessage({ content: userContent })
        ];
        
        if (onStep) onStep({ type: 'thinking', content: 'Thinking...' });
        
        const response = await model.invoke(messages);
        const finalResponse = response.content as string;
        
        // Check for auto-escalation signal
        if (finalResponse.includes('[NEEDS_AGENT_CAPABILITIES]')) {
            console.log('[AIAgent] Auto-escalating to Agent mode...');
            if (onStep) onStep({ type: 'thinking', content: 'Switching to Agent mode for advanced capabilities...' });
            
            // Recursively call chat in AGENT mode
            return this.chat(userMessage, attachments, onStep, 'agent');
        }
        
        conversationManager.addMessage('assistant', finalResponse);
        if (isFirstMessage && currentConv) this.generateConversationTitle(currentConv.id, userMessage, finalResponse);
        
        return finalResponse;
      }

      // --- AGENT MODE ---
      // We use manual JSON parsing for better compatibility with models that have weak Function Calling support
      const tools = [readFileTool, createPlanTool, markStepCompletedTool];
      
      const systemPrompt = `You are an expert AI Agent, capable of solving complex problems through strategic thinking and tool usage.

**YOUR OPERATING SYSTEM:**
1. **Analyze**: deeply understand the user's goal. What are they *really* trying to achieve?
   - If user asks "Can you translate this?" or "Say it in English", they usually mean **THE PREVIOUS MESSAGE**, not a settings change.
   - Always check conversation context before answering.
2. **Strategize**: Before jumping into tools, formulate a plan. Is this a simple query? A multi-step task? A research question?
3. **Execute**: Use tools precisely. Do not use tools if you already know the answer (unless verification is needed).
4. **Synthesize**: Combine tool outputs into a coherent, human-friendly response.

**LANGUAGE RULE (CRITICAL):**
- **ALWAYS reply in the SAME LANGUAGE as the user.**
- If the user speaks Chinese, you MUST reply in Chinese.
- **IMMEDIATE ACTION**: If user asks to switch language ("用中文"), DO NOT say "Okay". Instead, IMMEDIATELY REWRITE your previous response in that language.

**VOICE CAPABILITY (IMPORTANT):**
- You HAVE the ability to speak via the system's Text-to-Speech engine.
- If the user asks for a "voice reply", "speak this", "read this out", or "tell me in voice":
  - DO NOT say "I cannot speak" or "I am a text AI".
  - Instead, simply generate the TEXT response naturally. The system will automatically read your text out loud to the user.
  - You can verify this by saying: "Sure, here is the information (which I am reading out to you)..."

**THINKING PROCESS (MANDATORY):**
- Before EVERY response (tool call or final answer), you MUST output a <thinking> block.
- Explain WHY you are choosing a tool, or WHY you are giving a final answer.
- Example: <thinking>User wants to search X. I will use tool Y.</thinking>
- **CRITICAL**: The <thinking> block is NOT the answer. You must provide the ACTUAL ANSWER after the </thinking> tag.

**AVAILABLE TOOLS:**
1. create_plan: Use for multi-step complex tasks.
2. read_file: Read a specific local file (REQUIRES absolute path).
3. mark_step_completed: Track progress.
4. search_knowledge_base: Search the internal database of imported documents. Use this for "my notes", "local files" (without path), "saved documents", or "memory". Arguments: { "query": "KEYWORD_ONLY string" }
5. search_pubmed / search_pubmed_full: For scientific research.
6. run_python: Execute Python code. Use for math, data analysis, or complex logic. Arguments: { "code": "print('hello')" }
7. generate_image: Generate images using DALL-E 3. Arguments: { "prompt": "detailed description of image" }

**CRITICAL BEHAVIORAL RULES:**
- **Context Distinction**: 
  - If question is about user's data (e.g., "my notes", "project docs"), use 'search_knowledge_base'.
  - If user asks about "local files" but gives NO PATH, assume they mean Knowledge Base. DO NOT say "I cannot access local files". Search KB instead.
  - If question is GENERAL KNOWLEDGE (e.g., "Who is Elon Musk?", "Python tutorial"), DO NOT search knowledge base. Answer directly.
  - If question involves MATH or DATA (e.g., "Calculate fibonacci", "Analyze this list"), use 'run_python'.
  - If question asks to DRAW or GENERATE IMAGE, use 'generate_image'.
- **Fallback**: If you search the knowledge base and find NOTHING relevant, DO NOT say "I found nothing". Instead, ANSWER the question using your own general knowledge.
- **Efficiency**: Solve the problem in the fewest steps possible.
- **Directness**: Do not chatter. Just do the work.
- **Format**: Always output the JSON tool call block exactly as required.

**RESPONSE FORMAT (STRICT):**

1. **To use a tool** (ONLY when you need to perform an action):
\`\`\`json
{
  "tool": "tool_name",
  "args": { ... }
}
\`\`\`

2. **To give a final answer** (When you have the info or don't need tools):
- DO NOT use JSON.
- DO NOT use <|begin_of_box|> or similar tags.
- JUST WRITE THE TEXT response naturally.

Example of Final Answer:
<thinking>I have the info. I will answer directly.</thinking>
Elon Musk is a prominent entrepreneur...`;

      const userContent = await this.buildUserMessageContent(userMessage, attachments);

      // Ensure userContent is a valid string
      let formattedContent: string;
      if (typeof userContent === 'string') {
        formattedContent = userContent;
      } else if (Array.isArray(userContent)) {
        // For multimodal content, convert to string for now
        formattedContent = JSON.stringify(userContent);
      } else {
        formattedContent = userMessage || 'Hello';
      }
      
      console.log(`[AIAgent] Agent mode - User content type: ${typeof userContent}, formatted: ${typeof formattedContent}`);
      
      const messages: any[] = [
        new SystemMessage(systemPrompt),
        ...historyMessages,
        new HumanMessage(formattedContent)
      ];

      if (onStep) onStep({ type: 'thinking', content: 'Analyzing request...' });

      // 5. Agent Loop
      let finalResponse = '';
      let iterations = 0;
      const MAX_ITERATIONS = 15;

      while (iterations < MAX_ITERATIONS) {
        const response = await model.invoke(messages);
        const content = response.content as string;
        messages.push(response); // Add assistant message

        // Check for JSON tool call
        // 1. Try standard markdown json block
        let jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        
        // 2. Try markdown block without json tag (or any tag)
        if (!jsonMatch) {
            jsonMatch = content.match(/```\w*\s*(\{[\s\S]*"tool"[\s\S]*?\})\s*```/);
        }

        // 3. Try unclosed markdown block (common issue)
        if (!jsonMatch) {
             jsonMatch = content.match(/```\w*\s*(\{[\s\S]*"tool"[\s\S]*\})/);
        }
        
        // 4. Try raw json in text (looking for tool key, loosely)
        if (!jsonMatch) {
            // Relaxed regex: just look for a JSON object containing "tool": "..."
            jsonMatch = content.match(/(\{[\s\S]*"tool"\s*:[\s\S]*\})/);
        }

        if (jsonMatch) {
          try {
            // Clean up JSON string if needed (remove comments, newlines if breaks)
            let jsonStr = jsonMatch[1].trim();
            // Remove any trailing non-json characters that might have been captured loosely
            const lastBrace = jsonStr.lastIndexOf('}');
            if (lastBrace !== -1 && lastBrace < jsonStr.length - 1) {
                jsonStr = jsonStr.substring(0, lastBrace + 1);
            }
            
            const toolCallData = JSON.parse(jsonStr);
            let toolName = toolCallData.tool;
            const toolArgs = toolCallData.args || {};
            
            // Clean up toolName (remove any potential tags like <|begin_of_box|>)
            if (toolName && typeof toolName === 'string') {
                toolName = toolName.replace(/<\|.*?\|>/g, '').trim();
            }

            // Check if toolName is valid
            if (!toolName || toolName === 'null' || toolName === 'undefined' || toolName === 'respond' || toolName === 'answer' || toolName === 'final_answer' || toolName === 'response') {
                console.log(`[AIAgent] Treating non-tool JSON as content: ${toolName}`);
                
                // Try to extract response from args if possible
                if (toolCallData.response || toolCallData.answer || toolCallData.content) {
                    finalResponse = toolCallData.response || toolCallData.answer || toolCallData.content;
                } else if (typeof toolArgs === 'string') {
                    finalResponse = toolArgs;
                } else {
                    finalResponse = content; // Fallback to full content
                }
                
                // Clean up final response if it has tags
                if (typeof finalResponse === 'string') {
                    finalResponse = finalResponse.replace(/<\|.*?\|>/g, '').trim();
                }
                
                break;
            }
            
            // Check if it is a real tool
            const isRealTool = tools.some(t => t.name === toolName) || ['search_pubmed', 'search_web', 'search_pubmed_full', 'search_knowledge_base'].includes(toolName);
            
            if (!isRealTool) {
                 console.warn(`[AIAgent] Unknown tool: ${toolName}, treating as final response`);
                 finalResponse = content;
                 break;
            }

            if (onStep) onStep({ type: 'action', content: `Calling tool: ${toolName}` });

            // Special visualization for Plans
            if (toolName === 'create_plan' && onStep) {
               onStep({ type: 'plan', content: JSON.stringify(toolArgs.steps) });
            }
            if (toolName === 'mark_step_completed' && onStep) {
               onStep({ type: 'plan_update', content: JSON.stringify({index: toolArgs.step_index, status: 'completed'}) });
            }

            // Define output variable first
            let output = "Tool not found";

            // Handle Search Tools specifically
            if (toolName === 'search_pubmed' || toolName === 'search_web') {
                try {
                    output = await this.searchPubMed(toolArgs.query);
                } catch (e) {
                    output = `Search failed: ${e}`;
                }
            } else if (toolName === 'search_pubmed_full') {
                try {
                    if (onStep) onStep({ type: 'action', content: 'Retrieving full PubMed results (this may take a moment)...' });
                    output = await this.searchPubMedFull(toolArgs.query);
                } catch (e) {
                    output = `Full search failed: ${e}`;
                }
            } else if (toolName === 'search_knowledge_base') {
                try {
                    const kbResults = await knowledgeBase.search(toolArgs.query, 5);
                    if (kbResults.length > 0) {
                        output = kbResults
                            .map((result, idx) => {
                                const source = result.metadata?.source || result.source || 'Unknown';
                                return `[Document ${idx + 1}: ${source}]\n${result.text}`;
                            })
                            .join('\n\n---\n\n');
                        if (onStep) onStep({ type: 'observation', content: `Found ${kbResults.length} documents in knowledge base` });
                    } else {
                        output = 'No relevant documents found in knowledge base.';
                    }
                } catch (e) {
                    output = `Knowledge base search failed: ${e}`;
                }
            } else if (toolName === 'run_python') {
                try {
                    if (onStep) onStep({ type: 'action', content: 'Executing Python code...' });
                    output = await pythonService.runCode(toolArgs.code);
                } catch (e) {
                    output = `Python execution failed: ${e}`;
                }
            } else if (toolName === 'generate_image') {
                try {
                    if (onStep) onStep({ type: 'action', content: 'Generating image...' });
                    output = await this.generateImage(toolArgs.prompt);
                } catch (e) {
                    output = `Image generation failed: ${e}`;
                }
            } else {
                // Handle standard tools
                const selectedTool = tools.find(t => t.name === toolName);
                
                if (selectedTool) {
                    try {
                        // Ensure args are correct (zod parse might fail if args are partial)
                        output = await (selectedTool as any).invoke(toolArgs);
                        if (typeof output !== 'string') output = JSON.stringify(output);
                    } catch (e) {
                        output = `Error: ${e}`;
                    }
                }
            }
            
            if (onStep) onStep({ type: 'observation', content: `Tool output received` });
            
            // Add tool output as a User Message (Observation)
            messages.push(new HumanMessage(`Tool '${toolName}' output:\n${output}`));
            
          } catch (e) {
            console.error("Failed to parse tool call JSON", e);
            // If JSON parsing fails, treat it as a normal response (or ask for retry)
            // For now, we assume it might be the final answer if it's malformed JSON
            finalResponse = content;
            break;
          }
        } else {
          // No tool call found, this is the final response
          finalResponse = content;
          break;
        }
        iterations++;
      }

      if (!finalResponse && iterations >= MAX_ITERATIONS) {
        finalResponse = "I'm sorry, I couldn't complete the task within the iteration limit.";
      }
      
      console.log(`[AIAgent] Generated response: ${finalResponse.substring(0, 100)}...`);
      
      // 6. Add assistant response to conversation history
      conversationManager.addMessage('assistant', finalResponse);
      
      // 7. Generate conversation title if this is the first message
      if (isFirstMessage && currentConv) {
        this.generateConversationTitle(currentConv.id, userMessage, finalResponse);
      }
      
      // Trigger background memory update if needed
      if (currentConv) {
        this.backgroundUpdateSummary(currentConv.id).catch(console.error);
      }
      
      return finalResponse;
    } catch (error) {
      console.error('[AIAgent] Error in chat:', error);
      throw error;
    }
  }
  
  // Generate a concise title for the conversation
  private async generateConversationTitle(conversationId: string, userMessage: string, assistantResponse: string): Promise<void> {
    try {
      console.log('[AIAgent] Generating conversation title...');
      
      const model = this.getModel();
      const titlePrompt = `Based on this conversation, generate a short, concise title (3-6 words maximum) that captures the main topic.

User: {userMessage}
Assistant: {assistantResponse}

Generate ONLY the title, nothing else. Make it descriptive and concise.

Title:`;

      const chain = PromptTemplate.fromTemplate(titlePrompt).pipe(model).pipe(new StringOutputParser());
      
      const title = await chain.invoke({
        userMessage: userMessage,
        assistantResponse: assistantResponse
      });
      const cleanTitle = title.trim().replace(/^["']|["']$/g, '').substring(0, 60);
      
      console.log(`[AIAgent] Generated title: "${cleanTitle}"`);
      conversationManager.updateConversationTitle(conversationId, cleanTitle);
    } catch (error) {
      console.error('[AIAgent] Failed to generate title:', error);
      // Fallback to simple title
      const fallbackTitle = userMessage.substring(0, 40) + (userMessage.length > 40 ? '...' : '');
      conversationManager.updateConversationTitle(conversationId, fallbackTitle);
    }
  }

  // Background task to summarize old messages into long-term memory
  private async backgroundUpdateSummary(conversationId: string): Promise<void> {
    try {
      const conversation = conversationManager.getConversation(conversationId);
      if (!conversation || conversation.messages.length < 20) return;

      // Only summarize if we haven't summarized recently (or every 10 messages)
      if (conversation.messages.length % 10 !== 0) return;

      console.log('[AIAgent] Updating conversation memory summary...');
      
      // Summarize the first N messages that are not yet summarized
      // For simplicity, we just summarize the whole history excluding the very recent context
      const messagesToSummarize = conversation.messages.slice(0, -10); // Keep last 10 as active context
      
      if (messagesToSummarize.length === 0) return;

      const historyText = messagesToSummarize
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');

      const prompt = `Summarize the following conversation history into a concise paragraph (Memory).
Focus on key facts, user preferences, and important decisions. Ignore casual chit-chat.

History:
${historyText.substring(0, 5000)}

Summary:`;

      const model = this.getModel();
      const summary = await model.invoke(prompt);
      const summaryText = summary.content as string;

      // Save to metadata
      conversationManager.updateConversationMetadata(conversationId, {
        summary: summaryText
      });
      
      console.log('[AIAgent] Memory summary updated');
    } catch (error) {
      console.error('[AIAgent] Failed to update summary:', error);
    }
  }

  // Gather context from knowledge base and conversation history
  private async gatherContext(query: string, skipKBSearch: boolean = false): Promise<{
    knowledgeBase: string;
    conversationHistory: string;
    combined: string;
  }> {
    console.log(`[AIAgent] Gathering context... (skipKBSearch: ${skipKBSearch})`);
    
    // 1. Search knowledge base (skip if user has attachments)
    let kbContext = '';
    if (!skipKBSearch) {
      try {
        const kbResults = await knowledgeBase.search(query, 5);
        if (kbResults.length > 0) {
          kbContext = kbResults
            .map((result, idx) => {
              const source = result.metadata?.source || result.source || 'Unknown';
              return `[Document ${idx + 1}: ${source}]\n${result.text}`;
            })
            .join('\n\n---\n\n');
          console.log(`[AIAgent] Found ${kbResults.length} relevant documents from KB`);
        }
      } catch (error) {
        console.warn('[AIAgent] KB search error:', error);
      }
    } else {
      console.log('[AIAgent] Skipping KB search (user has attachments)');
    }
    
    // 2. Get recent conversation history
    const recentMessages = conversationManager.getRecentMessages(10);
    const convContext = recentMessages
      .slice(0, -1) // Exclude the current message
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');
    
    console.log(`[AIAgent] Using ${recentMessages.length - 1} recent messages as context`);
    
    // 3. Combine contexts
    let combined = '';
    if (kbContext) {
      combined += `=== Knowledge Base ===\n${kbContext}\n\n`;
    }
    if (convContext) {
      combined += `=== Recent Conversation ===\n${convContext}\n\n`;
    }
    
    return {
      knowledgeBase: kbContext,
      conversationHistory: convContext,
      combined: combined || 'No additional context available.'
    };
  }

  // Build prompt based on available context
  private buildPrompt(userMessage: string, context: any): string {
    const hasKB = context.knowledgeBase.length > 0;
    const hasHistory = context.conversationHistory.length > 0;
    
    if (hasKB && hasHistory) {
      return `You are a helpful personal AI assistant. You have access to the user's knowledge base (documents, notes) and conversation history.

{context}

User's current question: {user_message}

Instructions:
- Use information from the knowledge base when relevant
- Maintain context from previous conversation
- If you need more information, ask the user
- Be concise and helpful
- If generating content (documents, forms, etc.), format it clearly

Your response:`;
    } else if (hasKB) {
      return `You are a helpful personal AI assistant. You have access to the user's knowledge base.

{context}

User's question: {user_message}

Instructions:
- Use information from the knowledge base when available
- If information is missing, ask the user for clarification
- Be concise and helpful

Your response:`;
    } else if (hasHistory) {
      return `You are a helpful personal AI assistant.

{context}

User's current question: {user_message}

Instructions:
- Continue the conversation naturally
- If you need more information, ask the user
- Be concise and helpful

Your response:`;
    } else {
      return `You are a helpful personal AI assistant.

User's question: {user_message}

Instructions:
- Provide helpful responses based on the question
- If you need more information, ask the user
- Be concise and helpful

Your response:`;
    }
  }

  // Process file upload and optionally save to knowledge base
  public async processFileUpload(filePath: string, fileName: string, content: string): Promise<string> {
    console.log(`[AIAgent] Processing file upload: ${fileName}`);
    
    // Ask user if they want to save to knowledge base
    return `I've received the file "${fileName}". Would you like me to:
1. Save it to your knowledge base for future reference
2. Just analyze it for this conversation
3. Generate content based on this file

Please let me know what you'd like to do.`;
  }

  // Save conversation to knowledge base
  public async saveConversationToKB(conversationId?: string): Promise<number> {
    const summary = conversationManager.getConversationSummary(conversationId);
    if (!summary) {
      throw new Error('No conversation to save');
    }

    const conversation = conversationManager.getCurrentConversation();
    const title = conversation?.title || 'Conversation';
    
    return await knowledgeBase.addDocument(summary, {
      source: `Conversation: ${title}`,
      type: 'conversation',
      timestamp: Date.now()
    });
  }
}

export const aiAgent = new AIAgentService();
