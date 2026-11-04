<!-- 版权所有：波哥 -->
# 禅阅

禅阅提供独立 iOS App 工程和网页版 PWA，使用 React、TypeScript、Vite、Capacitor 和 PDF.js。无需后端，书籍解析在本机完成。

## 安装独立 iPhone App

`ios/App/App.xcodeproj` 是真实 iOS 原生工程，不是 Safari 主屏幕书签。界面、PDF 引擎/工作线程/字库、示例书都内置在安装包，首次启动也无需网络。运行时不需要电脑、HTTP 服务或预先缓存。

### Windows 免费方案：GitHub 公开仓库云编译 + 本机免费签名

无需购买 Mac 或 Apple Developer Program。**免费签名通常只有 7 天有效期，需要定期联网刷新；并非一次安装后永久离线可用。** 运行期间无需电脑保持开机。当前只准备了本地构建配置，尚未上传源码、执行 GitHub 构建或生成经过真机验证的 IPA。

#### 1. 准备 GitHub 公开仓库

- 已选择公开源码方案。当前工作流只允许**公开仓库**手动运行，使用标准 `macos-15-intel` runner；私有仓库会跳过，避免消耗私有仓库额度。不使用付费大规格 runner。
- 根据 [GitHub Actions 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)，公开仓库的标准托管 runner 可免费使用。不要添加付款方式、提高存储额度或启用额外付费服务；若平台提示费用，先停止并核对，不改用付费 runner。
- 创建仓库时选择 **Public**。推荐使用 [GitHub Desktop](https://desktop.github.com/) 选择本项目所在文件夹，检查待提交文件后发布；如果使用 Publish repository，取消 **Keep this code private**，发布后核对为 **Public**。任何人都能查看公开源码，因此必须先检查待上传内容。
- 如果先在 GitHub 网页创建空仓库，建议名称为 `chanyue`，不要初始化 README、`.gitignore` 或 License，以免与本地已有文件冲突。仓库创建后记下地址，例如 `https://github.com/你的用户名/chanyue`。
- 不要直接拖拽整个项目到网页上传：网页上传不应用 `.gitignore`，还容易遗漏 `.github`。当前尚未替你创建仓库或上传文件。
- 必须包含 `.github/workflows/ios-unsigned.yml`、`ios` 原生源码及共享 scheme、`src`、`scripts`、`tests`、`public` 原始图标、`package.json`、`package-lock.json` 和根目录构建配置。不要上传 `node_modules`、`dist`、`dist-native`、`artifacts`、`public/pdf-assets`、`ios/App/App/public` 等可重建内容。
- `.gitignore` 已排除 `.codebuddy`、环境变量、签名材料和构建产物。`.codebuddy` 是项目数据，保留在本机，不删除。忽略规则不会撤回已跟踪文件，也不是敏感信息审计；发布前仍须检查暂存内容。
- 不要上传自己的书籍、Apple ID 密码、GitHub Token 或证书私钥。本流程不需要任何 Apple Secrets。无需配置付款方式或开启超额付费；若 GitHub 提示收费/付款验证，先停止并核查，不要改成付费 runner。

#### 2. 手动构建和下载安装包

1. 确保工作流文件已在仓库默认分支。打开仓库的 **Actions → 禅阅 · 免费构建 iPhone 安装包 → Run workflow**。
2. 确认并勾选源码公开与未签名产物提示，然后运行。私有仓库或未勾选时会跳过构建，不产生安装包。
3. 等待任务变绿。云端将安装 Node.js 依赖、选择 Xcode 26、同步离线资源、编译 iPhone ARM64 Release 程序，不登录 Apple 账号、不请求签名证书。
4. 在本次运行页面的 **Artifacts** 下载 `chanyue-unsigned-iphone`，解压下载的外层 ZIP，得到 `Chanyue-unsigned.ipa`。**不要再解压 IPA，也不能点击 IPA 直接安装。** 产物仅保留 3 天，请保存到自己的电脑。
5. 如果任务失败，查看首个失败步骤；编译日志会尝试保存为 `chanyue-ios-build-log`。提供错误片段即可排查，不要提供账户密码。日志产物用于诊断，不代表已经构建成功。

#### 3. Windows 免费签名安装

1. 按 [AltStore Classic 官方 Windows 安装指南](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows) 安装 AltServer；根据该指南准备 Apple 官方版本的 iTunes/iCloud，不购买收费签名服务。请核实下载源，不运行来历不明的修改版安装器。
2. 用数据线连接 iPhone、解锁并信任自己的电脑，按指南开启 Wi-Fi 同步。通过 AltServer 的 **Install AltStore** 安装 AltStore Classic。
3. 在你自己的可信工具窗口输入免费 Apple ID，按手机提示信任开发者；iOS 16+ 通常还需启用开发者模式。**Apple ID 密码只由你在本机输入，不发给助手或 GitHub。**
4. 将 `Chanyue-unsigned.ipa` 保存到 iPhone 的「文件」中。打开 AltStore Classic → **My Apps → +** 选择 IPA，并保持手机能连接正在运行的 AltServer，完成签名和安装。若当前版本界面不同，以官方说明为准。
5. 安装成功后先完成系统要求的联网信任/验证，再开启飞行模式打开禅阅。阅读引擎、中文 PDF 字库和示例书均在包内。尚未下载的 iCloud 书籍需要先保存到本机。

#### 4. 每周刷新，不必重新云编译

- 建议每 5–6 天刷新一次，避免等到第 7 天过期。过期后 App 可能无法打开，这不代表阅读功能需要联网。
- 在自己的 Windows 上打开 AltServer，电脑与 iPhone 连接同一可信 Wi-Fi，或使用 USB。保持联网，在 AltStore 的 **My Apps → Refresh All** 刷新，确认剩余有效期更新。
- 每周只是刷新已有 App 的签名，**不需要重新上传源码、跑 GitHub 构建或生成新 IPA**。不要为了续签删除禅阅，否则可能丢失本机书库。
- 免费账户的侧载应用数量有限。安装失败时先检查名额、有效期及设备连接，不要付费绕过提示。升级 iOS、AltServer 或 Apple 签名政策变化可能影响安装，请以实际错误和官方指南为准。

工作流配置位于 `.github/workflows/ios-unsigned.yml`，打包脚本位于 `scripts/build_unsigned_ios.py`。当前只完成配置与本地校验；只有云端任务成功并在 iPhone 验收后，才能确认实际安装可用。

### 在 Mac 上编译和安装（可选）

1. 准备能运行 **Xcode 26.0+** 的 Mac、Node.js 24、Apple ID 和 iPhone。Capacitor 8 的最低系统配置为 iOS 15；实际兼容性仍需在目标系统真机验收，建议使用较新的 iOS。
2. 将**整个项目**复制到 Mac（保留 `ios`、源码和 `public`，无需复制 Windows 的 `node_modules`），在项目根目录执行 `npm ci`。
3. 执行 `npm run ios:sync`：构建 `dist-native`、验证离线资源、同步插件和本地资源到 `ios/App/App/public`。不要重新运行 `cap add ios`，工程已存在。
4. 执行 `npm run ios:open`，或用 Xcode 打开 `ios/App/App.xcodeproj`。SPM 会在构建时下载依赖；**这是开发构建需要网络，不是 App 运行需要网络**。
5. 在 Xcode 的 App target → Signing & Capabilities 勾选 Automatically manage signing，选择自己的 Team。默认 Bundle ID 是 `app.chanyue.reader`；如与签名账户冲突，改成你自己的唯一标识，并同步更新 `capacitor.config.ts`。不要把 Apple 密码或证书私钥写入项目。
6. 连接 iPhone、信任 Mac，按系统提示启用开发者模式，选择该设备后点击 Run。安装完成后即可断开电脑，打开飞行模式独立使用。

**Windows 不能运行 Xcode 编译 iOS 原生代码，但可通过 AltServer 等工具给云端编译出的 IPA 进行本机侧载签名。当前提供工程和云构建配置，不等于已经生成已签名 `.ipa`，也不代表已通过 App Store 审核。** 免费 Personal Team 安装通常需要定期重新签名，不能保证永久使用；TestFlight 安装也有有效期。正式长期分发请使用 Apple Developer Program 和适合的分发渠道。构建/签名/首次分发可能联网，阅读功能不联网。

### 原生存储与导入

- 正文放在 App 的 `Library/Chanyue/books` 私有文件夹，不是 WebView 缓存；设置和阅读进度使用 iOS UserDefaults（Preferences 插件）。
- App 不主动上传或跨设备同步；是否参与系统/iCloud 备份由用户的 iPhone 备份设置决定。卸载 App 会删除本机数据，请保留原始文件。
- 从「导入 → 文件 → 我的 iPhone」选择 TXT、DOCX、文字型 PDF。未下载的 iCloud 文件仍需联网下载，离线导入请提前存到手机上。
- 网页版与独立 App 的存储隔离，原有网页书架不会自动迁移，需要重新导入。
- 工程包含中文名称、横竖屏配置、禅阅 App 图标和 `PrivacyInfo.xcprivacy`（文件时间戳及 UserDefaults 理由声明）。
- 原生资源与 PWA 分开构建；发布配置没有 `server.url`，原生页面禁用 Service Worker，并通过 CSP 限制外部资源。

### 真机离线验收

安装后**首次启动前**开启飞行模式：打开 App → 导入三种本地文件 → 设置最高速度 1600 → 横竖屏阅读 → 锁屏/切后台 → 重开确认进度和设置 → 删除/重命名。还需检查设备字体、文件选择器、刘海安全区、iOS 隐私清单与签名；Windows 下的 WebKit 模拟不能替代这些验收。

## 启动网页版

推荐 Node.js 24。首次运行 `npm install`，然后运行 `npm run dev`，打开终端显示的网址（默认 `http://localhost:5173`）。

`npm run build` 生成 `dist`；`npm run preview` 预览生产版本（默认端口 4173）。将 `dist` 部署到 HTTPS 网站根目录，即可在 iPhone Safari 中通过「分享 → 添加到主屏幕」使用。

手机与电脑连接相同 Wi-Fi 后，可用电脑的局域网 IP 和开发端口测试，例如 `http://电脑局域网IP:5173`。手机上的 localhost 不指向电脑；防火墙需允许开发端口。局域网 HTTP 开发访问不支持离线安装，完整 PWA 体验需要 HTTPS。

## 功能

- 中央单行从右向左连续滚动，相邻阅读行直接拼接，不插入空格或换行等待；保留正文中的英文单词空格。支持开始／停止、后退一行、前进一行，读完停止，可重新阅读。
- 手机横竖屏布局自动切换。需关闭 iPhone 的竖排方向锁定；网页不会强行锁定方向。
- 设置宋体／黑体／楷体、字号、文字颜色、文字带背景、页面背景及 15–1600 px/秒的流动速度（最高速度是旧版的十倍）。字体按设备可用字体回退。
- 书架支持批量导入、搜索、排序、阅读状态筛选、重命名和确认删除。
- 网页版使用 IndexedDB 与 localStorage；独立 iOS 版使用私有文件夹与 Preferences。内容仅以纯文本渲染。
- 独立 iOS 版资源随包安装、首次启动无需联网；PWA 则需先联网完成缓存。开发模式不注册 Service Worker。
- 包含三篇原创示例短文，可删除；删除全部书籍后不会重复生成示例。

## 支持格式与边界

- **TXT**：UTF-8、GB18030、带 BOM 的 UTF-16 LE/BE。
- **Word**：`.docx` 正文和表格单元格的文字。不支持旧二进制 `.doc`、加密文档或保留原排版；旧 `.doc` 需在 Word 中另存为 `.docx`。
- **PDF**：可提取文字的 PDF，包括常见中文编码。扫描件先用 OCR 转为文字型 PDF；加密 PDF 需先解除保护。复杂分栏的阅读顺序以 PDF 提取顺序为准。
- 单文件最多 20 MB，正文最多 200 万 UTF-16 码元，PDF 最多 2000 页，每批最多 10 本；Word 解压大小上限 80 MB。
- 阅读行按原文换行和中文句子拆分，过长的内容按 Unicode 字符进一步切分，不等同于 Word/PDF 的视觉排版行。
- App 无账号及应用级跨设备同步/云备份；原生数据可能参与用户启用的 iPhone 系统备份。清除网页数据或卸载 App 会影响对应书库，请保留原始文件。导入后的书籍只保存提取的文字。
- WebKit 模拟测试不等于 iPhone 真机测试；正式使用前建议在目标 iPhone 上验收安全区、系统字体及主屏幕模式。

## 验证

- `npm test`：22 项测试，包括分行、编码、设置、导入限制和原生存储适配器（Filesystem/Preferences 使用模拟插件，并非真机）。
- `python -m unittest discover -s tests -p test_ios_packaging.py -v`：7 项云打包脚本测试，覆盖真机目标、未签名参数、Xcode 选择、失败退出码、IPA 文件结构及执行权限；不代表已完成 Xcode 编译。
- `python scripts/build_unsigned_ios.py --check-only`：Windows 可执行的源码完整性与共享 scheme 检查。真正的归档需在 GitHub macOS 构建机运行。
- `npm run build`：严格 TypeScript 检查和网页生产构建。
- `npm run build:ios` / `npm run ios:check`：构建/检查原生离线资源；`npm run ios:sync` 同步到 Xcode 工程。上述命令不是 iOS 二进制编译。
- `python tests/native_offline.py`：不启动服务器，用包内文件拦截资源请求，在全新上下文验证 TXT/DOCX/中文 PDF 首次导入及重启。Chromium 使用 `offline=True`；Windows WebKit 因离线导航拦截内核错误，改用只提供包内资源并阻断其他请求。此测试不验证原生文件选择器、签名或真实 WKWebView 桥接。
- `npm audit --omit=dev`：生产依赖安全检查。
- 浏览器测试：安装 Python 的 `playwright` 包及 Chromium / WebKit 浏览器，先启动 `npm run preview`，再执行 `python tests/e2e.py http://localhost:4173`。覆盖真实格式导入、右向左运动、暂停、切行、续读、读完重读、书籍管理、纯文本安全渲染、离线 PDF 和手机横竖屏。截图输出到 `artifacts`。

源码首行含版权注释。`package.json` 不支持注释，使用首行 `"//"` 版权字段；自动生成文件、第三方资源和二进制图片保持原生格式。
