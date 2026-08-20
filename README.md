# DAQ Insight

DAQ970A / 34970A 数据采集仪导出数据的智能处理桌面工具：自动分列、类型识别、数据清洗、统计分析与可视化，中文界面，面向 Windows。

> 技术栈：Electron + React + TypeScript + ECharts + Vite（electron-vite）；测试：Vitest。
> 架构细节见 [docs/架构.md](docs/架构.md)，常见问题见 [docs/FAQ.md](docs/FAQ.md)。

## 功能特性（MVP P0）

**导入与格式侦察**
- 拖拽 / 文件对话框导入 CSV、TSV、TXT
- 自动检测编码（UTF-8 / GBK / Big5 / UTF-16 等，GBK 中文样本见 tests/fixtures/samples/gbk_sample.csv）
- 自动检测分隔符（逗号 / 分号 / 制表符）、表头行数、小数点风格（. / ,）
- 识别三种数据布局：**宽表（wide）**、**长格式（long，BenchVue 导出，自动 pivot）**、**扫描格式（scan）**
- 识别 BenchVue 引号元信息行（设备行 / 日志行）并自动跳过

**通道与类型识别**
- 多行表头按列合并解析（通道号行 / 类型行 / 单位行）
- 通道号、测量类型（DCV/ACV/DCI/ACI/TC/RTD/2W/4W 电阻/频率/周期）、单位自动识别
- 列名内嵌类型（如 `Ch101 (DCV)`）、引号内嵌逗号均可处理
- 识别结果可手动校正（表头行数 / 布局 / 类型 / 单位）

**解析、清洗与分析**
- 科学计数法（`1.234567890E+00`）、欧式小数（`10,523`）、多格式时间戳归一化
- 特殊值处理：OVER/UNDER/OPEN/SHORT/`+9.9E37`/Sensor Error/空字段 → NaN + 质量标记（over_range/invalid/missing）
- 数据清洗：缺失值插值/前向填充/删除行、异常值（IQR/Z-score）、重复时间戳去重
- 统计分析：均值 / 标准差 / 极值 / RMS / 有效数 / 缺失数 / 超量程数，采样率与时间跨度

**可视化与导出**
- ECharts 时域波形（多通道叠加/分屏、缩放平移、大数据量降采样 ≤10 万点）
- 数据预览表（≤1000 行，NaN 显示 "--"）
- 导出 CSV（UTF-8 BOM）/ Excel / 图表 PNG

## 使用指南

1. **导入**：拖拽或选择 CSV/TSV/TXT 文件；
2. **检测与校正**：查看格式侦察结果（编码 / 分隔符 / 表头行数 / 布局 / 小数点），如有误可手动修正并重新检测；
3. **通道定义**：确认或校正各通道的名称 / 测量类型 / 单位；
4. **预览与清洗**：查看数据预览，按需开启清洗（缺失插值、异常标记、去重）；
5. **分析与可视化**：查看统计面板与波形图，缩放平移浏览；
6. **导出**：导出 CSV / Excel 结果。

### 界面截图（占位）

> 正式发布前补充以下截图（docs/screenshots/ 目录）：
> - `01-import.png`：文件导入与格式侦察结果
> - `02-channels.png`：通道定义与类型校正
> - `03-preview.png`：数据预览表
> - `04-analysis.png`：统计面板与波形图
> - `05-export.png`：导出对话框

## 开发环境

- Node.js ≥ 20，npm（本仓库在 Node 24 验证）
- 安装依赖（国内镜像加速）：
  ```bash
  export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  npm install
  ```
- Linux root 环境运行 Electron 需禁用沙箱：`ELECTRON_DISABLE_SANDBOX=1 npm run dev`

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发模式（Electron + 热更新） |
| `npm run build` | 构建三端产物到 out/ |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 运行单元/集成测试（Vitest） |
| `npm run gen:fixtures` | 生成 DAQ970A 模拟测试样本（确定性，可重现） |
| `npm run build:win` | 构建 Windows 安装包（NSIS x64） |

打包配置校验（不产出安装包）：
```bash
npx electron-builder --dir          # 当前平台解包目录
npx electron-builder --win --dir    # Windows 目标解包目录（Linux 上需 -c.win.signAndEditExecutable=false 跳过 wine 依赖）
```

## 持续集成（CI）

.github/workflows/build-win.yml 提供 Windows 安装包自动构建（GitHub Actions）：

