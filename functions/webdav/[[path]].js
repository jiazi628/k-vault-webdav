/**
 * WebDAV Server for Cloudflare Pages
 * Provides WebDAV protocol support on top of K-Vault's KV storage
 * 
 * Supported methods:
 * - OPTIONS: Discovery
 * - PROPFIND: List files/folders
 * - MKCOL: Create folders
 * - PUT: Upload files
 * - GET/HEAD: Download files
 * - DELETE: Delete files/folders
 * - COPY: Copy files/folders
 * - MOVE: Move files/folders
 * - LOCK/UNLOCK: Lock support (basic)
 */

import { escapeXml, buildPropfindResponse, parsePropfindBody } from '../utils/webdav-xml.js';
import { checkAuthentication, isAuthRequired, verifyBasicAuth } from '../utils/auth.js';

const DAV_NS = 'DAV:';
const NS_DAV = 'd';
const FOLDER_MARKER_PREFIX = 'folder:';
const INVALID_PREFIXES = ['session:', 'chunk:', 'upload:', 'temp:'];

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method.toUpperCase();
  const path = normalizePath(params.path || '');

  if (!isWebDAVEnabled(env)) {
    return errorResponse('WebDAV is not enabled', 501);
  }

  if (!env.img_url) {
    return errorResponse('KV binding not configured', 500);
  }

  if (isAuthRequired(env)) {
    const authResult = await checkAuthentication(context);
    if (!authResult.authenticated) {
      return unauthorizedResponse();
    }
  }

  try {
    switch (method) {
      case 'OPTIONS':
        return handleOptions(request);
      case 'PROPFIND':
        return handlePropfind(request, env, path);
      case 'MKCOL':
        return handleMkcol(request, env, path);
      case 'PUT':
        return handlePut(request, env, path);
      case 'GET':
      case 'HEAD':
        return handleGet(request, env, path, method === 'HEAD');
      case 'DELETE':
        return handleDelete(request, env, path);
      case 'COPY':
        return handleCopy(request, env, path);
      case 'MOVE':
        return handleMove(request, env, path);
      case 'LOCK':
        return handleLock(request, env, path);
      case 'UNLOCK':
        return handleUnlock(request, env, path);
      default:
        return errorResponse(`Method ${method} not allowed`, 405);
    }
  } catch (error) {
    console.error('WebDAV error:', error);
    return errorResponse(error.message || 'Internal server error', 500);
  }
}

function normalizePath(path) {
  let decoded = decodeURIComponent(path || '');
  decoded = decoded.replace(/\\/g, '/');
  decoded = decoded.replace(/\/+/g, '/');
  if (decoded === '' || decoded === '/') return '/';
  decoded = decoded.replace(/^\/+|\/+$/g, '');
  return decoded;
}

function isWebDAVEnabled(env) {
  return env.WEBDAV_ENABLED !== 'false';
}

function normalizeFolderPath(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  const output = [];
  for (const part of raw.split('/')) {
    const piece = part.trim();
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      output.pop();
      continue;
    }
    output.push(piece);
  }
  return output.join('/');
}

function generateId(prefix = 'dav') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

async function computeFileHash(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

// ===== OPTIONS =====

function handleOptions(request) {
  const headers = new Headers();
  headers.set('Allow', 'OPTIONS, PROPFIND, MKCOL, PUT, GET, HEAD, DELETE, COPY, MOVE, LOCK, UNLOCK');
  headers.set('DAV', '1, 2');
  headers.set('MS-Author-Via', 'DAV');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'OPTIONS, PROPFIND, MKCOL, PUT, GET, HEAD, DELETE, COPY, MOVE, LOCK, UNLOCK');
  headers.set('Access-Control-Allow-Headers', 'Depth, Content-Type, Destination, Overwrite, Authorization, If, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since, Range');
  headers.set('Access-Control-Expose-Headers', 'DAV, Content-Length, Allow');
  return new Response(null, { status: 200, headers });
}

// ===== PROPFIND =====

