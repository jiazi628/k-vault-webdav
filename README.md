# K-Vault WebDAV Server

基于 K-Vault 的 Cloudflare Pages WebDAV 服务端实现，让你可以通过 WebDAV 协议访问和管理存储在 Cloudflare KV 中的文件。

## 功能特性

- ✅ 完整 WebDAV 协议支持 (Class 1 & 2)
- ✅ PROPFIND - 浏览文件和文件夹
- ✅ MKCOL - 创建文件夹
- ✅ PUT - 上传文件
- ✅ GET/HEAD - 下载文件（支持 Range 断点续传）
- ✅ DELETE - 删除文件/文件夹
- ✅ COPY - 复制文件/文件夹
- ✅ MOVE - 移动文件/文件夹
- ✅ LOCK/UNLOCK - 基本锁支持
- ✅ Basic Auth 认证
- ✅ 与 K-Vault 现有存储系统兼容

## 快速部署

### 1. 准备环境

```bash
# 安装依赖
npm install

# 登录 Cloudflare
npx wrangler login
```

### 2. 创建 KV Namespace

```bash
npx wrangler kv:namespace create img_url
```

将输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "img_url"
id = "your-actual-kv-namespace-id"
```

### 3. 配置环境变量

编辑 `wrangler.toml`：

```toml
[vars]
BASIC_USER = "your-username"
BASIC_PASS = "your-password"
WEBDAV_ENABLED = "true"
```

### 4. 部署

```bash
npx wrangler pages deploy
```

## 使用方法

### 命令行 (curl)

```bash
# 列出根目录
curl -X PROPFIND -u user:pass https://your-site.pages.dev/webdav/

# 创建文件夹
curl -X MKCOL -u user:pass https://your-site.pages.dev/webdav/myfolder/

# 上传文件
curl -T file.txt -u user:pass https://your-site.pages.dev/webdav/myfolder/file.txt

# 下载文件
curl -u user:pass -O https://your-site.pages.dev/webdav/myfolder/file.txt

# 删除文件
curl -X DELETE -u user:pass https://your-site.pages.dev/webdav/myfolder/file.txt
```

### macOS Finder

1. Finder → 前往 → 连接服务器
2. 输入：`https://your-site.pages.dev/webdav/`
3. 输入用户名和密码

### Windows 资源管理器

1. 打开"此电脑"
2. 添加网络位置
3. 输入：`https://your-site.pages.dev/webdav/`
4. 输入用户名和密码

### Rclone

```bash
rclone config
# 选择 webdav
# URL: https://your-site.pages.dev/webdav/
# vendor: other
# user: your-username
# password: your-password
```

### Cyberduck

1. 新建连接
2. 协议：WebDAV (HTTPS)
3. 服务器：`your-site.pages.dev`
4. 路径：`/webdav/`
5. 用户名/密码

## 项目结构

```
├── functions/
│   ├── webdav/
│   │   └── [[path]].js      # WebDAV 主入口
│   └── utils/
│       ├── webdav-xml.js    # WebDAV XML 处理
│       └── auth.js          # 认证模块
├── public/                   # 静态文件
├── wrangler.toml            # Cloudflare 配置
└── package.json
```

## 存储结构

文件在 KV 中的存储格式：

- 文件元数据：`dav:<id>.<ext>` → 包含 fileName, fileSize, folderPath, storageType 等
- 文件夹标记：`folder:<path>` → 标记文件夹存在

## 与 K-Vault 集成

如果你想将此 WebDAV 服务与完整的 K-Vault 项目集成：

1. 将 `functions/webdav/[[path]].js` 添加到 K-Vault 的 `functions/` 目录
2. 将 `functions/utils/webdav-xml.js` 添加到 K-Vault 的 `functions/utils/` 目录
3. 确保 `wrangler.toml` 中有 KV binding

## 本地开发

```bash
npm run dev
# 访问 http://localhost:8787/webdav/
```

## 限制说明

- Cloudflare Workers 请求体限制：100MB
- KV 单值限制：25MB（仅存储元数据，不受影响）
- 实际文件内容存储在外部分发网络（Telegram/R2/S3 等）
- WebDAV 模式目前主要用于元数据管理和文件索引

## License

MIT
