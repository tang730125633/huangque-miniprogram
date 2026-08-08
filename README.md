<p align="center">
  <img src="assets/readme/hero.svg" width="100%" alt="黄雀 AI 微信小程序：从 IP12 定位到生成与资产复用的移动创作链路">
</p>

# 黄雀 AI 微信小程序

把 IP 定位、图片/声音/视频生成和历史资产复用放进微信内的一条创作链路。

**首次成功动作：** 在微信开发者工具导入仓库根目录后，打开「IP12」开始一次定位；后续创作结果可回到资产页查看提示词与继续使用。

## 可核对的实现证据

- [`tests/ip12_full_journey.test.js`](./tests/ip12_full_journey.test.js) 校验 IP12 会话、确认初稿与 PDF 查看入口。
- [`tests/banana_draft_multiref.test.js`](./tests/banana_draft_multiref.test.js) 覆盖多参考图、草稿恢复与任务受理后清理。
- [`tests/assets_prompt_history.test.js`](./tests/assets_prompt_history.test.js) 校验图片和视频历史中的提示词展示、复制与隐私字段过滤。

这些是客户端契约与静态回归测试，不代表任一生成服务、计费或微信正式版当前可用。

## 创作如何衔接

```text
IP12 定位
  → 生成：灵感跟创、AI 作图、配音/声音克隆、视频
  → 资产复用：在历史作品中预览、保存或查看提示词
```

对应代码在 [`pages/ip12`](./miniprogram/pages/ip12)、[`pages/banana`](./miniprogram/pages/banana)、[`pages/video`](./miniprogram/pages/video)、[`pages/audio`](./miniprogram/pages/audio) 与 [`pages/assets`](./miniprogram/pages/assets)。账号、点数、任务与文件服务由黄雀后端提供；本仓库保存小程序客户端及其相关测试。

## 本地导入与检查

```bash
# 在仓库根目录
node --test tests/*.test.js
```

在微信开发者工具选择「导入项目」，目录选择仓库根目录（含 `project.config.json`）。如需小程序 npm 依赖，进入 `miniprogram/` 执行 `npm install`，再在开发者工具中执行「工具 → 构建 npm」。需要开发权限的 AppID 与本地私有设置；详细操作见 [`使用说明-如何运行和发布.md`](./使用说明-如何运行和发布.md)。

发布状态必须分别核验：Git `main`、开发者工具上传、微信审核、正式发布和真实用户可用不是同一件事。本 README 不声明当前正式版状态。

## 工程约定与边界

- 小程序入口与配置：[`miniprogram/app.js`](./miniprogram/app.js)、[`miniprogram/app.json`](./miniprogram/app.json)、[`project.config.json`](./project.config.json)。
- 支付、点数、会员、邀请和用户数据的变更，除相关专项测试外仍需真实业务验收。
- 相册、相机、麦克风、声音克隆和数字人口播仅应在用户主动使用时处理；后两者需要独立授权。
- 不提交密码、Token、Cookie、私钥、用户数据或本机私有配置。
