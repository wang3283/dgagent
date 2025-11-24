# 智能 RAG 系统设计

## 当前实现：AI 自主决策 ⭐

### 工作原理
- **Chat 模式**：纯粹的对话，不自动搜索知识库
- **Agent 模式**：AI 拥有 `search_knowledge_base` 工具，可以主动决定何时搜索

### 优势
✅ AI 根据问题性质智能判断是否需要知识库
✅ 避免无关文档干扰（如图片识别场景）
✅ 用户体验流畅，无需手动干预
✅ 透明可见：在 Agent 模式下可以看到 AI 的工具调用

### 使用场景
```
用户：今天天气怎么样？
AI：（不调用知识库，直接回答）

用户：我之前保存的那个项目申报书的截止日期是什么时候？
AI：（调用 search_knowledge_base("项目申报书 截止日期")）
```

---

## 其他可选方案

### 方案 2：用户主动触发

#### 实现方式
添加特殊命令或按钮：
```typescript
// 检测特殊前缀
if (userMessage.startsWith('/kb ')) {
  const query = userMessage.substring(4);
  const kbResults = await knowledgeBase.search(query);
  // 注入结果到 prompt
}
```

#### 优势
- 用户完全控制
- 简单直接

#### 劣势
- 需要用户记住命令
- 增加操作步骤

---

### 方案 3：意图识别

#### 实现方式
使用轻量级模型预先判断：
```typescript
async function needsKnowledgeBase(query: string): Promise<boolean> {
  const intentPrompt = `Does this question require searching personal documents?
Question: ${query}
Answer with only YES or NO.`;
  
  const response = await quickModel.invoke(intentPrompt);
  return response.includes('YES');
}
```

#### 优势
- 快速判断
- 成本低

#### 劣势
- 需要额外 API 调用
- 可能误判

---

### 方案 4：混合策略

#### 实现方式
结合多种信号：
```typescript
function shouldSearchKB(context: {
  hasAttachments: boolean;
  queryLength: number;
  containsKeywords: string[];
  conversationHistory: Message[];
}): boolean {
  // 1. 有附件 → 不搜索
  if (context.hasAttachments) return false;
  
  // 2. 包含特定关键词 → 搜索
  const kbKeywords = ['之前', '保存的', '文档', '笔记', '记录'];
  if (context.containsKeywords.some(k => kbKeywords.includes(k))) return true;
  
  // 3. 问题很短 → 不搜索
  if (context.queryLength < 10) return false;
  
  // 4. 默认不搜索
  return false;
}
```

#### 优势
- 规则明确
- 可调优

#### 劣势
- 需要维护规则
- 不够灵活

---

### 方案 5：用户确认模式

#### 实现方式
```typescript
// 先快速判断是否可能需要 KB
if (mightNeedKB(query)) {
  // 发送确认消息到前端
  event.sender.send('kb-search-confirm', {
    query: extractKeywords(query),
    preview: getKBPreview(query)
  });
  
  // 等待用户确认
  const userChoice = await waitForUserConfirm();
  if (userChoice.approved) {
    // 搜索并注入
  }
}
```

#### 优势
- 用户完全知情
- 可以预览结果

#### 劣势
- 打断对话流程
- 增加交互步骤

---

## 推荐配置

### 当前最佳实践

1. **默认使用 Agent 模式**
   - AI 自主决策何时搜索 KB
   - 透明可见的工具调用

2. **Chat 模式作为备选**
   - 纯粹对话，无 KB 干扰
   - 适合闲聊、图片识别等场景

3. **未来优化方向**
   - 添加 KB 搜索质量评分
   - 实现多轮 KB 查询（refine search）
   - 支持用户反馈（"这个文档不相关"）

---

## 使用建议

### 何时使用 Chat 模式
- 闲聊、日常对话
- 图片/文件分析
- 不需要历史信息的问题

### 何时使用 Agent 模式
- 需要查询保存的文档
- 复杂任务（需要多步骤）
- 需要工具支持（文件读取、PubMed 搜索等）

### 切换方式
点击输入框旁边的 🔧/💬 图标即可切换模式。

---

## 技术细节

### Agent 模式下的 KB 搜索流程

```
用户提问
    ↓
AI 分析问题
    ↓
判断是否需要 KB？
    ↓ YES
调用 search_knowledge_base 工具
    ↓
返回相关文档
    ↓
AI 基于文档生成回答
```

### 搜索优化

```typescript
// 当前实现
await knowledgeBase.search(query, 5);  // 返回前 5 个结果

// 未来可以优化
await knowledgeBase.search(query, {
  limit: 5,
  minScore: 0.7,  // 最低相关度
  filters: {      // 可选过滤
    type: 'document',
    dateRange: 'last-month'
  }
});
```

---

## 常见问题

### Q: 为什么 AI 没有搜索知识库？
A: 在 Agent 模式下，AI 会根据问题判断是否需要。如果问题不需要历史信息，AI 会直接回答。

### Q: 如何强制 AI 搜索知识库？
A: 在问题中明确提及，例如："根据我之前保存的文档，..."

### Q: Chat 模式和 Agent 模式有什么区别？
A: 
- **Chat 模式**：纯对话，快速响应，无工具调用
- **Agent 模式**：可以使用工具（KB 搜索、文件读取、PubMed 等），适合复杂任务

---

## 性能对比

| 方案 | 响应速度 | 准确度 | 用户体验 | 实现复杂度 |
|------|---------|--------|---------|-----------|
| AI 自主决策 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 用户主动触发 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| 意图识别 | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 混合策略 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 用户确认 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |

**当前选择：AI 自主决策** - 平衡了所有维度，是最佳方案。
