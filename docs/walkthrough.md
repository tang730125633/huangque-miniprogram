# Agent UI 组件库 Apple HIG 规范与零硬编码数据驱动完工报告

按照你的指导与核心原则——**“文件不要硬编码，这个组件是给 Agent 用的”**，我们对整个 Agent UI 体系进行了一次彻底的架构解耦与工程升级：
1. **全面以 Apple Human Interface Guidelines (Apple HIG) 为全局基石**，图标以 **Apple SF Symbols 优先**，**oil-icon 仅作为苹果未覆盖业务缺口的补充**；
2. **彻底解耦硬编码**：无论是任务栏编号、任务标题、卡片待选数量、卡片内容、还是操作按钮（克隆、定制、重写等），**100% 由后端 Agent 下发的 JSON Schema 数据驱动**；
3. **重构真机预览页为动态仿真工作台**：将 `agent_ui_preview.html` 重构为具备实时 JSON 代码编辑器、多场景一键预设、动态渲染引擎与上行协议日志的 Agent UI 工作台，在浏览器中即可随改随验。

---

## 架构核心：零硬编码与 Agent 数据驱动契约

```
┌─────────────────────────────────────────────────────────────┐
│                 后端 Agent 下发 JSON 消息体                  │
│  { task: { id, title, desc }, widgets: [ ... ], ... }      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 前端动态解析与状态计算引擎                    │
│   - task.id -> 任务胶囊标签「#TASK-XXXX」                   │
│   - task.title -> 任务标题动态绑定 (支持任意业务领域)       │
│   - widgets.length -> 动态待选徽标「N 项待选」              │
│   - widgets.map(w => w.title) -> 动态折叠副标题摘要         │
│   - widget.actions -> 动态渲染操作按钮与指令 Prompt         │
│   - selection_mode -> 动态适配 single 单选 / multiple 多选  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Apple HIG 纯矢量原生组件呈现                │
│   - iOS 系统蓝 (#007AFF) · Inset Grouped 分组卡片           │
│   - Apple checkmark.circle.fill 打勾圆环 / 多选打勾方框     │
│   - SF Symbols 纯矢量图标 (doc / wave / person / mic)       │
│   - 适老化 44pt 触达区域与「展开全文 ▾ / 收起 ▴」长文本折叠 │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心设计与解耦升级详情

### 1. 任务预备栏彻底解耦（Dynamic Task Capsule Bar）
- **改版前缺陷**：在 WXML 模板中写死了静态文字与固定数字（如 `'方案已收起 · 点击展开 3 项组件卡'`、`'方案建议准备就绪'`、`任务 #01` 等）。
- **改版后实现**：
  - **动态任务编号**：优先读取后端 Agent 传回的 `task.id` 或 `task_id`，若缺省则自动由会话尾号补位（`#{{agentTaskId || agentSessionId.slice(-4)}}`）；
  - **动态任务主标题**：绑定 `{{agentTaskTitle || '方案建议准备就绪'}}`，后端 Agent 可随时下发任何标题（如“门店周促策划案”、“多渠道分发任务”等）；
  - **动态待选徽章**：通过 `{{agentWidgets.length}} 项待选` 动态计算，无论是 1 张、3 张还是 5 张卡片均自动精确计数；
  - **动态折叠副标题**：展开时展示动态概览 `agentWidgetsSummary`（自动根据当前卡片名称串联，如“门店引流文案 · 配音音色 · 数字人形象”）；折叠时展示动态文案 `方案已收起 · 点击展开 {{agentWidgets.length}} 项组件卡`。

