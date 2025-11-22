# OCR 功能设置指南

## 📋 概述

应用现在使用 `node-tesseract-ocr`，这是一个更稳定的 OCR 方案，适合 Electron 应用。它调用系统的 Tesseract 命令行工具，不会出现 Worker 错误。

## 🔧 安装 Tesseract

### macOS

```bash
# 安装 Tesseract 和中文语言包
brew install tesseract tesseract-lang

# 验证安装
tesseract --version
```

### 验证语言包

```bash
# 查看已安装的语言
tesseract --list-langs

# 应该看到：
# eng (English)
# chi_sim (Simplified Chinese)
```

## ✅ 功能特性

### 1. **自动检测**
- 应用启动时自动检测 Tesseract 是否可用
- 如果未安装，会显示友好提示

### 2. **支持的语言**
- 英文 (eng)
- 简体中文 (chi_sim)
- 可以同时识别中英文混合文本

### 3. **智能降级**
- Tesseract 未安装：显示安装提示
- Tesseract 已安装但识别失败：显示错误信息
- 识别成功：提取文字内容

## 📝 使用方法

### 1. **在聊天中上传图片**
```
1. 点击📎按钮
2. 选择图片文件
3. 输入问题（如"这张图片说的什么"）
4. 点击发送
5. 系统自动 OCR 识别
6. AI 根据提取的文字回答
```

### 2. **保存到知识库**
```
1. 上传图片后
2. 点击 "Save to KB" 按钮
3. OCR 提取的文字保存到知识库
4. 后续可以搜索和引用
```

## 🎯 性能说明

- **识别速度**: 通常 2-5 秒
- **准确率**: 取决于图片质量
  - 清晰的文字：90%+
  - 模糊或手写：可能较低
- **支持格式**: JPG, PNG, GIF, BMP, TIFF, WebP

## 🐛 故障排除

### 问题1: "OCR not available"
**原因**: Tesseract 未安装
**解决**: 
```bash
brew install tesseract tesseract-lang
```

### 问题2: "OCR failed: spawn tesseract ENOENT"
**原因**: Tesseract 未在 PATH 中
**解决**: 
```bash
# 添加到 ~/.zshrc 或 ~/.bash_profile
export PATH="/opt/homebrew/bin:$PATH"
source ~/.zshrc
```

### 问题3: "Error opening data file"
**原因**: 语言包未安装
**解决**: 
```bash
brew install tesseract-lang
```

### 问题4: 识别结果不准确
**建议**:
- 使用高分辨率图片
- 确保文字清晰
- 避免复杂背景
- 文字方向正确

## 📊 技术对比

| 方案 | 优点 | 缺点 | 状态 |
|------|------|------|------|
| tesseract.js | 纯 JS，无需安装 | Worker 在 Electron 中有问题 | ❌ 已弃用 |
| node-tesseract-ocr | 稳定，速度快 | 需要安装系统依赖 | ✅ 当前使用 |

## 🚀 未来改进

- [ ] 支持更多语言（日文、韩文等）
- [ ] 图片预处理优化（去噪、增强）
- [ ] 批量 OCR 处理
- [ ] OCR 结果校正和优化
- [ ] 支持 PDF 文件的 OCR

## 💡 提示

1. **首次使用**: 安装 Tesseract 后重启应用
2. **最佳实践**: 上传清晰、高分辨率的图片
3. **隐私**: OCR 在本地处理，不会上传到云端
4. **性能**: 大图片可能需要更长时间

---

**需要帮助?** 查看控制台日志获取详细错误信息
