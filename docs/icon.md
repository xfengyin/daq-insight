# docs/icon.ico — 应用图标占位说明

docs/icon.ico 为 **DAQ Insight 正式应用图标 v1**（ImageMagick 生成：深蓝渐变背景 + 白色/青色波形线，寓意数据采集波形），包含多尺寸 **16/24/32/48/64/128/256**（256 为 PNG 条目、其余为 BMP），已接入 package.json 的 build.win.icon，Windows 安装包与任务栏/桌面快捷方式均使用该图标。

## 如何替换/更新图标

1. 准备 256×256（推荐）的 PNG/ICO 源图，Windows 安装包建议包含多尺寸：16/24/32/48/64/128/256；
2. 用图标工具（如 GIMP、IcoFX、ImageMagick、在线转换）导出 .ico 文件；
3. 覆盖 docs/icon.ico（保持文件名），或修改 package.json 的 build.win.icon 指向新路径；
4. 重新执行打包验证：`npx electron-builder --win --dir`，确认无图标相关报错后再执行 `npm run build:win` 产出正式安装包。

## 代码签名（可选，发布正式版建议启用）

package.json build.win 已配置证书占位（**不提交真实证书**，本地构建时通过环境变量注入）：

- `WIN_CERTIFICATE_FILE`：证书文件（.pfx/.p12）路径 → build.win.certificateFile
- `WIN_CERTIFICATE_PASSWORD`：证书密码 → build.win.certificatePassword

CI 中推荐使用 electron-builder 原生环境变量（自动识别，无需 package.json 配置）：

- `CSC_LINK`：证书 base64 或路径
- `CSC_KEY_PASSWORD`：证书密码

未配置证书时 electron-builder 自动跳过签名（产物为未签名安装包，Windows SmartScreen 会提示）。

## 当前打包配置（package.json build 字段）

- appId: com.daqinsight.app
- productName: DAQ Insight
- asar: true；files: out/**/* + package.json（不含 node_modules 开发依赖）
- win: NSIS x64，icon = docs/icon.ico（oneClick=false，允许改安装目录，创建桌面快捷方式）
- 打包验证：`npx electron-builder --dir`（linux）与 `--win --dir`（Windows 目标，Linux 上加 -c.win.signAndEditExecutable=false 跳过 wine 依赖）均已在本地跑通（app.asar 产出）；正式安装包在 Windows/CI 环境执行 `npm run build:win` 产出 NSIS。

> 注：macOS 打包需要 icns 格式与签名证书；当前 MVP 仅面向 Windows，未配置 mac 目标。