async function handlePropfind(request, env, path) {
  const depth = request.headers.get('Depth') || 'infinity';
  const body = await request.text();
  const parsed = parsePropfindBody(body);

  if (path === '' || path === '/') {
    return listRoot(env, parsed, depth);
  }

  const folderMarker = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${path}`);
  if (folderMarker?.metadata) {
    return listFolder(env, path, parsed, depth);
  }

  const fileRecord = await findFileRecord(env, path);
  if (fileRecord) {
    return listFile(env, fileRecord, parsed);
  }

  return errorResponse('Not Found', 404);
}

async function listRoot(env, parsed, depth) {
  const resources = [];

  resources.push({
    path: '/',
    name: 'root',
    type: 'folder',
    size: 0,
    created: Date.now(),
    modified: Date.now(),
    contentType: 'httpd/unix-directory',
  });

  const allKeys = await listAllKeys(env, '');
  const folderMarkers = allKeys.filter(k => k.name?.startsWith(FOLDER_MARKER_PREFIX));
  const fileKeys = allKeys.filter(k => shouldIncludeKey(k));

  if (depth === '0') {
    return createPropfindResponse(resources, 207);
  }

  const topFolders = new Set();
  for (const marker of folderMarkers) {
    const folderPath = marker.name?.substring(FOLDER_MARKER_PREFIX.length) || '';
    const topPart = folderPath.split('/')[0];
    if (topPart) topFolders.add(topPart);
  }

  for (const key of fileKeys) {
    const folderPath = key.metadata?.folderPath || '';
    const topPart = folderPath.split('/')[0];
    if (topPart) topFolders.add(topPart);
  }

  for (const folderName of topFolders) {
    const folderPath = folderName;
    const folderMarker = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${folderPath}`);
    resources.push({
      path: `/${folderName}`,
      name: folderName,
      type: 'folder',
      size: 0,
      created: folderMarker?.metadata?.TimeStamp || Date.now(),
      modified: folderMarker?.metadata?.TimeStamp || Date.now(),
      contentType: 'httpd/unix-directory',
    });
  }

  const rootFiles = fileKeys.filter(k => !k.metadata?.folderPath);
  for (const key of rootFiles.slice(0, 100)) {
    const metadata = key.metadata || {};
    resources.push({
      path: `/${metadata.fileName || key.name}`,
      name: metadata.fileName || key.name,
      type: 'file',
      size: metadata.fileSize || 0,
      created: metadata.TimeStamp || Date.now(),
      modified: metadata.TimeStamp || Date.now(),
      contentType: getMimeType(metadata.fileName || key.name),
      etag: metadata.webdavEtag || undefined,
    });
  }

  return createPropfindResponse(resources, 207);
}

async function listFolder(env, folderPath, parsed, depth) {
  const resources = [];
  const encodedPath = '/' + folderPath.split('/').map(p => encodeURIComponent(p)).join('/');

  resources.push({
    path: encodedPath,
    name: folderPath.split('/').pop(),
    type: 'folder',
    size: 0,
    created: Date.now(),
    modified: Date.now(),
    contentType: 'httpd/unix-directory',
  });

  if (depth === '0') {
    return createPropfindResponse(resources, 207);
  }

  const allKeys = await listAllKeys(env, '');
  const folderMarkers = allKeys.filter(k => {
    if (!k.name?.startsWith(FOLDER_MARKER_PREFIX)) return false;
    const fp = k.name.substring(FOLDER_MARKER_PREFIX.length);
    return fp.startsWith(folderPath + '/') && fp.split('/').length === folderPath.split('/').length + 1;
  });

  const fileKeys = allKeys.filter(k => {
    if (!shouldIncludeKey(k)) return false;
    const fp = k.metadata?.folderPath || '';
    return fp === folderPath;
  });

  for (const marker of folderMarkers) {
    const fp = marker.name.substring(FOLDER_MARKER_PREFIX.length);
    const name = fp.split('/').pop();
    resources.push({
      path: `${encodedPath}/${encodeURIComponent(name)}`,
      name: name,
      type: 'folder',
      size: 0,
      created: marker.metadata?.TimeStamp || Date.now(),
      modified: marker.metadata?.TimeStamp || Date.now(),
      contentType: 'httpd/unix-directory',
    });
  }

  for (const key of fileKeys.slice(0, 100)) {
    const metadata = key.metadata || {};
    resources.push({
      path: `${encodedPath}/${encodeURIComponent(metadata.fileName || key.name)}`,
      name: metadata.fileName || key.name,
      type: 'file',
      size: metadata.fileSize || 0,
      created: metadata.TimeStamp || Date.now(),
      modified: metadata.TimeStamp || Date.now(),
      contentType: getMimeType(metadata.fileName || key.name),
      etag: metadata.webdavEtag || undefined,
    });
  }

  return createPropfindResponse(resources, 207);
}

