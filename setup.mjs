#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const PROJECT_NAME = 'k-vault-webdav';
const KV_BINDING = 'img_url';

console.log('🚀 K-Vault WebDAV 一键部署\n');

// Step 1: Check wrangler login
console.log('📋 Step 1: 检查 Cloudflare 登录状态...');
try {
  execSync('npx wrangler whoami', { stdio: 'inherit' });
} catch (e) {
  console.log('⚠️  未登录，请先运行: npx wrangler login');
  process.exit(1);
}

// Step 2: Get account ID
console.log('\n📋 Step 2: 获取 Account ID...');
const whoamiOutput = execSync('npx wrangler whoami --json 2>/dev/null || true').toString();
let accountId = '';
try {
  const data = JSON.parse(whoamiOutput);
  accountId = data?.account?.[0]?.id || '';
} catch {}

if (!accountId) {
  const accountsOutput = execSync('npx wrangler whoami 2>/dev/null').toString();
  const match = accountsOutput.match(/([a-f0-9]{32})/);
  accountId = match ? match[1] : '';
}

if (!accountId) {
  console.log('❌ 无法获取 Account ID');
  process.exit(1);
}
console.log('✅ Account ID:', accountId);

// Step 3: Create or find KV namespace
console.log('\n📋 Step 3: 创建/查找 KV namespace...');
const kvListOutput = execSync(`npx wrangler kv:namespace list 2>/dev/null`).toString();
let kvId = '';
try {
  const namespaces = JSON.parse(kvListOutput);
  const existing = namespaces.find(ns => ns.title.includes(KV_BINDING) || ns.title.includes(PROJECT_NAME));
  if (existing) {
    kvId = existing.id;
    console.log('✅ 找到已有 KV namespace:', existing.title, '→', kvId);
  }
} catch {}

if (!kvId) {
  console.log('📦 创建 KV namespace...');
  const createOutput = execSync(`npx wrangler kv:namespace create "${KV_BINDING}" 2>&1`).toString();
  const idMatch = createOutput.match(/"id"\s*:\s*"([a-f0-9]+)"/);
  if (idMatch) {
    kvId = idMatch[1];
    console.log('✅ KV namespace 创建成功:', kvId);
  } else {
    console.log('❌ 创建 KV namespace 失败');
    console.log(createOutput);
    process.exit(1);
  }
}

// Step 4: Update wrangler.toml
console.log('\n📋 Step 4: 更新 wrangler.toml...');
let wrangler = readFileSync('wrangler.toml', 'utf8');
wrangler = wrangler.replace(/id\s*=\s*"[^"]*"/, `id = "${kvId}"`);
writeFileSync('wrangler.toml', wrangler);
console.log('✅ wrangler.toml 已更新');

// Step 5: Ask for auth credentials
console.log('\n📋 Step 5: 设置访问凭据...');
const readline = await import('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const question = (q) => new Promise(resolve => rl.question(q, resolve));

const basicUser = await question('设置用户名 (默认: admin): ') || 'admin';
const basicPass = await question('设置密码 (默认: password123): ') || 'password123';

rl.close();

wrangler = readFileSync('wrangler.toml', 'utf8');
wrangler = wrangler.replace(/BASIC_USER\s*=\s*"[^"]*"/, `BASIC_USER = "${basicUser}"`);
wrangler = wrangler.replace(/BASIC_PASS\s*=\s*"[^"]*"/, `BASIC_PASS = "${basicPass}"`);
writeFileSync('wrangler.toml', wrangler);
console.log('✅ 访问凭据已设置');

// Step 6: Deploy
console.log('\n📋 Step 6: 部署到 Cloudflare Pages...');
console.log('⏳ 正在部署，请稍候...\n');
try {
  execSync('npx wrangler pages deploy', { stdio: 'inherit' });
  console.log('\n🎉 部署成功！');
  console.log(`\n📍 访问地址: https://${PROJECT_NAME}.pages.dev`);
  console.log(`🔑 用户名: ${basicUser}`);
  console.log(`🔒 密码: ${basicPass}`);
  console.log(`\n📁 WebDAV 地址: https://${PROJECT_NAME}.pages.dev/webdav/`);
} catch (e) {
  console.log('❌ 部署失败');
  process.exit(1);
}