### 2. 卡片操作按钮全面动态化（Dynamic Widget Actions）
- **改版前缺陷**：在卡片底部写死了 `wx:if="{{item.type==='voice_pick'}}"` 和 `item.type==='avatar_pick'`，按钮文案写死为 `'＋ 克隆音频'` 和 `'＋ 定制数字人'`，点击发送的文本也是前端硬编码字符串。
- **改版后实现**：
  - **支持 Agent 自由下发 actions**：任何组件卡均可在 JSON 中携带 `actions: [{ label: '...', prompt: '...', mode: '...' }]`；
  - **动态渲染**：通过 `wx:for="{{item.actions}}"` 动态渲染按钮，支持自定义按钮文案（如 `＋ 重新生成文案`、`＋ 推荐新兴渠道`、`＋ 录制专属声音`）；
  - **动态指令分发**：点击时通过 `triggerAgentWidgetAction` 将 `action.prompt` 或对应模式直接回传给 Agent，无需前端写死任何业务判断，彻底对齐 Agentic 架构；
  - **无缝向下兼容**：若老旧轮次未下发 actions，自动兜底提供原生克隆/定制入口，确保历史用例 100% 稳定运行。

### 3. 真机预览页重构为「动态仿真工作台」（agent_ui_preview.html）
- **改版前缺陷**：之前的预览页是写死 HTML 结构的静态 Mock，无法修改数据，更无法证明能够解析不同的 Agent 任务。
- **改版后能力**：
  - **内置 4 大真实 Agent 业务预设**：
    1. 🎬 **预设 1：短视频方案三联选**（口播文案 + 音色试听 + 数字人形象选择）；
    2. 📊 **预设 2：多渠道营销活动策划**（多选 Checkbox 模式 + 实时已选计数 + 批量确认）；
    3. 🎙️ **预设 3：声音克隆采样流程**（动态下发跟读文稿 + 录音/上传动作）；
    4. 🍜 **预设 4：餐饮门店爆品周促**（证明无缝适配任意全新业务领域）；
  - **实时 JSON 编辑器与一键渲染**：页面左侧配备实时 JSON 编辑面板，开发者可随意粘贴、修改任意 Agent 下发的 JSON Payload，点击「立即渲染 Agent 数据」即可在右侧真机视图中秒级呈现；
  - **实时上行协议日志终端**：实时记录用户在真机端的交互行为，并打印向 Agent 发送的精准指令（如 `【点选】门店引流口播文案：A版 · 直给福利型（id=script_1）`）。

### 4. Apple HIG 与 SF Symbols 视觉规范对齐
- **主交互色**：全量采用 Apple iOS 标志性系统蓝（`#007AFF`）；
- **单选与多选打勾**：全面采用 Apple iOS `checkmark.circle.fill` 规范（未选中为 Apple 系统灰细圆环 `#C7C7CC`；选中为实心 Apple 系统蓝 `#007AFF` 填充 + 纯白对勾 `✓`）；
- **卡片容器**：遵循 Apple Inset Grouped 分组卡片规范，白色背景（`#FFFFFF`）配合系统极细分隔线与微阴影；
- **纯矢量图标**：全面移除 Emoji 字符与噪点，全量采用 Apple SF Symbols 标准矢量图标（`doc.text`、`waveform`、`person.crop.rectangle`、`mic.fill`、`sparkles`）。

---

## 文件落盘位置一览

| 目标文件 | 磁盘绝对路径 | 作用说明 |
| :--- | :--- | :--- |
| **真机预览工作台 (根目录)** | `/Users/xlzj/Desktop/21日的视频/huangque-miniprogram/agent_ui_preview.html` | 本地 Git 仓库根目录，包含完整 JSON 编辑器与动态渲染引擎 |
| **真机预览工作台 (桌面直达)** | `/Users/xlzj/Desktop/agent_ui_preview.html` | 桌面快速双击在浏览器中直接打开体验 |
| **真机预览工作台 (文档库)** | `/Users/xlzj/Desktop/21日的视频/huangque-miniprogram/docs/agent_ui_preview.html` | 归档于项目文档库中 |
| **完工设计报告 (文档库)** | `/Users/xlzj/Desktop/21日的视频/huangque-miniprogram/docs/walkthrough.md` | 项目设计与架构全量规范文档 |
| **完工设计报告 (桌面直达)** | `/Users/xlzj/Desktop/walkthrough.md` | 桌面快速阅读文档 |
| **小程序 Agent 核心模板** | `miniprogram/paper/components/screen/index.wxml` | 解耦硬编码后的微信小程序 WXML 模板 |
| **小程序 Agent 核心逻辑** | `miniprogram/paper/components/screen/index.js` | 动态任务栏与 actions 解析的 JS 逻辑 |
| **小程序 Agent 原生样式** | `miniprogram/paper/components/screen/index.wxss` | Apple HIG 系统蓝与 Inset Grouped 样式表 |