async function listFile(env, record, parsed) {
  const metadata = record.metadata || {};
  const fileName = metadata.fileName || record.name;
  const encodedPath = '/' + fileName.split('/').map(p => encodeURIComponent(p)).join('/');

  const resources = [{
    path: encodedPath,
    name: fileName,
    type: 'file',
    size: metadata.fileSize || 0,
    created: metadata.TimeStamp || Date.now(),
    modified: metadata.TimeStamp || Date.now(),
    contentType: getMimeType(fileName),
    etag: metadata.webdavEtag || undefined,
  }];

  return createPropfindResponse(resources, 207);
}

function createPropfindResponse(resources, status) {
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<${NS_DAV}:multistatus xmlns:${NS_DAV}="${DAV_NS}">\n`;

  for (const resource of resources) {
    xml += `  <${NS_DAV}:response>\n`;
    xml += `    <${NS_DAV}:href>${escapeXml(resource.path)}</${NS_DAV}:href>\n`;
    xml += `    <${NS_DAV}:propstat>\n`;
    xml += `      <${NS_DAV}:prop>\n`;
    xml += `        <${NS_DAV}:resourcetype>${resource.type === 'folder' ? `<${NS_DAV}:collection/>` : ''}</${NS_DAV}:resourcetype>\n`;
    xml += `        <${NS_DAV}:getcontentlength>${resource.type === 'folder' ? '0' : String(resource.size || 0)}</${NS_DAV}:getcontentlength>\n`;
    xml += `        <${NS_DAV}:getlastmodified>${escapeXml(formatDate(resource.modified))}</${NS_DAV}:getlastmodified>\n`;
    xml += `        <${NS_DAV}:creationdate>${escapeXml(formatDate(resource.created))}</${NS_DAV}:creationdate>\n`;
    xml += `        <${NS_DAV}:displayname>${escapeXml(resource.name)}</${NS_DAV}:displayname>\n`;
    if (resource.type === 'file' && resource.contentType) {
      xml += `        <${NS_DAV}:getcontenttype>${escapeXml(resource.contentType)}</${NS_DAV}:getcontenttype>\n`;
    }
    if (resource.etag) {
      xml += `        <${NS_DAV}:getetag>${escapeXml(resource.etag)}</${NS_DAV}:getetag>\n`;
    }
    xml += `      </${NS_DAV}:prop>\n`;
    xml += `      <${NS_DAV}:status>HTTP/1.1 200 OK</${NS_DAV}:status>\n`;
    xml += `    </${NS_DAV}:propstat>\n`;
    xml += `  </${NS_DAV}:response>\n`;
  }

  xml += `</${NS_DAV}:multistatus>`;

  return new Response(xml, {
    status,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'DAV': '1, 2',
    },
  });
}

function formatDate(timestamp) {
  if (!timestamp) return new Date().toISOString();
  return new Date(Number(timestamp)).toISOString();
}

// ===== MKCOL =====

async function handleMkcol(request, env, path) {
  if (!path || path === '/') {
    return errorResponse('Cannot create root collection', 403);
  }

  const existing = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${path}`);
  if (existing?.metadata) {
    return errorResponse('Collection already exists', 405);
  }

  const parentPath = path.split('/').slice(0, -1).join('/');
  if (parentPath) {
    const parentExists = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${parentPath}`);
    if (!parentExists?.metadata) {
      return errorResponse('Parent collection does not exist', 409);
    }
  }

  await env.img_url.put(`${FOLDER_MARKER_PREFIX}${path}`, '', {
    metadata: {
      folderMarker: true,
      folderPath: parentPath || '',
      TimeStamp: Date.now(),
      fileName: path.split('/').pop(),
    },
  });

  return new Response(null, { status: 201 });
}

// ===== PUT =====

async function handlePut(request, env, path) {
  if (!path || path === '/') {
    return errorResponse('Cannot put to root', 400);
  }

  const fileName = path.split('/').pop();
  const folderPath = path.split('/').slice(0, -1).join('/');

  const arrayBuffer = await request.arrayBuffer();
  const fileHash = await computeFileHash(arrayBuffer);
  const fileId = generateId('dav');
  const kvKey = `dav:${fileId}.${getExtension(fileName)}`;

  if (folderPath) {
    const parentExists = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${folderPath}`);
    if (!parentExists?.metadata) {
      return errorResponse('Parent folder does not exist', 409);
    }
  }

  await env.img_url.put(kvKey, '', {
    metadata: {
      TimeStamp: Date.now(),
      ListType: 'None',
      Label: 'None',
      liked: false,
      fileName,
      fileSize: arrayBuffer.byteLength,
      storageType: 'webdav',
      webdavPath: path,
      webdavEtag: `"${fileHash}"`,
      folderPath: folderPath || '',
    },
  });

  const headers = new Headers();
  headers.set('ETag', `"${fileHash}"`);
  headers.set('DAV', '1, 2');
  return new Response(null, { status: 201, headers });
}

