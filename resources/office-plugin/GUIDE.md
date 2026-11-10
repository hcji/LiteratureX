# LiteratureX 文献插件安装说明

插件让 WPS Writer / Microsoft Word 直接搜索本机 LiteratureX 文库，并插入引用与参考文献表。

> 使用插件时必须保持 **LiteratureX 桌面应用正在运行**。插件只访问本机 `127.0.0.1`，不上传任何文献数据。

## WPS Writer

1. 打开 LiteratureX → **设置 → 文献插件**。
2. 点击 **安装 / 更新 WPS 加载项**，确认后等待完成。
3. 完全退出并重新启动 WPS。
4. 在 WPS Writer 顶部找到 **LiteratureX** 选项卡，点击 **插入参考文献**。
5. 在任务窗格中搜索文献、勾选、点击 **插入引用**；点击 **参考文献表** 会在文末插入完整条目。

安装位置：`%APPDATA%\kingsoft\wps\jsaddons\LiteratureX_<version>`，并自动合并 `publish.xml`。
更新/卸载：在设置中点击对应按钮；卸载不会删除你的文献数据。

## Microsoft Word

Word 加载项使用本机 HTTPS 服务，需要先信任一个仅用于 `127.0.0.1` 的本地证书。

1. 打开 LiteratureX → **设置 → 文献插件**。
2. 点击 **安装 / 更新 Word 加载项**，阅读确认框后继续。
   - 程序会生成本地自签名证书，并尝试安装到当前用户的“受信任的根证书颁发机构”。
   - 如果系统拒绝，按界面提示手动执行 `certutil -user -addstore -f Root <证书路径>`。
3. 在 Word 中打开 **插入 → 获取加载项 → 我的加载项 → 上传我的加载项**。
4. 选择界面显示的 `manifest.xml`（默认位于 `%APPDATA%\LiteratureX\office-addin\manifest.xml`）。
5. 打开文献插件任务窗格，搜索并插入引用。

### 常见问题

- **Word 提示无法打开加载项**：确认 LiteratureX 正在运行；确认证书已加入“当前用户 → 受信任的根证书颁发机构”；Office 首次使用 localhost 加载项时可能提示 Edge WebView2 loopback 例外，选择允许。
- **任务窗格空白**：Office.js 从 Microsoft CDN 加载，需要网络；本机文献数据仍只在本机传输。
- **端口被占用**：插件服务默认使用 `47831`（WPS/HTTP）和 `47832`（Word/HTTPS）；关闭占用端口的程序后重启 LiteratureX。
- **WPS 中没有 LiteratureX 选项卡**：确认已重启 WPS；确认 `%APPDATA%\kingsoft\wps\jsaddons\publish.xml` 中存在 `LiteratureX` 条目。

## 引用格式

- **数字**：正文插入 `[1]`、`[1,2]`，按首次引用顺序编号；参考文献表按编号输出。
- **作者-年份**：正文插入 `(Ji et al., 2024; Lee et al., 2023)`；参考文献表按引用顺序输出完整条目。

已引用的文献 ID 会保存在当前 Word 文档（document settings）或 WPS 文档变量中；同一文档再次打开后可继续更新参考文献表。

## 隐私与安全

- 本地服务只监听 `127.0.0.1`，使用安装时生成的随机令牌。
- WPS 加载项读取本机插件配置中的令牌；Word 页面由本地服务直接注入令牌。
- 本地 HTTPS 证书只用于 `127.0.0.1` / `localhost`，不会用于其他域名。
- 插件不发送文献数据到互联网；Word 页面的 Office.js 库除外（Microsoft CDN）。
