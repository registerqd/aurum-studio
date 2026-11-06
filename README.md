# MOLDA · 鎏金工坊

把 **SVG 或位图（PNG / JPG / WebP）** 变成可分层的 3D 徽章、奖牌、金属牌匾，并导出可 3D 打印的实体模型。

浏览器里跑，也能装成桌面应用（Windows / macOS / Linux）。

## 核心能力

| 模块 | 说明 |
| --- | --- |
| 位图矢量化 | PNG/JPG 拖进来弹出参数面板：色板量化、渐变分层、平滑、简化、最小面积、去背景、描边，实时预览后一键导入为分层路径 |
| 渐变分层 | 平滑渐变被切成若干亮度带，每带成为独立图层，直接堆叠出浮雕厚度 |
| 分层挤出 | 每层独立厚度、倒角、材质、颜色、Z 偏移、精度；左侧结构树管理层级 |
| 模型修复 | 补破面（边界环扇形封口）、顶点焊接、去退化面、去重复面、统一法线、非流形检测、可打印性判定 |
| 导出 | GLB / USDZ / JSON 工程、透明演示 GIF / ProRes MOV、React + Three 代码片段 |
| 本地库 | IndexedDB 离线作品库；接入后端后可用文件存储 API 跨设备同步 |
| 桌面端 | Electron 打包，内置本地服务，无需联网 |

## 快速开始

```bash
npm install
npm run dev          # http://localhost:3000
```

## 桌面端

```bash
npm run electron:dev     # 开发模式，先起 npm run dev
npm run dist             # 产出当前平台安装包到 dist/
```

## 三平台安装包

跨平台安装包由 GitHub Actions 构建（`AURUM_ELECTRON=1` 启用 Next standalone 输出）：

```bash
git tag v1.1.0 && git push origin v1.1.0
```

推送 tag 后 `.github/workflows/release.yml` 会在 windows / macOS / ubuntu 三个 runner 上分别产出：

- `MOLDA-1.1.0-win-x64.exe`（NSIS 安装器，可选安装目录）
- `MOLDA-1.1.0-win-arm64.exe`
- `MOLDA-1.1.0-mac-x64.dmg` / `-arm64.dmg`
- `MOLDA-1.1.0-linux-x64.AppImage` / `.deb`

产物自动挂到对应 GitHub Release。

> macOS 未签名时首次打开需在「系统设置 → 隐私与安全性」里允许；正式分发建议配置 Apple Developer ID 与 Windows 代码签名证书（仓库 Secrets 提供 `CSC_LINK` / `CSC_KEY_PASSWORD`）。

## 后端 API

可选，纯文件存储，零外部依赖：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/works` | 作品列表 |
| POST | `/api/works` | 保存作品（新建或覆盖） |
| GET | `/api/works/:id` | 读取作品 |
| PUT | `/api/works/:id` | 更新作品 |
| DELETE | `/api/works/:id` | 删除作品 |

数据目录默认 `./.aurum-data/works`，可用 `AURUM_DATA_DIR` 覆盖；桌面端默认落在用户数据目录。

## 目录

```
app/                 路由、设计层（aurum.css）、API
components/          工作台、位图导入弹窗、修复面板、导出队列
lib/                 png-to-svg 追踪、mesh-repair、建模与导出管线
electron/            主进程与 preload
electron-builder.yml 三平台打包配置
.github/workflows/   多平台发布流水线
```

## 许可

MIT，见 `LICENSE`。第三方组件声明见 `THIRD_PARTY_NOTICES.md`。