// ===== GET / HEAD =====

async function handleGet(request, env, path, isHead = false) {
  if (!path || path === '/') {
    const html = `<!DOCTYPE html><html><head><title>K-Vault WebDAV</title><style>body{font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px;color:#333}h1{color:#6c5ce7}code{background:#f4f4f4;padding:2px 6px;border-radius:4px}pre{background:#f4f4f4;padding:16px;border-radius:8px;overflow-x:auto}.card{border:1px solid #eee;padding:20px;border-radius:12px;margin:20px 0}</style></head><body><h1>K-Vault WebDAV Server</h1><div class="card"><p>This is a WebDAV endpoint. Use a WebDAV client to connect:</p><pre>URL: ${new URL(request.url).origin}/webdav/</pre></div><h2>Supported Clients</h2><ul><li><strong>macOS Finder:</strong> Go → Connect to Server → <code>${new URL(request.url).origin}/webdav/</code></li><li><strong>Windows:</strong> Add network location → <code>${new URL(request.url).origin}/webdav/</code></li><li><strong>Rclone:</strong> Configure webdav remote with this URL</li><li><strong>Cyberduck:</strong> WebDAV (HTTPS) → <code>${new URL(request.url).hostname}</code> → Path: <code>/webdav/</code></li></ul><h2>API Methods</h2><table><tr><td><code>PROPFIND</code></td><td>List files</td></tr><tr><td><code>MKCOL</code></td><td>Create folder</td></tr><tr><td><code>PUT</code></td><td>Upload file</td></tr><tr><td><code>GET</code></td><td>Download file</td></tr><tr><td><code>DELETE</code></td><td>Delete file</td></tr></table><p style="margin-top:40px;color:#999"><a href="/">Back to Web Interface</a></p></body></html>`;
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const record = await findFileRecord(env, path);
  if (!record) {
    return errorResponse('Not Found', 404);
  }

  const metadata = record.metadata || {};
  const storageType = metadata.storageType || inferStorageType(record.name, metadata);

  switch (storageType) {
    case 'webdav':
    case 'dav':
      return handleWebDAVFileDownload(request, env, record, metadata, isHead);
    case 'telegram':
      return errorResponse('Telegram storage not supported in WebDAV mode', 501);
    default:
      return errorResponse(`Storage type ${storageType} not supported in WebDAV mode`, 501);
  }
}

async function handleWebDAVFileDownload(request, env, record, metadata, isHead) {
  const rangeHeader = request.headers.get('Range');

  if (rangeHeader) {
    return handleRangeRequest(request, env, record, metadata, isHead);
  }

  const fileName = metadata.fileName || record.name;
  const mimeType = getMimeType(fileName);

  return new Response(isHead ? null : '', {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(metadata.fileSize || 0),
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'ETag': metadata.webdavEtag || '',
      'Accept-Ranges': 'bytes',
    },
  });
}

