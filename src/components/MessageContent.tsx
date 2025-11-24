import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface MessageContentProps {
  content: string;
}

export const MessageContent: React.FC<MessageContentProps> = ({ content }) => {
  // Extract thinking block - support multiple formats
  // Matches: <thinking>...</thinking>, <think>...</think>, <思考>...</思考>
  // Also handles mismatched tags like <思考>...</think>
  const thinkingRegex = /<(thinking|think|思考)>([\s\S]*?)<\/(thinking|think|思考)>/i;
  const thinkingMatch = content.match(thinkingRegex);
  
  const thinkingContent = thinkingMatch ? thinkingMatch[2].trim() : null;
  
  // Remove thinking block from main content
  const mainContent = content.replace(thinkingRegex, '').trim();
  
  const [isThinkingOpen, setIsThinkingOpen] = useState(false); // Default to closed for cleaner look

  return (
    <div className="message-content-wrapper">
      {thinkingContent && (
        <div className="thinking-block" style={{ marginBottom: '12px' }}>
          <div 
            className="thinking-header" 
            onClick={() => setIsThinkingOpen(!isThinkingOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              color: 'var(--text-muted)',
              userSelect: 'none'
            }}
          >
            <Brain size={14} />
            <span style={{ fontWeight: 500 }}>Thought Process</span>
            {isThinkingOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
          
          {isThinkingOpen && (
            <div 
              className="thinking-content"
              style={{
                marginTop: '8px',
                padding: '10px 12px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: '1.5',
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap'
              }}
            >
              {thinkingContent}
            </div>
          )}
        </div>
      )}
      
      <div className="message-content" style={{ whiteSpace: 'pre-wrap' }}>
        {mainContent || (thinkingContent ? '' : content)}
      </div>
    </div>
  );
};
