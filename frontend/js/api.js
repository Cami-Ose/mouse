/**
 * API 通信封装 — fetch + SSE
 */

const API = {
  // 同源：前端由后端一起托管（默认 127.0.0.1:8086），改成绝对地址可指向别的后端
  base: '',

  // ─── 通用 ──────────────────────────

  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(this.base + path, opts);
    if (!res.ok) {
      const err = await res.text().catch(() => '请求失败');
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    return res.json();
  },

  // ─── 对话 ──────────────────────────

  listConversations() {
    return this.request('GET', '/api/conversations');
  },

  createConversation(data) {
    return this.request('POST', '/api/conversations', data);
  },

  updateConversation(id, data) {
    return this.request('PUT', `/api/conversations/${id}`, data);
  },

  deleteConversation(id) {
    return this.request('DELETE', `/api/conversations/${id}`);
  },

  moveConversation(id, folderId) {
    return this.request('PUT', `/api/conversations/${id}/folder`, { folder_id: folderId || null });
  },

  // ─── 聊天文件夹 ─────────────────────

  listFolders() {
    return this.request('GET', '/api/folders');
  },

  createFolder(data) {
    return this.request('POST', '/api/folders', data);
  },

  updateFolder(id, data) {
    return this.request('PUT', `/api/folders/${id}`, data);
  },

  deleteFolder(id) {
    return this.request('DELETE', `/api/folders/${id}`);
  },

  getMessages(id, limit = 0, offset = 0, desc = false) {
    var params = [];
    if (limit > 0) params.push('limit=' + limit);
    if (offset > 0) params.push('offset=' + offset);
    if (desc) params.push('desc=true');
    var qs = params.length ? '?' + params.join('&') : '';
    return this.request('GET', `/api/conversations/${id}/messages${qs}`);
  },

  deleteMessage(convId, msgId) {
    return this.request('DELETE', `/api/conversations/${convId}/messages/${msgId}`);
  },

  updateMessage(convId, msgId, data) {
    return this.request('PUT', `/api/conversations/${convId}/messages/${msgId}`, data);
  },

  // ─── 文件上传 ──────────────────────

  async uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(this.base + '/api/upload', {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error('上传失败: ' + await res.text());
    return res.json();
  },

  // ─── 聊天 SSE ──────────────────────

  chatStream(convId, message, providerId, images, files, worldEntryIds, signal) {
    const body = { message };
    if (providerId) body.provider_id = providerId;
    if (images && images.length) body.images = images;
    if (files && files.length) body.files = files;
    if (worldEntryIds) body.world_entry_ids = worldEntryIds;  // [] 也发送：表示什么都不携带
    return fetch(this.base + `/api/chat/${convId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  },

  regenerateStream(convId, providerId, userMsgId, signal) {
    const body = {};
    if (providerId) body.provider_id = providerId;
    if (userMsgId) body.user_msg_id = userMsgId;
    return fetch(this.base + `/api/chat/${convId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  },

  // ─── 世界书 ────────────────────────

  listWorldEntries() {
    return this.request('GET', '/api/world-entries');
  },

  createWorldEntry(data) {
    return this.request('POST', '/api/world-entries', data);
  },

  updateWorldEntry(id, data) {
    return this.request('PUT', `/api/world-entries/${id}`, data);
  },

  deleteWorldEntry(id) {
    return this.request('DELETE', `/api/world-entries/${id}`);
  },

  listWorldCategories() {
    return this.request('GET', '/api/world-entries/categories');
  },

  testWorldMatch(text) {
    return this.request('POST', '/api/world-entries/test-match', { text });
  },

  // ─── API 线路 ──────────────────────

  listProviders() {
    return this.request('GET', '/api/providers');
  },

  createProvider(data) {
    return this.request('POST', '/api/providers', data);
  },

  updateProvider(id, data) {
    return this.request('PUT', `/api/providers/${id}`, data);
  },

  deleteProvider(id) {
    return this.request('DELETE', `/api/providers/${id}`);
  },

  setDefaultProvider(id) {
    return this.request('POST', `/api/providers/${id}/set-default`);
  },

  // ─── 奶酪图书馆 ─────────────────

  listLibraryEntries(folder) {
    var q = folder ? '?folder=' + encodeURIComponent(folder) : '';
    return this.request('GET', '/api/library/entries' + q);
  },

  getLibraryEntry(id) {
    return this.request('GET', '/api/library/entries/' + id);
  },

  createLibraryEntry(data) {
    return this.request('POST', '/api/library/entries', data);
  },

  updateLibraryEntry(id, data) {
    return this.request('PUT', '/api/library/entries/' + id, data);
  },

  deleteLibraryEntry(id) {
    return this.request('DELETE', '/api/library/entries/' + id);
  },

  listLibraryFolders() {
    return this.request('GET', '/api/library/folders');
  },

  searchLibraryEntries(q) {
    return this.request('GET', '/api/library/search?q=' + encodeURIComponent(q));
  },

  // ─── 宝箱 ─────────────────
  listTreasureBox() {
    return this.request('GET', '/api/library/treasure-box');
  },
  createTreasureBox(content) {
    return this.request('POST', '/api/library/treasure-box', { content });
  },
  deleteTreasureBox(id) {
    return this.request('DELETE', '/api/library/treasure-box/' + id);
  },

  // ─── 消息搜索 ──────────────────────

  searchMessages(q) {
    return this.request('GET', '/api/search/messages?q=' + encodeURIComponent(q));
  },

  // ─── 控制台仪表盘 ──────────────────
  getStats() {
    return this.request('GET', '/api/stats');
  },
  listImages(limit, offset) {
    var params = [];
    if (limit) params.push('limit=' + limit);
    if (offset) params.push('offset=' + offset);
    var qs = params.length ? '?' + params.join('&') : '';
    return this.request('GET', '/api/stats/images' + qs);
  },
};

/**
 * 解析 SSE 流，逐事件调用回调
 * @param {Response} response fetch Response
 * @param {Object} callbacks { onToken, onToolStatus, onDone, onError }
 */
function parseSSE(response, callbacks) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function read() {
    reader.read().then(({ done, value }) => {
      if (done) {
        // 流正常结束但服务端未发 done 事件（断连），确保前端重置
        callbacks.onDone?.();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr) continue;
        try {
          const event = JSON.parse(dataStr);
          switch (event.type) {
            case 'token':
              callbacks.onToken?.(event.content);
              break;
            case 'tool_status':
              callbacks.onToolStatus?.(event.content);
              break;
            case 'tool_call_start':
              callbacks.onToolCallStart?.(event);
              break;
            case 'tool_call':
              callbacks.onToolCall?.(event);
              break;
            case 'worldbook_injected':
              callbacks.onWorldbookInjected?.(event.entries);
              break;
            case 'done':
              callbacks.onDone?.(event.message_id, event.user_message_id, event.user_image_urls, event.user_files);
              break;
            case 'error':
              callbacks.onError?.(event.content);
              break;
          }
        } catch { /* skip malformed JSON */ }
      }
      read();
    }).catch(err => {
      callbacks.onError?.(err.message);
      callbacks.onDone?.();  // 异常断连也确保重置
    });
  }
  read();
}

/**
 * HTML 转义工具（全局，供所有视图模块使用）
 */
function escHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function _fmtSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
