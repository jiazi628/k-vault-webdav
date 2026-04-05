const DAV_NS = 'DAV:';
const NS_DAV = 'd';

export function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatWebDAVDate(timestamp) {
  if (!timestamp) return new Date().toISOString();
  const date = new Date(Number(timestamp));
  return date.toISOString();
}

export function buildPropfindResponse(resources, host, depth) {
  let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
  xml += `<${NS_DAV}:multistatus xmlns:${NS_DAV}="${DAV_NS}">\n`;

  for (const resource of resources) {
    xml += buildResponse(resource, host);
  }

  xml += `</${NS_DAV}:multistatus>`;
  return xml;
}

function buildResponse(resource, host) {
  const href = encodePath(resource.path);
  const isCollection = resource.type === 'folder';

  let xml = `  <${NS_DAV}:response>\n`;
  xml += `    <${NS_DAV}:href>${escapeXml(href)}</${NS_DAV}:href>\n`;
  xml += `    <${NS_DAV}:propstat>\n`;
  xml += `      <${NS_DAV}:prop>\n`;

  xml += `        <${NS_DAV}:resourcetype>${isCollection ? `<${NS_DAV}:collection/>` : ''}</${NS_DAV}:resourcetype>\n`;
  xml += `        <${NS_DAV}:getcontentlength>${isCollection ? '0' : String(resource.size || 0)}</${NS_DAV}:getcontentlength>\n`;
  xml += `        <${NS_DAV}:getlastmodified>${escapeXml(formatWebDAVDate(resource.modified))}</${NS_DAV}:getlastmodified>\n`;
  xml += `        <${NS_DAV}:creationdate>${escapeXml(formatWebDAVDate(resource.created))}</${NS_DAV}:creationdate>\n`;
  xml += `        <${NS_DAV}:displayname>${escapeXml(resource.name)}</${NS_DAV}:displayname>\n`;

  if (!isCollection && resource.contentType) {
    xml += `        <${NS_DAV}:getcontenttype>${escapeXml(resource.contentType)}</${NS_DAV}:getcontenttype>\n`;
  }

  if (!isCollection && resource.etag) {
    xml += `        <${NS_DAV}:getetag>${escapeXml(resource.etag)}</${NS_DAV}:getetag>\n`;
  }

  xml += `      </${NS_DAV}:prop>\n`;
  xml += `      <${NS_DAV}:status>HTTP/1.1 200 OK</${NS_DAV}:status>\n`;
  xml += `    </${NS_DAV}:propstat>\n`;
  xml += `  </${NS_DAV}:response>\n`;

  return xml;
}

function encodePath(path) {
  if (!path || path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  return '/' + parts.map(p => encodeURIComponent(p)).join('/');
}

export function parsePropfindBody(body) {
  const props = [];
  if (!body) return { allprop: true, props: [] };

  const allpropMatch = body.match(/<D:allprop\s*\/?>/i) || body.match(/<allprop\s*\/?>/i);
  if (allpropMatch) {
    return { allprop: true, props: [] };
  }

  const propMatch = body.match(/<D:prop[^>]*>([\s\S]*?)<\/D:prop>/i) || body.match(/<prop[^>]*>([\s\S]*?)<\/prop>/i);
  if (propMatch) {
    const propContent = propMatch[1];
    const tagRegex = /<(?:D:)?(\w+)[^>]*>/g;
    let match;
    while ((match = tagRegex.exec(propContent)) !== null) {
      props.push(match[1]);
    }
  }

  return { allprop: false, props };
}

export function buildPropfindXml(propfindBody) {
  if (!propfindBody) return '';
  return propfindBody;
}
