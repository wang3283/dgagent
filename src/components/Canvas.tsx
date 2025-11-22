import React, { useState, useRef, useEffect } from 'react';
import { X, Save, Copy, RefreshCw, PenTool, Check, Undo, Redo } from 'lucide-react';

interface CanvasProps {
  content: string;
  onChange: (content: string) => void;
  onClose: () => void;
  onAskAI: (instruction: string, selection?: string) => void;
  isProcessing?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSnapshot?: (content: string) => void;
}

export function Canvas({ 
  content, 
  onChange, 
  onClose, 
  onAskAI, 
  isProcessing,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSnapshot
}: CanvasProps) {
  const [selection, setSelection] = useState('');
  const [selectionRange, setSelectionRange] = useState<{start: number, end: number} | null>(null);
  const [aiInstruction, setAiInstruction] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle content change with debounce for history snapshot
  const handleChange = (val: string) => {
    onChange(val);
    
    // Clear selection visual when editing
    if (selectionRange) {
      setSelection('');
      setSelectionRange(null);
    }

    // Debounce snapshot
    if (onSnapshot) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        onSnapshot(val);
      }, 1000);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Cmd+Z / Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
      }
      // Redo: Cmd+Shift+Z / Ctrl+Shift+Z or Cmd+Y / Ctrl+Y
      if (((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) || 
          ((e.metaKey || e.ctrlKey) && e.key === 'y')) {
        e.preventDefault();
        onRedo?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUndo, onRedo]);

  const handleSelect = () => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      if (start !== end) {
        const selectedText = content.substring(start, end);
        setSelection(selectedText);
        setSelectionRange({start, end});
      } else {
        setSelection('');
        setSelectionRange(null);
      }
    }
  };

  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleSave = async () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'canvas-draft.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="canvas-container">
      <div className="canvas-header">
        <div className="canvas-title">
          <PenTool size={16} />
          <span>Canvas (Markdown)</span>
        </div>
        <div className="canvas-actions">
          <button 
            className="btn-ghost" 
            onClick={onUndo} 
            disabled={!canUndo} 
            title="Undo (Cmd+Z)"
            style={{opacity: canUndo ? 1 : 0.3}}
          >
            <Undo size={16} />
          </button>
          <button 
            className="btn-ghost" 
            onClick={onRedo} 
            disabled={!canRedo} 
            title="Redo (Cmd+Shift+Z)"
            style={{opacity: canRedo ? 1 : 0.3, marginRight: 8}}
          >
            <Redo size={16} />
          </button>
          
          <div style={{width: 1, height: 16, background: 'var(--border-primary)', margin: '0 4px'}}></div>

          <button className="btn-ghost" onClick={handleSave} title="Save as Markdown">
            <Save size={16} />
          </button>
          <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(content)} title="Copy">
            <Copy size={16} />
          </button>
          <button className="btn-ghost" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="canvas-editor">
        <div ref={backdropRef} className="canvas-highlighter">
          {selectionRange && content ? (
            <>
              {content.substring(0, selectionRange.start)}
              <span className="highlight-bg">{content.substring(selectionRange.start, selectionRange.end)}</span>
              {content.substring(selectionRange.end)}
            </>
          ) : (
            content
          )}
          <br />
        </div>
        <textarea
          ref={textareaRef}
          className="canvas-textarea"
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onSelect={handleSelect}
          onKeyUp={handleSelect}
          onMouseUp={handleSelect}
          onScroll={handleScroll}
          placeholder={`✨ Canvas Editor (Markdown Supported)

Here you can collaborate with AI to write better content.

How to use:
1. Type or paste your draft here
2. Select any text to bring up the AI Edit bar
3. Ask AI to "Translate", "Fix grammar", or "Rewrite"

Images: Use Markdown syntax ![Alt](url)
Formatting: Use **Bold**, *Italic*, # Headers`}
        />
        
        <div className="canvas-ai-input">
          <div className="ai-input-row">
            <input 
              type="text" 
              placeholder={selection ? "Ask AI to edit selection..." : "Ask AI to edit document..."}
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && aiInstruction.trim() && !isProcessing) {
                  onAskAI(aiInstruction, selection);
                  setAiInstruction('');
                }
              }}
              disabled={isProcessing}
            />
            <button 
              className="btn-primary"
              onClick={() => {
                if (aiInstruction.trim() && !isProcessing) {
                  onAskAI(aiInstruction, selection);
                  setAiInstruction('');
                }
              }}
              disabled={isProcessing}
              title={selection ? "Edit Selection" : "Edit Document"}
            >
              {isProcessing ? <RefreshCw size={18} className="spinning" /> : <PenTool size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
