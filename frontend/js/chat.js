/**
 * 聊天界面 v37 - 分页加载（最新30条）+ 显示更多
 */

// 页面加载完成后自动设置图片/文件上传（独立于 app.js，防止调用链断裂）
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    if (typeof Chat !== 'undefined' && Chat._setupImageInput) {
      Chat._setupImageInput();
      Chat._setupFileInput();
      Chat._setupWorldbookTagBar();
    }
  }, 100);
});

const Chat = {
  conversations: [],
  folders: [],
  currentConvId: null,
  messages: [],
  isStreaming: false,
  _abortController: null,
  providerId: null,
  _allMessages: [],
  messageOffset: 0,
  hasMoreMessages: false,
  isLoadingMore: false,
  _folderStates: {},   // { folderId: true/false } — expanded/collapsed
  // 世界书携带（发送前选哪几条，输入框上方标签条）
  _autoWb: [],         // 实时匹配到的（随输入更新）
  _manualWb: [],       // 手动添加的
  _removedWb: {},      // 用户 × 掉的条目 ID（自动匹配时不再出现）
  _wbMatchTimer: null,
  _wbMatched: false,   // 当前文本是否已跑过匹配（没跑过就交给后端自动匹配，避免抢回车丢注入）
  _wbLastMatchedText: '',  // 上次匹配的文字（没变就不重复匹配，减少请求和渲染）

  async loadConversations() {
    try {
      this.conversations = await API.listConversations();
    } catch (e) {
      console.error('加载对话列表失败:', e);
      this.conversations = [];
    }
    try {
      this.folders = await API.listFolders();
    } catch (e) {
      console.error('加载文件夹失败:', e);
      this.folders = [];
    }
    this.renderConversations();
  },

  _convHtml(c) {
    var active = c.id === this.currentConvId ? 'active' : '';
    return '<div class="conv-item ' + active + '" draggable="true"'
      + ' data-conv-id="' + c.id + '"'
      + ' onclick="Chat.switchConversation(\'' + c.id + '\')"'
      + ' ondblclick="Chat.renameConversation(\'' + c.id + '\')"'
      + ' ondragstart="Chat._dragStart(event, \'' + c.id + '\')"'
      + ' ondragend="Chat._dragEnd(event)"'
      + '>'
      + '<span class="conv-title">' + escHtml(c.title) + '</span>'
      + '<span class="conv-date">' + (c.updated_at ? c.updated_at.slice(0, 16) : '') + '</span>'
      + '<button class="conv-del-btn" onclick="event.stopPropagation();Chat.deleteConversation(\'' + c.id + '\')" title="删除">×</button>'
      + '</div>';
  },

  _folderHtml(fid, fname, count, convs, expanded) {
    var arrow = expanded ? '▼' : '▶';
    var body = expanded ? convs.map(function(c) { return Chat._convHtml(c); }).join('') : '';
    var html = '<div class="folder-item" data-folder-id="' + fid + '">'
      + '<div class="folder-header" onclick="Chat._toggleFolder(\'' + fid + '\', event)"'
      + ' ondragover="Chat._dragOverFolder(event)"'
      + ' ondragleave="Chat._dragLeaveFolder(event)"'
      + ' ondrop="Chat._dropOnFolder(event, \'' + fid + '\')">'
      + '<span class="folder-toggle">' + arrow + '</span>'
      + '<span class="folder-icon">📁</span>'
      + '<span class="folder-name">' + escHtml(fname) + '</span>'
      + '<span class="folder-count">' + count + '</span>'
      + '<button class="folder-del-btn" onclick="event.stopPropagation();Chat._deleteFolder(\'' + fid + '\',\'' + escHtml(fname) + '\')" title="删除文件夹">×</button>'
      + '</div>'
      + '<div class="folder-convs' + (expanded ? '' : ' collapsed') + '">'
      + body
      + '</div></div>';
    return html;
  },

  _dragOverFolder(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
  },

  _dragLeaveFolder(event) {
    event.currentTarget.classList.remove('drag-over');
  },

  _renderFolderSection() {
    var grouped = {};
    for (var i = 0; i < this.conversations.length; i++) {
      var c = this.conversations[i];
      if (c.folder_id) {
        if (!grouped[c.folder_id]) grouped[c.folder_id] = [];
        grouped[c.folder_id].push(c);
      }
    }

    var fl = document.getElementById('folder-list');
    if (!fl) return;

    if (!this.folders.length) {
      fl.innerHTML = '';
      return;
    }

    var html = '<div class="folders-bar">'
      + '<span class="folders-label">📁 文件夹</span>'
      + '<button class="folder-add-btn" onclick="Chat._addFolder()" title="新建文件夹">+</button>'
      + '</div>';

    for (var fi = 0; fi < this.folders.length; fi++) {
      var f = this.folders[fi];
      var convs = grouped[f.id] || [];
      var expanded = Chat._folderStates[f.id] === true;
      html += Chat._folderHtml(f.id, f.name, convs.length, convs, expanded);
    }

    fl.innerHTML = html;
  },

  renderConversations() {
    var el = document.getElementById('conv-list');
    if (!el) return;

    // 渲染文件夹到顶部区域
    this._renderFolderSection();

    if (this.conversations.length === 0) {
      el.innerHTML = '<div class="empty-state"><p>暂无对话，点击"新建"开始</p></div>';
      return;
    }

    // 搜索过滤
    var searchVal = (document.getElementById('search-conv')?.value || '').toLowerCase().trim();
    var unassigned = [];
    for (var i = 0; i < this.conversations.length; i++) {
      var c = this.conversations[i];
      if (searchVal) {
        // 搜索模式：显示所有匹配的
        if (c.title.toLowerCase().includes(searchVal)) {
          unassigned.push(c);
        }
      } else if (!c.folder_id) {
        unassigned.push(c);
      }
    }

    var dropZoneAttr = searchVal ? '' : ' ondragover="Chat._dragOverFolder(event)" ondragleave="Chat._dragLeaveFolder(event)" ondrop="Chat._dropOnFolder(event, null)"';
    if (unassigned.length === 0) {
      if (searchVal) {
        el.innerHTML = '<div class="empty-state"><p>没有匹配的对话</p></div>';
      } else {
        el.innerHTML = '<div class="empty-state" ' + dropZoneAttr + '><p>所有对话都在文件夹中</p><p style="font-size:11px;margin-top:4px">可将对话拖出文件夹放到这里</p></div>';
      }
    } else {
      el.innerHTML = '<div class="unassigned-header" ' + dropZoneAttr + '><span>📄 未分类</span><span class="folder-count">' + unassigned.length + '</span></div>'
        + unassigned.map(function(c) { return Chat._convHtml(c); }).join('');
    }

    // 如果有关键词，触发消息内容搜索
    if (searchVal) {
      var sEl = el;
      Chat._searchMessages(searchVal, function(html) {
        sEl.insertAdjacentHTML('beforeend', html);
      });
    }

    // 更新标题
    var current = null;
    for (var i = 0; i < this.conversations.length; i++) {
      if (this.conversations[i].id === this.currentConvId) { current = this.conversations[i]; break; }
    }
    document.getElementById('current-view-title').textContent = current ? current.title : '聊天';
  },

  _searchTimeout: null,
  _searchMessages: function(q, cb) {
    if (Chat._searchTimeout) clearTimeout(Chat._searchTimeout);
    Chat._searchTimeout = setTimeout(function() {
      API.searchMessages(q).then(function(results) {
        if (!results || !results.length) return;
        var html = '<div class="search-msg-section">' +
          '<div class="search-msg-header">📝 消息内容匹配（' + results.length + '）</div>';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var icon = r.role === 'user' ? '🙂' : '🤖';
          html += '<div class="search-msg-item" onclick="Chat.switchConversation(\'' + r.conversation_id + '\')">' +
            '<div class="search-msg-title">' + escHtml(r.conv_title || '未命名对话') + '</div>' +
            '<div class="search-msg-snippet">' + icon + ' ' + escHtml(r.snippet) + '</div>' +
            '</div>';
        }
        html += '</div>';
        cb(html);
      }).catch(function() {});
    }, 300);
  },

  // ─── 文件夹操作 ────────────────────────────────────

  _toggleFolder(fid, event) {
    if (event.target.closest('.folder-del-btn') || event.target.closest('.folder-add-btn')) return;
    var current = this._folderStates[fid];
    this._folderStates[fid] = current === false ? true : false;
    this.renderConversations();
  },

  async _addFolder() {
    var name = prompt('文件夹名称：');
    if (!name || !name.trim()) return;
    try {
      var f = await API.createFolder({ name: name.trim(), sort_order: 0 });
      this.folders.push(f);
      this._folderStates[f.id] = true;
      this.renderConversations();
    } catch (e) { alert('创建失败：' + e.message); }
  },

  async _deleteFolder(fid, fname) {
    if (!confirm('删除文件夹「' + fname + '」？其中的对话会移到"未分类"。')) return;
    try {
      await API.deleteFolder(fid);
      this.folders = this.folders.filter(function(f) { return f.id !== fid; });
      delete this._folderStates[fid];
      // 更新本地 conversations 的 folder_id
      for (var i = 0; i < this.conversations.length; i++) {
        if (this.conversations[i].folder_id === fid) this.conversations[i].folder_id = null;
      }
      this.renderConversations();
    } catch (e) { alert('删除失败：' + e.message); }
  },

  // ─── 拖拽 ────────────────────────────────────────

  _dragConvId: null,

  _dragStart(event, cid) {
    this._dragConvId = cid;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', cid);
    var target = event.target.closest('.conv-item');
    if (target) setTimeout(function() { target.style.opacity = '0.4'; }, 0);
  },

  _dragEnd(event) {
    this._dragConvId = null;
    var items = document.querySelectorAll('.conv-item');
    for (var i = 0; i < items.length; i++) items[i].style.opacity = '';
    document.querySelectorAll('.drag-over').forEach(function(e) { e.classList.remove('drag-over'); });
  },

  _dropOnFolder(event, fid) {
    event.preventDefault();
    var el = event.currentTarget;
    el.classList.remove('drag-over');
    var cid = this._dragConvId || event.dataTransfer.getData('text/plain');
    this._dragConvId = null;
    // 恢复所有 conv-item 样式
    var items = document.querySelectorAll('.conv-item');
    for (var i = 0; i < items.length; i++) items[i].style.opacity = '';
    document.querySelectorAll('.drag-over').forEach(function(e) { e.classList.remove('drag-over'); });

    // 过滤非对话拖拽（外部文件等）
    if (!cid) return;
    var conv = null;
    for (var i = 0; i < this.conversations.length; i++) {
      if (this.conversations[i].id === cid) { conv = this.conversations[i]; break; }
    }
    if (!conv) return;
    if (conv.folder_id === fid) return;

    conv.folder_id = fid;
    // 自动展开目标文件夹
    this._folderStates[fid] = true;
    this.renderConversations();

    // 异步通知后端
    API.moveConversation(cid, fid).catch(function(e) {
      console.error('移动对话失败:', e);
    });
  },

  async renameConversation(id) {
    const conv = this.conversations.find(c => c.id === id);
    if (!conv) return;
    const title = prompt('重命名对话：', conv.title);
    if (!title || title === conv.title) return;
    try {
      const updated = await API.updateConversation(id, { title });
      Object.assign(conv, updated);
      this.renderConversations();
    } catch (e) {
      alert('重命名失败：' + e.message);
    }
  },

  async deleteConversation(id) {
    if (this.isStreaming) return;
    if (!confirm('确定删除这个对话及其所有消息？')) return;
    try {
      await API.deleteConversation(id);
      this.conversations = this.conversations.filter(c => c.id !== id);
      if (this.currentConvId === id) {
        if (this.conversations.length > 0) {
          await this.switchConversation(this.conversations[0].id);
        } else {
          this.currentConvId = null;
          this.messages = [];
          this._allMessages = [];
          this.renderMessages();
          this.renderConversations();
        }
      } else {
        this.renderConversations();
      }
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  },

  // 滚动消息容器到最底部（最多尝试 3 次确保渲染完成后执行）
  _scrollToBottom: (function() {
    var scrollTimer = null;
    return function() {
      if (scrollTimer) clearTimeout(scrollTimer);
      var mc = document.getElementById('messages-container');
      if (!mc) return;
      // 立即尝试
      mc.scrollTop = mc.scrollHeight;
      // 下一帧重试（等浏览器完成布局）
      requestAnimationFrame(function() {
        if (mc) mc.scrollTop = mc.scrollHeight;
      });
      // 300ms 后最终兜底（等图片加载完毕）
      scrollTimer = setTimeout(function() {
        if (mc) mc.scrollTop = mc.scrollHeight;
      }, 300);
    };
  })(),

  async switchConversation(id) {
    if (this.isStreaming) return;
    this.currentConvId = id;
    this._resetWbBar();
    this.messages = [];
    this._allMessages = [];
    this.messageOffset = 0;
    this.hasMoreMessages = false;
    this.isLoadingMore = false;
    this.renderMessages();
    this.renderConversations();
    if (typeof switchView === 'function') switchView('chat');
    try {
      var data = await API.getMessages(id); // 全部消息 ASC（limit=0 = 无限制）
      this._allMessages = data || [];
      this.messageOffset = Math.max(0, this._allMessages.length - 30);
      this.hasMoreMessages = this.messageOffset > 0;
      this.messages = this._allMessages.slice(this.messageOffset);
      this._linkWbRefs();
      this.renderMessages();
      this._scrollToBottom();
    } catch (e) {
      console.error('加载消息失败:', e);
    }
  },

  _linkWbRefs() {
    var pendingWb = [];
    for (var mi = 0; mi < this.messages.length; mi++) {
      var m = this.messages[mi];
      if (m.role === 'system' && m.content && m.content.indexOf('[世界书注入:') === 0) {
        var titleMatch = m.content.match(/^\[世界书注入:[^\]]*\]\s*(.+?)(?:\n|$)/);
        if (titleMatch) pendingWb.push(titleMatch[1]);
      } else if (m.role === 'user') {
        if (pendingWb.length) {
          m._wbRefs = pendingWb.slice();
          pendingWb = [];
        }
      }
    }
  },

  async loadMoreMessages() {
    if (!this.hasMoreMessages || this.isLoadingMore) return;
    this.isLoadingMore = true;
    var el = document.getElementById('messages-container');
    var prevHeight = el ? el.scrollHeight : 0;
    try {
      this.messageOffset = Math.max(0, this.messageOffset - 30);
      this.messages = this._allMessages.slice(this.messageOffset);
      this.hasMoreMessages = this.messageOffset > 0;
      this._linkWbRefs();
      this.renderMessages();
      if (el && prevHeight > 0) {
        el.scrollTop = el.scrollHeight - prevHeight;
      }
    } catch (e) {
      console.error('加载更多消息失败:', e);
    } finally {
      this.isLoadingMore = false;
    }
  },

  async newConversation() {
    if (this.isStreaming) return;
    const title = prompt('对话标题（可选）：') || '新对话';
    try {
      const conv = await API.createConversation({ title, system_prompt: '' });
      this.conversations.unshift(conv);
      this.currentConvId = conv.id;
      this.messages = [];
      this._allMessages = [];
      this.renderConversations();
      this.renderMessages();
    } catch (e) {
      alert('创建对话失败：' + e.message);
    }
  },

  renderMessages() {
    const el = document.getElementById('messages-container');
    if (!el) return;

    const visible = this.messages.filter(m => m.role !== 'system' && (m.content || (m.image_urls && m.image_urls.length) || m._tempId));
    if (visible.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="icon"><img src="./img/mouse-face.svg" class="icon-img"></div><p>开始一段新对话吧</p></div>';
      return;
    }

    var html = '';
    // 加载更早消息的按钮
    if (this.hasMoreMessages) {
      html += '<div class="load-more-bar">' +
        '<button class="load-more-btn" onclick="Chat.loadMoreMessages()" ' +
        (this.isLoadingMore ? 'disabled' : '') + '>' +
        (this.isLoadingMore ? '加载中…' : '↑ 显示更早的消息') +
        '</button></div>';
    }
    html += visible.map((m, i) => {
      const isLastAssistant = m.id && !m._tempId && m.role === 'assistant' &&
        visible.slice(i + 1).every(n => n.role !== 'assistant');
      const showEdit = m.id && !m._tempId && m.role === 'user';
      const showActions = isLastAssistant || showEdit;
      // 图片在气泡上方渲染（支持多图）
      const imgHtml = m.role === 'user'
        ? (m.image_urls && m.image_urls.length
            ? '<div class="msg-imgs">' + m.image_urls.map(function(u) {
                return '<div class="msg-img"><img src="' + u + '" alt="图片"></div>';
              }).join('') + '</div>'
            : (m.images && m.images.length
                ? '<div class="msg-imgs">' + m.images.map(function(b64) {
                    return '<div class="msg-img"><img src="data:image/jpeg;base64,' + b64 + '" alt="图片"></div>';
                  }).join('') + '</div>'
                : (m.image_url
                    ? '<div class="msg-img"><img src="' + m.image_url + '" alt="图片"></div>'
                    : (m.image && !m.image_url
                        ? '<div class="msg-img"><img src="data:image/jpeg;base64,' + m.image + '" alt="图片"></div>'
                        : ''))))
        : '';
      // 文件附件渲染（用户消息）
      const filesHtml = m.role === 'user' && m.files && m.files.length
        ? '<div class="msg-files">' + m.files.map(f =>
            '<a class="msg-file" href="' + f.url + '" target="_blank" download="' + escHtml(f.name) + '">' +
              '<span class="msg-file-icon">📎</span>' +
              '<span class="msg-file-name">' + escHtml(f.name) + '</span>' +
              '<span class="msg-file-size">' + _fmtSize(f.size) + '</span>' +
            '</a>'
          ).join('') + '</div>'
        : '';
      const toolHtml = m.role === 'assistant' && m.tool_calls && m.tool_calls.length
        ? renderToolCalls(m.tool_calls) : '';
      var toolSummaryHtml = m.role === 'assistant' && m.tool_calls && m.tool_calls.length
        ? renderToolSummary(m.tool_calls) : '';
      var wbRefHtml = (m.role === 'user' && m._wbRefs && m._wbRefs.length)
        ? `<div class="wb-ref-bar">` + escHtml('已引用 ' + m._wbRefs.join('、')) + `</div>`
        : '';
      // 文件文本已拼入 content，前端渲染时要去掉，避免在气泡里重复显示
      var displayContent = m.content;
      if (m.role === 'user' && m.files && m.files.length && displayContent && displayContent.indexOf('[用户上传了以下文件：]') === 0) {
        // 用户原始消息在文件内容之后，取最后一个 \n\n 后面的部分
        var idx = displayContent.lastIndexOf('\n\n');
        if (idx > -1 && idx < displayContent.length - 2) {
          displayContent = displayContent.substring(idx + 2);
        } else {
          displayContent = '';
        }
      }
      return `
      <div class="message ${m.role}" data-msg-id="${m.id || ''}">
        ${imgHtml}
        ${filesHtml}
        <div class="bubble"><div class="bubble-text">${renderMarkdown(displayContent)}</div>${toolHtml}</div>
        ${toolSummaryHtml}
        ${wbRefHtml}
        ${showActions ? `<div class="msg-actions">
          ${isLastAssistant ? `<button class="msg-regen-btn" onclick="Chat.regenerate()" title="重新生成">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>` : ''}
          ${showEdit ? `<button class="msg-edit-btn" onclick="Chat.startEdit('${m.id}')" title="编辑">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>` : ''}
        </div>` : ''}
      </div>
    `}).join('');
    el.innerHTML = html;

    // 只在用户靠近底部时自动滚动，不干扰阅读历史
    const threshold = 100;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  },

  startEdit(msgId) {
    const msg = this.messages.find(m => m.id === msgId);
    if (!msg) return;
    const el = document.querySelector(`.message[data-msg-id="${msgId}"] .bubble`);
    if (!el) return;
    el.innerHTML = `<textarea class="edit-textarea" rows="3">${escHtml(msg.content)}</textarea>
      <div class="edit-actions">
        <button class="btn btn-sm" onclick="Chat.cancelEdit('${msgId}')">取消</button>
        <button class="btn btn-sm btn-primary" onclick="Chat.saveEdit('${msgId}')">保存</button>
      </div>`;
    el.querySelector('textarea').focus();
  },

  cancelEdit(msgId) {
    this.renderMessages();
  },

  async saveEdit(msgId) {
    const el = document.querySelector(`.message[data-msg-id="${msgId}"] .edit-textarea`);
    if (!el) return;
    const newContent = el.value.trim();
    if (!newContent) return;
    try {
      await API.updateMessage(this.currentConvId, msgId, { content: newContent });

      // 只删除编辑位置之后的 AI 回复，保留用户消息
      const idx = this.messages.findIndex(m => m.id === msgId);
      if (idx === -1) return;
      const toDelete = this.messages.slice(idx + 1).filter(m => m.id && !m.id.startsWith('local-'));
      for (const m of toDelete) {
        await API.deleteMessage(this.currentConvId, m.id).catch(() => {});
      }

      // 更新编辑内容，从本地数组移除已删的 AI 回复
      const msg = this.messages[idx];
      msg.content = newContent;
      var delIds = {};
      toDelete.forEach(function(m) { delIds[m.id] = true; });
      this.messages = this.messages.filter(function(m) { return !delIds[m.id]; });
      this.renderMessages();

      // 如果被编辑的是最后一条非 system 用户消息，自动重新生成
      // （注意：世界书注入会产生 system 消息夹在 user 和 assistant 之间）
      var lastRealIdx = this.messages.length - 1;
      while (lastRealIdx >= 0 && this.messages[lastRealIdx].role === 'system') {
        lastRealIdx--;
      }
      var lastReal = this.messages[lastRealIdx];
      if (lastReal && lastReal.id === msgId && lastReal.role === 'user') {
        await this.regenerate(msgId);
      }
    } catch (e) {
      alert('编辑失败: ' + e.message);
    }
  },

  async deleteMessage(msgId) {
    if (!msgId) return;
    if (msgId.startsWith('local-')) {
      this.messages = this.messages.filter(m => m.id !== msgId);
      this.renderMessages();
      return;
    }
    if (!this.currentConvId) return;
    if (!confirm('删除这条消息？')) return;
    try {
      await API.deleteMessage(this.currentConvId, msgId);
      this.messages = this.messages.filter(m => m.id !== msgId);
      this.renderMessages();
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  },

  // ─── 世界书标签条（发送前选携带哪几条） ────────────
  _setupWorldbookTagBar() {
    const bar = document.getElementById('wb-tag-bar');
    const ta = document.getElementById('message-input');
    const addBtn = document.getElementById('wb-tag-add');
    if (!bar || !ta) return;
    const self = this;

    // 输入时防抖实时匹配
    ta.addEventListener('input', function() {
      self._debounceWbMatch();
    });

    // ＋ 手动添加
    if (addBtn) {
      addBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        self._toggleWbPicker();
      });
    }

    // 点击空白处收起 picker
    document.addEventListener('click', function(e) {
      const picker = document.getElementById('wb-tag-picker');
      if (picker && !picker.classList.contains('hidden') &&
          !e.target.closest('#wb-tag-picker') && !e.target.closest('#wb-tag-add')) {
        picker.classList.add('hidden');
      }
    });
  },

  _debounceWbMatch() {
    const self = this;
    clearTimeout(this._wbMatchTimer);
    this._wbMatched = false;  // 文本变了，旧匹配结果作废
    this._wbMatchTimer = setTimeout(function() { self._runWbMatch(); }, 500);
  },

  async _runWbMatch() {
    const ta = document.getElementById('message-input');
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) {
      this._autoWb = [];
      this._wbMatched = true;
      this._wbLastMatchedText = '';
      this._syncWbBar();
      return;
    }
    // 文字没变就不重复匹配（图片/文件/语音加进来时会派发 input 事件）
    if (text === this._wbLastMatchedText) return;
    try {
      const data = await API.testWorldMatch(text);
      const removed = this._removedWb;
      const matched = (data.matched_entries || []).filter(function(e) { return !removed[e.id]; });
      // 保持后端同款顺序：精确在前，可能关联在后
      const nextAuto = matched.filter(function(e) { return e.match_type === 'exact'; })
                              .concat(matched.filter(function(e) { return e.match_type === 'fuzzy'; }));
      // 结果没变就不重渲染，避免标签条一直“抽抽”
      const same = nextAuto.length === this._autoWb.length &&
                   nextAuto.every(function(e, i) {
                     return this._autoWb[i] && this._autoWb[i].id === e.id &&
                            this._autoWb[i].match_type === e.match_type;
                   }, this);
      this._autoWb = nextAuto;
      this._wbMatched = true;
      this._wbLastMatchedText = text;
      if (!same) this._syncWbBar();
    } catch (e) {
      // 静默：匹配失败时 _wbMatched 保持 false，交给后端自动匹配兜底
    }
  },

  _carriedList() {
    const seen = {}, out = [];
    const all = this._autoWb.concat(this._manualWb);
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!seen[e.id]) { seen[e.id] = true; out.push(e); }
    }
    return out;
  },

  _syncWbBar() {
    const bar = document.getElementById('wb-tag-bar');
    const list = document.getElementById('wb-tag-list');
    if (!bar || !list) return;
    const carried = this._carriedList();
    // 有携带的标签，或输入框里有文字（给个 ＋ 入口手动添加）时才显示
    const ta = document.getElementById('message-input');
    const hasText = ta && ta.value.trim().length > 0;
    if (!carried.length && !hasText) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    list.innerHTML = '';
    const self = this;
    carried.forEach(function(e) {
      var chip = document.createElement('span');
      chip.className = 'wb-tag-chip';
      if (e.match_type === 'manual') chip.classList.add('wb-tag-manual');
      else if (e.match_type === 'fuzzy') chip.classList.add('wb-tag-fuzzy');
      else chip.classList.add('wb-tag-exact');
      var mark = e.match_type === 'fuzzy' ? '🔗' : (e.match_type === 'manual' ? '📌' : '✅');
      chip.innerHTML = '<span class="wb-tag-mark">' + mark + '</span>' +
                       '<span class="wb-tag-title">' + escHtml(e.title) + '</span>' +
                       '<span class="wb-tag-x" title="移除">×</span>';
      chip.querySelector('.wb-tag-x').addEventListener('click', function() {
        self._removeWb(e);
      });
      list.appendChild(chip);
    });
  },

  _removeWb(entry) {
    if (entry.match_type === 'manual') {
      this._manualWb = this._manualWb.filter(function(e) { return e.id !== entry.id; });
    } else {
      this._autoWb = this._autoWb.filter(function(e) { return e.id !== entry.id; });
      this._removedWb[entry.id] = true;  // 自动匹配时不再出现
    }
    this._syncWbBar();
  },

  async _toggleWbPicker() {
    const picker = document.getElementById('wb-tag-picker');
    if (!picker) return;
    if (!picker.classList.contains('hidden')) { picker.classList.add('hidden'); return; }
    // 先展开，再加载：即使失败也能看到面板和错误，不会“点了一下没反应”
    picker.classList.remove('hidden');
    picker.innerHTML = '<div class="wb-picker-empty">加载中…</div>';
    try {
      const entries = await API.listWorldEntries();
      this._renderWbPicker(entries);
    } catch (e) {
      picker.innerHTML = '<div class="wb-picker-empty">加载失败：' + escHtml(e.message) + '</div>';
    }
  },

  _renderWbPicker(entries) {
    const picker = document.getElementById('wb-tag-picker');
    if (!picker) return;
    const carried = {};
    this._carriedList().forEach(function(e) { carried[e.id] = true; });

    var html = '<input id="wb-picker-search" type="text" placeholder="搜索世界书…" autocomplete="off">';
    html += '<div class="wb-picker-list">';
    const usable = entries.filter(function(e) { return e.enabled; });
    if (!usable.length) html += '<div class="wb-picker-empty">没有可用的世界书条目</div>';
    usable.forEach(function(e) {
      var on = carried[e.id] ? ' on' : '';
      html += '<div class="wb-picker-item' + on + '" data-id="' + escHtml(e.id) + '" data-title="' + escHtml(e.title) + '">' +
              '<span class="wb-picker-title">' + escHtml(e.title) + '</span>' +
              (e.category ? '<span class="wb-picker-cat">' + escHtml(e.category) + (e.subcategory ? ' / ' + escHtml(e.subcategory) : '') + '</span>' : '') +
              '</div>';
    });
    html += '</div>';
    picker.innerHTML = html;

    const self = this;
    picker.querySelectorAll('.wb-picker-item').forEach(function(item) {
      item.addEventListener('click', function() {
        self._toggleManualEntry(item.dataset.id, item.dataset.title);
      });
    });
    const search = document.getElementById('wb-picker-search');
    if (search) {
      search.addEventListener('input', function() {
        var q = search.value.trim().toLowerCase();
        picker.querySelectorAll('.wb-picker-item').forEach(function(item) {
          var txt = (item.dataset.title || '').toLowerCase();
          item.style.display = (!q || txt.indexOf(q) > -1) ? '' : 'none';
        });
      });
      setTimeout(function() { search.focus(); }, 50);
    }
  },

  _toggleManualEntry(id, title) {
    const self = this;
    var idx = this._manualWb.findIndex(function(e) { return e.id === id; });
    if (idx > -1) {
      this._manualWb.splice(idx, 1);
    } else {
      this._manualWb.push({ id: id, title: title, match_type: 'manual' });
    }
    this._syncWbBar();
    const picker = document.getElementById('wb-tag-picker');
    if (picker && !picker.classList.contains('hidden')) {
      // 重新渲染以刷新选中态
      API.listWorldEntries().then(function(entries) { self._renderWbPicker(entries); });
    }
  },

  _resetWbBar() {
    this._autoWb = [];
    this._manualWb = [];
    this._removedWb = {};
    this._wbMatched = false;
    this._wbLastMatchedText = '';
    clearTimeout(this._wbMatchTimer);
    this._syncWbBar();
    const picker = document.getElementById('wb-tag-picker');
    if (picker) picker.classList.add('hidden');
  },

  async send() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    // 当前标签条携带的世界书 ID。_wbMatched=false 时（文本刚变、还没跑匹配）不传，
    // 交给后端自动匹配，避免抢回车导致注入丢失。
    var wbIds = this._wbMatched ? this._carriedList().map(function(e) { return e.id; }) : null;
    // 收集所有图片：_pendingImages（按钮选取/拖拽/粘贴）
    var imagesData = this._pendingImages || [];
    // 也检查 preview 元素（兼容旧版）
    var previewEl = document.getElementById('img-preview');
    var imgEl = previewEl && previewEl.querySelector('.img-preview-item img');
    var fromSrc = imgEl && imgEl.src && imgEl.src.indexOf('base64,') > -1 ? imgEl.src.split(',')[1] : '';
    if (fromSrc && !imagesData.length) imagesData = [fromSrc];
    if (fromSrc && imagesData.length) console.log('[img] 图片数:', imagesData.length);

    // 处理待上传的文件
    var pendingFiles = this._pendingFiles || [];
    var uploadedFiles = [];
    var uploadErr = null;
    if (pendingFiles.length) {
      for (var fi = 0; fi < pendingFiles.length; fi++) {
        try {
          var result = await API.uploadFile(pendingFiles[fi]);
          uploadedFiles.push(result);
        } catch (e) {
          uploadErr = e.message;
          break;
        }
      }
    }

    if ((!text && !imagesData.length && !uploadedFiles.length) || !this.currentConvId || this.isStreaming) return;
    if (uploadErr) {
      this.showStreamError('文件上传失败: ' + uploadErr);
      return;
    }

    this.messages.push({ role: 'user', content: text || (imagesData.length ? '(图片)' : '(文件)'), images: imagesData.length ? imagesData : null, files: uploadedFiles.length ? uploadedFiles : null });
    this.renderMessages();

    input.value = '';
    input.dispatchEvent(new Event('input'));
    this._resetWbBar();  // 清空本次携带的世界书，下一条消息重新选
    this.isStreaming = true;
    this._abortController = new AbortController();
    this.setSendButtonLoading(true);

    // 清除图片预览
    var preview = document.getElementById('img-preview');
    if (preview) {
      preview.innerHTML = '';
      delete preview.dataset.imgBase64;
      preview.classList.add('hidden');
    }
    this._pendingImages = [];

    // 清除文件预览
    var fp = document.getElementById('file-preview');
    if (fp) { fp.innerHTML = ''; fp.classList.add('hidden'); }
    this._pendingFiles = [];

    const tempId = 'streaming-msg';
    this.messages.push({ role: 'assistant', content: '', _tempId: tempId });
    this.renderMessages();

    // 保存重试上下文（输入框已清空，需要在这里存档）
    this._retryCtx = { text, imagesData: imagesData.length ? [...imagesData] : null, uploadedFiles: uploadedFiles.length ? [...uploadedFiles] : null };

    const container = document.getElementById('messages-container');
    const bubble = container.querySelector(`.message:last-child .bubble`);
    if (bubble) bubble.classList.add('typing-cursor');
    if (bubble) {
      // 建立文字容器和工具调用容器，分离更新
      var bt = document.createElement('div');
      bt.className = 'bubble-text';
      bubble.appendChild(bt);
    }

    try {
      // 纯图片/纯文件消息给个占位符，避免存空串导致刷新后消失
      var sendContent = text || (imagesData.length ? '(图片)' : (uploadedFiles.length ? '(文件)' : ''));
      const resp = await API.chatStream(this.currentConvId, sendContent, this.providerId, imagesData.length ? imagesData : null, uploadedFiles.length ? uploadedFiles : null, wbIds, this._abortController.signal);
      if (!resp.ok) {
        const err = await resp.text();
        this.showStreamError(`请求失败: ${err}`);
        return;
      }

      let fullContent = '';
      var self = this;
      parseSSE(resp, {
        onToken: (content) => {
          fullContent += content;
          // 用 rAF 节流：每帧最多更新一次 DOM，手机上 token 密集时不卡
          if (!self._rafPending) {
            self._rafPending = true;
            requestAnimationFrame(function() {
              self._rafPending = false;
              if (bubble) {
                var bt = bubble.querySelector('.bubble-text');
                if (bt) bt.innerHTML = renderMarkdown(fullContent);
                // 只在用户靠近底部时自动滚动
                const threshold = 100;
                const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
                if (nearBottom) container.scrollTop = container.scrollHeight;
              }
            });
          }
        },
        onToolStatus: (msg) => {
          const indicator = document.getElementById('tool-status');
          if (indicator) { indicator.textContent = msg; indicator.style.display = 'block'; }
        },
        onWorldbookInjected: (entries) => {
          if (!entries || !entries.length) return;
          // 存到消息对象上（含 match_type）
          var lastUser = self.messages.filter(function(m) { return m.role === 'user'; }).pop();
          if (lastUser) {
            if (!lastUser._wbRefs) lastUser._wbRefs = [];
            var existing = {};
            lastUser._wbRefs.forEach(function(t) { existing[t] = true; });
            entries.forEach(function(e) { if (!existing[e.title]) { existing[e.title] = true; lastUser._wbRefs.push(e.title); } });
          }
          // 更新 DOM：显示增强引用栏，区分精确 ✅ 和可能 🔗
          if (!container) return;
          var allUserMsgs = container.querySelectorAll('.message.user');
          var userMsgEl = allUserMsgs[allUserMsgs.length - 1];
          if (!userMsgEl) return;
          if (userMsgEl.nextElementSibling && userMsgEl.nextElementSibling.classList.contains('wb-ref-bar')) return;
          var exact = entries.filter(function(e) { return e.match_type === 'exact'; });
          var fuzzy = entries.filter(function(e) { return e.match_type === 'fuzzy'; });
          var manual = entries.filter(function(e) { return e.match_type === 'manual'; });
          var parts = [];
          if (exact.length) parts.push('✅ ' + exact.map(function(e) { return e.title; }).join(', '));
          if (fuzzy.length) parts.push('🔗 ' + fuzzy.map(function(e) { return e.title; }).join(', '));
          if (manual.length) parts.push('📌 ' + manual.map(function(e) { return e.title; }).join(', '));
          var bar = document.createElement('div');
          bar.className = 'wb-ref-bar wb-ref-enhanced';
          bar.textContent = parts.join('  ');
          userMsgEl.parentNode.insertBefore(bar, userMsgEl.nextSibling);
        },
        onToolCallStart: (event) => {
          if (!bubble) return;
          var tcContainer = bubble.querySelector('.tool-calls');
          if (!tcContainer) {
            tcContainer = document.createElement('div');
            tcContainer.className = 'tool-calls';
            bubble.appendChild(tcContainer);
          }
          var argsStr = event.arguments || '{}';
          var toolName = event.tool_name;
          var existingGroup = null;
          var groups = tcContainer.querySelectorAll('.tool-call-group');
          for (var gi = 0; gi < groups.length; gi++) {
            var nameEl = groups[gi].querySelector('.tool-call-group-header .tool-call-name');
            if (nameEl && nameEl.textContent === toolName) {
              existingGroup = groups[gi];
              break;
            }
          }
          if (existingGroup) {
            var groupBody = existingGroup.querySelector('.tool-call-group-body');
            var countEl = existingGroup.querySelector('.tool-call-count');
            var cur = parseInt(countEl.textContent, 10) || 1;
            countEl.textContent = cur + 1;
            var subItem = document.createElement('div');
            subItem.className = 'tool-call-item pending';
            subItem.innerHTML =
              '<div class="tool-call-header" onclick="this.parentElement.classList.toggle(\'expanded\')">' +
                '<span class="tool-call-arrow">▶</span> ' +
                '<span class="tool-call-name">' + escHtml(toolName) + '</span>' +
                '<span class="tool-call-idx">#' + (cur + 1) + '</span>' +
                '<span class="tool-call-spinner" style="margin-left:auto;font-size:11px;color:var(--text-secondary)">···</span>' +
              '</div>' +
              '<div class="tool-call-body">' +
                '<div class="tool-call-label">参数：</div>' +
                '<pre class="tool-call-args">' + escHtml(argsStr) + '</pre>' +
                '<div class="tool-call-label">结果：</div>' +
                '<div class="tool-call-result">执行中…</div>' +
              '</div>';
            groupBody.appendChild(subItem);
          } else {
            var group = document.createElement('div');
            group.className = 'tool-call-group';
            var header = document.createElement('div');
            header.className = 'tool-call-group-header';
            header.innerHTML =
              '<span class="tool-call-arrow">▶</span> ' +
              '<span class="tool-call-name">' + escHtml(toolName) + '</span>' +
              '<span class="tool-call-count">1</span>';
            header.onclick = function() {
              var body = this.nextElementSibling;
              var hidden = body.style.display !== 'block';
              body.style.display = hidden ? 'block' : 'none';
              this.querySelector('.tool-call-arrow').textContent = hidden ? '▼' : '▶';
            };
            var groupBody = document.createElement('div');
            groupBody.className = 'tool-call-group-body';
            groupBody.style.display = 'block';
            var subItem = document.createElement('div');
            subItem.className = 'tool-call-item pending';
            subItem.innerHTML =
              '<div class="tool-call-header" onclick="this.parentElement.classList.toggle(\'expanded\')">' +
                '<span class="tool-call-arrow">▶</span> ' +
                '<span class="tool-call-name">' + escHtml(toolName) + '</span>' +
                '<span class="tool-call-idx">#1</span>' +
                '<span class="tool-call-spinner" style="margin-left:auto;font-size:11px;color:var(--text-secondary)">···</span>' +
              '</div>' +
              '<div class="tool-call-body">' +
                '<div class="tool-call-label">参数：</div>' +
                '<pre class="tool-call-args">' + escHtml(argsStr) + '</pre>' +
                '<div class="tool-call-label">结果：</div>' +
                '<div class="tool-call-result">执行中…</div>' +
              '</div>';
            groupBody.appendChild(subItem);
            group.appendChild(header);
            group.appendChild(groupBody);
            tcContainer.appendChild(group);
          }
          var asstMsg = this.messages.findLast(m => m._tempId === tempId);
          if (asstMsg) {
            if (!asstMsg.tool_calls) asstMsg.tool_calls = [];
            asstMsg.tool_calls.push({ name: event.tool_name, arguments: event.arguments, result: null, _pending: true });
          }
        },
        onToolCall: (event) => {
          if (bubble) {
            var pendingCard = bubble.querySelector('.tool-call-item.pending');
            if (pendingCard) {
              pendingCard.classList.remove('pending');
              var resultEl = pendingCard.querySelector('.tool-call-result');
              if (resultEl) resultEl.textContent = event.result || '(无返回)';
              var spinner = pendingCard.querySelector('.tool-call-spinner');
              if (spinner) spinner.remove();
            }
          }
          var asstMsg = this.messages.findLast(m => m._tempId === tempId);
          if (asstMsg) {
            var pending = asstMsg.tool_calls && asstMsg.tool_calls.findLast(function(tc) { return tc._pending; });
            if (pending) {
              pending.result = event.result;
              delete pending._pending;
            }
          }
        },
        onDone: (messageId, userMessageId, userImageUrls, userFiles) => {
          if (!this.isStreaming) return;
          if (bubble) bubble.classList.remove('typing-cursor');
          const indicator = document.getElementById('tool-status');
          if (indicator) indicator.style.display = 'none';
          if (messageId) {
            const msgs = this.messages;
            const userMsg = msgs.findLast(m => m.role === 'user' && !m.id);
            if (userMsg && userMessageId) {
              userMsg.id = userMessageId;
              if (userImageUrls && userImageUrls.length) userMsg.image_urls = userImageUrls;
              if (userFiles && userFiles.length) userMsg.files = userFiles;
            }
            const asstMsg = msgs.findLast(m => m._tempId === tempId);
            if (asstMsg) {
              asstMsg.content = fullContent;
              asstMsg.id = messageId;
              delete asstMsg._tempId;
            }
            // 同步到 _allMessages，保证切换对话回来数据完整
            this._syncAllMessages();
          } else {
            // 流异常结束：删掉空的 temp assistant，保留 user 消息
            this.messages = this.messages.filter(m => !m._tempId);
            this._showRetryBanner();
          }
          this.isStreaming = false;
          this._abortController = null;
          this.setSendButtonLoading(false);
          // 增量更新：不销毁重建，避免页面抽动
          if (bubble) {
            var msgEl = bubble.closest('.message');
            if (msgEl && messageId) msgEl.dataset.msgId = messageId;
            if (userMessageId) {
              var allUserMsgs = container && container.querySelectorAll('.message.user');
              var userMsgEl = allUserMsgs && allUserMsgs[allUserMsgs.length - 1];
              if (userMsgEl) {
                userMsgEl.dataset.msgId = userMessageId;
                // 添加编辑按钮
                if (!userMsgEl.querySelector('.msg-actions')) {
                  var userActs = document.createElement('div');
                  userActs.className = 'msg-actions';
                  userActs.innerHTML = '<button class="msg-edit-btn" onclick="Chat.startEdit(\'' + userMessageId + '\')" title="编辑">' +
                    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
                    '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
                  userMsgEl.appendChild(userActs);
                }
              }
            }
            // 添加重新生成按钮
            if (msgEl && !msgEl.querySelector('.msg-actions')) {
              var acts = document.createElement('div');
              acts.className = 'msg-actions';
              acts.innerHTML = '<button class="msg-regen-btn" onclick="Chat.regenerate()" title="重新生成">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>' +
                '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>';
              msgEl.appendChild(acts);
            }
          }
          this.loadConversations();
          WorldBook.load();

          // 工具调用汇总（同工具多次调用 → 可折叠文件夹）
          if (asstMsg && asstMsg.tool_calls && asstMsg.tool_calls.length) {
            var toolGroups = {};
            for (var ti = 0; ti < asstMsg.tool_calls.length; ti++) {
              var tc = asstMsg.tool_calls[ti];
              if (!toolGroups[tc.name]) toolGroups[tc.name] = { calls: [], count: 0 };
              toolGroups[tc.name].calls.push(tc);
              if (tc.result) {
                var c = 0;
                if (tc.name === 'search_library') {
                  var mm = tc.result.match(/\d+\. 标题:/g);
                  c = mm ? mm.length : 0;
                } else if (tc.name === 'search_world_entries') {
                  var mm = tc.result.match(/共 (\d+) 条结果/);
                  c = mm ? parseInt(mm[1], 10) : 0;
                } else if (tc.name === 'read_library_entry' || tc.name === 'get_world_entry') {
                  c = 1;
                }
                toolGroups[tc.name].count += c;
              }
            }
            var toolParts = [];
            for (var name in toolGroups) {
              var g = toolGroups[name];
              if (!g.count) continue;
              var icon = name.indexOf('library') !== -1 ? '📚' : '📄';
              toolParts.push({icon: icon, label: icon + ' ' + g.count + ' 条', group: g});
            }
            if (toolParts.length) {
              var toolSummary = document.createElement('div');
              toolSummary.className = 'tool-summary-bar';
              for (var pi = 0; pi < toolParts.length; pi++) {
                var tp = toolParts[pi];
                if (tp.group.calls.length > 1) {
                  var folder = document.createElement('span');
                  folder.className = 'tool-summary-folder';
                  var toggle = document.createElement('span');
                  toggle.className = 'tool-summary-toggle';
                  toggle.textContent = '▶';
                  var labelSpan = document.createElement('span');
                  labelSpan.textContent = tp.label;
                  folder.appendChild(toggle);
                  folder.appendChild(labelSpan);
                  var subList = document.createElement('div');
                  subList.className = 'tool-summary-sublist';
                  subList.style.display = 'none';
                  for (var si = 0; si < tp.group.calls.length; si++) {
                    var subItem = document.createElement('div');
                    subItem.className = 'tool-summary-subitem';
                    var sc = 0;
                    var stc = tp.group.calls[si];
                    if (stc.result) {
                      if (stc.name === 'search_library') {
                        var sm = stc.result.match(/\d+\. 标题:/g);
                        sc = sm ? sm.length : 0;
                      } else if (stc.name === 'search_world_entries') {
                        var sm = stc.result.match(/共 (\d+) 条结果/);
                        sc = sm ? parseInt(sm[1], 10) : 0;
                      } else if (stc.name === 'read_library_entry' || stc.name === 'get_world_entry') {
                        sc = 1;
                      }
                    }
                    subItem.textContent = tp.icon + ' ➜ ' + (stc.name.replace(/_/g, ' ')) + (sc ? ' (' + sc + ' 条)' : '');
                    subList.appendChild(subItem);
                  }
                  folder.appendChild(subList);
                  toggle.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var sub = this.parentNode.querySelector('.tool-summary-sublist');
                    var isHidden = sub.style.display === 'none';
                    sub.style.display = isHidden ? 'block' : 'none';
                    this.textContent = isHidden ? '▼' : '▶';
                  });
                  toolSummary.appendChild(folder);
                } else {
                  var plain = document.createElement('span');
                  plain.textContent = tp.label;
                  toolSummary.appendChild(plain);
                }
                if (pi < toolParts.length - 1) {
                  var sep = document.createElement('span');
                  sep.textContent = '  ';
                  toolSummary.appendChild(sep);
                }
              }
              if (msgEl) {
                msgEl.parentNode.insertBefore(toolSummary, msgEl.nextSibling);
              }
            }
          }
        },
        onError: (errMsg) => {
          // 清理流状态，显示错误和重试按钮
          this.messages = this.messages.filter(m => !m._tempId);
          this.isStreaming = false;
          this._abortController = null;
          this.setSendButtonLoading(false);
          this.renderMessages();
          this._showRetryBanner();
          if (bubble) {
            var note = document.createElement('div');
            note.className = 'stream-error-note';
            note.textContent = '⚠️ ' + errMsg;
            bubble.parentNode.appendChild(note);
          }
        },
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        // 用户主动停止，保留已有内容
        this._finalizeStream(tempId, fullContent, bubble, container);
      } else {
        this.showStreamError(e.message);
      }
    }
  },

  async regenerate(userMsgId) {
    if (!this.currentConvId || this.isStreaming) return;

    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      this.messages.pop();
    }

    this.renderMessages();
    this.isStreaming = true;
    this._abortController = new AbortController();
    this.setSendButtonLoading(true);

    const tempId = 'streaming-msg';
    this.messages.push({ role: 'assistant', content: '', _tempId: tempId });
    this.renderMessages();

    const container = document.getElementById('messages-container');
    const bubble = container.querySelector(`.message:last-child .bubble`);
    if (bubble) bubble.classList.add('typing-cursor');
    if (bubble) {
      // 建立文字容器和工具调用容器，分离更新
      var bt = document.createElement('div');
      bt.className = 'bubble-text';
      bubble.appendChild(bt);
    }

    try {
      const resp = await API.regenerateStream(this.currentConvId, this.providerId, userMsgId, this._abortController.signal);
      if (!resp.ok) {
        const err = await resp.text();
        this.showStreamError(`重生成失败: ${err}`);
        return;
      }

      let fullContent = '';
      var self = this;
      parseSSE(resp, {
        onToken: (content) => {
          fullContent += content;
          // 用 rAF 节流：每帧最多更新一次 DOM，手机上 token 密集时不卡
          if (!self._rafPending) {
            self._rafPending = true;
            requestAnimationFrame(function() {
              self._rafPending = false;
              if (bubble) {
                var bt = bubble.querySelector('.bubble-text');
                if (bt) bt.innerHTML = renderMarkdown(fullContent);
                // 只在用户靠近底部时自动滚动
                const threshold = 100;
                const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
                if (nearBottom) container.scrollTop = container.scrollHeight;
              }
            });
          }
        },
        onToolStatus: (msg) => {
          const indicator = document.getElementById('tool-status');
          if (indicator) { indicator.textContent = msg; indicator.style.display = 'block'; }
        },
        onWorldbookInjected: (entries) => {
          if (!entries || !entries.length) return;
          // 存到消息对象上（含 match_type）
          var lastUser = self.messages.filter(function(m) { return m.role === 'user'; }).pop();
          if (lastUser) {
            if (!lastUser._wbRefs) lastUser._wbRefs = [];
            var existing = {};
            lastUser._wbRefs.forEach(function(t) { existing[t] = true; });
            entries.forEach(function(e) { if (!existing[e.title]) { existing[e.title] = true; lastUser._wbRefs.push(e.title); } });
          }
          // 更新 DOM：显示增强引用栏，区分精确 ✅ 和可能 🔗
          if (!container) return;
          var allUserMsgs = container.querySelectorAll('.message.user');
          var userMsgEl = allUserMsgs[allUserMsgs.length - 1];
          if (!userMsgEl) return;
          if (userMsgEl.nextElementSibling && userMsgEl.nextElementSibling.classList.contains('wb-ref-bar')) return;
          var exact = entries.filter(function(e) { return e.match_type === 'exact'; });
          var fuzzy = entries.filter(function(e) { return e.match_type === 'fuzzy'; });
          var manual = entries.filter(function(e) { return e.match_type === 'manual'; });
          var parts = [];
          if (exact.length) parts.push('✅ ' + exact.map(function(e) { return e.title; }).join(', '));
          if (fuzzy.length) parts.push('🔗 ' + fuzzy.map(function(e) { return e.title; }).join(', '));
          if (manual.length) parts.push('📌 ' + manual.map(function(e) { return e.title; }).join(', '));
          var bar = document.createElement('div');
          bar.className = 'wb-ref-bar wb-ref-enhanced';
          bar.textContent = parts.join('  ');
          userMsgEl.parentNode.insertBefore(bar, userMsgEl.nextSibling);
        },
        onToolCallStart: (event) => {
          if (!bubble) return;
          var tcContainer = bubble.querySelector('.tool-calls');
          if (!tcContainer) {
            tcContainer = document.createElement('div');
            tcContainer.className = 'tool-calls';
            bubble.appendChild(tcContainer);
          }
          var argsStr = event.arguments || '{}';
          var toolName = event.tool_name;
          var existingGroup = null;
          var groups = tcContainer.querySelectorAll('.tool-call-group');
          for (var gi = 0; gi < groups.length; gi++) {
            var nameEl = groups[gi].querySelector('.tool-call-group-header .tool-call-name');
            if (nameEl && nameEl.textContent === toolName) {
              existingGroup = groups[gi];
              break;
            }
          }
          if (existingGroup) {
            var groupBody = existingGroup.querySelector('.tool-call-group-body');
            var countEl = existingGroup.querySelector('.tool-call-count');
            var cur = parseInt(countEl.textContent, 10) || 1;
            countEl.textContent = cur + 1;
            var subItem = document.createElement('div');
            subItem.className = 'tool-call-item pending';
            subItem.innerHTML =
              '<div class="tool-call-header" onclick="this.parentElement.classList.toggle(\'expanded\')">' +
                '<span class="tool-call-arrow">▶</span> ' +
                '<span class="tool-call-name">' + escHtml(toolName) + '</span>' +
                '<span class="tool-call-idx">#' + (cur + 1) + '</span>' +
                '<span class="tool-call-spinner" style="margin-left:auto;font-size:11px;color:var(--text-secondary)">···</span>' +
              '</div>' +
              '<div class="tool-call-body">' +
                '<div class="tool-call-label">参数：</div>' +
                '<pre class="tool-call-args">' + escHtml(argsStr) + '</pre>' +
                '<div class="tool-call-label">结果：</div>' +
                '<div class="tool-call-result">执行中…</div>' +
              '</div>';
            groupBody.appendChild(subItem);
          } else {
            var group = document.createElement('div');
            group.className = 'tool-call-group';
            var header = document.createElement('div');
            header.className = 'tool-call-group-header';
            header.innerHTML =
              '<span class="tool-call-arrow">▶</span> ' +
              '<span class="tool-call-name">' + escHtml(toolName) + '</span>' +
              '<span class="tool-call-count">1</span>';
            header.onclick = function() {
              var body = this.nextElementSibling;
              var hidden = body.style.display !== 'block';
              body.style.display = hidden ? 'block' : 'none';
              this.querySelector('.tool-call-arrow').textContent = hidden ? '▼' : '▶';
            };
            var groupBody = document.createElement('div');
            groupBody.className = 'tool-call-group-body';
            groupBody.style.display = 'block';
            var subItem = document.createElement('div');
            subItem.className = 'tool-call-item pending';
            subItem.innerHTML =
              '<div class="tool-call-header" onclick="this.parentElement.classList.toggle(\'expanded\')">' +
                '<span class="tool-call-arrow">▶</span> ' +
                '<span class="tool-call-name">' + escHtml(toolName) + '</span>' +
                '<span class="tool-call-idx">#1</span>' +
                '<span class="tool-call-spinner" style="margin-left:auto;font-size:11px;color:var(--text-secondary)">···</span>' +
              '</div>' +
              '<div class="tool-call-body">' +
                '<div class="tool-call-label">参数：</div>' +
                '<pre class="tool-call-args">' + escHtml(argsStr) + '</pre>' +
                '<div class="tool-call-label">结果：</div>' +
                '<div class="tool-call-result">执行中…</div>' +
              '</div>';
            groupBody.appendChild(subItem);
            group.appendChild(header);
            group.appendChild(groupBody);
            tcContainer.appendChild(group);
          }
          var asstMsg = this.messages.findLast(m => m._tempId === tempId);
          if (asstMsg) {
            if (!asstMsg.tool_calls) asstMsg.tool_calls = [];
            asstMsg.tool_calls.push({ name: event.tool_name, arguments: event.arguments, result: null, _pending: true });
          }
        },
        onToolCall: (event) => {
          if (bubble) {
            var pendingCard = bubble.querySelector('.tool-call-item.pending');
            if (pendingCard) {
              pendingCard.classList.remove('pending');
              var resultEl = pendingCard.querySelector('.tool-call-result');
              if (resultEl) resultEl.textContent = event.result || '(无返回)';
              var spinner = pendingCard.querySelector('.tool-call-spinner');
              if (spinner) spinner.remove();
            }
          }
          var asstMsg = this.messages.findLast(m => m._tempId === tempId);
          if (asstMsg) {
            var pending = asstMsg.tool_calls && asstMsg.tool_calls.findLast(function(tc) { return tc._pending; });
            if (pending) {
              pending.result = event.result;
              delete pending._pending;
            }
          }
        },
        onDone: (messageId) => {
          if (!this.isStreaming) return;
          if (bubble) bubble.classList.remove('typing-cursor');
          const indicator = document.getElementById('tool-status');
          if (indicator) indicator.style.display = 'none';
          if (messageId) {
            const msgs = this.messages;
            const asstMsg = msgs.findLast(m => m._tempId === tempId);
            if (asstMsg) {
              asstMsg.content = fullContent;
              asstMsg.id = messageId;
              delete asstMsg._tempId;
            }
            this._syncAllMessages();
          } else {
            this.messages = this.messages.filter(m => !m._tempId);
            this._showRetryBanner();
          }
          this.isStreaming = false;
          this._abortController = null;
          this.setSendButtonLoading(false);
          // 增量更新，避免全量重绘导致抽动
          if (bubble) {
            var msgEl = bubble.closest('.message');
            if (msgEl && messageId) msgEl.dataset.msgId = messageId;
            if (msgEl && !msgEl.querySelector('.msg-actions')) {
              var acts = document.createElement('div');
              acts.className = 'msg-actions';
              acts.innerHTML = '<button class="msg-regen-btn" onclick="Chat.regenerate()" title="重新生成">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>' +
                '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>';
              msgEl.appendChild(acts);
            }
            // 同步确保用户消息也有编辑按钮
            var allUserMsgs = container && container.querySelectorAll('.message.user');
            var userMsgEl = allUserMsgs && allUserMsgs[allUserMsgs.length - 1];
            if (userMsgEl && !userMsgEl.querySelector('.msg-actions')) {
              var userActs = document.createElement('div');
              userActs.className = 'msg-actions';
              var uid = userMsgEl.dataset.msgId;
              if (uid) {
                userActs.innerHTML = '<button class="msg-edit-btn" onclick="Chat.startEdit(\'' + uid + '\')" title="编辑">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
                  '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>';
                userMsgEl.appendChild(userActs);
              }
            }
          }
          this.loadConversations();
          WorldBook.load();

          // 工具调用汇总（同工具多次调用 → 可折叠文件夹）
          if (asstMsg && asstMsg.tool_calls && asstMsg.tool_calls.length) {
            var toolGroups = {};
            for (var ti = 0; ti < asstMsg.tool_calls.length; ti++) {
              var tc = asstMsg.tool_calls[ti];
              if (!toolGroups[tc.name]) toolGroups[tc.name] = { calls: [], count: 0 };
              toolGroups[tc.name].calls.push(tc);
              if (tc.result) {
                var c = 0;
                if (tc.name === 'search_library') {
                  var mm = tc.result.match(/\d+\. 标题:/g);
                  c = mm ? mm.length : 0;
                } else if (tc.name === 'search_world_entries') {
                  var mm = tc.result.match(/共 (\d+) 条结果/);
                  c = mm ? parseInt(mm[1], 10) : 0;
                } else if (tc.name === 'read_library_entry' || tc.name === 'get_world_entry') {
                  c = 1;
                }
                toolGroups[tc.name].count += c;
              }
            }
            var toolParts = [];
            for (var name in toolGroups) {
              var g = toolGroups[name];
              if (!g.count) continue;
              var icon = name.indexOf('library') !== -1 ? '📚' : '📄';
              toolParts.push({icon: icon, label: icon + ' ' + g.count + ' 条', group: g});
            }
            if (toolParts.length) {
              var toolSummary = document.createElement('div');
              toolSummary.className = 'tool-summary-bar';
              for (var pi = 0; pi < toolParts.length; pi++) {
                var tp = toolParts[pi];
                if (tp.group.calls.length > 1) {
                  var folder = document.createElement('span');
                  folder.className = 'tool-summary-folder';
                  var toggle = document.createElement('span');
                  toggle.className = 'tool-summary-toggle';
                  toggle.textContent = '▶';
                  var labelSpan = document.createElement('span');
                  labelSpan.textContent = tp.label;
                  folder.appendChild(toggle);
                  folder.appendChild(labelSpan);
                  var subList = document.createElement('div');
                  subList.className = 'tool-summary-sublist';
                  subList.style.display = 'none';
                  for (var si = 0; si < tp.group.calls.length; si++) {
                    var subItem = document.createElement('div');
                    subItem.className = 'tool-summary-subitem';
                    var sc = 0;
                    var stc = tp.group.calls[si];
                    if (stc.result) {
                      if (stc.name === 'search_library') {
                        var sm = stc.result.match(/\d+\. 标题:/g);
                        sc = sm ? sm.length : 0;
                      } else if (stc.name === 'search_world_entries') {
                        var sm = stc.result.match(/共 (\d+) 条结果/);
                        sc = sm ? parseInt(sm[1], 10) : 0;
                      } else if (stc.name === 'read_library_entry' || stc.name === 'get_world_entry') {
                        sc = 1;
                      }
                    }
                    subItem.textContent = tp.icon + ' ➜ ' + (stc.name.replace(/_/g, ' ')) + (sc ? ' (' + sc + ' 条)' : '');
                    subList.appendChild(subItem);
                  }
                  folder.appendChild(subList);
                  toggle.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var sub = this.parentNode.querySelector('.tool-summary-sublist');
                    var isHidden = sub.style.display === 'none';
                    sub.style.display = isHidden ? 'block' : 'none';
                    this.textContent = isHidden ? '▼' : '▶';
                  });
                  toolSummary.appendChild(folder);
                } else {
                  var plain = document.createElement('span');
                  plain.textContent = tp.label;
                  toolSummary.appendChild(plain);
                }
                if (pi < toolParts.length - 1) {
                  var sep = document.createElement('span');
                  sep.textContent = '  ';
                  toolSummary.appendChild(sep);
                }
              }
              if (msgEl) {
                msgEl.parentNode.insertBefore(toolSummary, msgEl.nextSibling);
              }
            }
          }
        },
        onError: (errMsg) => {
          this.showStreamError(errMsg);
        },
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        this._finalizeStream(tempId, fullContent, bubble, container);
      } else {
        this.showStreamError(e.message);
      }
    }
  },

  showStreamError(errMsg) {
    const asstMsg = this.messages.findLast(m => m._tempId);
    if (asstMsg) {
      if (asstMsg.content && asstMsg.content.length > 0) {
        asstMsg.content += `\n\n> ⚠️ ${errMsg}`;
        delete asstMsg._tempId;
      } else {
        // 只删占位 assistant，保留 user 消息
        this.messages = this.messages.filter(m => !m._tempId);
      }
    }
    this.renderMessages();
    this.isStreaming = false;
    this.setSendButtonLoading(false);
    this._showRetryBanner();
  },

  _showRetryBanner() {
    // 移除旧的重试栏
    var old = document.querySelector('.retry-bar');
    if (old) old.remove();
    var btn = document.getElementById('btn-send');
    if (btn) {
      btn.textContent = '重发';
      btn.disabled = false;
      btn.onclick = () => {
        btn.onclick = null;
        // 恢复文本到输入框
        if (this._retryCtx && this._retryCtx.text) {
          var input = document.getElementById('message-input');
          if (input) input.value = this._retryCtx.text;
        }
        this._retryCtx = null;
        this.send();
      };
    }
  },

  setSendButtonLoading(loading) {
    const btn = document.getElementById('btn-send');
    if (btn) {
      btn.textContent = loading ? '■ 停止' : '发送';
      btn.disabled = false;
      btn.classList.toggle('stop', loading);
    }
  },

  stopStreaming() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  },

  // 流结束/中断后的收尾：保留已输出的内容
  _finalizeStream(tempId, fullContent, bubble, container) {
    if (bubble) bubble.classList.remove('typing-cursor');
    const indicator = document.getElementById('tool-status');
    if (indicator) indicator.style.display = 'none';
    const asstMsg = this.messages.findLast(m => m._tempId === tempId);
    if (asstMsg) {
      asstMsg.content = fullContent || '(已中断)';
      delete asstMsg._tempId;
    }
    this._syncAllMessages();
    this.isStreaming = false;
    this._abortController = null;
    this.setSendButtonLoading(false);
  },

  // 把 this.messages 同步到 _allMessages，保证切换回来数据完整
  _syncAllMessages() {
    if (!this._allMessages) return;
    var existingIds = {};
    for (var i = 0; i < this._allMessages.length; i++) {
      if (this._allMessages[i].id) existingIds[this._allMessages[i].id] = true;
    }
    for (var j = 0; j < this.messages.length; j++) {
      var m = this.messages[j];
      if (m.id && !existingIds[m.id]) {
        this._allMessages.push(m);
        existingIds[m.id] = true;
      }
    }
  },
  /**
   * 设置粘贴/拖拽/点击上传图片
   */
  _setupImageInput() {
    const inputArea = document.getElementById('input-area');
    const textarea = document.getElementById('message-input');
    const preview = document.getElementById('img-preview');
    const fileInput = document.getElementById('file-input');
    const uploadBtn = document.getElementById('btn-upload-img');
    if (!inputArea || !textarea || !preview) return;

    const self = this;

    // 粘贴图片（传统 for 循环，兼容性更好）
    textarea.addEventListener('paste', function(e) {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.type && item.type.indexOf('image/') === 0) {
          e.preventDefault();
          var file = item.getAsFile && item.getAsFile();
          if (file) self._readImageFile(file);
          return;
        }
      }
    });

    // 拖拽上传（图片 + 文件）
    inputArea.addEventListener('dragover', function(e) {
      e.preventDefault();
      inputArea.classList.add('drag-over');
    });
    inputArea.addEventListener('dragleave', function() {
      inputArea.classList.remove('drag-over');
    });
    inputArea.addEventListener('drop', function(e) {
      e.preventDefault();
      inputArea.classList.remove('drag-over');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files) return;
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (file.type && file.type.indexOf('image/') === 0) {
          self._readImageFile(file);
        } else {
          self._addPendingFile(file);
        }
      }
    });

    // 文件选择按钮（支持多图）
    if (uploadBtn && fileInput) {
      fileInput.multiple = true;  // 允许多选
      uploadBtn.addEventListener('click', function() {
        fileInput.click();
      });
      fileInput.addEventListener('change', function(e) {
        var files = e.target && e.target.files;
        if (!files || !files.length) return;
        for (var fi = 0; fi < files.length; fi++) {
          self._readImageFile(files[fi]);
        }
        fileInput.value = '';
      });
    }
  },

  _readImageFile(file) {
    if (!file) return;
    var self = this;
    if (!self._pendingImages) self._pendingImages = [];
    var reader = new FileReader();
    reader.onload = function(e) {
      var preview = document.getElementById('img-preview');
      if (!preview) return;
      var dataUrl = e.target && e.target.result;
      if (!dataUrl) return;
      var base64 = dataUrl.split(',')[1];
      if (!base64) return;
      // 推入数组
      self._pendingImages.push(base64);
      // 追加预览缩略图
      var item = document.createElement('div');
      item.className = 'img-preview-item';
      item.innerHTML =
        '<img src="' + dataUrl + '" alt="图片预览">' +
        '<button class="img-preview-remove" data-idx="' + (self._pendingImages.length - 1) + '">×</button>';
      preview.appendChild(item);
      preview.classList.remove('hidden');
      // × 按钮移除单张
      var rmBtn = item.querySelector('.img-preview-remove');
      if (rmBtn) {
        rmBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          var idx = parseInt(rmBtn.dataset.idx);
          if (self._pendingImages) self._pendingImages.splice(idx, 1);
          item.remove();
          if (!preview.children.length) preview.classList.add('hidden');
          // 更新后续按钮的索引
          var items = preview.querySelectorAll('.img-preview-item');
          for (var i = 0; i < items.length; i++) {
            var btn = items[i].querySelector('.img-preview-remove');
            if (btn) btn.dataset.idx = i;
          }
        });
      }
      // 触发发送按钮状态更新
      var inp = document.getElementById('message-input');
      if (inp) inp.dispatchEvent(new Event('input'));
    };
    reader.onerror = function() {
      console.warn('FileReader 读取失败:', file.name);
    };
    reader.readAsDataURL(file);
  },

  _removeImage() {
    // 兼容旧版单图清除（保留）
    var preview = document.getElementById('img-preview');
    if (preview) {
      preview.innerHTML = '';
      preview.classList.add('hidden');
    }
    this._pendingImages = [];
    var inp = document.getElementById('message-input');
    if (inp) inp.dispatchEvent(new Event('input'));
  },

  // ─── 文件上传 ──────────────────────────────────────────

  _setupFileInput() {
    const uploadBtn = document.getElementById('btn-upload-file');
    const fileInput = document.getElementById('file-input-file');
    if (!uploadBtn || !fileInput) return;
    const self = this;
    uploadBtn.addEventListener('click', function() {
      fileInput.click();
    });
    fileInput.addEventListener('change', function(e) {
      var files = e.target && e.target.files;
      if (!files || !files.length) return;
      for (var i = 0; i < files.length; i++) {
        self._addPendingFile(files[i]);
      }
      fileInput.value = '';
    });
  },

  _pendingFiles: [],

  _addPendingFile(file) {
    if (!file) return;
    // 检查是否已添加同名文件
    for (var i = 0; i < this._pendingFiles.length; i++) {
      if (this._pendingFiles[i].name === file.name && this._pendingFiles[i].size === file.size) return;
    }
    this._pendingFiles.push(file);
    this._renderFilePreview();
  },

  _removePendingFile(index) {
    if (index >= 0 && index < this._pendingFiles.length) {
      this._pendingFiles.splice(index, 1);
    }
    this._renderFilePreview();
  },

  _renderFilePreview() {
    var el = document.getElementById('file-preview');
    if (!el) return;
    var files = this._pendingFiles;
    if (!files || !files.length) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    var html = '';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      html +=
        '<div class="file-preview-item">' +
          '<span class="file-preview-icon">📎</span>' +
          '<span class="file-preview-name">' + escHtml(f.name) + '</span>' +
          '<span class="file-preview-size">' + _fmtSize(f.size) + '</span>' +
          '<button class="file-preview-remove" onclick="Chat._removePendingFile(' + i + ')">×</button>' +
        '</div>';
    }
    el.innerHTML = html;
    el.classList.remove('hidden');
  },

  // ─── 语音输入 ──────────────────────────────────────────

  _recognition: null,
  _isRecording: false,

  _initSpeechRecognition() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    this._recognition = new SR();
    this._recognition.lang = 'zh-CN';
    this._recognition.continuous = true;
    this._recognition.interimResults = true;
    this._recognition.maxAlternatives = 1;

    var self = this;
    var textarea = document.getElementById('message-input');
    var btn = document.getElementById('btn-voice');

    this._recognition.onresult = function(e) {
      var interim = '';
      var final = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      // 最终结果追加到已有内容
      if (final) {
        textarea.value = (textarea.value || '') + final;
      }
      // 临时结果显示在末尾（灰色，让用户看到正在识别）
      if (interim) {
        var current = textarea.value;
        // 去掉之前的临时部分（如果有）
        if (self._lastInterim !== undefined && current.endsWith(self._lastInterim)) {
          current = current.slice(0, -self._lastInterim.length);
        }
        textarea.value = current + interim;
        self._lastInterim = interim;
      }
    };

    this._recognition.onerror = function(e) {
      console.warn('语音识别错误:', e.error);
      if (e.error === 'not-allowed') {
        alert('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问。');
      }
      self._stopRecordingUI();
    };

    this._recognition.onend = function() {
      self._stopRecordingUI();
      // 清理临时文本
      if (self._lastInterim && textarea) {
        var cur = textarea.value;
        if (cur.endsWith(self._lastInterim)) {
          textarea.value = cur.slice(0, -self._lastInterim.length);
        }
      }
      self._lastInterim = undefined;
    };
  },

  _startRecordingUI() {
    this._isRecording = true;
    var btn = document.getElementById('btn-voice');
    if (btn) btn.classList.add('recording');
  },

  _stopRecordingUI() {
    this._isRecording = false;
    var btn = document.getElementById('btn-voice');
    if (btn) btn.classList.remove('recording');
  },

  toggleVoiceInput() {
    if (this._isRecording) {
      if (this._recognition) {
        try { this._recognition.stop(); } catch(e) {}
      }
      this._stopRecordingUI();
      return;
    }

    // 延迟初始化（第一次点击时才创建）
    if (!this._recognition) {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        alert('您的浏览器不支持语音输入，请使用 Chrome 或 Edge。');
        return;
      }
      this._initSpeechRecognition();
    }

    // 检查权限 + 开始录音
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then(function() {
        // 权限有了，开始识别
        try {
          this._recognition.start();
          this._startRecordingUI();
        } catch(e) {
          console.warn('语音启动失败:', e);
        }
      }.bind(this))
      .catch(function(err) {
        console.warn('麦克风权限被拒绝:', err);
        alert('需要麦克风权限才能使用语音输入。');
      });
  },

  // ─── 手机端长按换行 ──────────────────────────

  _setupMobileInput() {
    // 只在移动设备上启用
    if (!('ontouchstart' in window)) return;
    var ta = document.getElementById('message-input');
    if (!ta) return;

    var self = this;
    var timer = null;
    var longPressed = false;

    ta.addEventListener('touchstart', function(e) {
      longPressed = false;
      timer = setTimeout(function() {
        longPressed = true;
        self._showNewlineMenu(e);
      }, 500);
    }, { passive: true });

    ta.addEventListener('touchend', function(e) {
      clearTimeout(timer);
      if (longPressed) {
        e.preventDefault();
        longPressed = false;
      }
    }, { passive: false });

    ta.addEventListener('touchmove', function() {
      clearTimeout(timer);
      longPressed = false;
      self._hideNewlineMenu();
    }, { passive: true });

    // 点击其他地方关闭菜单
    document.addEventListener('touchstart', function(e) {
      if (!e.target.closest('.mobile-text-menu') && !e.target.closest('#message-input')) {
        self._hideNewlineMenu();
      }
    }, { passive: true });
  },

  _showNewlineMenu(e) {
    this._hideNewlineMenu();
    var touch = e.touches[0];
    var menu = document.createElement('div');
    menu.className = 'mobile-text-menu';
    menu.innerHTML =
      '<button class="mobile-text-menu-btn" onclick="Chat._insertNewline()">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></polyline></svg>' +
        '换行' +
      '</button>';
    menu.style.position = 'fixed';

    // 定位在输入框上方
    var ta = document.getElementById('message-input');
    if (ta) {
      var rect = ta.getBoundingClientRect();
      menu.style.left = '16px';
      menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    } else {
      menu.style.left = touch.clientX + 'px';
      menu.style.top = (touch.clientY - 60) + 'px';
    }

    document.body.appendChild(menu);
  },

  _hideNewlineMenu() {
    var old = document.querySelector('.mobile-text-menu');
    if (old) old.remove();
  },

  _insertNewline() {
    this._hideNewlineMenu();
    var ta = document.getElementById('message-input');
    if (!ta) return;
    var pos = ta.selectionStart;
    var val = ta.value;
    ta.value = val.substring(0, pos) + '\n' + val.substring(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = pos + 1;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  },
};