- 触发：推送 main / `v*` 标签 / 手动触发（workflow_dispatch）；
- 流程：checkout → setup-node 20（npm 缓存）→ 设置 electron 镜像加速 → 缓存 electron-builder → `npm ci` → `npm run build:win` → 上传 NSIS 产物（dist/*.exe、blockmap、latest.yml）；
- 签名：仓库 Secrets 配置 `CSC_LINK`（证书 base64/路径）与 `CSC_KEY_PASSWORD` 即启用 Authenticode 签名，未配置自动跳过；
- 发布：推送 `v*` 标签自动创建 GitHub Release 并附带安装包。

## 项目结构

```
daq-insight/
├── electron/            # 主进程 + preload（IPC 桥，通道名见 src/shared/ipc.ts）
├── core/                # 核心引擎（与 UI 无关的纯逻辑）
│   ├── models.ts        # 共享数据模型（契约）
│   ├── detection/       # ①格式侦察（编码/分隔符/表头/布局/preamble）
│   ├── parsing/         # ②表头解析 + ④数据解析与标准化
│   ├── identification/  # ③通道/类型识别
│   ├── cleaning/        # ⑤数据清洗
│   ├── analysis/        # ⑥统计分析
│   └── export/          # 导出（CSV/Excel）
├── src/                 # React 渲染进程（中文 UI）
│   └── shared/          # ipc.ts（IPC 通道名/类型唯一事实来源）+ types.ts
├── tests/               # vitest 单元/集成测试 + fixtures 样本
│   ├── fixtures/        # generator.ts + samples/*.(csv|tsv|txt) + 各 .meta.json
│   └── integration/     # pipeline.test.ts（全样本六阶段集成测试）
└── docs/                # 架构.md / FAQ.md / icon.md
```

## 测试与样本

- 单元测试：detection / parser / identification / analysis / export / models / edge-cases
- 集成测试：tests/integration/pipeline.test.ts 以 `tests/fixtures/samples/` 下 **12 个真实形态样本**（standard、semicolon.tsv、tab.txt、gbk_sample、euro_decimal、special_values、no_header、english_header、large、dirty、scan_format、read_query）为基准，逐一断言 检测 → 表头 → 解析 → 统计 与各 .meta.json 期望一致，另含导出往返与清洗阶段；
- 每个样本附 `.meta.json`（期望编码/分隔符/表头行数/通道数/类型/行数），是解析与识别测试的断言基准；
- 样本由 generator.ts 确定性生成（重复执行 sha256 一致），便于回归。

## 已知限制

- **打包**：Linux 上交叉打包 Windows 目标需要 wine（rcedit/签名步骤）；正式发布请在 Windows/CI 执行 `npm run build:win`（CI 见 [.github/workflows/build-win.yml](.github/workflows/build-win.yml)）；未配置签名证书时安装包为未签名（SmartScreen 会提示）；
- **签名**：build.win 已配置证书占位（WIN_CERTIFICATE_FILE / WIN_CERTIFICATE_PASSWORD 环境变量注入，CI 用 CSC_LINK / CSC_KEY_PASSWORD），真实证书不入库（见 [docs/icon.md](docs/icon.md)）；
- **图标**：docs/icon.ico 为正式图标 v1（多尺寸 16-256），如需更换见 [docs/icon.md](docs/icon.md)；
- **root 环境**：Linux 下以 root 运行 Electron 需 `ELECTRON_DISABLE_SANDBOX=1`；
- **类型识别**：长格式仅有单位列时 degC 无法区分热电偶(TC)与热电阻(RTD)，默认按 TC，需手动校正；无表头/纯数字列名文件识别为 unknown；
- **大文件**：侦察只读前 64KB，预览 ≤1000 行，图表降采样 ≤10 万点；超大文件（>100MB）建议拆分导入；
- **格式支持**：仅文本（CSV/TSV/TXT），Excel 文件（xlsx）不在 MVP 导入范围（导出支持 xlsx）。

## 文档

- [docs/架构.md](docs/架构.md) — 六阶段流水线、核心模块、IPC 通道表、扩展点
- [docs/FAQ.md](docs/FAQ.md) — 常见问题（编码乱码 / 分隔符 / 特殊值 / 长格式 / 大文件等）
- [docs/icon.md](docs/icon.md) — 应用图标（多尺寸 ICO）与代码签名说明