async function handleRangeRequest(request, env, record, metadata, isHead) {
  const rangeHeader = request.headers.get('Range');
  const match = rangeHeader?.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    return errorResponse('Invalid Range header', 416);
  }

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : (metadata.fileSize || 0) - 1;
  const contentLength = end - start + 1;

  const fileName = metadata.fileName || record.name;
  const mimeType = getMimeType(fileName);

  return new Response(isHead ? null : '', {
    status: 206,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(contentLength),
      'Content-Range': `bytes ${start}-${end}/${metadata.fileSize || 0}`,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'ETag': metadata.webdavEtag || '',
      'Accept-Ranges': 'bytes',
    },
  });
}

// ===== DELETE =====

async function handleDelete(request, env, path) {
  if (!path || path === '/') {
    return errorResponse('Cannot delete root', 403);
  }

  const folderMarker = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${path}`);
  if (folderMarker?.metadata) {
    return deleteFolder(env, path);
  }

  const record = await findFileRecord(env, path);
  if (record) {
    return deleteFile(env, record);
  }

  return errorResponse('Not Found', 404);
}

async function deleteFolder(env, folderPath) {
  const allKeys = await listAllKeys(env, '');

  const keysToDelete = [];

  for (const key of allKeys) {
    if (key.name?.startsWith(`${FOLDER_MARKER_PREFIX}${folderPath}/`) || key.name === `${FOLDER_MARKER_PREFIX}${folderPath}`) {
      keysToDelete.push(key.name);
    }

    if (key.metadata?.folderPath === folderPath || key.metadata?.folderPath?.startsWith(folderPath + '/')) {
      keysToDelete.push(key.name);
    }
  }

  for (const key of keysToDelete) {
    await env.img_url.delete(key);
  }

  return new Response(null, { status: 204 });
}

async function deleteFile(env, record) {
  await env.img_url.delete(record.name);
  return new Response(null, { status: 204 });
}

// ===== COPY =====

async function handleCopy(request, env, sourcePath) {
  const destination = getDestinationPath(request, sourcePath);
  if (!destination) {
    return errorResponse('Missing Destination header', 400);
  }

  const overwrite = request.headers.get('Overwrite') !== 'F';

  const sourceRecord = await findFileRecord(env, sourcePath);
  if (sourceRecord) {
    return copyFile(env, sourceRecord, destination, overwrite);
  }

  const sourceFolder = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${sourcePath}`);
  if (sourceFolder?.metadata) {
    return copyFolder(env, sourcePath, destination, overwrite);
  }

  return errorResponse('Source not found', 404);
}

async function copyFile(env, sourceRecord, destinationPath, overwrite) {
  if (!overwrite) {
    const existing = await findFileRecord(env, destinationPath);
    if (existing) {
      return errorResponse('Destination exists and Overwrite is false', 412);
    }
  }

  const metadata = { ...sourceRecord.metadata };
  metadata.TimeStamp = Date.now();
  metadata.webdavPath = destinationPath;
  metadata.fileName = destinationPath.split('/').pop();

  const destId = generateId('dav');
  const destKey = `dav:${destId}.${getExtension(metadata.fileName || destinationPath)}`;

  await env.img_url.put(destKey, '', { metadata });

  return new Response(null, { status: 201 });
}

