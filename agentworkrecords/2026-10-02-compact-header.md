# 2026-10-02 image-gen 顶部布局优化（用户验收通过）

## 已完成范围
- 分支：fix/compact-paintings-header。
- 标题栏移除累加 --dsh-frame-top-clearance 的顶部内边距，改为 12px 上下、18px 左右。
- 使用三列网格排列标题、导航、设置按钮，移除多余 spacer。
- 导航按钮保持完整宽度；窄窗口下导航独占第二行，极窄时可横向滚动。
- 保留现有主题、字号、标签文字和功能逻辑。

## 实际验证
- TypeScript 类型检查通过。
- 30 个测试文件、213 项测试全部通过。
- 构建和 pnpm pack --dry-run 通过；构建有 lucide-react 的 use client 指令提示，未阻断输出。
- 浏览器使用真实 PaintingsPage 和 STYLE、演示 API 数据验证。
- 1280×720 预览、模拟继承顶部避让值 56px：修改前标题栏 116px，修改后 52px。
- 375×812 和 320×720：修改后标题栏 84px，两行排列；无页面横向溢出，375px 下各导航文字无裁切。
- 绘画、图库、收藏 Prompt、设置入口切换正常。
- 本地验收页面：http://127.0.0.1:5179/（服务由当前会话启动；node_modules/.cache/header-preview 内的预览文件不进入 npm 包或 Git 提交）。
- 截图：C:/Users/Alan/.codex/visualizations/2026/10/02/01a0fb16-a641-7503-be97-873a0b93cbf0/image-gen-header-after.png；同目录有 before、narrow 截图。

## 仍需注意的边界
- 浏览器预览验证不等同于桌面宿主集成验证；尚未替换已安装的插件，未调用真实生图服务。
- 用户于 2026-10-02 回复“通过”，已授权合并、推送及 npm 发布。
- 发布版本升级至 0.1.9，通过现有 publish.yml 在推送 v0.1.9 tag 后发布；最终结果以 GitHub Actions 和 npm registry 实际核实为准。

## 发布完成核实
- fix/compact-paintings-header 已快进合并至 main，发布提交 e8039e812d4cf794ed72d1ebec70f5ed09706a24。
- main 与 v0.1.9 标签通过 atomic push 一并推送成功。
- 发布前再次通过类型检查、30 个测试文件 / 213 项测试、构建和打包检查。
- GitHub Actions 发布成功：https://github.com/copylee711/dsh-image-gen/actions/runs/36978444414。
- main CI 和 v0.1.9 CI 均成功（36978444869、36978444379）。
- npm registry 实际确认版本 0.1.9、latest=0.1.9；发布时间为 2026-10-02 15:27:05（北京时间）。
- npm tarball HTTP 200：https://registry.npmjs.org/@copylee/dsh-image-gen/-/dsh-image-gen-0.1.9.tgz。
- 用户桌面宿主已安装插件的升级与实机集成验证不在本次发布核实范围内。