---

### 5. 真机端标题文字恶性竖排折行 Bug 根因剖析与 Apple HIG 原生单元格彻底重构（2026-09-18 晚）
- **真机异常现象**：用户在真机体验版截图反馈：标题卡片中“不会打字也能做视频”被挤成一列单字竖排文字（`不\n会\n打\n字...`），胶囊标签悬空在右侧，单选对勾圆环被挤在下方，整张卡片严重畸形。
- **根因剖析**：
  1. `index.js` 中 `parsedTag` 错误地直接赋初值为 `item.summary || item.description`，导致长句副标题（如“副标题: 给中老年的零输入AI出片流程，一看就会”）全部被当做胶囊标签灌入 `parsedTag`；
  2. `index.wxss` 中 `.agent-widget-pill` 设置了 `flex: none`，而容器 `.agent-widget-name-row` 未开启 `flex-wrap: wrap`。导致无弹性的超长标签独占整行，标题文本 `.agent-widget-name` 被迫压缩至 min-content 极限（汉字字符宽度 29rpx），发生单字恶性竖排换行；
  3. `index.wxml` 中将用于短名称音色卡的 `voice-copy-layout` 误加到所有单选卡片容器上，破坏了通用组件的自适应能力。
- **Apple HIG 原生重构方案**：
  1. **解析层精准解耦**：`parsedTag` 仅在存在显式 `item.tag` 或括号内提取出 $\le 8$ 字符的非说明性短标签时生效；长句与副标题统一归入 `summary`；
  2. **容器严格遵循 Apple Inset Grouped 规范**：`.agent-widget-option` 强制 `display: flex; flex-direction: row; align-items: center; justify-content: space-between;`，文本区采用 `flex: 1 1 0%; min-width: 0; width: 0;` 确保宽度严格受控；
  3. **标题行支持 Apple 弹性自适应换行**：`.agent-widget-name-row` 配置 `flex-wrap: wrap; gap: 10rpx 14rpx;`，标题 `word-break: break-word; white-space: normal;`，彻底杜绝单字断行畸变；
  4. **原生 iOS 配件样式**：单选圆环 `44rpx`（未选 `#C7C7CC`，选中实心 Apple 蓝 `#007AFF` 居中白色加粗勾号 `✓`），边距为标准的 20rpx 圆角与 1.5rpx 细发丝边框；
  5. **测试与发布闭环**：新增 1 项针对长副标题与标题排版的回归测试，全量 214 项测试 100% 通过；已通过脚本成功发布至微信小程序体验版 `v0.137`。

---

## 自动化测试验证

工程全量 214 项单元测试执行结果：
```bash
node --test tests/*.test.js
```
- **测试总数**：`214`
- **通过数量**：`214`（100% 全部通过）
- **失败用例**：`0`
- **回归验证范围**：
  - 标题与文案卡项：副标题长句不误作为 parsedTag，避免竖排挤压 bug（全新通过）；
  - 动态任务栏折叠/展开与多卡片收纳逻辑；
  - 动态 actions 按钮分发与老旧方法向下兼容；
  - 单选点选即发与多选勾齐批量提交；
  - 音色播放器试听解耦与纯矢量图标完整性。
