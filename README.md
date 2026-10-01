# 🎨 @copylee/dsh-image-gen

DeepSeek Harness（DSH）的 AI 生图插件。DSH 左侧栏会多出一个「绘画」入口，打开的是全局画廊，与工作区无关，布局参考 Cherry Studio 的绘画页。Agent 在普通对话里也能在需要时直接调用生图工具。

> 与原插件 `dsh-image-gen` 使用不同的包名、路由、数据目录和工具名，**两者可以同时安装**。
>
> 本插件参考并移植了 [shanliuling/dsh-image-gen](https://github.com/shanliuling/dsh-image-gen)（Apache-2.0）的部分 Provider 适配代码，详见 [NOTICE](NOTICE)。

## 功能

| 入口 | 能做什么 |
| :--- | :--- |
| 🎨 **侧边栏 · 绘画** | 左栏切换画廊项目、设置参数（服务商、模型、比例、清晰度、数量、种子、反向提示词、参考图），中间是画板和 Prompt 输入框，右栏显示当前项目的历史 |
| 🖼️ **侧边栏 · 图库** | 浏览所有项目的图片，支持搜索、按服务商筛选、收藏、批量移动/下载/删除、导入本地图片，可在大图查看器里「作为参考图」或「复用 Prompt」 |
| 🔖 **收藏 Prompt** | 收藏常用 Prompt，可一键带回绘画页 |
| 💬 **对话** | Agent 需要时自动调用 `paint_image` / `paint_images` / `edit_painting`，结果以图片卡片显示在对话里，同时存入画廊的「对话」项目 |
| ⚙️ **设置** | 预置服务商可直接改，也能添加任意多个自定义端点；全局代理加上每个服务商单独的代理；可测试连接、拉取模型列表 |

### 画廊不绑定项目

- 画廊数据存放在 `~/.dsh/storages/copylee-image-gen/gallery.json`，图片本体存在 DSH 附件库里，不跟任何工作区或会话挂钩，切换工作区后画廊内容不会变。
- 画廊有**自己的项目分组**，可以新建、重命名、删除（删除时可选择把图片一起删掉或移到「默认画板」）。另有两个内置项目：「默认画板」和「对话」（Agent 在对话中生成的图会放在这里）。
- 如果需要，也可以把对话里生成的图再存一份到当前会话工作区（设置 → 存储）。

## 安装

在 DeepSeek Harness 项目根目录执行：

```bash
pnpm dsh plugin --profile web add @copylee/dsh-image-gen@latest
# 或者从 GitHub 直接安装
pnpm dsh plugin --profile web add git+https://github.com/copylee711/dsh-image-gen.git
```

装好后重启 DSH，左侧栏会出现「绘画」。打开后点右上角 ⚙️，或者进入 **设置 → 插件 → 图像生成**，给至少一个服务商填好 API Key 就能用了。

需要 DSH 0.1.7 或更高版本（已在 0.2.0-rc.2 上验证），Node.js `^22.19.0` 或 `>=24`。

## 预置服务商

| 服务商 | 协议 | 默认端点 | 默认模型 |
| :--- | :--- | :--- | :--- |
| **ModelScope 魔搭**（默认） | modelscope（异步任务） | `https://api-inference.modelscope.cn/v1` | `Qwen/Qwen-Image`（另含 `Qwen/Qwen-Image-Edit`、FLUX.1-Krea-dev 等） |
| Google Gemini | gemini | `https://generativelanguage.googleapis.com/v1beta/interactions` | `gemini-3.1-flash-image` |
| OpenAI | openai | `https://api.openai.com/v1` | `gpt-image-2` |
| 硅基流动 SiliconFlow | siliconflow | `https://api.siliconflow.cn/v1` | `Kwai-Kolors/Kolors` |
| 火山方舟 Seedream | seedream | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seedream-5-0-260128` |
| 阿里云百炼 DashScope | dashscope | `https://dashscope.aliyuncs.com/api/v1` | `qwen-image-3.0` |
| xAI Grok Imagine | xai | `https://api.x.ai/v1` | `grok-imagine-image` |
| 智谱 GLM-Image | zhipu | `https://open.bigmodel.cn/api/paas/v4` | `glm-image` |
| Together AI | openai-compat | `https://api.together.xyz/v1` | `black-forest-labs/FLUX.1-schnell` |
| OpenAI 兼容（中转站） | openai-compat | 自己填 | 自己填 |

预置服务商的名称、端点、模型、代理都能改，也可以停用，只是不能删除。

## 自定义端点

在设置里点「服务商 +」新建一条，选好**接口协议**（上表任意一种），再填名称、API 地址、Key 和模型（可以点「拉取模型」自动获取）。同一种协议可以添加多条，比如多个 OpenAI 兼容的中转站。中转站的「高级选项」里还能设置编辑请求格式和尺寸表。

## 代理

- **全局代理**：只作用于本插件发出的生图请求，不会影响 DSH 的其他网络流量。支持 `http://`、`https://`、`socks5://`、`socks5h://`、`socks4://`，地址里可以带 `user:pass@`；还可以配置不走代理的主机（`localhost`、`.example.com`、`*.example.com`）。
- **每个服务商单独设置**：「跟随全局」「直连」或「自定义代理地址」三选一。
- 「测试代理」和「测试连接」走的是和正式请求相同的代理路径。

## Agent 工具

| 工具 | 说明 |
| :--- | :--- |
| `paint_image` | 文生图。Agent 判断需要配图时会主动调用 |
| `paint_images` | 一次按顺序生成多张，最多 8 张 |
| `edit_painting` | 图生图/改图。用户刚上传的图会直接作为输入，也支持传对话里的附件 ID 或工作区里的文件路径 |

每次请求时，插件会往系统上下文里注入一小段说明，列出已配置 Key 的服务商（id、模型、是否支持编辑），这样 Agent 就知道可以生图、也能按用户要求指定服务商。

## 分辨率、收藏 Prompt 与本地文件

- **分辨率**：ModelScope、硅基流动、OpenAI 系、DashScope、智谱、Seedream 可以在「标准 / 1K / 1.5K / 2K / 自定义宽×高」之间选择。自定义尺寸会按各服务商允许的范围和步长自动对齐；Gemini、xAI 仍然用清晰度档位。
- **收藏 Prompt**：点输入框的书签按钮，或在空输入框里按 `/`、`Ctrl/⌘+K`，弹出收藏列表：点击替换、Shift+Enter 追加，还能收藏或取消收藏当前 Prompt。「收藏 Prompt」页签里可以直接编辑。
- **本地文件**：每张图在「图片保存目录」（默认 `~/.dsh/storages/copylee-image-gen/images/`，可在设置里修改）保存一份带可读文件名的副本，按月份分文件夹。画板工具栏和大图查看器里的「在文件夹中显示」会在资源管理器 / 访达中定位到该文件。

## 数据与隐私

- API Key 存在 DSH 凭据库里（记录名为 `copylee-image-gen/<服务商 id>`），浏览器端永远拿不到明文。宿主不支持记录 API 时，会退回到权限为 0600 的 `keys.json`。
- 设置保存在 `~/.dsh/storages/copylee-image-gen/settings.json`，画廊保存在 `gallery.json`。可以用 `COPYLEE_IMAGE_GEN_HOME` 或插件配置项 `dataDir` 换目录。
- Prompt 和参考图会发送给你选择的服务商。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test        # vitest，包含本地 HTTP / SOCKS5 代理的端到端测试
pnpm build       # 输出 lib/index.js（Host）和 lib/client.js（浏览器）
pnpm pack:check

```

### 发版

推送版本 tag 后，GitHub Actions（`.github/workflows/publish.yml`）会通过 npm Trusted Publishing 自动发布，并附带 provenance：

```bash
# 先把 package.json 的 version 改成新版本并合并到 main
git tag v0.1.1 && git push origin v0.1.1
```

## 路线图

后续计划：Prompt 灵感库、多模型横向对比、本地 ComfyUI、订阅账号登录（免 Key）、无限画布。

## License

MIT（自有代码）。从上游移植的文件按 Apache-2.0 授权，详见 [NOTICE](NOTICE)。
