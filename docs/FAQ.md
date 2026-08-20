# DAQ Insight 常见问题（FAQ）

> 面向终端用户与测试人员；内容与当前实现（T3–T8）保持一致。
> 相关术语详见 docs/架构.md。

## 1. 导入乱码（中文显示为乱码）

**现象**：导入 GBK 编码的 CSV（如从国产软件或旧系统导出的文件）后，中文表头/内容显示为乱码。

**原因**：文件不是 UTF-8 编码，自动检测可能判错或按 UTF-8 硬解码。

**解决**：
1. 在「检测结果」面板中手动把编码改为 **GBK**（支持 GBK/GB2312/Big5/UTF-16/UTF-8 等），
   再点「重新检测」或直接进入下一步；
2. 若仍乱码，尝试 latin1（ISO-8859-1）等编码逐个试；
3. 确认文件确实为文本格式（.csv/.tsv/.txt），Excel 另存时请选「CSV UTF-8」或「CSV（逗号分隔）」而非「CSV（MS-DOS）」。

> 提示：测试样本 tests/fixtures/samples/gbk_sample.csv 即为真实 GBK 编码文件，
> 可作为编码检测与校正的回归基准。

## 2. 分隔符识别失败（一列数据拆不开 / 全挤在一列）

**现象**：数据全部挤在第一列，或列数错乱。

**原因**：文件使用了非标准分隔符（如分号、制表符、竖线 |），或分隔符与扩展名不符
（例如文件名是 .tsv 但内容实际是分号分隔——见样本 semicolon.tsv）。

**解决**：
1. 在「检测结果」面板手动选择分隔符：逗号 / 分号 / 制表符；
2. 检查表头行数是否正确——表头行数错误会导致把表头当数据或反之；
3. 若含引号包裹的字段内嵌逗号（如 `"CH102 (TC,K)"`），程序按 CSV 引号规则解析；
   若文件未加引号导致列错位，可先在外部编辑器统一格式。

## 3. 特殊值 OVER / UNDER / OPEN / SHORT 是什么意思？

DAQ970A 导出的读数除正常数值外，可能包含以下特殊值：

| 特殊值 | 含义 | 程序处理 |
|---|---|---|
| OVER | 超量程（读数超过量程上限） | 转为 NaN，质量标记 over_range，不参与统计 |
| UNDER | 欠量程（读数低于量程下限） | 转为 NaN，质量标记 over_range，不参与统计 |
| OPEN | 开路（传感器/通道未接好） | 转为 NaN，质量标记 invalid |
| SHORT | 短路（通道短路） | 转为 NaN，质量标记 invalid |
| +9.9E37 / 9.9E37 | DAQ 超量程标准数值表示 | 识别为 over_range |
| Sensor Error | 传感器错误（引号包裹的文本） | 转为 NaN，质量标记 invalid |
| 空字段 | 该次扫描未读到读数 | 转为 NaN，质量标记 missing |

统计面板中「有效点数 / 缺失点数 / 超量程点数」即来自这些质量标记；
清洗时缺失点（missing）可插值或填充，超量程/非法点（over_range/invalid）保留为 NaN 不参与统计。

## 4. 什么是「长格式」（long）？和宽表有什么区别？

- **宽表（wide）**：一行包含全部通道，形如 `时间,CH101,CH102,CH103,...`，通常配 3 行表头
  （通道号行 / 类型行 / 单位行）。
- **长格式（long）**：一行一个通道读数，形如 `通道,读数,单位,时间戳`
  （BenchVue/PathWave 软件导出格式，见样本 standard.csv）：
  ```
  "Keysight Technologies,34970A Data Acquisition System"
  "Log File Created: 2024-01-15 10:30:00"
  Channel,Reading,Unit,Timestamp
  101,1.234567890E+00,VDC,2024-01-15 10:30:00.123
  102,2.345678901E+01,degC,2024-01-15 10:30:00.123
  ```
  程序检测到长格式后会自动**透视（pivot）**：按时间戳分组、按通道号转成列，
  同一扫描时刻的多个通道合并为一行。
- **扫描格式（scan）**：首列是扫描序号（Scan #），第二列时间戳，其余为各通道列。

三种布局均可自动识别（检测结果会显示「布局」）；识别错误时可在「通道校正」界面手动切换。

## 5. 时间戳显示为毫秒数 / 时间轴不对？

- 内部统一使用 **Unix 毫秒** 存储时间戳，界面按本地时区显示为 `YYYY-MM-DD HH:mm:ss.SSS`；
- 若原文件是欧式日期 `DD.MM.YYYY`（见样本 euro_decimal.csv）或 `MM/DD/YYYY`（前面板导出，
  日期与时间分列），程序会自动归一化；无法解析的行该点时间取 NaN 并跳过；
- 重复时间戳（同一时刻多条读数）在清洗时可勾选「去重」。

## 6. 大文件（数万行）卡顿 / 内存占用高？

- 格式侦察只读取文件**前 64KB / 前 100 行**，解析采用流式逐行转换，不整文件驻留两份；
- 图表展示默认**降采样**（最多 10 万点），预览表默认最多 1000 行；
- 测试样本 large.csv 为 5 通道 × 20000 行，可用来验证导入/解析/统计/出图性能；
- 若文件超大（>100MB），建议先拆分或确认磁盘与内存余量。

## 7. 导出的 CSV 用 Excel 打开中文乱码？

导出 CSV 默认带 **UTF-8 BOM**，Excel 可直接识别；若仍乱码，请用「数据→从文本/CSV 导入」并选择 UTF-8。
导出 Excel（.xlsx）则无此问题。

## 8. 检测结果置信度低 / 提示「未知类型」？

- 「未知类型（unknown）」意味着表头或样本数值不足以推断测量类型（常见于无表头文件或纯数字列名）；
  请在「通道定义」界面手动指定类型（DCV/ACV/TC/RTD/电阻/频率等）与单位；
- 识别顺序：通道号模式 → 类型关键字 → 单位兜底 → 数值特征；长格式只有单位列时，
  degC 无法区分热电偶(TC)与热电阻(RTD)，默认按 TC，可手动校正。

## 9. Windows 打包、签名与 CI

- 打包命令：`npm run build:win`（electron-vite build + electron-builder NSIS x64，产品名 DAQ Insight，asar 打包）；
- 应用图标：docs/icon.ico（多尺寸 16-256 正式图标 v1），已接入 build.win.icon（见 docs/icon.md）；
- 代码签名（可选）：build.win 已配置证书占位，本地用环境变量 WIN_CERTIFICATE_FILE / WIN_CERTIFICATE_PASSWORD 注入；CI 用 CSC_LINK / CSC_KEY_PASSWORD（GitHub Secrets）；未配置证书时自动跳过签名，Windows SmartScreen 会提示"未知发布者"；
- CI 工作流：.github/workflows/build-win.yml（windows-latest：npm ci → build:win → 上传 NSIS 产物；含 electron 镜像加速与缓存）；推送 v* 标签自动发布 GitHub Release；
- 本机 Linux 无法产出 NSIS 安装包（交叉打包需 wine），请在 Windows / GitHub Actions 上构建；
- Linux root 环境运行开发模式需 `ELECTRON_DISABLE_SANDBOX=1`。