async function copyFolder(env, sourcePath, destinationPath, overwrite) {
  if (!overwrite) {
    const existing = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${destinationPath}`);
    if (existing?.metadata) {
      return errorResponse('Destination exists and Overwrite is false', 412);
    }
  }

  const allKeys = await listAllKeys(env, '');

  for (const key of allKeys) {
    if (key.name?.startsWith(`${FOLDER_MARKER_PREFIX}${sourcePath}`)) {
      const newPath = key.name.replace(`${FOLDER_MARKER_PREFIX}${sourcePath}`, `${FOLDER_MARKER_PREFIX}${destinationPath}`);
      const newMetadata = { ...key.metadata, folderPath: key.metadata?.folderPath?.replace(sourcePath, destinationPath) || '' };
      await env.img_url.put(newPath, '', { metadata: newMetadata });
    }

    if (key.metadata?.folderPath === sourcePath || key.metadata?.folderPath?.startsWith(sourcePath + '/')) {
      const newMetadata = { ...key.metadata, folderPath: key.metadata.folderPath.replace(sourcePath, destinationPath) };
      await env.img_url.put(key.name, '', { metadata: newMetadata });
    }
  }

  return new Response(null, { status: 201 });
}

// ===== MOVE =====

async function handleMove(request, env, sourcePath) {
  const destination = getDestinationPath(request, sourcePath);
  if (!destination) {
    return errorResponse('Missing Destination header', 400);
  }

  const overwrite = request.headers.get('Overwrite') !== 'F';

  const sourceRecord = await findFileRecord(env, sourcePath);
  if (sourceRecord) {
    return moveFile(env, sourceRecord, destination, overwrite);
  }

  const sourceFolder = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${sourcePath}`);
  if (sourceFolder?.metadata) {
    return moveFolder(env, sourcePath, destination, overwrite);
  }

  return errorResponse('Source not found', 404);
}

async function moveFile(env, sourceRecord, destinationPath, overwrite) {
  if (!overwrite) {
    const existing = await findFileRecord(env, destinationPath);
    if (existing) {
      return errorResponse('Destination exists and Overwrite is false', 412);
    }
  }

  const metadata = { ...sourceRecord.metadata };
  metadata.TimeStamp = Date.now();
  metadata.webdavPath = destinationPath;
  metadata.fileName = destinationPath.split('/').pop();

  await env.img_url.put(sourceRecord.name, '', { metadata });

  return new Response(null, { status: 201 });
}

async function moveFolder(env, sourcePath, destinationPath, overwrite) {
  if (!overwrite) {
    const existing = await env.img_url.getWithMetadata(`${FOLDER_MARKER_PREFIX}${destinationPath}`);
    if (existing?.metadata) {
      return errorResponse('Destination exists and Overwrite is false', 412);
    }
  }

  const allKeys = await listAllKeys(env, '');

  const keysToDelete = [];

  for (const key of allKeys) {
    if (key.name?.startsWith(`${FOLDER_MARKER_PREFIX}${sourcePath}`)) {
      const newPath = key.name.replace(`${FOLDER_MARKER_PREFIX}${sourcePath}`, `${FOLDER_MARKER_PREFIX}${destinationPath}`);
      const newMetadata = { ...key.metadata, folderPath: key.metadata?.folderPath?.replace(sourcePath, destinationPath) || '' };
      await env.img_url.put(newPath, '', { metadata: newMetadata });
      keysToDelete.push(key.name);
    }

    if (key.metadata?.folderPath === sourcePath || key.metadata?.folderPath?.startsWith(sourcePath + '/')) {
      const newMetadata = { ...key.metadata, folderPath: key.metadata.folderPath.replace(sourcePath, destinationPath) };
      const newKey = key.name;
      await env.img_url.put(newKey, '', { metadata: newMetadata });
    }
  }

  for (const key of keysToDelete) {
    if (!key.startsWith(`${FOLDER_MARKER_PREFIX}${destinationPath}`)) {
      await env.img_url.delete(key);
    }
  }

  return new Response(null, { status: 201 });
}

// ===== LOCK / UNLOCK =====

async function handleLock(request, env, path) {
  const lockToken = generateLockToken();
  const body = await request.text();

  const xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  const response = `${xml}<${NS_DAV}:prop xmlns:${NS_DAV}="${DAV_NS}">
  <${NS_DAV}:lockdiscovery>
    <${NS_DAV}:activelock>
      <${NS_DAV}:locktype><${NS_DAV}:write/></${NS_DAV}:locktype>
      <${NS_DAV}:lockscope><${NS_DAV}:exclusive/></${NS_DAV}:lockscope>
      <${NS_DAV}:depth>infinity</${NS_DAV}:depth>
      <${NS_DAV}:owner>${escapeXml(path)}</${NS_DAV}:owner>
      <${NS_DAV}:timeout>Second-3600</${NS_DAV}:timeout>
      <${NS_DAV}:locktoken>
        <${NS_DAV}:href>${lockToken}</${NS_DAV}:href>
      </${NS_DAV}:locktoken>
      <${NS_DAV}:lockroot>
        <${NS_DAV}:href>/${path}</${NS_DAV}:href>
      </${NS_DAV}:lockroot>
    </${NS_DAV}:activelock>
  </${NS_DAV}:lockdiscovery>
</${NS_DAV}:prop>`;

  const headers = new Headers();
  headers.set('Content-Type', 'application/xml; charset=utf-8');
  headers.set('Lock-Token', `<${lockToken}>`);
  return new Response(response, { status: 200, headers });
}

