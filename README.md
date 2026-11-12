# UU Filer

本地优先的批量文件管理桌面工具。Tauri 2 + Rust + React / TypeScript，支持 Windows 与 macOS。

## 核心功能

- **批量重命名**：查找替换、前后缀、大小写、去空格、编号、正则、位置编辑、字段提取、模板、条件分支、日期转换等 28 类规则入口，可叠加排序、单独启停，支持名称互换和大小写变化。
- **复制 / 移动**：独占创建目标，SHA-256 校验，移动在校验通过后删除源文件，已有目标不覆盖。
- **预览与冲突检测**：执行前逐文件预览且可编辑，重名阻止执行。
- **操作记录与撤销**：SQLite 记录每一步，支持撤销和中断后的尽力恢复。
- **命名方案**：保存规则顺序与参数，载入时追加到当前规则，不覆盖。
- **AI 辅助命名**：自然语言生成规则草案，或按文件生成名称；支持本地 Ollama 与兼容 OpenAI 的 HTTPS 服务。
- **隐私控制**：按文件 / 目录设置 AI 权限，默认仅本地；「禁止 AI」连文件名也不发送，完整源路径不进入请求，API Key 存在系统凭据库。
- **外观**：浅色 / 深色 / 跟随系统，可调强调色、面板宽度与列表密度。

## 开发

需要 Node.js 22+、npm、稳定版 Rust 和 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。Windows 另需 VS C++ Build Tools 与 WebView2，macOS 需 Xcode Command Line Tools。

```sh
npm ci
npm run desktop   # 桌面开发（带 desktop feature）
npm run dev       # 仅浏览器预览界面，只读文件属性，不操作磁盘
```

`npm run tauri dev` 不带 `desktop` feature，会报 `requires the features: desktop`，请用 `npm run desktop`。

## 检查与打包

```sh
npm run build          # tsc + vite
npm test               # vitest
npm run test:core      # Rust 引擎测试
npm run test:e2e       # 需先 npx playwright install chromium
npm run desktop:build  # 生成未签名安装包，需在对应系统构建
```

## 数据与安全

- 数据目录：Windows `%APPDATA%\app.uufiler.desktop`，macOS `~/Library/Application Support/app.uufiler.desktop`，内含 `uu-filer.sqlite` 和窗口尺寸记录。
- 重命名依赖同文件系统的硬链接暂存；不支持时停止并保留源文件。不要手动删除 `.uu-filer-*` 暂存文件。
- 所有操作先预览。日志不是跨文件系统事务，失败后停止，可在「操作记录」中尝试恢复。
- 首次使用请先用文件副本测试，重要文件保留独立备份。

## 尚未实现

Office 正文提取、扫描 PDF 的 OCR、音视频转写、自动分类、EXIF / 音频标签、CSV 映射、关联文件联动、拼音转换、目录改名、任务取消与断点续跑。

## 文档

- [重命名规则指南](docs/rename-rules.md)
