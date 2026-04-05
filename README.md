# K-Vault WebDAV Server

基于 K-Vault 的 Cloudflare Pages WebDAV 服务端，支持通过 WebDAV 协议管理文件。

## 一键部署

### 方式一：Cloudflare Pages（推荐）

1. **Fork 此仓库** 或直接使用
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages**
3. 选择 **Connect to Git** → 选 `k-vault-webdav`
4. 设置：
   - **Build command**: 留空
   - **Build output directory**: `public`
   - **Deploy command**: 留空
5. 创建 KV namespace：**Workers & Pages** → **KV** → **Create** → 命名 `img_url`
6. 绑定 KV：Pages 项目 → **Settings** → **Functions** → **KV namespace bindings** → 添加 `img_url`
7. 设置环境变量（可选）：
   - `BASIC_USER`: 用户名
   - `BASIC_PASS`: 密码
8. 点击 **Save and Deploy**

### 方式二：本地一键脚本

```bash
# 安装依赖
npm install

# 登录 Cloudflare
npx wrangler login

# 一键部署（自动创建 KV、设置凭据、部署）
npm run setup
```

## 使用方法

部署后访问 `https://k-vault-webdav.pages.dev` 使用 Web 界面。

### WebDAV 客户端连接

| 客户端 | 地址 |
|--------|------|
| macOS Finder | `https://k-vault-webdav.pages.dev/webdav/` |
| Windows | 添加网络位置 `https://k-vault-webdav.pages.dev/webdav/` |
| Rclone | `https://k-vault-webdav.pages.dev/webdav/` |
| Cyberduck | WebDAV (HTTPS) → `k-vault-webdav.pages.dev` → `/webdav/` |

### curl 示例

```bash
# 列出文件
curl -X PROPFIND -u user:pass https://your-site.pages.dev/webdav/

# 上传文件
curl -T file.txt -u user:pass https://your-site.pages.dev/webdav/file.txt

# 下载文件
curl -u user:pass -O https://your-site.pages.dev/webdav/file.txt

# 创建文件夹
curl -X MKCOL -u user:pass https://your-site.pages.dev/webdav/myfolder/

# 删除文件
curl -X DELETE -u user:pass https://your-site.pages.dev/webdav/file.txt
```

## 项目结构

```
├── functions/
│   ├── webdav/
│   │   └── [[path]].js      # WebDAV 主入口
│   ├── utils/
│   │   ├── webdav-xml.js    # WebDAV XML 处理
│   │   └── auth.js          # 认证模块
│   └── _middleware.js       # CORS 中间件
├── public/
│   └── index.html           # Web 前端界面
├── wrangler.toml            # Cloudflare 配置
├── setup.mjs                # 一键部署脚本
└── package.json
```

## 功能

- ✅ PROPFIND / MKCOL / PUT / GET / DELETE / COPY / MOVE / LOCK / UNLOCK
- ✅ Basic Auth 认证
- ✅ Range 断点续传
- ✅ Web 文件管理界面
- ✅ 拖拽上传

## License

MIT
