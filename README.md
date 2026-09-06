# LX iOS 导入修复与 IPA 构建包

这是源码补丁和 GitHub Actions 构建流程，不是已经编译好的 IPA。

针对 `ashimjenning/lx-music-mobile` 的 `ios-adaptation` 分支，基准提交：
`eb382002225bdc7ee404cf99f27f59685cc95a79`。

## 已定位的问题

- `src/utils/fs.ts` 在 iOS 上不加载 Android 文件模块，原来的 `selectFile()` 因而直接返回 `null`，系统文件选择不会出现。
- 同一文件的 `unGzipFile()` / `gzipFile()` 对 iOS 直接抛出不支持的错误，压缩的 `.lxmc` 备份即使被选中也无法解压。
- 内置文件列表把 `isFile` / `isDirectory` 当作布尔值，RNFS 返回的却是方法。本补丁将 iOS 目录列表转换为调用方期待的数据格式。

## 本补丁的变化

1. 增加 `LXDocumentPicker.m`，调用 iOS 系统文件选择器。文件先经文件协调器复制到应用缓存，再交给现有的配置/音源导入逻辑处理，支持中文文件名和文件提供器。
2. 在 iOS 上强制使用系统选择器导入文件，取消选择时正常返回，读取失败时显示错误。
3. 使用项目已有的 pako 和 Buffer 依赖补齐二进制 gzip 文件压缩/解压，没有增加 npm 依赖。
4. 修正内置目录浏览器的数据格式；Android 继续调用原来的模块。

补丁修复的是文件选择与压缩文件读取，不会为原项目增加新的配置格式兼容性。原版只支持部分桌面端备份内容时，这一限制仍然存在。在线音源 URL 的网络问题、同步服务和 CarPlay 不在本次修复范围内。

## Windows 用户如何生成 IPA

1. 登录 GitHub，创建一个空的仓库，例如 `lx-ios-import-repair`。公开仓库的标准 GitHub 托管构建时间免费；私有仓库及产物存储有账户配额，参见下方官方文档。
2. 解压此构建包，将里面的 `.github`、`patches`、`scripts` 文件夹及 README、LICENSE 文件放在新仓库根目录。不要把压缩包本身上传，也不要多套一层 `lx-ios-import-repair` 目录。
3. 在仓库的 **Actions** 中启用工作流，选择 **Build LX iOS import repair → Run workflow**。
4. 等待构建结果。工作流会下载固定版本的原项目，应用补丁，安装依赖，执行检查，在 GitHub 的 macOS/Xcode 环境编译真机版本。
5. 成功后，在该次运行页面的 **Artifacts** 下载 `LXMusic-iOS-import-repair-unsigned`，解压得到 `.ipa`。
6. 在 Windows 的 Sideloadly 中使用此前安装时的 Apple ID 和 Bundle ID 设置签名并覆盖安装。不要先卸载旧应用。

该工作流只产出未签名 IPA；不需要向 GitHub 上传 Apple ID、密码或签名证书。签名仍在 Windows 的 Sideloadly 中完成，免费账号仍需续签。

使用已有仓库时，可把本包文件加入仓库根目录。该工作流会另行检出固定的上游源码，**不会编译你已有仓库里的其他源码修改**。如要继续修改 LX，请修改补丁，或把工作流改成检出你自己的源代码分支。

## 验证状态

- 已对照 GitHub blob SHA 校验所读取的原文件。
- 已通过 10 项 Node 回归检查：文件选择结果、取消、原生模块缺失、文件提供器错误、中文备份解压、gzip 跨实现互通、空数据/二进制数据、损坏文件保护、目录数据格式、Android 调用保持原行为。
- 检查中使用真实 pako 2.1.0 和 Node zlib；React Native 文件桥和 UIKit 使用模拟接口。
- 修改的 JS、TS、TSX 已通过语法解析，补丁通过 `git diff --check` 和对原文件的应用检查。
- **尚未在 macOS 上编译或在 iOS 26.6.1 真机运行。** GitHub 的首次构建可能暴露上游旧依赖与 Xcode 的兼容问题，需要根据构建日志继续处理。上述检查不等于确认手机上的 bug 已修好。

当前工作流选择 macOS 15 Intel、Xcode 16.4、Node 22、Ruby 3.2、CocoaPods 1.16.2。此处 Xcode 版本是编译工具版本；不能单凭编译通过推断 iOS 26.6.1 完全兼容。

## 真机验证

- 导入一份你原先失败的 `.js` 音源文件，确认弹出“文件”、选择成功、出现导入提示，然后手动启用音源。
- 导入支持的 `.json` 或 `.lxmc` 列表/备份，确认内容正确。若该备份包含覆盖操作，核对应用弹出的确认提示。
- 测试中文文件名、取消后重新导入、iCloud 中的文件，以及损坏文件是否能给出错误而非无反应。
- 播放一首已知可用的音源歌曲，检查后台播放和锁屏控制。

## 构建失败时

在 Actions 中打开红色的步骤，保留最早的具体报错。若已经进入 Xcode 阶段，可下载 `xcodebuild-log` 产物。不要把最后一句 `BUILD FAILED` 当作完整错误。

## 来源与许可

- [原社区分支](https://github.com/ashimjenning/lx-music-mobile/tree/ios-adaptation)
- [相同问题反馈](https://github.com/ashimjenning/lx-music-mobile/issues/2)
- [GitHub Actions 费用与配额](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub macOS 构建环境](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md)
- [Sideloadly 安装与续签说明](https://sideloadly.io/faq)

上游及补丁代码遵循随附 Apache-2.0 LICENSE；此包是独立修复草稿，不代表 LX 官方或社区分支维护者发布的版本。