// ─── 初始化语音按钮 + 手机端长按菜单 ────────────────
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    var voiceBtn = document.getElementById('btn-voice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', function() {
        Chat.toggleVoiceInput();
      });
    }
    Chat._setupMobileInput();
  }, 200);
});

/**
 * Markdown → HTML（使用 marked.js）
 */
function renderMarkdown(text) {
  if (!text) return '';
  // 只转义 HTML，不做自定义 link renderer（marked v12 自动处理 XSS）
  const safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = marked.parse(safe, {
    breaks: true,
    gfm: true,
  });
  // 安全后处理：阻止 javascript: URL + 新窗口打开
  html = html.replace(/<a\s+href="javascript:/gi, '<a href="#blocked"');
  return html;
}

/**
 * 工具调用 → 可折叠 HTML
 */
function toggleToolSublist(el) {
  var sub = el.parentNode.querySelector('.tool-summary-sublist');
  if (!sub) return;
  var hidden = sub.style.display !== 'block';
  sub.style.display = hidden ? 'block' : 'none';
  el.textContent = hidden ? '▼' : '▶';
}

function renderToolSummary(toolCalls) {
  if (!toolCalls || !toolCalls.length) return '';
  var groups = {};
  for (var i = 0; i < toolCalls.length; i++) {
    var tc = toolCalls[i];
    if (!groups[tc.name]) groups[tc.name] = { calls: [], count: 0 };
    groups[tc.name].calls.push(tc);
    if (tc.result) {
      var c = 0;
      if (tc.name === 'search_library') {
        var mm = tc.result.match(/\d+\. 标题:/g);
        c = mm ? mm.length : 0;
      } else if (tc.name === 'search_world_entries') {
        var mm = tc.result.match(/共 (\d+) 条结果/);
        c = mm ? parseInt(mm[1], 10) : 0;
      } else if (tc.name === 'read_library_entry' || tc.name === 'get_world_entry') {
        c = 1;
      }
      groups[tc.name].count += c;
    }
  }
  var names = Object.keys(groups).filter(function(n) { return groups[n].count > 0; });
  if (!names.length) return '';
  var html = '<div class="tool-summary-bar">';
  for (var ni = 0; ni < names.length; ni++) {
    var g = groups[names[ni]];
    var icon = names[ni].indexOf('library') !== -1 ? '📚' : '📄';
    if (g.calls.length > 1) {
      html += '<span class="tool-summary-folder">'
        + '<span class="tool-summary-toggle" onclick="toggleToolSublist(this)">▶</span> '
        + icon + ' ' + g.count + ' 条'
        + '<div class="tool-summary-sublist" style="display:none">';
      for (var si = 0; si < g.calls.length; si++) {
        var sc = 0;
        var stc = g.calls[si];
        if (stc.result) {
          if (stc.name === 'search_library') {
            var sm = stc.result.match(/\d+\. 标题:/g);
            sc = sm ? sm.length : 0;
          } else if (stc.name === 'search_world_entries') {
            var sm = stc.result.match(/共 (\d+) 条结果/);
            sc = sm ? parseInt(sm[1], 10) : 0;
          } else if (stc.name === 'read_library_entry' || stc.name === 'get_world_entry') {
            sc = 1;
          }
        }
        html += '<div class="tool-summary-subitem">' + icon + ' ➜ ' + stc.name.replace(/_/g, ' ') + (sc ? ' (' + sc + ' 条)' : '') + '</div>';
      }
      html += '</div></span>';
    } else {
      html += icon + ' ' + g.count + ' 条';
    }
    if (ni < names.length - 1) html += '  ';
  }
  html += '</div>';
  return html;
}

function renderToolCalls(toolCalls) {
  if (!toolCalls || !toolCalls.length) return '';
  // 按工具名分组
  var groups = {};
  for (var i = 0; i < toolCalls.length; i++) {
    var tc = toolCalls[i];
    if (!groups[tc.name]) groups[tc.name] = [];
    groups[tc.name].push(tc);
  }
  var names = Object.keys(groups);
  var items = [];
  for (var ni = 0; ni < names.length; ni++) {
    var name = names[ni];
    var calls = groups[name];
    var count = calls.length;
    var subItems = '';
    for (var si = 0; si < calls.length; si++) {
      var tc = calls[si];
      var argsStr = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments, null, 2);
      var resultStr = tc.result || '(无返回)';
      subItems +=
        '<div class="tool-call-item">' +
          '<div class="tool-call-header" onclick="this.parentElement.classList.toggle(\'expanded\')">' +
            '<span class="tool-call-arrow">▶</span> ' +
            '<span class="tool-call-name">' + escHtml(tc.name) + '</span>' +
            '<span class="tool-call-idx">#' + (si + 1) + '</span>' +
          '</div>' +
          '<div class="tool-call-body">' +
            '<div class="tool-call-label">参数：</div>' +
            '<pre class="tool-call-args">' + escHtml(argsStr) + '</pre>' +
            '<div class="tool-call-label">结果：</div>' +
            '<div class="tool-call-result">' + escHtml(resultStr) + '</div>' +
          '</div>' +
        '</div>';
    }
    items.push(
      '<div class="tool-call-group">' +
        '<div class="tool-call-group-header" onclick="var b=this.nextElementSibling;b.style.display=b.style.display===\'block\'?\'none\':\'block\';this.querySelector(\'.tool-call-arrow\').textContent=b.style.display===\'block\'?\'▼\':\'▶\'">' +
          '<span class="tool-call-arrow">▶</span> ' +
          '<span class="tool-call-name">' + escHtml(name) + '</span>' +
          (count > 1 ? '<span class="tool-call-count">' + count + '</span>' : '') +
        '</div>' +
        '<div class="tool-call-group-body" style="display:none">' +
          subItems +
        '</div>' +
      '</div>'
    );
  }
  return '<div class="tool-calls">' + items.join('') + '</div>';
}
