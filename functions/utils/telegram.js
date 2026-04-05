export function buildTelegramApiUrl(env, method) {
  return `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`;
}

export function buildTelegramFileUrl(env, filePath) {
  return `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;
}

export async function uploadToTelegram(file, fileName, env) {
  const formData = new FormData();
  formData.append('chat_id', env.TG_CHAT_ID);
  formData.append('document', file, {
    filename: fileName,
    type: file.type || 'application/octet-stream',
  });

  const url = buildTelegramApiUrl(env, 'sendDocument');
  const response = await fetch(url, { method: 'POST', body: formData });
  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.description || 'Telegram upload failed');
  }

  const result = data.result;
  const doc = result.document || result.photo?.[0] || result.video || result.audio;

  return {
    fileId: doc.file_id,
    messageId: result.message_id,
    fileSize: doc.file_size || file.size,
    mimeType: doc.mime_type || file.type,
  };
}

export async function getTelegramFilePath(env, fileId) {
  const url = `${buildTelegramApiUrl(env, 'getFile')}?file_id=${encodeURIComponent(fileId)}`;
  const response = await fetch(url);
  const data = await response.json();

  if (!data.ok) return null;
  return data.result.file_path;
}
