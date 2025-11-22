# 语音对话功能实现指南

## ✅ 已实现的后端功能

### 1. **语音转文字** (Speech-to-Text)
- 文件: `electron/services/speechToText.ts`
- 功能: 将音频/视频文件转换为文字
- API: Whisper (OpenAI 兼容)

### 2. **文字转语音** (Text-to-Speech)
- 文件: `electron/services/voiceChat.ts`
- 功能: 将 AI 回复转换为语音
- API: TTS (OpenAI 兼容)

### 3. **IPC 处理器**
- `voice-to-text`: 处理语音输入
- `text-to-speech`: 生成语音回复
- `get-temp-dir`: 获取临时文件目录

## 🎯 前端需要添加的功能

### 1. **录音按钮**
在聊天输入框旁边添加麦克风按钮：
```tsx
// 录音状态
const [isRecording, setIsRecording] = useState(false)
const mediaRecorderRef = useRef<MediaRecorder | null>(null)
const audioChunksRef = useRef<Blob[]>([])

// 开始录音
const startRecording = async () => {
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
    alert('无法访问麦克风')
  }
}

// 停止录音
const stopRecording = () => {
  if (mediaRecorderRef.current && isRecording) {
    mediaRecorderRef.current.stop()
    setIsRecording(false)
  }
}
```

### 2. **处理语音输入**
```tsx
const handleVoiceInput = async (audioBlob: Blob) => {
  try {
    setProcessingStatus('正在识别语音...')
    
    // Save audio blob to temp file
    const tempDir = await window.ipcRenderer.invoke('get-temp-dir')
    const audioPath = `${tempDir}/voice_${Date.now()}.webm`
    
    // Convert blob to buffer and save
    const buffer = await audioBlob.arrayBuffer()
    const fs = require('fs')
    fs.writeFileSync(audioPath, Buffer.from(buffer))
    
    // Convert to text
    const text = await window.ipcRenderer.invoke('voice-to-text', audioPath)
    
    // Set as input message
    setInputMessage(text)
    setProcessingStatus('')
    
    // Optionally auto-send
    // await handleSendMessage()
  } catch (error) {
    console.error('Voice input failed:', error)
    alert('语音识别失败')
    setProcessingStatus('')
  }
}
```

### 3. **播放 AI 语音回复**
```tsx
const [isPlayingAudio, setIsPlayingAudio] = useState(false)
const audioRef = useRef<HTMLAudioElement | null>(null)

const playAIVoice = async (text: string) => {
  try {
    setIsPlayingAudio(true)
    
    // Generate speech
    const audioPath = await window.ipcRenderer.invoke('text-to-speech', text)
    
    // Play audio
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

const stopAIVoice = () => {
  if (audioRef.current) {
    audioRef.current.pause()
    audioRef.current = null
    setIsPlayingAudio(false)
  }
}
```

### 4. **修改发送消息函数**
```tsx
const handleSendMessage = async () => {
  // ... 现有代码 ...
  
  // 发送消息后，生成语音回复
  if (enableVoiceReply) {
    const aiResponse = updated.messages[updated.messages.length - 1]
    if (aiResponse && aiResponse.role === 'assistant') {
      await playAIVoice(aiResponse.content)
    }
  }
}
```

### 5. **UI 按钮布局**
```tsx
<div className="input-container">
  {/* 录音按钮 */}
  <button
    onClick={isRecording ? stopRecording : startRecording}
    style={{
      padding: '12px',
      background: isRecording ? '#e74c3c' : 'transparent',
      border: 'none',
      cursor: 'pointer',
      color: isRecording ? 'white' : '#3498db',
      display: 'flex',
      alignItems: 'center',
      borderRadius: '50%'
    }}
    title={isRecording ? "停止录音" : "开始录音"}
  >
    {isRecording ? <StopCircle size={20} /> : <Mic size={20} />}
  </button>

  {/* 附件按钮 */}
  <button onClick={() => fileInputRef.current?.click()}>
    <Paperclip size={20} />
  </button>

  {/* 输入框 */}
  <textarea value={inputMessage} onChange={...} />

  {/* 发送按钮 */}
  <button onClick={handleSendMessage}>
    <Send size={16} />
  </button>

  {/* 语音播放控制 */}
  {isPlayingAudio && (
    <button onClick={stopAIVoice}>
      <Volume2 size={16} />
      <span>停止播放</span>
    </button>
  )}
</div>
```

## 🎨 用户体验流程

### 场景1: 语音输入 + 文字回复
1. 用户点击麦克风按钮
2. 开始录音（按钮变红）
3. 用户说话
4. 点击停止录音
5. 系统识别语音 → 转文字
6. 文字显示在输入框
7. 用户确认后发送
8. AI 文字回复

### 场景2: 语音输入 + 语音回复
1. 用户点击麦克风按钮
2. 录音并自动发送
3. AI 文字回复
4. 自动播放语音回复
5. 文字和语音都保存在对话历史

### 场景3: 文字输入 + 语音回复
1. 用户打字输入
2. 发送消息
3. AI 文字回复
4. 点击播放按钮听语音
5. 或自动播放（可选）

## ⚙️ 配置选项

在 Settings 中添加：
```tsx
<div className="setting-group">
  <label>
    <input 
      type="checkbox" 
      checked={enableVoiceReply}
      onChange={(e) => setEnableVoiceReply(e.target.checked)}
    />
    自动播放 AI 语音回复
  </label>
</div>

<div className="setting-group">
  <label>语音音色</label>
  <select value={voiceType} onChange={(e) => setVoiceType(e.target.value)}>
    <option value="alloy">Alloy (中性)</option>
    <option value="echo">Echo (男声)</option>
    <option value="fable">Fable (英式)</option>
    <option value="onyx">Onyx (深沉)</option>
    <option value="nova">Nova (女声)</option>
    <option value="shimmer">Shimmer (温柔)</option>
  </select>
</div>
```

## 💰 成本估算

### DMX API 价格
- **STT (语音转文字)**: ¥0.006/分钟
- **TTS (文字转语音)**: ¥0.015/1K 字符

### 示例
- 1分钟语音输入: ¥0.006
- AI 回复 200 字: ¥0.003
- 完整对话: ¥0.009

## 🔒 隐私说明

- 录音在浏览器中完成
- 音频文件临时保存在本地
- 发送到 API 进行转写
- 生成的语音保存在本地临时目录
- 定期自动清理（60分钟后）

## 📝 待实现功能

- [ ] 前端录音UI
- [ ] 语音波形显示
- [ ] 语音播放进度条
- [ ] 语音速度调节
- [ ] 多语言支持
- [ ] 离线语音识别（whisper.cpp）

## 🐛 故障排除

### 问题1: 无法录音
- 检查麦克风权限
- 浏览器需要 HTTPS 或 localhost

### 问题2: 语音识别失败
- 检查 API 配置
- 确认服务商支持 Whisper

### 问题3: 语音播放失败
- 检查音频文件路径
- 确认 TTS API 可用

---

**下一步**: 实现前端录音和播放UI
