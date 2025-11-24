import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css'; // Or any other theme

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
  let mainContent = content.replace(thinkingRegex, '').trim();
  
  // Clean up weird tags
  mainContent = mainContent.replace(/<\|.*?\|>/g, '').trim();
  
  // Try to clean up JSON if it was exposed
  if (mainContent.trim().startsWith('{') && mainContent.includes('"response":')) {
    try {
      const parsed = JSON.parse(mainContent);
      if (parsed.response) {
        mainContent = parsed.response;
      }
    } catch (e) {
      // Ignore parse error, show as is
    }
  }
  
  const [isThinkingOpen, setIsThinkingOpen] = useState(false); // Default to closed for cleaner look

  // Custom Code Block Component with Copy Button
  const CodeBlock = ({ node, inline, className, children, ...props }: any) => {
    const [copied, setCopied] = useState(false);
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';

    const handleCopy = () => {
      navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    if (inline) {
      return <code className={className} {...props}>{children}</code>;
    }

    return (
      <div className="code-block-wrapper" style={{ position: 'relative', margin: '12px 0' }}>
        <div className="code-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          background: '#2d2d2d', // Match code block bg slightly lighter
          borderTopLeftRadius: '6px',
          borderTopRightRadius: '6px',
          borderBottom: '1px solid #404040',
          fontSize: '12px',
          color: '#a0a0a0'
        }}>
          <span>{language || 'text'}</span>
          <button 
            onClick={handleCopy}
            className="btn-ghost"
            style={{ 
              padding: '2px 6px', 
              height: 'auto',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: '#a0a0a0',
              border: '1px solid transparent',
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '400px' }}>
          <code className={className} {...props} style={{
            display: 'block',
            padding: '12px',
            background: '#1e1e1e', // Always dark for code
            color: '#d4d4d4',
            borderBottomLeftRadius: '6px',
            borderBottomRightRadius: '6px',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: '13px',
            lineHeight: '1.5'
          }}>
            {children}
          </code>
        </div>
      </div>
    );
  };

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
                backgroundColor: 'var(--bg-surface-hover)', // Slightly distinct from bg
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
      
      <div className="message-content markdown-body">
        <ReactMarkdown 
          rehypePlugins={[rehypeHighlight]}
          components={{
            code: CodeBlock
          }}
        >
          {mainContent || (thinkingContent ? '' : content)}
        </ReactMarkdown>
      </div>
    </div>
  );
};