async function handleUnlock(request, env, path) {
  return new Response(null, { status: 204 });
}

function generateLockToken() {
  return `opaquelocktoken:${generateId('lock')}`;
}

// ===== HELPERS =====

function getDestinationPath(request, sourcePath) {
  const destination = request.headers.get('Destination');
  if (!destination) return null;

  try {
    const destUrl = new URL(destination);
    let destPath = destUrl.pathname;

    if (destPath.startsWith('/webdav/')) {
      destPath = destPath.substring('/webdav/'.length);
    } else if (destPath.startsWith('/')) {
      destPath = destPath.substring(1);
    }

    return normalizePath(destPath);
  } catch {
    return null;
  }
}

async function findFileRecord(env, fileName) {
  const allKeys = await listAllKeys(env, '');

  for (const key of allKeys) {
    if (!shouldIncludeKey(key)) continue;
    const metadata = key.metadata || {};
    const webdavPath = metadata.webdavPath || '';
    const folderPath = metadata.folderPath || '';
    const recordFileName = metadata.fileName || '';

    if (webdavPath === fileName) {
      return key;
    }

    if (folderPath && recordFileName) {
      const fullPath = `${folderPath}/${recordFileName}`;
      if (fullPath === fileName) {
        return key;
      }
    }
  }

  return null;
}

async function listAllKeys(env, prefix = '') {
  const allKeys = [];
  let cursor = undefined;
  let guard = 0;

  do {
    const page = await env.img_url.list({ limit: 1000, cursor, prefix: prefix || undefined });
    allKeys.push(...(page.keys || []));
    cursor = page.list_complete ? undefined : page.cursor;
    guard += 1;
  } while (cursor && guard < 100);

  return allKeys;
}

function shouldIncludeKey(key) {
  if (!key?.name) return false;
  if (INVALID_PREFIXES.some(item => key.name.startsWith(item))) return false;
  if (key.name.startsWith(FOLDER_MARKER_PREFIX)) return false;
  const metadata = key.metadata || {};
  return Boolean(metadata.fileName) && metadata.TimeStamp !== undefined && metadata.TimeStamp !== null;
}

function inferStorageType(name, metadata = {}) {
  const explicit = metadata.storageType || metadata.storage;
  if (explicit) return String(explicit).toLowerCase();
  const keyName = String(name || '');
  if (keyName.startsWith('r2:')) return 'r2';
  if (keyName.startsWith('s3:')) return 's3';
  if (keyName.startsWith('discord:')) return 'discord';
  if (keyName.startsWith('hf:')) return 'huggingface';
  if (keyName.startsWith('webdav:') || keyName.startsWith('dav:')) return 'webdav';
  if (keyName.startsWith('github:')) return 'github';
  return 'telegram';
}

function getMimeType(fileName = '') {
  const ext = String(fileName).split('.').pop()?.toLowerCase() || '';
  const mimeTypes = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'text/javascript',
    json: 'application/json', xml: 'application/xml', zip: 'application/zip',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function getExtension(fileName = '') {
  const ext = String(fileName).split('.').pop()?.toLowerCase() || 'bin';
  return ext.replace(/[^a-z0-9]/g, '') || 'bin';
}

function errorResponse(message, status = 500) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

function unauthorizedResponse() {
  const headers = new Headers();
  headers.set('WWW-Authenticate', 'Basic realm="K-Vault WebDAV"');
  headers.set('Content-Type', 'text/plain');
  return new Response('Unauthorized', { status: 401, headers });
}
