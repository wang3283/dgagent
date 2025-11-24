import { useState, useEffect, useRef } from 'react'
import { MessageSquare, Database, Settings, Plus, Trash2, User, Bot, Send, Loader2, FolderOpen, Save, Minimize2, X, Paperclip, File, Image as ImageIcon, Video, Mic, Volume2, StopCircle, Calendar, Sun, Moon, PenTool, Undo, Redo, Brain, Wrench, Eye, Check, RefreshCw, Download } from 'lucide-react'
import { SummaryTab } from './components/SummaryTab'
import { Canvas } from './components/Canvas'
import { MessageContent } from './components/MessageContent'

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: Array<{name: string; path: string; type: string}>;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

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

function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge' | 'settings' | 'summary'>('chat')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  
  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  
  // Config
  const [config, setConfig] = useState({
    baseUrl: '',
    apiKey: '',
    chatModel: '',
    embeddingModel: '',
    agentName: 'AI Assistant',
    enableVoiceInput: false,  // 语音输入（默认关闭）
    enableVoiceReply: false,  // 语音回复（默认关闭）
    voiceType: 'alloy',       // 语音音色（API）
    useBrowserSpeech: true,   // 使用浏览器免费语音识别
    useBrowserTTS: true       // 使用浏览器免费文字转语音
  })
  const [isConfigLoaded, setIsConfigLoaded] = useState(false)

  // Chat
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [processingStatus, setProcessingStatus] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<Array<{name: string; path: string; type: string; preview?: string}>>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [currentAudioPath, setCurrentAudioPath] = useState<string | null>(null)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  
  // Knowledge base state
  const [kbStats, setKbStats] = useState<{ count: number; mode: string; storagePath?: string } | null>(null)
  const [parsedFile, setParsedFile] = useState<{ name: string; path: string; content: string; type: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [kbPath, setKbPath] = useState<string>('')
  const [documentsPath, setDocumentsPath] = useState<string>('')
  const [kbDocuments, setKbDocuments] = useState<Array<{ text: string; metadata: any }>>([])
  const [showDocuments, setShowDocuments] = useState(false)
  const [watchedPaths, setWatchedPaths] = useState<string[]>([])
  const [mlkbStats, setMlkbStats] = useState<any>(null)
  const [selectedLayer, setSelectedLayer] = useState<'core' | 'conversation' | 'generated'>('core')
  
  // Summary state
  const [summaries, setSummaries] = useState<ConversationSummary[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [summarySearch, setSummarySearch] = useState('')
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)

  // Token estimation logic (placed here to access state)
  const estimateTokens = (text: string) => Math.ceil((text || '').length / 2.5)
  const getModelLimit = (model: string) => {
    if (model.includes('Flash') || model.includes('128k')) return 128000
    if (model.includes('gpt-4')) return 128000
    if (model.includes('gpt-3.5')) return 16000
    return 32000
  }
  
  const contextLimit = getModelLimit(config.chatModel)
  const historyTokens = (currentConversation?.messages || []).reduce((acc, msg) => acc + estimateTokens(msg.content), 0)
  const inputTokens = estimateTokens(inputMessage)
  const totalTokens = historyTokens + inputTokens
  const usagePercent = Math.min(100, Math.round((totalTokens / contextLimit) * 100))

  // Load initial data
  useEffect(() => {
    loadInitialData().finally(() => setIsConfigLoaded(true))
  }, [])

  // Sync config
  useEffect(() => {
    if (isConfigLoaded) {
      window.ipcRenderer.invoke('kb-update-config', config).catch(console.error)
    }
  }, [config, isConfigLoaded])

  // Auto-scroll to bottom
  const prevConvIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (currentConversation) {
      // If conversation switched, scroll instantly
      if (prevConvIdRef.current !== currentConversation.id) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
        prevConvIdRef.current = currentConversation.id
      } else {
        // If same conversation (new message), scroll smoothly
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [currentConversation?.id, currentConversation?.messages.length])

  const loadInitialData = async () => {
    try {
      const [loadedConfig, stats, convs, current, mlStats, watched] = await Promise.all([
        window.ipcRenderer.invoke('config-get'),
        window.ipcRenderer.invoke('kb-get-stats'),
        window.ipcRenderer.invoke('conversation-get-all'),
        window.ipcRenderer.invoke('conversation-get-current'),
        window.ipcRenderer.invoke('mlkb-get-stats'),
        window.ipcRenderer.invoke('watcher-get-paths')
      ])
      
      if (loadedConfig) {
        setConfig(prev => ({ ...prev, ...loadedConfig }))
      }

      // Clean up ALL empty conversations (we have "New Conversation" button, no need to keep empty ones)
      const emptyConvs = convs.filter((c: Conversation) => c.messages.length === 0)
      
      let finalConvs = convs
      
      if (emptyConvs.length > 0) {
        console.log(`[App] Deleting ${emptyConvs.length} empty conversations`)
        for (const emptyConv of emptyConvs) {
          await window.ipcRenderer.invoke('conversation-delete', emptyConv.id)
        }
        finalConvs = await window.ipcRenderer.invoke('conversation-get-all')
      }
      
      setConversations(finalConvs)
      setKbStats(stats)
      setMlkbStats(mlStats)
      setWatchedPaths(watched)
      
      // Handle current conversation
      if (finalConvs.length === 0) {
        // No conversations at all, create a new one
        console.log('[App] No conversations found, creating first one')
        await window.ipcRenderer.invoke('conversation-new')
        const newConv = await window.ipcRenderer.invoke('conversation-get-current')
        setCurrentConversation(newConv)
        
        // Reload conversation list
        const updatedConvs = await window.ipcRenderer.invoke('conversation-get-all')
        setConversations(updatedConvs)
      } else if (!current || !finalConvs.find((c: Conversation) => c.id === current.id)) {
        // Current conversation was deleted or doesn't exist, switch to first one
        console.log('[App] Switching to first conversation')
        await window.ipcRenderer.invoke('conversation-switch', finalConvs[0].id)
        const switched = await window.ipcRenderer.invoke('conversation-get-current')
        setCurrentConversation(switched)
      } else {
        // Current conversation is valid
        setCurrentConversation(current)
      }
    } catch (error) {
      console.error('Failed to load initial data:', error)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const newFiles: Array<{name: string; path: string; type: string; preview?: string}> = []
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as any // Electron File has path property
      let preview: string | undefined = undefined;

      // Generate preview for images
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(files[i]);
      }

      if (file.path) {
        newFiles.push({
          name: file.name,
          path: file.path,
          type: file.type || 'unknown',
          preview
        })
      }
    }
    
    setAttachedFiles(prev => [...prev, ...newFiles])
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemoveFile = (index: number) => {
    setAttachedFiles(attachedFiles.filter((_, i) => i !== index))
  }

  const handleSaveFilesToKB = async () => {
    if (attachedFiles.length === 0) return

    try {
      for (const file of attachedFiles) {
        const parsed = await window.ipcRenderer.invoke('parse-file', file.path)
        await window.ipcRenderer.invoke('kb-add-document', {
          text: parsed.content,
          metadata: {
            source: file.name,
            type: parsed.type,
            path: file.path,
            savedFromChat: true
          }
        })
      }
      
      alert(`${attachedFiles.length} file(s) saved to knowledge base!`)
      setAttachedFiles([])
      
      // Refresh KB stats
      const newStats = await window.ipcRenderer.invoke('mlkb-get-stats')
      setMlkbStats(newStats)
    } catch (error) {
      console.error('Failed to save files to KB:', error)
      alert('Failed to save files to knowledge base')
    }
  }

  // Voice input functions
  const startRecording = async () => {
    // Use browser's free speech recognition if enabled
    if (config.useBrowserSpeech) {
      startBrowserSpeechRecognition()
      return
    }

    // Otherwise use paid API method
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await handleVoiceInput(audioBlob)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (error) {
      console.error('Failed to start recording:', error)
      alert('无法访问麦克风，请检查权限设置')
    }
  }

  // Browser's free speech recognition (Web Speech API)
  const startBrowserSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    
    if (!SpeechRecognition) {
      alert('您的浏览器不支持语音识别\n\n建议使用 Chrome 或 Edge 浏览器')
      return
    }

    console.log('[Voice] Starting browser speech recognition...')
    
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'  // Chinese
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      console.log('[Voice] Recognition started')
      setIsRecording(true)
      setProcessingStatus('正在听取语音...')
    }
    
    recognition.onaudiostart = () => {
      console.log('[Voice] Audio capturing started')
    }
    
    recognition.onsoundstart = () => {
      console.log('[Voice] Sound detected')
    }
    
    recognition.onspeechstart = () => {
      console.log('[Voice] Speech detected')
    }
    
    recognition.onspeechend = () => {
      console.log('[Voice] Speech ended')
    }

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setInputMessage(inputMessage + transcript)
      setProcessingStatus('')
      alert(`语音识别完成（免费）！\n\n识别结果：\n${transcript}`)
    }

    recognition.onerror = (event: any) => {
      console.error('[Voice] Speech recognition error:', event.error, event)
      setProcessingStatus('')
      setIsRecording(false)
      
      let errorMsg = '语音识别失败'
      let debugInfo = `\n\n调试信息：\n错误类型: ${event.error}\n浏览器: ${navigator.userAgent.includes('Chrome') ? 'Chrome' : navigator.userAgent.includes('Edge') ? 'Edge' : 'Other'}`
      
      switch(event.error) {
        case 'network':
          errorMsg = '网络错误\n\n可能原因：\n1. 浏览器无法连接到语音识别服务器\n2. 防火墙或代理阻止了连接\n3. DNS 解析问题\n\n建议：\n• 检查控制台 (F12) 查看详细错误\n• 尝试在 Settings 中使用付费 Whisper API\n• 或者检查网络代理设置' + debugInfo
          break
        case 'not-allowed':
          errorMsg = '麦克风权限被拒绝\n\n请在浏览器地址栏左侧点击锁图标\n允许麦克风访问' + debugInfo
          break
        case 'no-speech':
          errorMsg = '没有检测到语音\n\n请确保：\n• 麦克风正常工作\n• 说话声音足够大\n• 麦克风未被静音' + debugInfo
          break
        case 'aborted':
          errorMsg = '语音识别被中断' + debugInfo
          break
        case 'audio-capture':
          errorMsg = '无法捕获音频\n\n请检查：\n• 麦克风是否被其他应用占用\n• 麦克风驱动是否正常' + debugInfo
          break
        case 'service-not-allowed':
          errorMsg = '语音识别服务不可用\n\n可能是浏览器限制或网络问题' + debugInfo
          break
        default:
          errorMsg = `未知错误：${event.error}` + debugInfo
      }
      
      alert(errorMsg)
    }

    recognition.onend = () => {
      setIsRecording(false)
      setProcessingStatus('')
    }

    try {
      recognition.start()
    } catch (error) {
      console.error('Failed to start recognition:', error)
      setIsRecording(false)
      setProcessingStatus('')
      alert('无法启动语音识别\n\n请检查麦克风权限')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  // Play AI response as speech
  const playAIResponse = async (text: string) => {
    try {
      // Use browser's free TTS if enabled
      if (config.useBrowserTTS) {
        playBrowserTTS(text)
        return
      }

      // Otherwise use paid API (now replaced by Edge TTS in backend)
      setIsPlayingAudio(true)
      // Pass voice type from config
      const voice = config.voiceType || 'zh-CN-XiaoxiaoNeural';
      const audioPath = await window.ipcRenderer.invoke('text-to-speech', text, voice)
      
      const audio = new Audio(`file://${audioPath}`)
      audioRef.current = audio
      
      audio.onended = () => {
        setIsPlayingAudio(false)
      }
      
      audio.play()
    } catch (error) {
      console.error('Failed to play AI voice:', error)
      setIsPlayingAudio(false)
    }
  }

  // Browser's free text-to-speech (Web Speech API)
  const playBrowserTTS = (text: string) => {
    if (!('speechSynthesis' in window)) {
      alert('您的浏览器不支持语音合成')
      return
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'  // Chinese
    utterance.rate = 1.0      // Speed
    utterance.pitch = 1.0     // Pitch
    utterance.volume = 1.0    // Volume

    utterance.onstart = () => {
      setIsPlayingAudio(true)
    }

    utterance.onend = () => {
      setIsPlayingAudio(false)
    }

    utterance.onerror = (event) => {
      console.error('TTS error:', event)
      setIsPlayingAudio(false)
    }

    window.speechSynthesis.speak(utterance)
  }

  const stopAIVoice = () => {
    if (config.useBrowserTTS) {
      window.speechSynthesis.cancel()
    } else if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setIsPlayingAudio(false)
  }

  const handleVoiceInput = async (audioBlob: Blob) => {
    try {
      setProcessingStatus('正在识别语音...')
      
      // Get temp directory
      const tempDir = await window.ipcRenderer.invoke('get-temp-dir')
      const audioPath = `${tempDir}/voice_${Date.now()}.webm`
      
      // Convert blob to array buffer
      const arrayBuffer = await audioBlob.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      
      // Save audio file
      await window.ipcRenderer.invoke('save-audio-file', audioPath, Array.from(uint8Array))
      
      // Convert to text
      const text = await window.ipcRenderer.invoke('voice-to-text', audioPath)
      
      // Set as input message
      setInputMessage(text)
      setProcessingStatus('')
      
      alert(`语音识别完成！\n\n识别结果：\n${text}\n\n请点击发送按钮发送消息`)
    } catch (error) {
      console.error('Voice input failed:', error)
      alert(`语音识别失败：${(error as Error).message}`)
      setProcessingStatus('')
    }
  }

  // Canvas state
  const [showCanvas, setShowCanvas] = useState(false)
  const [canvasContent, setCanvasContent] = useState('')
  const [isCanvasProcessing, setIsCanvasProcessing] = useState(false)
  const [agentSteps, setAgentSteps] = useState<Array<{type: string, content: string}>>([])
  const [agentPlan, setAgentPlan] = useState<Array<{title: string, status: 'pending' | 'completed'}>>([])
  const [isAgentMode, setIsAgentMode] = useState(true)

  // Listen for agent steps
  useEffect(() => {
    const stepHandler = (_: any, step: any) => {
      if (step.type === 'plan') {
        try {
          const steps = JSON.parse(step.content)
          setAgentPlan(steps.map((s: string) => ({title: s, status: 'pending'})))
        } catch (e) { console.error('Failed to parse plan', e) }
      } else if (step.type === 'plan_update') {
        try {
          const { index, status } = JSON.parse(step.content)
          setAgentPlan(prev => prev.map((item, i) => i === index ? {...item, status} : item))
        } catch (e) { console.error('Failed to parse plan update', e) }
      } else {
        setAgentSteps(prev => [...prev, step])
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    const cleanup = window.ipcRenderer.on('agent-step', stepHandler)
    
    return () => {
      if (typeof cleanup === 'function') {
        cleanup()
      }
    }
  }, [])
  
  // Canvas History
  const [canvasHistory, setCanvasHistory] = useState<string[]>([''])
  const [historyIndex, setHistoryIndex] = useState(0)

  const pushHistory = (content: string) => {
    if (content === canvasHistory[historyIndex]) return
    setCanvasHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(content)
      return newHistory
    })
    setHistoryIndex(prev => prev + 1)
  }

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      setHistoryIndex(newIndex)
      setCanvasContent(canvasHistory[newIndex])
    }
  }

  const handleRedo = () => {
    if (historyIndex < canvasHistory.length - 1) {
      const newIndex = historyIndex + 1
      setHistoryIndex(newIndex)
      setCanvasContent(canvasHistory[newIndex])
    }
  }

  // Handle AI edit in canvas
  const handleCanvasAI = async (instruction: string, selection?: string) => {
    setIsCanvasProcessing(true)
    try {
      let prompt = ''
      if (selection) {
        prompt = `Please edit the following text based on this instruction: "${instruction}"\n\nText to edit:\n${selection}\n\nReturn ONLY the edited text without any explanation or quotes.`
      } else {
        prompt = `Please edit the following document based on this instruction: "${instruction}"\n\nDocument:\n${canvasContent}\n\nReturn ONLY the edited document without any explanation or quotes.`
      }

      const response = await window.ipcRenderer.invoke('ai-edit-text', prompt)
      
      if (selection) {
        const newContent = canvasContent.replace(selection, response)
        setCanvasContent(newContent)
        pushHistory(newContent)
      } else {
        setCanvasContent(response)
        pushHistory(response)
      }
    } catch (error) {
      console.error('Canvas AI error:', error)
    } finally {
      setIsCanvasProcessing(false)
    }
  }

  // Stop generation function
  const handleStopGeneration = () => {
    setIsSending(false)
    setProcessingStatus('')
    setAgentSteps([])
    setAgentPlan([])
    // Note: This doesn't actually abort the backend request, but allows user to continue
    // The backend response will be ignored when it arrives
  }

  // Existing functions...
  const handleSendMessage = async () => {
    if ((!inputMessage.trim() && attachedFiles.length === 0) || isSending) return

    const userDisplayMsg = inputMessage
    let aiMsg = inputMessage
    const filesToProcess = [...attachedFiles]
    
    setInputMessage('')
    setAttachedFiles([])
    setIsSending(true)
    setAgentSteps([])
    setAgentPlan([])
    
    setProcessingStatus('Preparing message...')

    // Optimistic UI update: Show user message immediately
    const optimisticUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userDisplayMsg,
      timestamp: Date.now(),
      attachments: filesToProcess.length > 0 ? filesToProcess : undefined
    };

    setCurrentConversation(prev => {
      if (!prev) return null;
      return {
        ...prev,
        messages: [...prev.messages, optimisticUserMsg]
      };
    });

    // Scroll to bottom immediately
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      // Parse and extract content from attached files (for AI)
      if (filesToProcess.length > 0) {
        aiMsg += '\n\nAttached files content:\n'
        
        for (let i = 0; i < filesToProcess.length; i++) {
          const file = filesToProcess[i]
          
          // SKIP parsing for Images. Let the multimodal model see the image directly.
          if (file.type.startsWith('image/')) {
            continue;
          }

          try {
            setProcessingStatus(`Processing file ${i + 1}/${filesToProcess.length}: ${file.name}...`)
            console.log(`[App] Parsing file: ${file.name}`)
            
            const parsed = await window.ipcRenderer.invoke('parse-file', file.path)
            
            aiMsg += `\n--- File: ${file.name} (${parsed.type}) ---\n`
            aiMsg += parsed.content.substring(0, 5000) // Limit to 5000 chars per file
            if (parsed.content.length > 5000) {
              aiMsg += '\n[Content truncated...]'
            }
            aiMsg += '\n--- End of file ---\n'
          } catch (error) {
            console.error(`Failed to parse ${file.name}:`, error)
            aiMsg += `\n[Failed to parse ${file.name}: ${(error as Error).message}]\n`
          }
        }
      }
      
      // Send message with file contents to AI
      setProcessingStatus('Sending to AI...')
      await window.ipcRenderer.invoke('chat-send', aiMsg, {
        displayMessage: userDisplayMsg,
        attachments: filesToProcess,
        mode: isAgentMode ? 'agent' : 'chat'
      })
      
      // Reload current conversation to get updated messages
      const updated = await window.ipcRenderer.invoke('conversation-get-current')
      setCurrentConversation(updated)
      
      // Auto-play AI voice reply if enabled
      if (config.enableVoiceReply && updated.messages.length > 0) {
        const lastMessage = updated.messages[updated.messages.length - 1]
        if (lastMessage.role === 'assistant') {
          await playAIResponse(lastMessage.content)
        }
      }
      
      // Also reload conversation list to get updated title
      const allConvs = await window.ipcRenderer.invoke('conversation-get-all')
      setConversations(allConvs)
      
      // Ask if user wants to save files to KB
      if (filesToProcess.length > 0) {
        const shouldSave = confirm(`Do you want to save ${filesToProcess.length} file(s) to knowledge base?`)
        if (shouldSave) {
          for (const file of filesToProcess) {
            try {
              const parsed = await window.ipcRenderer.invoke('parse-file', file.path)
              await window.ipcRenderer.invoke('kb-add-document', {
                text: parsed.content,
                metadata: {
                  source: file.name,
                  type: parsed.type,
                  path: file.path,
                  savedFromChat: true
                }
              })
            } catch (error) {
              console.error(`Failed to save ${file.name} to KB:`, error)
            }
          }
          alert('Files saved to knowledge base!')
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      alert('Failed to send message. Check console.')
    } finally {
      setIsSending(false)
      setProcessingStatus('')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const toggleVoiceInput = () => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  const handleNewConversation = async () => {
    try {
      // Before creating new, check if current conversation is empty and delete it
      if (currentConversation && currentConversation.messages.length === 0) {
        console.log('[App] Deleting empty conversation before creating new one')
        await window.ipcRenderer.invoke('conversation-delete', currentConversation.id)
      }
      
      await window.ipcRenderer.invoke('conversation-new')
      const newConv = await window.ipcRenderer.invoke('conversation-get-current')
      setCurrentConversation(newConv)
      
      const allConvs = await window.ipcRenderer.invoke('conversation-get-all')
      setConversations(allConvs)
    } catch (error) {
      console.error('Failed to create conversation:', error)
    }
  }

  const handleSwitchConversation = async (id: string) => {
    try {
      await window.ipcRenderer.invoke('conversation-switch', id)
      const conv = await window.ipcRenderer.invoke('conversation-get-current')
      setCurrentConversation(conv)
    } catch (error) {
      console.error('Failed to switch conversation:', error)
    }
  }

  const handleDeleteConversation = async (id: string) => {
    try {
      // Find the conversation to delete
      const convToDelete = conversations.find(c => c.id === id)
      if (!convToDelete) return
      
      // Check if conversation has content
      const hasContent = convToDelete.messages.length > 0
      
      if (hasContent) {
        // Ask if user wants to save to knowledge base before deleting
        const saveToKB = confirm(
          `此对话包含 ${convToDelete.messages.length} 条消息。\n\n是否保存到知识库后再删除？\n\n点击"确定"保存到知识库\n点击"取消"直接删除`
        )
        
        if (saveToKB) {
          // Generate summary and save to KB
          try {
            const summary = await window.ipcRenderer.invoke('summary-generate', id)
            
            // Save summary to knowledge base
            const summaryText = `${summary.title}\n\n${summary.summary}\n\n关键要点：\n${summary.keyPoints.join('\n')}`
            
            await window.ipcRenderer.invoke('kb-add-document', {
              text: summaryText,
              metadata: {
                type: 'conversation_summary',
                conversationId: id,
                date: summary.date,
                messageCount: summary.messageCount,
                tags: summary.tags
              }
            })
            
            alert('对话已保存到知识库')
          } catch (error) {
            console.error('Failed to save to KB:', error)
            alert('保存到知识库失败，但仍会删除对话')
          }
        }
      }
      
      // Delete the conversation
      await window.ipcRenderer.invoke('conversation-delete', id)
      const allConvs = await window.ipcRenderer.invoke('conversation-get-all')
      setConversations(allConvs)
      
      if (currentConversation?.id === id) {
        if (allConvs.length > 0) {
          // Switch to first conversation
          await window.ipcRenderer.invoke('conversation-switch', allConvs[0].id)
          const switched = await window.ipcRenderer.invoke('conversation-get-current')
          setCurrentConversation(switched)
        } else {
          // No conversations left, create a new one
          setCurrentConversation(null)
          handleNewConversation()
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      alert('删除对话失败')
    }
  }

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const file = files[0] as any // Electron File has path property
    try {
      const result = await window.ipcRenderer.invoke('parse-file', file.path)
      setParsedFile(result)
      console.log('Parsed file:', result)
    } catch (error) {
      console.error('Failed to parse file:', error)
      alert('Failed to parse file')
    }
  }

  const handleSelectKbPath = async () => {
    const result = await window.ipcRenderer.invoke('select-directory')
    if (result) {
      setKbPath(result)
      // Optionally update KB config here if needed
    }
  }

  const handleSelectDocumentsPath = async () => {
    const result = await window.ipcRenderer.invoke('select-directory')
    if (result) {
      setDocumentsPath(result)
      try {
        await window.ipcRenderer.invoke('watcher-add-path', result)
        const updated = await window.ipcRenderer.invoke('watcher-get-paths')
        setWatchedPaths(updated)
      } catch (error) {
        console.error('Failed to add watcher path:', error)
      }
    }
  }

  const handleSaveToKB = async () => {
    if (!parsedFile) return

    setIsSaving(true)
    try {
      // Ensure config is synced before saving (needed for embedding if configured)
      console.log('[App] Syncing config before save:', config)
      await window.ipcRenderer.invoke('kb-update-config', config)
      
      const count = await window.ipcRenderer.invoke('kb-add-document', {
        text: parsedFile.content,
        metadata: {
          source: parsedFile.name,
          type: parsedFile.type,
          path: parsedFile.path
        }
      })
      
      // Refresh stats and documents
      const newStats = await window.ipcRenderer.invoke('kb-get-stats')
      setKbStats(newStats)
      
      if (showDocuments) {
        const docs = await window.ipcRenderer.invoke('kb-get-documents')
        setKbDocuments(docs)
      }
      
      alert(`Successfully added ${count} chunks to Knowledge Base!`)
      setParsedFile(null)
    } catch (error) {
      console.error('Failed to save:', error)
      alert('Failed to save to Knowledge Base')
    } finally {
      setIsSaving(false)
    }
  }
  
  const loadKBDocuments = async () => {
    try {
      const docs = await window.ipcRenderer.invoke('kb-get-documents')
      setKbDocuments(docs)
      setShowDocuments(true)
    } catch (error) {
      console.error('Failed to load documents:', error)
    }
  }
  
  const loadMLKBDocuments = async (layer: 'core' | 'conversation' | 'generated') => {
    try {
      const docs = await window.ipcRenderer.invoke('mlkb-get-documents', layer)
      return docs
    } catch (error) {
      console.error('Failed to load multi-layer KB documents:', error)
      return []
    }
  }
  
  const handleDeleteMLKBDocument = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return
    
    try {
      await window.ipcRenderer.invoke('mlkb-delete-document', id)
      
      // Refresh stats
      const newStats = await window.ipcRenderer.invoke('mlkb-get-stats')
      setMlkbStats(newStats)
      
      alert('Document deleted successfully!')
    } catch (error) {
      console.error('Failed to delete document:', error)
      alert('Failed to delete document')
    }
  }
  
  const handleDeleteDocument = async (index: number) => {
    if (!confirm('Are you sure you want to delete this document?')) return
    
    try {
      await window.ipcRenderer.invoke('kb-delete-document', index)
      
      // Refresh stats and documents
      const newStats = await window.ipcRenderer.invoke('kb-get-stats')
      setKbStats(newStats)
      
      const docs = await window.ipcRenderer.invoke('kb-get-documents')
      setKbDocuments(docs)
      
      alert('Document deleted successfully!')
    } catch (error) {
      console.error('Failed to delete document:', error)
      alert('Failed to delete document')
    }
  }
  
  const [isReindexing, setIsReindexing] = useState(false)

  const handleReindex = async () => {
    if (!window.confirm('Are you sure you want to reindex all documents? This might take a while and consume OpenAI tokens.')) return
    
    setIsReindexing(true)
    setProcessingStatus('Reindexing knowledge base...')
    
    try {
      const result = await window.ipcRenderer.invoke('kb-reindex')
      if (result.success) {
        alert(`Reindex successful! Processed ${result.count} documents.`)
      } else {
        alert(`Reindex failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Reindex failed:', error)
      alert('Failed to reindex knowledge base.')
    } finally {
      setIsReindexing(false)
      setProcessingStatus('')
      // Refresh stats
      const stats = await window.ipcRenderer.invoke('kb-get-stats')
      setKbStats(stats)
    }
  }

  // Export PubMed table functions
  const exportTableAsCSV = (content: string) => {
    // Extract table from markdown
    const tableMatch = content.match(/\|.*\|[\s\S]*?\n(?=\n|$)/g)
    if (!tableMatch) return
    
    const lines = tableMatch[0].trim().split('\n')
    const csvLines: string[] = []
    
    lines.forEach((line, idx) => {
      if (idx === 1) return // Skip separator line
      const cells = line.split('|').map(c => c.trim()).filter(c => c)
      csvLines.push(cells.map(c => `"${c.replace(/"/g, '""')}"`).join(','))
    })
    
    const csv = csvLines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `pubmed_results_${Date.now()}.csv`
    link.click()
  }
  
  const exportTableAsMarkdown = (content: string) => {
    const tableMatch = content.match(/\|.*\|[\s\S]*?\n(?=\n|$)/g)
    if (!tableMatch) return
    
    const blob = new Blob([tableMatch[0]], { type: 'text/markdown;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `pubmed_results_${Date.now()}.md`
    link.click()
  }
  
  const hasPubMedTable = (content: string) => {
    return content.includes('PubMed Search Results') && content.includes('| # | Title | Source | Year | PMID |')
  }

  const handleClearAllDocuments = async () => {
    if (!confirm('Are you sure you want to clear ALL documents? This cannot be undone!')) return
    
    try {
      await window.ipcRenderer.invoke('kb-clear-all')
      
      // Refresh stats and documents
      const newStats = await window.ipcRenderer.invoke('kb-get-stats')
      setKbStats(newStats)
      setKbDocuments([])
      
      alert('All documents cleared!')
    } catch (error) {
      console.error('Failed to clear documents:', error)
      alert('Failed to clear documents')
    }
  }

  return (
    <div className="app-container">
      {/* Custom Title Bar with macOS style buttons */}
      <div className="title-bar">
        <div className="title-bar-buttons">
          <div className="title-bar-button close" onClick={() => window.close()}></div>
          <div className="title-bar-button minimize" onClick={() => window.ipcRenderer.invoke('minimize-window')}></div>
          <div className="title-bar-button maximize" onClick={() => window.ipcRenderer.invoke('maximize-window')}></div>
        </div>
        <div className="title-bar-drag-region">{config.agentName || 'Personal AI Agent'}</div>
        <div className="title-bar-spacer"></div>
      </div>

      {/* Main Wrapper */}
      <div className="main-wrapper" style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
        {/* Sidebar */}
        <div className="sidebar" style={{width: '260px', display: 'flex', flexDirection: 'column', padding: '16px'}}>

        {/* Tab Navigation */}
        <div className="tab-nav">
          <button 
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`} 
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={16} /> Chat
          </button>
          <button 
            className={`tab-btn ${activeTab === 'knowledge' ? 'active' : ''}`} 
            onClick={() => setActiveTab('knowledge')}
          >
            <Database size={16} /> KB
          </button>
          <button 
            className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`} 
            onClick={() => setActiveTab('summary')}
          >
            <Calendar size={16} /> Summary
          </button>
          <button 
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} 
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} /> Settings
          </button>
        </div>

        {/* Conversation List (only in chat tab) */}
        {activeTab === 'chat' && (
          <div className="conversation-list" style={{flex: 1, overflowY: 'auto', marginTop: '10px'}}>
            <button className="btn-primary" style={{width: '100%', marginBottom: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'}} onClick={handleNewConversation}>
              <Plus size={16} /> New Chat
            </button>
            <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
              {conversations.map(conv => (
                <div 
                  key={conv.id}
                  className={`sidebar-item ${currentConversation?.id === conv.id ? 'active' : ''}`}
                  onClick={() => handleSwitchConversation(conv.id)}
                >
                  <div className="conversation-title" style={{flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                    {conv.title}
                  </div>
                  <button 
                    className="btn-ghost"
                    style={{padding: '4px', opacity: 0.6}}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteConversation(conv.id)
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Spacer */}
        <div style={{flex: 1}} />

        {/* KB Stats & Theme Toggle */}
        <div style={{marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-color)'}}>
          {kbStats && (
            <div style={{fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px'}}>
                <Database size={12} />
                <span>{kbStats.count} docs</span>
              </div>
              <div>{kbStats.mode === 'vector' ? 'Vector Search' : 'Keyword Search'}</div>
            </div>
          )}
          
          <button 
            className="btn-ghost" 
            style={{width: '100%', justifyContent: 'center', gap: '8px', display: 'flex', alignItems: 'center'}}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </div>
      </div>
      {/* Main Content */}
      <div className="main-content">
        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div style={{display: 'flex', flex: 1, overflow: 'hidden', height: '100%'}}>
            <div style={{flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0}}>
              <div className="chat-messages" style={{flex: 1, overflowY: 'auto', padding: '20px'}}>
                {currentConversation?.messages.map(msg => (
                  <div key={msg.id} className={`message ${msg.role}`}>
                    <div className="message-role">
                      {msg.role === 'user' ? <><User size={14} /> You</> : <><Bot size={14} /> {config.agentName}</>}
                    </div>
                    <MessageContent content={msg.content} />
                    {/* Export buttons for PubMed tables */}
                    {msg.role === 'assistant' && hasPubMedTable(msg.content) && (
                      <div style={{
                        marginTop: '12px',
                        display: 'flex',
                        gap: '8px',
                        paddingTop: '12px',
                        borderTop: '1px solid var(--border-primary)'
                      }}>
                        <button
                          onClick={() => exportTableAsCSV(msg.content)}
                          className="btn-ghost"
                          style={{fontSize: '12px', padding: '6px 12px'}}
                        >
                          <Download size={14} style={{marginRight: 6}} />
                          Export as CSV
                        </button>
                        <button
                          onClick={() => exportTableAsMarkdown(msg.content)}
                          className="btn-ghost"
                          style={{fontSize: '12px', padding: '6px 12px'}}
                        >
                          <Download size={14} style={{marginRight: 6}} />
                          Export as Markdown
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                
                {/* Agent Process Visualization */}
                {isSending && (agentPlan.length > 0 || agentSteps.length > 0) && (
                  <div className="message assistant agent-process">
                    <div className="message-role"><Bot size={14} /> AI Assistant</div>
                    
                    {/* Plan Section */}
                    {agentPlan.length > 0 && (
                      <div className="agent-plan">
                        <div className="plan-header">Execution Plan</div>
                        {agentPlan.map((item, i) => (
                          <div key={i} className={`plan-item ${item.status}`}>
                            <div className={`plan-checkbox ${item.status === 'completed' ? 'checked' : ''}`}>
                              {item.status === 'completed' && <Check size={10} strokeWidth={3} />}
                            </div>
                            <span>{item.title}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Steps Section */}
                    {agentSteps.length > 0 && (
                      <div className="agent-steps-container">
                        {agentSteps.map((step, i) => (
                          <div key={i} className={`agent-step ${step.type}`}>
                            <div className="step-icon">
                              {step.type === 'thinking' && <Brain size={12} />}
                              {step.type === 'action' && <Wrench size={12} />}
                              {step.type === 'observation' && <Eye size={12} />}
                            </div>
                            <div className="step-content">{step.content}</div>
                          </div>
                        ))}
                        <div className="agent-step thinking">
                          <Loader2 size={12} className="spinning step-icon" />
                          <span className="step-content" style={{fontStyle: 'italic'}}>Processing...</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              <div className="input-area">
                <div className="input-wrapper">
                  {attachedFiles.length > 0 && (
                    <div className="attachment-preview">
                      {attachedFiles.map((file, index) => (
                        <div key={index} className="attachment-chip" style={{
                          position: 'relative',
                          padding: file.preview ? 0 : '6px 10px',
                          overflow: 'hidden',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '8px',
                          height: '48px',
                          minWidth: file.preview ? '48px' : 'auto',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          {file.preview ? (
                            <div style={{position: 'relative', width: '100%', height: '100%'}}>
                              <img 
                                src={file.preview} 
                                alt={file.name}
                                style={{
                                  width: '48px', 
                                  height: '48px', 
                                  objectFit: 'cover',
                                  display: 'block'
                                }} 
                              />
                              <div style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                background: 'rgba(0,0,0,0.5)',
                                color: 'white',
                                fontSize: '8px',
                                padding: '2px 4px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}>
                                {file.name}
                              </div>
                            </div>
                          ) : (
                            <>
                              {file.type.startsWith('video/') ? <Video size={16} /> : 
                               file.type.includes('pdf') ? <File size={16} color="var(--danger)" /> :
                               <File size={16} />}
                              <span style={{maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '12px'}}>
                                {file.name}
                              </span>
                            </>
                          )}
                          
                          <button 
                            onClick={() => handleRemoveFile(index)}
                            className="btn-remove-attachment"
                            style={{
                              position: 'absolute',
                              top: -4,
                              right: -4,
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '50%',
                              width: '16px',
                              height: '16px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              color: 'var(--text-secondary)',
                              zIndex: 10
                            }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      <div style={{flexBasis: '100%', height: 0}}></div>
                      <button
                        onClick={handleSaveFilesToKB}
                        className="btn-ghost"
                        style={{fontSize: '11px', padding: '4px 8px', color: 'var(--accent)'}}
                      >
                        <Save size={12} style={{marginRight: 4}} /> Save to KB
                      </button>
                    </div>
                  )}

                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                    style={{display: 'none'}}
                    accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv"
                  />
                  
                  <textarea
                    className="input-field"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={isSending ? "Thinking..." : "Type your message... (Shift+Enter for new line)"}
                    disabled={isSending}
                    rows={1}
                  />
                  
                  <div className="input-actions">
                    <div className="action-buttons">
                      {/* Token Usage Indicator */}
                      <div 
                        title={`Estimated tokens: ${totalTokens} / ${contextLimit} (${usagePercent}%)`}
                        style={{
                          display: 'flex', 
                          alignItems: 'center', 
                          fontSize: '10px', 
                          color: usagePercent > 80 ? 'var(--danger)' : 'var(--text-muted)',
                          marginRight: 8,
                          background: 'var(--bg-hover)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontWeight: 500,
                          gap: 4,
                          cursor: 'help'
                        }}
                      >
                        <Database size={10} />
                        {usagePercent}%
                      </div>

                      <button 
                        className="btn-ghost" 
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach files"
                        disabled={isSending}
                      >
                        <Paperclip size={18} />
                      </button>
                      
                      {config.enableVoiceInput && (
                        <button 
                          className={`btn-ghost ${isRecording ? 'listening' : ''}`}
                          onClick={toggleVoiceInput}
                          title={isRecording ? "Stop listening" : "Voice input"}
                          disabled={isSending}
                        >
                          {isRecording ? <Mic size={18} color="var(--danger)" className="pulse" /> : <Mic size={18} />}
                        </button>
                      )}

                      <button
                        className="btn-ghost"
                        onClick={() => setIsAgentMode(!isAgentMode)}
                        title={isAgentMode ? "Switch to Chat Mode" : "Switch to Agent Mode (Tools Enabled)"}
                        style={{ color: isAgentMode ? 'var(--accent)' : 'var(--text-muted)' }}
                        disabled={isSending}
                      >
                        {isAgentMode ? <Wrench size={18} /> : <MessageSquare size={18} />}
                      </button>

                      <button 
                        className="btn-ghost" 
                        title="Open Canvas Editor (Write with AI)"
                        onClick={() => {
                          setShowCanvas(true)
                          if (!canvasContent && inputMessage.trim()) {
                            setCanvasContent(inputMessage)
                            setCanvasHistory(['', inputMessage])
                            setHistoryIndex(1)
                          }
                        }}
                      >
                        <PenTool size={18} />
                      </button>
                    </div>
                    
                    {isSending ? (
                      <button 
                        className="btn-primary" 
                        onClick={handleStopGeneration}
                      >
                        <X size={16} />
                        <span>Stop</span>
                      </button>
                    ) : (
                      <button 
                        className="btn-primary" 
                        onClick={handleSendMessage}
                        disabled={!inputMessage.trim() && attachedFiles.length === 0}
                      >
                        <Send size={16} />
                        <span>Send</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Processing Status */}
              {isSending && processingStatus && (
                <div style={{
                  padding: '10px 20px',
                  background: 'rgba(52, 152, 219, 0.1)',
                  borderTop: '1px solid rgba(52, 152, 219, 0.3)',
                  color: '#3498db',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <Loader2 size={16} className="spinning" />
                  {processingStatus}
                </div>
              )}
            </div>

            {/* Canvas Area */}
            {showCanvas && (
              <div style={{width: '50%', borderLeft: '1px solid var(--border-primary)', height: '100%'}}>
                <Canvas 
                  content={canvasContent}
                  onChange={setCanvasContent}
                  onClose={() => setShowCanvas(false)}
                  onAskAI={handleCanvasAI}
                  isProcessing={isCanvasProcessing}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  canUndo={historyIndex > 0}
                  canRedo={historyIndex < canvasHistory.length - 1}
                  onSnapshot={pushHistory}
                />
              </div>
            )}
          </div>
        )}

        {/* Knowledge Tab */}
        {activeTab === 'knowledge' && (
          <div className="kb-container">
            <div className="kb-header">
              <h2>Multi-Layer Knowledge Base</h2>
            </div>
            
            <div className="kb-content">
              {/* Layer Tabs */}
              <div className="layer-tabs">
                <button
                  onClick={() => setSelectedLayer('core')}
                  className={`layer-tab-btn core ${selectedLayer === 'core' ? 'active' : ''}`}
                >
                  Core Documents ({mlkbStats?.core || 0})
                </button>
                <button
                  onClick={() => setSelectedLayer('conversation')}
                  className={`layer-tab-btn conversation ${selectedLayer === 'conversation' ? 'active' : ''}`}
                >
                  Conversations ({mlkbStats?.conversation || 0})
                </button>
                <button
                  onClick={() => setSelectedLayer('generated')}
                  className={`layer-tab-btn generated ${selectedLayer === 'generated' ? 'active' : ''}`}
                >
                  Generated ({mlkbStats?.generated || 0})
                </button>
              </div>

              {/* Core Layer - Upload Interface */}
              {selectedLayer === 'core' && (
                <>
                  <div 
                    className="drop-zone"
                    onDrop={handleFileDrop}
                    onDragOver={(e) => e.preventDefault()}
                  >
                    <FolderOpen size={48} style={{margin: '0 auto 10px'}} />
                    <p>Drag and drop files here</p>
                    <p className="hint">Documents: PDF, Word, Excel, PowerPoint</p>
                    <p className="hint">Images: JPG, PNG, GIF, BMP (with OCR)</p>
                    <p className="hint">Text: TXT, MD, CSV</p>
                  </div>

                  {parsedFile && (
                    <div className="card">
                      <h3>{parsedFile.name}</h3>
                      <p>Type: {parsedFile.type}</p>
                      <p>Content length: {parsedFile.content.length} characters</p>
                      <div style={{marginTop: '16px'}}>
                        <button className="btn-primary" onClick={handleSaveToKB} disabled={isSaving}>
                          {isSaving ? <><Loader2 size={16} className="spinning" /> Saving...</> : <><Save size={16} /> Save to Core KB</>}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {kbStats && (
                <div className="card" style={{marginTop: '20px'}}>
                  <h3>Knowledge Base Status</h3>
                  <p>Documents: {kbStats.count}</p>
                  <p>Mode: {kbStats.mode === 'vector' ? 'Vector Search (with embedding)' : 'Keyword Search'}</p>
                  {kbStats.storagePath && (
                    <p className="hint">
                      Storage: {kbStats.storagePath}
                    </p>
                  )}
                  
                  <div className="kb-actions">
                    <button 
                      onClick={handleReindex}
                      className="btn-primary"
                      disabled={isReindexing || !config.embeddingModel}
                      title={!config.embeddingModel ? "Set up an embedding model first" : "Re-process all documents into vector database"}
                    >
                      {isReindexing ? <Loader2 className="spinning" size={16} /> : <RefreshCw size={16} />}
                      <span style={{marginLeft: 8}}>Reindex KB</span>
                    </button>

                    <button 
                      className="btn-ghost"
                      onClick={() => setShowDocuments(!showDocuments)}
                    >
                      {showDocuments ? 'Hide Documents' : 'View Documents'}
                    </button>
                    
                    <button 
                      className="btn-ghost"
                      style={{color: 'var(--danger)', marginLeft: 'auto'}}
                      onClick={handleClearAllDocuments}
                    >
                      <Trash2 size={16} /> 
                      <span style={{marginLeft: 8}}>Delete All</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary Tab */}
        {activeTab === 'summary' && (
          <SummaryTab 
            currentConversationId={currentConversation?.id || null}
            onViewConversation={async (conversationId) => {
              const allConvs = await window.ipcRenderer.invoke('conversation-get-all')
              const conv = allConvs.find((c: Conversation) => c.id === conversationId)
              if (conv) {
                setCurrentConversation(conv)
                setActiveTab('chat')
              }
            }}
          />
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="settings-container">
            <h2>Settings</h2>
            
            <div className="setting-card">
              <h3>General</h3>
              <div className="setting-group">
                <label>Agent Name</label>
                <input
                  type="text"
                  value={config.agentName}
                  onChange={(e) => setConfig({...config, agentName: e.target.value})}
                />
              </div>

              <div className="setting-group">
                <label>API Base URL</label>
                <input
                  type="text"
                  value={config.baseUrl}
                  onChange={(e) => setConfig({...config, baseUrl: e.target.value})}
                  placeholder="https://api.openai.com/v1"
                />
                <p className="hint">Default: https://api.openai.com/v1. For Ollama: http://localhost:11434/v1</p>
              </div>

              <div className="setting-group">
                <label>API Key</label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setConfig({...config, apiKey: e.target.value})}
                  placeholder="sk-..."
                />
                <p className="hint">Required for cloud. For local models (Ollama), enter any string.</p>
              </div>

              <div className="setting-group">
                <label>Chat Model</label>
                <input
                  type="text"
                  value={config.chatModel}
                  onChange={(e) => setConfig({...config, chatModel: e.target.value})}
                  placeholder="gpt-3.5-turbo"
                />
                <p className="hint">e.g. gpt-4o, llama3, qwen:7b</p>
              </div>

              <div className="setting-group">
                <label>Embedding Model</label>
                <input
                  type="text"
                  value={config.embeddingModel}
                  onChange={(e) => setConfig({...config, embeddingModel: e.target.value})}
                  placeholder="Leave empty for keyword search"
                />
                <p className="hint">Cloud: text-embedding-3-small. Local: nomic-embed-text. Empty: Keyword search.</p>
              </div>
            </div>

            <div className="setting-card">
              <h3>Voice Features</h3>
              
              <div className="setting-row">
                <div className="setting-info">
                  <div className="setting-title">Voice Input</div>
                  <div className="setting-desc">Enable microphone input for chat</div>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={config.enableVoiceInput}
                    onChange={(e) => setConfig({...config, enableVoiceInput: e.target.checked})}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <div className="setting-title">Voice Reply</div>
                  <div className="setting-desc">Auto-play AI responses as speech</div>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={config.enableVoiceReply}
                    onChange={(e) => setConfig({...config, enableVoiceReply: e.target.checked})}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              {config.enableVoiceInput && (
                <div className="setting-row">
                  <div className="setting-info">
                    <div className="setting-title">Use Whisper API</div>
                    <div className="setting-desc">Higher accuracy but paid (~¥0.006/min)</div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!config.useBrowserSpeech}
                      onChange={(e) => setConfig({...config, useBrowserSpeech: !e.target.checked})}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              )}

              {config.enableVoiceReply && (
                <div className="setting-row">
                  <div className="setting-info">
                    <div className="setting-title">Use Natural Voice</div>
                    <div className="setting-desc">High quality neural voice (Edge TTS, Free)</div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!config.useBrowserTTS}
                      onChange={(e) => setConfig({...config, useBrowserTTS: !e.target.checked})}
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              )}

              {!config.useBrowserTTS && config.enableVoiceReply && (
                <div className="setting-group" style={{marginTop: '16px'}}>
                  <label>Voice Personality</label>
                  <select 
                    value={config.voiceType}
                    onChange={(e) => setConfig({...config, voiceType: e.target.value})}
                  >
                    <option value="zh-CN-XiaoxiaoNeural">Xiaoxiao (Warm & Natural)</option>
                    <option value="zh-CN-YunxiNeural">Yunxi (Lively Boy)</option>
                    <option value="zh-CN-YunjianNeural">Yunjian (Sports Male)</option>
                    <option value="zh-CN-YunyangNeural">Yunyang (News Anchor)</option>
                  </select>
                </div>
              )}
            </div>

    <div className="setting-card">
      <h3>Storage & Paths</h3>

      <div className="setting-group">
        <label>Knowledge Base Path</label>
        <div style={{display: 'flex', gap: '10px'}}>
          <input
            type="text"
            value={kbPath}
            readOnly
            placeholder="Select a folder..."
          />
          <button 
            className="btn-ghost"
            onClick={handleSelectKbPath}
          >
            <FolderOpen size={16} />
          </button>
        </div>
      </div>

      <div className="setting-group">
        <label>Document Watcher (Auto-Import)</label>
        <div style={{display: 'flex', gap: '10px', marginBottom: '10px'}}>
          <input
            type="text"
            value={documentsPath}
            readOnly
            placeholder="Select documents folder..."
          />
          <button 
            className="btn-ghost"
            onClick={handleSelectDocumentsPath}
          >
            <FolderOpen size={16} />
          </button>
        </div>
        
        {watchedPaths.length > 0 && (
          <div style={{marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px'}}>
            {watchedPaths.map((path, index) => (
              <div key={index} style={{
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '8px 12px', 
                background: 'var(--bg-hover)', 
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-primary)'
              }}>
                <span style={{fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{path}</span>
                <button
                  onClick={async () => {
                    try {
                      await window.ipcRenderer.invoke('watcher-remove-path', path)
                      const updated = await window.ipcRenderer.invoke('watcher-get-paths')
                      setWatchedPaths(updated)
                    } catch (error) {
                      console.error('Failed to remove path:', error)
                    }
                  }}
                  className="btn-ghost"
                  style={{color: 'var(--danger)', padding: 4}}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
              
              <button 
                className="btn-primary"
                style={{width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px'}}
                onClick={async () => {
                  const result = await window.ipcRenderer.invoke('select-directory')
                  if (result) {
                    try {
                      await window.ipcRenderer.invoke('watcher-add-path', result)
                      const updated = await window.ipcRenderer.invoke('watcher-get-paths')
                      setWatchedPaths(updated)
                    } catch (error) {
                      console.error('Failed to add path:', error)
                      alert('Failed to add folder: ' + (error as Error).message)
                    }
                  }
                }}
              >
                <Plus size={16} /> Add Watch Folder
              </button>
              <p className="hint">Files added to watched folders will be automatically processed</p>
            </div>
          </div>

            <div className="footer-copyright" style={{
              textAlign: 'center',
              marginTop: '40px',
              paddingBottom: '20px',
              color: 'var(--text-muted)',
              fontSize: '12px',
              lineHeight: '1.6'
            }}>
              <p>© 2025 DeepGenome AI Tech LLC. All Rights Reserved.</p>
              <p>Version 1.0.0</p>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}

export default App
