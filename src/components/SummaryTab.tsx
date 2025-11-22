import { useState, useEffect } from 'react';
import { Calendar, Search, Trash2, Eye, Loader2, ChevronLeft, ChevronRight, Tag, Paperclip, MessageSquare } from 'lucide-react';

interface ConversationSummary {
  id: string;
  conversationId: string;
  date: string;
  timestamp: number;
  title: string;
  summary: string;
  keyPoints: string[];
  participants: string[];
  attachments: Array<{name: string; type: string}>;
  messageCount: number;
  tags: string[];
}

interface SummaryTabProps {
  currentConversationId: string | null;
  onViewConversation: (conversationId: string) => void;
}

export function SummaryTab({ currentConversationId, onViewConversation }: SummaryTabProps) {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [allSummariesGrouped, setAllSummariesGrouped] = useState<Record<string, ConversationSummary[]>>({});

  // Load all summaries on mount
  useEffect(() => {
    loadAllSummaries();
  }, []);

  const loadAllSummaries = async () => {
    try {
      const grouped = await window.ipcRenderer.invoke('summary-get-all-grouped');
      setAllSummariesGrouped(grouped);
    } catch (error) {
      console.error('Failed to load summaries:', error);
    }
  };

  const loadSummariesForDate = async (date: string) => {
    try {
      const data = await window.ipcRenderer.invoke('summary-get-by-date', date);
      setSummaries(data);
      setSelectedDate(date);
    } catch (error) {
      console.error('Failed to load summaries for date:', error);
    }
  };

  const generateSummary = async () => {
    if (!currentConversationId) {
      alert('Please select a conversation first');
      return;
    }

    setIsGenerating(true);
    try {
      const summary = await window.ipcRenderer.invoke('summary-generate', currentConversationId);
      // alert(`Summary generated!\n\nTitle: ${summary.title}`);
      await loadAllSummaries();
      
      // Auto select today
      const today = new Date().toISOString().split('T')[0];
      await loadSummariesForDate(today);
    } catch (error) {
      console.error('Failed to generate summary:', error);
      alert('Failed to generate summary: ' + (error as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSearch = async () => {
    if (searchQuery.trim()) {
      try {
        const results = await window.ipcRenderer.invoke('summary-search', searchQuery);
        setSummaries(results);
        setSelectedDate(null);
      } catch (error) {
        console.error('Search failed:', error);
      }
    } else {
      setSummaries([]);
      setSelectedDate(null);
    }
  };

  const deleteSummary = async (summaryId: string) => {
    if (confirm('Are you sure you want to delete this summary?')) {
      try {
        await window.ipcRenderer.invoke('summary-delete', summaryId);
        await loadAllSummaries();
        if (selectedDate) {
          await loadSummariesForDate(selectedDate);
        }
      } catch (error) {
        console.error('Failed to delete summary:', error);
      }
    }
  };

  // Get days in current month
  const getDaysInMonth = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: Date[] = [];

    // Add empty days for alignment
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(new Date(0));
    }

    // Add actual days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  const formatDate = (date: Date) => {
    if (date.getTime() === 0) return '';
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
  };

  const hasSummary = (date: Date) => {
    if (date.getTime() === 0) return false;
    const dateStr = formatDate(date);
    return allSummariesGrouped[dateStr] && allSummariesGrouped[dateStr].length > 0;
  };

  const getSummaryCount = (date: Date) => {
    const dateStr = formatDate(date);
    return allSummariesGrouped[dateStr]?.length || 0;
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={{padding: '24px', height: '100%', overflowY: 'auto', background: 'var(--bg-glass)'}}>
      
      {/* Header */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px'}}>
        <div>
          <h2 style={{margin: 0, fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)'}}>Daily Summary</h2>
          <p style={{margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '14px'}}>Track and review your conversations</p>
        </div>
        <button
          onClick={generateSummary}
          disabled={!currentConversationId || isGenerating}
          className="btn-primary"
          style={{padding: '8px 16px'}}
        >
          {isGenerating ? <Loader2 size={16} className="spinning" /> : <Calendar size={16} />}
          <span style={{marginLeft: '8px'}}>{isGenerating ? 'Generating...' : 'Summarize Current'}</span>
        </button>
      </div>

      {/* Search */}
      <div style={{marginBottom: '24px', display: 'flex', gap: '12px'}}>
        <div className="input-wrapper" style={{flex: 1, background: 'var(--bg-surface)'}}>
          <Search size={16} style={{color: 'var(--text-muted)', marginLeft: '12px'}} />
          <input
            type="text"
            placeholder="Search summaries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{border: 'none', background: 'transparent', padding: '10px', width: '100%', outline: 'none', color: 'var(--text-primary)'}}
          />
        </div>
        <button onClick={handleSearch} className="btn-primary">
          Search
        </button>
      </div>

      <div style={{display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '24px', alignItems: 'start'}}>
        {/* Calendar Card */}
        <div style={{
          background: 'var(--bg-surface)', 
          padding: '20px', 
          borderRadius: '16px', 
          border: '1px solid var(--border-primary)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
            <button onClick={prevMonth} className="btn-ghost" style={{padding: '4px'}}>
              <ChevronLeft size={20} />
            </button>
            <h3 style={{margin: 0, fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)'}}>
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h3>
            <button onClick={nextMonth} className="btn-ghost" style={{padding: '4px'}}>
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Week days */}
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px'}}>
            {weekDays.map(day => (
              <div key={day} style={{textAlign: 'center', fontSize: '12px', fontWeight: '500', color: 'var(--text-muted)', padding: '4px'}}>
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px'}}>
            {getDaysInMonth().map((date, index) => {
              const dateStr = formatDate(date);
              const hasData = hasSummary(date);
              const isSelected = dateStr === selectedDate;
              const isEmpty = date.getTime() === 0;

              return (
                <div
                  key={index}
                  onClick={() => !isEmpty && dateStr && loadSummariesForDate(dateStr)}
                  style={{
                    aspectRatio: '1',
                    borderRadius: '8px',
                    cursor: isEmpty ? 'default' : 'pointer',
                    background: isEmpty ? 'transparent' : isSelected ? 'var(--accent)' : hasData ? 'var(--bg-hover)' : 'transparent',
                    color: isSelected ? 'white' : 'var(--text-primary)',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    border: (!isEmpty && !isSelected && !hasData) ? '1px solid transparent' : 'none'
                  }}
                  className={!isEmpty && !isSelected ? "calendar-day-hover" : ""}
                >
                  {!isEmpty && (
                    <>
                      <div style={{fontSize: '14px', fontWeight: isSelected || hasData ? '600' : '400'}}>
                        {date.getDate()}
                      </div>
                      {hasData && (
                        <div style={{
                          width: '4px',
                          height: '4px',
                          borderRadius: '50%',
                          background: isSelected ? 'white' : 'var(--accent)',
                          marginTop: '4px'
                        }} />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Summaries list */}
        <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
          {!selectedDate && !searchQuery && summaries.length === 0 && (
             <div style={{
               padding: '40px', 
               textAlign: 'center', 
               color: 'var(--text-muted)',
               background: 'var(--bg-surface)',
               borderRadius: '16px',
               border: '1px solid var(--border-primary)'
             }}>
               <Calendar size={48} style={{opacity: 0.2, marginBottom: '16px'}} />
               <p>Select a date or search to view summaries</p>
             </div>
          )}

          {summaries.length > 0 && (
            <>
              <h3 style={{margin: '0 0 8px 0', fontSize: '16px', color: 'var(--text-primary)'}}>
                {selectedDate ? `Summaries for ${selectedDate}` : 'Search Results'}
              </h3>
              
              {summaries.map(summary => (
                <div key={summary.id} style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '12px',
                  padding: '20px',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'transform 0.2s ease'
                }}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px'}}>
                    <h4 style={{margin: 0, fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: '1.4'}}>
                      {summary.title}
                    </h4>
                    <span style={{fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-input)', padding: '2px 8px', borderRadius: '12px'}}>
                      {new Date(summary.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>

                  <p style={{color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.6', marginBottom: '16px'}}>
                    {summary.summary}
                  </p>
                  
                  {summary.keyPoints.length > 0 && (
                    <div style={{marginBottom: '16px', background: 'var(--bg-input)', padding: '12px', borderRadius: '8px'}}>
                      <div style={{fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase'}}>Key Points</div>
                      <ul style={{margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-primary)'}}>
                        {summary.keyPoints.map((point, i) => (
                          <li key={i} style={{marginBottom: '4px'}}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div style={{display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px'}}>
                    <div className="badge" style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                      <MessageSquare size={12} /> {summary.messageCount} msgs
                    </div>
                    {summary.attachments.length > 0 && (
                      <div className="badge" style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                        <Paperclip size={12} /> {summary.attachments.length} files
                      </div>
                    )}
                    {summary.tags.map(tag => (
                      <div key={tag} className="badge" style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                        <Tag size={12} /> {tag}
                      </div>
                    ))}
                  </div>

                  <div style={{display: 'flex', gap: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-primary)'}}>
                    <button
                      onClick={() => onViewConversation(summary.conversationId)}
                      className="btn-ghost"
                      style={{fontSize: '13px', padding: '6px 12px', color: 'var(--accent)'}}
                    >
                      <Eye size={14} style={{marginRight: '6px'}} />
                      View Chat
                    </button>
                    <div style={{flex: 1}}></div>
                    <button
                      onClick={() => deleteSummary(summary.id)}
                      className="btn-ghost"
                      style={{fontSize: '13px', padding: '6px 12px', color: 'var(--danger)'}}
                    >
                      <Trash2 size={14} style={{marginRight: '6px'}} />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {summaries.length === 0 && selectedDate && (
            <div style={{
              textAlign: 'center', 
              padding: '40px', 
              color: 'var(--text-muted)',
              background: 'var(--bg-surface)',
              borderRadius: '16px',
              border: '1px solid var(--border-primary)'
            }}>
              No summaries found for this date
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
