# DAQ970A 测试样本（tests/fixtures）

由 `generator.ts` 确定性生成（mulberry32 种子随机，重复生成结果一致）。
重新生成：`npm run gen:fixtures`（tsx）或 `node tests/fixtures/generator.ts`（Node ≥ 23.6 原生 TS）。

## 样本清单与元数据摘要

| 文件 | 编码 | 分隔符 | 表头行 | 通道数 | 通道类型 | 数据行 | 时间戳格式 | 说明 |
|------|------|--------|--------|--------|----------|--------|------------|------|
| standard.csv | UTF-8 | 逗号 | 3 | 4 | DCV / TC Type K / RTD PT100 / FREQ | 300 | YYYY-MM-DD HH:mm:ss.SSS | 基准样本，多行表头 |
| semicolon.tsv | UTF-8 | 分号 | 3 | 4 | 同上 | 300 | 同上 | 扩展名为 .tsv 但实为分号分隔 |
| tab.txt | UTF-8 | 制表符 | 3 | 4 | 同上 | 300 | 同上 | 扩展名为 .txt 但实为制表符分隔 |
| gbk_sample.csv | **GBK** | 逗号 | 1 | 9 | DCV(×9) | 50 | 无 | 中文单行表头「通道,读数,单位」，长格式，通道号循环 CH101-CH109 |
| euro_decimal.csv | UTF-8 | 分号 | 3 | 4 | 同上 | 100 | DD.MM.YYYY HH:mm:ss | 小数点为逗号（欧式） |
| special_values.csv | UTF-8 | 逗号 | 3 | 4 | 同上 | 60 | YYYY-MM-DD HH:mm:ss.SSS | 含 OVER/UNDER/OPEN/SHORT/空白 |
| no_header.csv | UTF-8 | 逗号 | 0 | 4 | 同上 | 100 | 同上 | 无表头，首行即数据 |
| english_header.csv | UTF-8 | 逗号 | 1 | 4 | 同上 | 300 | 同上 | 单行英文表头，列名内嵌类型；CH102 (TC,K) 含**未加引号嵌入逗号**（表头朴素切分为 6 列） |
| large.csv | UTF-8 | 逗号 | 3 | 5 | DCV/TC K/RTD PT100/FREQ/ACV | 20000 | 同上 | 性能验证大样本 |
| dirty.csv | UTF-8 | 逗号 | 3 | 4 | 同上 | 120 | 同上 | 重复时间戳(3 处)、空字段(6 处)、参差行(1 处)、字段空白 |

## .meta.json 契约

每个样本文件旁有同名 `.meta.json`，字段：
`name`（文件名）、`encoding`（utf-8|gbk）、`delimiter`（comma|semicolon|tab）、
`headerRows`（表头行数）、`channelCount`（通道数，不含时间戳列）、
`channelTypes`（各列测量类型）、`units`（各列单位）、`rowCount`（数据行数）、
`timestampFormat`（时间戳格式，无则 null）、`decimalSeparator`（. 或 ,）、
`issues`（脏数据说明，special_values/dirty 有）、`notes`（补充说明）。

解析/检测模块的测试断言应以 `.meta.json` 为期望值基准。

## 注意事项（解析器易踩坑）

1. `standard/semicolon/tab` 的三行表头首列是 `Time`，第二、三行首列为空（时间戳列无类型/单位）。
2. `english_header.csv` 表头 `CH102 (TC,K)` 未加引号，含嵌入逗号——朴素按逗号切分表头得 6 列，而数据行 5 列；需按「数据行列数」反推或识别括号内的类型。
3. `gbk_sample.csv` 是真正的 GBK 字节（非 UTF-8），按 UTF-8 解码会失败。
4. `euro_decimal.csv` 小数点是逗号、分隔符是分号、日期是 DD.MM.YYYY，三种欧式特征叠加。
5. `dirty.csv` 第 65 行仅 4 列（参差行）、第 15 行行尾多余逗号、第 85 行字段前导空格。

## 运行时 API

`generator.ts` 导出：`generateStandard/generateSemicolon/generateTab/generateGbk/
generateEuroDecimal/generateSpecialValues/generateNoHeader/generateEnglishHeader/
generateLarge/generateDirty`（各自返回 `{ name, content, meta }`）、`generateAll()`、
`allMeta()`、`writeSamples(outDir?)`、`encodeGbk()`、`mulberry32()`、
`timestampAt()`、`DEVICE_LINE`、`BASE_TIME`、`SAMPLE_INTERVAL_MS`。
