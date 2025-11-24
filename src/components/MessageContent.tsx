import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface MessageContentProps {
  content: string;
}

export const MessageContent: React.FC<MessageContentProps> = ({ content }) => {
  // Extract thinking block
  const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const thinkingContent = thinkingMatch ? thinkingMatch[1].trim() : null;
  
  // Remove thinking block from main content
  const mainContent = content.replace(/<thinking>([\s\S]*?)<\/thinking>/g, '').trim();
  
  const [isThinkingOpen, setIsThinkingOpen] = useState(true);

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
      
      <div className="main-content" style={{ whiteSpace: 'pre-wrap' }}>
        {mainContent || (thinkingContent ? '' : content)}
      </div>
    </div>
  );
};
