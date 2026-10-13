/**
 * 🛠 工作间（阁楼工作台）
 * 模型可以在这里读写工作区文件、执行命令、管理钉板卡片
 * 支持专属工作台对话列表，多个工作台对话自由切换
 */

const Workspace = {
  convId: null,
  conversations: [],
  messages: [],
  providerId: null,
  isStreaming: false,
  abortController: null,
  fileTree: [],
  fileTreePath: '',
  expandedDirs: {},
  activeTab: 'code',
  pins: [],
  codeViewContent: '',
  codeViewPath: '',
  terminalHistory: '',
  diffContent: '',

  // ─── 初始化 ─────────────────────────

  async load() {
    // 加载 provider
    if (!this.providerId) {
      try {
        const providers = await API.listProviders();
        const def = providers.find(p => p.is_default) || providers[0];
        if (def) this.providerId = def.id;
      } catch { /* ignore */ }
    }

    // 加载工作台对话列表
    await this._loadConversations();

    // 如果 convId 未设置（首次加载），默认选第一个
    if (!this.convId && this.conversations.length) {
      this.convId = this.conversations[0].id;
    } else if (!this.convId) {
      // 没有工作台对话，创建一个
      await this._createNewAndSwitch();
      return;
    }

    await this._loadConvData();
  },

  async _loadConversations() {
    try {
      this.conversations = await API.listWorkspaceConversations();
    } catch (e) {
      console.warn('加载工作台对话列表失败:', e);
      this.conversations = [];
    }
  },

  async _loadConvData() {
    if (!this.convId) return;

    // 并行加载数据
    try {
      var msgData = await API.getMessages(this.convId);
      this.messages = msgData || [];
    } catch (e) {
      console.warn('加载消息失败:', e);
      this.messages = [];
    }

    try {
      var treeData = await API.getWorkspaceTree('');
      this.fileTree = treeData.items || [];
      this.fileTreePath = treeData.path || '';
    } catch (e) {
      console.warn('加载文件树失败:', e);
      this.fileTree = [];
    }

    try {
      var pinsData = await API.getWorkspacePins(this.convId);
      this.pins = pinsData.pins || [];
    } catch (e) {
      console.warn('加载钉板失败:', e);
      this.pins = [];
    }

    // 恢复代码视图
    this._restoreCodeView();

    this.render();
    this._scrollToBottom();
  },

  async switchConversation(convId) {
    if (convId === this.convId) return;
    this.convId = convId;
    this.messages = [];
    this.pins = [];
    this.codeViewPath = '';
    this.codeViewContent = '';
    this.terminalHistory = '';

    this.render(); // 清空渲染区域
    await this._loadConvData();
    // 重新加载对话列表以更新选中状态
    await this._renderConvList();
  },

  async newConversation() {
    await this._createNewAndSwitch();
  },

  async _createNewAndSwitch() {
    try {
      var titles = ['工作台', '代码工坊', '调试记录', '重构笔记', '功能开发'];
      var title = titles[Math.floor(Math.random() * titles.length)];
      var conv = await API.createWorkspaceConversation(title);
      this.conversations.push(conv);
      this.convId = conv.id;
      this.messages = [];
      this.pins = [];
      this.codeViewPath = '';
      this.codeViewContent = '';
      this.terminalHistory = '';
      await this._loadConvData(); // 会触发 render
    } catch (e) {
      console.error('创建工作台对话失败:', e);
    }
  },

  _restoreCodeView() {
    // 从最后一条 assistant 消息的 tool_call 中找到 read_file 调用
    for (var i = this.messages.length - 1; i >= 0; i--) {
      var m = this.messages[i];
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
        var calls = m.tool_calls;
        for (var j = calls.length - 1; j >= 0; j--) {
          if (calls[j].name === 'workspace_read_file') {
            try {
              var args = JSON.parse(calls[j].arguments || '{}');
              this.codeViewPath = args.path || '';
              this.codeViewContent = calls[j].result || '';
              return;
            } catch { /* ignore */ }
          }
        }
      }
    }
  },

  // ─── 渲染 ───────────────────────────

  render() {
    this._renderConvList();
    this.renderChat();
    this.renderFileTree();
    this.renderPinBoard();
    this.renderActiveTab();
  },

  _renderConvList() {
    var el = document.getElementById('ws-conv-list');
    if (!el) return;

    var html = '';
    html += '<div class="ws-conv-new" onclick="Workspace.newConversation()">';
    html += '<span>+ 新建工作台对话</span>';
    html += '</div>';

    if (this.conversations.length) {
      for (var i = 0; i < this.conversations.length; i++) {
        var c = this.conversations[i];
        var active = c.id === this.convId ? ' ws-conv-item-active' : '';
        var title = c.title || '工作台';
        html += '<div class="ws-conv-item' + active + '" data-id="' + c.id + '" onclick="Workspace.switchConversation(\'' + c.id + '\')">';
        html += '<span class="ws-conv-icon">🛠</span>';
        html += '<span class="ws-conv-title">' + escHtml(title) + '</span>';
        html += '</div>';
      }
    }

    // 重建列表：保留新建按钮，替换列表项
    var elChildren = el.children;
    while (elChildren.length > 1) {
      el.removeChild(elChildren[elChildren.length - 1]);
    }
    var container = document.createElement('div');
    container.innerHTML = html;
    var items = container.querySelectorAll('.ws-conv-item');
    items.forEach(function(item) { el.appendChild(item); });
  },

  renderChat() {
    var el = document.getElementById('ws-messages');
    if (!el) return;

    if (!this.messages.length) {
      el.innerHTML = '<div class="ws-empty"><p>在工作间里，助手可以修改工作区里的代码</p></div>';
      return;
    }

    var html = '';
    // 只显示 user 和 assistant 消息
    for (var i = 0; i < this.messages.length; i++) {
      var m = this.messages[i];
      if (m.role === 'system') continue;

      if (m.role === 'user') {
        html += '<div class="ws-msg ws-msg-user">';
        html += '<div class="ws-msg-meta">你</div>';
        html += '<div class="ws-msg-bubble">' + escHtml(m.content) + '</div>';
        html += '</div>';
      } else if (m.role === 'assistant') {
        html += '<div class="ws-msg ws-msg-ai">';
        html += '<div class="ws-msg-meta">助手</div>';
        html += '<div class="ws-msg-bubble ws-msg-bubble-ai">';
        // Markdown 渲染
        if (typeof marked === 'function') {
          html += marked(m.content || '');
        } else {
          html += '<p>' + escHtml(m.content || '') + '</p>';
        }
        // 工具调用
        if (m.tool_calls && m.tool_calls.length) {
          html += this._renderToolCalls(m.tool_calls);
        }
        html += '</div>';
        html += '</div>';
      }
    }

    // 流式占位
    if (this.isStreaming) {
      html += '<div class="ws-msg ws-msg-ai" id="ws-streaming-msg">';
      html += '<div class="ws-msg-meta">助手</div>';
      html += '<div class="ws-msg-bubble ws-msg-bubble-ai" id="ws-streaming-content">';
      html += '<span class="ws-typing">▊</span>';
      html += '</div>';
      html += '</div>';
    }

    el.innerHTML = html;
  },

  _renderToolCalls(calls) {
    if (!calls || !calls.length) return '';
    var html = '<div class="ws-tool-calls">';
    for (var i = 0; i < calls.length; i++) {
      var c = calls[i];
      var name = c.name || '未知工具';
      var args = '';
      try {
        var parsed = typeof c.arguments === 'string' ? JSON.parse(c.arguments) : (c.arguments || {});
        args = JSON.stringify(parsed, null, 2);
      } catch { args = c.arguments || ''; }
      var result = typeof c.result === 'string' ? c.result : '';

      html += '<div class="ws-tool-call-item">';
      html += '<div class="ws-tool-call-header" onclick="this.parentElement.classList.toggle(\'ws-expanded\')">';
      html += '<span class="ws-tool-arrow">▶</span> ';
      html += '<span class="ws-tool-name">' + escHtml(name) + '</span>';
      html += '</div>';
      html += '<div class="ws-tool-call-body">';
      if (args) {
        html += '<div class="ws-tool-label">参数：</div>';
        html += '<pre class="ws-tool-args">' + escHtml(args) + '</pre>';
      }
      if (result) {
        html += '<div class="ws-tool-label">结果：</div>';
        html += '<div class="ws-tool-result">' + escHtml(result.slice(0, 2000)) + '</div>';
      }
      html += '</div>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  },

  renderFileTree(dirPath) {
    var container = document.getElementById('ws-file-tree');
    if (!container) return;

    var path = dirPath !== undefined ? dirPath : this.fileTreePath;

    // 从 local 缓存或 API 获取数据
    var items;
    if (path === this.fileTreePath) {
      items = this.fileTree;
    } else {
      // 懒加载子目录 — 暂时用 API 拉
      this._lazyLoadDir(path, container);
      return;
    }

    var html = '';
    // 如果是根目录且 items 为空
    if (path === '' || path === '/') {
      html += '<div class="ws-tree-item ws-tree-dir ws-tree-active" data-path="">';
      html += '<span class="ws-tree-icon">📁</span> mouse/';
      html += '</div>';
    }

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var fullPath = (path ? path + '/' : '') + item.name;
      if (item.type === 'dir') {
        var isExpanded = this.expandedDirs[fullPath];
        html += '<div class="ws-tree-item ws-tree-dir" data-path="' + escHtml(fullPath) + '" data-expanded="' + (isExpanded ? '1' : '0') + '">';
        html += '<span class="ws-tree-toggle">' + (isExpanded ? '▼' : '▶') + '</span>';
        html += '<span class="ws-tree-icon">' + (isExpanded ? '📂' : '📁') + '</span>';
        html += escHtml(item.name) + '/';
        html += '</div>';
        if (isExpanded) {
          html += '<div class="ws-tree-children" data-parent="' + escHtml(fullPath) + '">';
          html += '<div class="ws-tree-loading">加载中…</div>';
          html += '</div>';
        }
      } else {
        html += '<div class="ws-tree-item ws-tree-file" data-path="' + escHtml(fullPath) + '">';
        html += '<span class="ws-tree-icon">';

        // 根据扩展名选图标
        var ext = (item.name.split('.').pop() || '').toLowerCase();
        var icons = { py: '🐍', js: '🟨', ts: '🔵', html: '🌐', css: '🎨', json: '📋', md: '📝', toml: '⚙️', rs: '🦀', sql: '🗄️', sh: '📜' };
        html += icons[ext] || '📄';
        html += '</span>';
        html += escHtml(item.name);
        if (item.size > 0) {
          html += ' <span class="ws-tree-size">' + _fmtSize(item.size) + '</span>';
        }
        html += '</div>';
      }
    }

    container.innerHTML = html;
    this._bindFileTreeEvents();
  },

  async _lazyLoadDir(path, container) {
    try {
      var data = await API.getWorkspaceTree(path);
      var items = data.items || [];

      var html = '';
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var fullPath = path + '/' + item.name;
        if (item.type === 'dir') {
          html += '<div class="ws-tree-item ws-tree-dir" data-path="' + escHtml(fullPath) + '">';
          html += '<span class="ws-tree-toggle">▶</span>';
          html += '<span class="ws-tree-icon">📁</span>';
          html += escHtml(item.name) + '/';
          html += '</div>';
        } else {
          html += '<div class="ws-tree-item ws-tree-file" data-path="' + escHtml(fullPath) + '">';
          html += '<span class="ws-tree-icon">📄</span>';
          html += escHtml(item.name);
          if (item.size > 0) {
            html += ' <span class="ws-tree-size">' + _fmtSize(item.size) + '</span>';
          }
          html += '</div>';
        }
      }

      container.innerHTML = html;
      // 绑定事件
      container.querySelectorAll('.ws-tree-dir').forEach(function(el) {
        el.addEventListener('click', function(e) {
          e.stopPropagation();
          Workspace._toggleDir(this);
        });
      });
      container.querySelectorAll('.ws-tree-file').forEach(function(el) {
        el.addEventListener('click', function() {
          Workspace._clickFile(this.dataset.path);
        });
      });
    } catch (e) {
      container.innerHTML = '<div class="ws-tree-error">加载失败: ' + escHtml(e.message) + '</div>';
    }
  },

  _bindFileTreeEvents() {
    var self = this;
    document.querySelectorAll('#ws-file-tree .ws-tree-dir').forEach(function(el) {
      el.addEventListener('click', function(e) {
        self._toggleDir(this);
      });
    });
    document.querySelectorAll('#ws-file-tree .ws-tree-file').forEach(function(el) {
      el.addEventListener('click', function() {
        self._clickFile(this.dataset.path);
      });
    });
  },

  async _toggleDir(el) {
    var path = el.dataset.path;
    var isExpanded = el.dataset.expanded === '1';
    var children = el.nextElementSibling;

    if (isExpanded) {
      // 折叠
      el.dataset.expanded = '0';
      el.querySelector('.ws-tree-toggle').textContent = '▶';
      el.querySelector('.ws-tree-icon').textContent = '📁';
      this.expandedDirs[path] = false;
      if (children && children.classList.contains('ws-tree-children')) {
        children.style.display = 'none';
      }
      return;
    }

    // 展开
    el.dataset.expanded = '1';
    el.querySelector('.ws-tree-toggle').textContent = '▼';
    el.querySelector('.ws-tree-icon').textContent = '📂';
    this.expandedDirs[path] = true;

    if (!children || !children.classList.contains('ws-tree-children')) {
      // 创建子目录容器
      var container = document.createElement('div');
      container.className = 'ws-tree-children';
      container.dataset.parent = path;
      container.innerHTML = '<div class="ws-tree-loading">加载中…</div>';
      el.parentNode.insertBefore(container, el.nextSibling);
      await this._lazyLoadDir(path, container);
    } else {
      children.style.display = '';
      // 可能之前加载过但隐藏了，重新加载
      if (children.querySelector('.ws-tree-loading')) {
        await this._lazyLoadDir(path, children);
      }
    }
  },

  async _clickFile(path) {
    // 点击文件 → 用 API 读取，展示到代码查看器
    this.codeViewPath = path;
    this.codeViewContent = '加载中…';
    this.activeTab = 'code';
    this.renderActiveTab();

    // 也请求助手查看（通过发送包含路径的消息）
    // 但为了即时代码展示，先直接 API 读
    try {
      var execResult = await API.workspaceExec(this.convId, 'cat "' + path.replace(/"/g, '\\"') + '"');
      if (execResult && execResult.stdout) {
        this.codeViewContent = execResult.stdout;
      } else if (execResult && execResult.stderr) {
        this.codeViewContent = '[错误] ' + execResult.stderr;
      } else {
        this.codeViewContent = '(空文件或无法读取)';
      }
    } catch (e) {
      this.codeViewContent = '[读取失败] ' + e.message;
    }
    this.renderActiveTab();
  },

  renderPinBoard() {
    var el = document.getElementById('ws-pinboard');
    if (!el) return;

    if (!this.pins || !this.pins.length) {
      el.innerHTML = '<div class="ws-pin-empty"><p>📌 钉板还空着</p><p class="ws-pin-hint">助手在工作间聊天时可以用 <code>workspace_pin_note</code> 往这里钉卡片</p></div>';
      return;
    }

    var html = '';
    for (var i = 0; i < this.pins.length; i++) {
      var pin = this.pins[i];
      html += '<div class="ws-pin-card" style="transform: rotate(' + (Math.random() * 3 - 1.5).toFixed(1) + 'deg)">';
      html += '<div class="ws-pin-card-title">' + escHtml(pin.title || '无标题') + '</div>';
      html += '<div class="ws-pin-card-body">' + escHtml(pin.content || '') + '</div>';
      html += '<div class="ws-bite-mark"></div>';
      html += '</div>';
    }
    el.innerHTML = html;
  },

  renderActiveTab() {
    if (this.activeTab === 'code') this.renderCodeView();
    else if (this.activeTab === 'diff') this.renderDiffView();
    else if (this.activeTab === 'term') this.renderTerminalView();
    else if (this.activeTab === 'note') this.renderNoteView();
  },

  renderCodeView() {
    var el = document.getElementById('ws-code-view');
    if (!el) return;

    var pathDisplay = this.codeViewPath ? '📄 ' + this.codeViewPath : '';

    var html = '<div class="ws-code-layout">';
    // 文件树
    html += '<div class="ws-code-tree">';
    html += '<div class="ws-code-tree-header">📁 文件</div>';
    html += '<div id="ws-file-tree"></div>';
    html += '</div>';
    // 编辑器
    html += '<div class="ws-code-main">';
    if (this.codeViewPath) {
      html += '<div class="ws-code-path">' + pathDisplay + '</div>';
      html += '<pre class="ws-code-editor"><code>' + escHtml(this.codeViewContent) + '</code></pre>';
    } else {
      html += '<div class="ws-code-empty"><p>点击左侧文件查看内容，或让助手帮忙查看代码</p></div>';
    }
    html += '</div>';
    html += '</div>';
    el.innerHTML = html;

    // 渲染文件树
    this.renderFileTree(this.fileTreePath);
  },

  renderDiffView() {
    var el = document.getElementById('ws-diff-view');
    if (!el) return;

    var self = this;
    el.innerHTML = '<div class="ws-diff-loading"><p>加载 diff 中…</p></div>';

    API.workspaceGitDiff(this.convId).then(function(data) {
      var html = '';
      // status
      if (data.status) {
        html += '<div class="ws-diff-section">';
        html += '<div class="ws-diff-header">📋 变更文件</div>';
        html += '<pre class="ws-diff-status">' + escHtml(data.status) + '</pre>';
        html += '</div>';
      }
      // unstaged diff
      if (data.diff) {
        html += '<div class="ws-diff-section">';
        html += '<div class="ws-diff-header">📝 未暂存的改动</div>';
        html += '<pre class="ws-diff-content">' + escHtml(data.diff) + '</pre>';
        html += '</div>';
      }
      // staged diff
      if (data.staged) {
        html += '<div class="ws-diff-section">';
        html += '<div class="ws-diff-header">✅ 已暂存的改动</div>';
        html += '<pre class="ws-diff-content">' + escHtml(data.staged) + '</pre>';
        html += '</div>';
      }
      if (!data.status && !data.diff && !data.staged) {
        html = '<div class="ws-diff-empty"><p>没有未提交的改动</p></div>';
      }
      if (data.error) {
        html += '<div class="ws-diff-error">错误: ' + escHtml(data.error) + '</div>';
      }
      el.innerHTML = html;
    }).catch(function(e) {
      el.innerHTML = '<div class="ws-diff-error">加载失败: ' + escHtml(e.message) + '</div>';
    });
  },

  renderTerminalView() {
    var el = document.getElementById('ws-term-view');
    if (!el) return;

    var html = '<div class="ws-term-box">';
    html += '<div class="ws-term-header">';
    html += '<span>$ 工作区终端</span>';
    html += '</div>';
    html += '<pre class="ws-term-output" id="ws-term-output">';
    html += this.terminalHistory || '<span class="ws-term-dim">输入命令或让助手执行…</span>';
    html += '</pre>';
    html += '<div class="ws-term-input-row">';
    html += '<span class="ws-term-prompt">$</span>';
    html += '<input type="text" class="ws-term-input" id="ws-term-input" placeholder="输入命令…" />';
    html += '<button class="ws-term-run-btn" onclick="Workspace._runTermCommand()">▶</button>';
    html += '</div>';
    html += '</div>';
    el.innerHTML = html;

    // 绑定回车
    var input = document.getElementById('ws-term-input');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          Workspace._runTermCommand();
        }
      });
    }
  },

  async _runTermCommand() {
    var input = document.getElementById('ws-term-input');
    if (!input || !input.value.trim()) return;
    var cmd = input.value.trim();
    input.value = '';
    this.terminalHistory += '$ ' + cmd + '\n';

    try {
      var result = await API.workspaceExec(this.convId, cmd);
      if (result.stdout) this.terminalHistory += result.stdout;
      if (result.stderr) this.terminalHistory += '\n[stderr]\n' + result.stderr;
      if (result.exit_code !== 0) {
        this.terminalHistory += '\n[退出码: ' + result.exit_code + ']';
      }
    } catch (e) {
      this.terminalHistory += '\n[执行失败] ' + e.message + '\n';
    }

    // 截断太长
    if (this.terminalHistory.length > 50000) {
      this.terminalHistory = '...(输出过长已截断)\n' + this.terminalHistory.slice(-30000);
    }

    this.renderTerminalView();
    // 滚动到底部
    var output = document.getElementById('ws-term-output');
    if (output) output.scrollTop = output.scrollHeight;
  },

  renderNoteView() {
    var el = document.getElementById('ws-note-view');
    if (!el) return;

    var html = '<div class="ws-ledger">';
    html += '<div class="ws-ledger-title">📒 工作记录</div>';
    html += '<div class="ws-ledger-content">';
    // 从最近的 assistant 消息提取关键信息
    var notes = this._extractNotes();
    if (notes.length) {
      for (var i = 0; i < notes.length; i++) {
        html += '<div class="ws-ledger-entry">';
        html += '<div class="ws-ledger-num">#' + (i + 1) + '</div>';
        html += '<div class="ws-ledger-text">' + escHtml(notes[i]) + '</div>';
        html += '</div>';
      }
    } else {
      html += '<p class="ws-ledger-empty">还没有记录，开始工作吧</p>';
    }
    html += '</div>';
    html += '</div>';
    el.innerHTML = html;
  },

  _extractNotes() {
    // 从 assistant 消息的工具调用日志提取关键信息
    var notes = [];
    for (var i = 0; i < this.messages.length; i++) {
      var m = this.messages[i];
      if (m.role === 'assistant' && m.tool_calls) {
        for (var j = 0; j < m.tool_calls.length; j++) {
          var tc = m.tool_calls[j];
          if (tc.name === 'workspace_write_file') {
            try {
              var args = JSON.parse(tc.arguments);
              notes.push('✏️ 修改了 ' + args.path);
            } catch { /* ignore */ }
          } else if (tc.name === 'workspace_git_commit') {
            try {
              var args = JSON.parse(tc.arguments);
              notes.push('📝 提交: ' + args.message);
            } catch { /* ignore */ }
          } else if (tc.name === 'workspace_pin_note') {
            try {
              var args = JSON.parse(tc.arguments);
              notes.push('📌 钉板: ' + args.title);
            } catch { /* ignore */ }
          }
        }
      }
    }
    return notes.slice(-20);
  },

  switchTab(tab) {
    this.activeTab = tab;

    // 更新标签样式
    document.querySelectorAll('.ws-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    // 更新视图
    document.querySelectorAll('.ws-tab-content').forEach(function(v) {
      v.classList.toggle('active', v.id === 'ws-' + tab + '-view');
    });

    // 渲染对应视图
    this.renderActiveTab();
  },

  // ─── 聊天 ───────────────────────────

  async send() {
    var input = document.getElementById('ws-chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';

    // 添加用户消息到本地
    this.messages.push({
      id: 'temp-' + Date.now(),
      role: 'user',
      content: text,
    });

    this.isStreaming = true;
    this.abortController = new AbortController();
    this.renderChat();
    this._scrollToBottom();

    try {
      var response = await API.workspaceChatStream(
        this.convId, text, this.providerId, this.abortController.signal
      );

      var self = this;
      var streamingContent = '';
      var toolCalls = [];

      parseSSE(response, {
        onToken(content) {
          streamingContent += content;
          var el = document.getElementById('ws-streaming-content');
          if (el) {
            if (typeof marked === 'function') {
              el.innerHTML = marked(streamingContent);
            } else {
              el.textContent = streamingContent;
            }
            self._scrollToBottom();
          }
        },

        onToolCallStart(event) {
          var el = document.getElementById('ws-streaming-content');
          if (el && streamingContent) {
            if (typeof marked === 'function') {
              el.innerHTML = marked(streamingContent);
            } else {
              el.textContent = streamingContent;
            }
          }
        },

        onToolCall(event) {
          // 收集工具调用日志
          toolCalls.push({
            name: event.tool_name,
            arguments: event.arguments,
            result: event.result,
          });

          // 如果是读文件，更新代码视图
          if (event.tool_name === 'workspace_read_file') {
            try {
              var args = JSON.parse(event.arguments || '{}');
              self.codeViewPath = args.path || '';
              self.codeViewContent = event.result || '';
              self.switchTab('code');
            } catch { /* ignore */ }
          }

          // 如果是改文件，标记需要刷新 diff
          if (event.tool_name === 'workspace_write_file' || event.tool_name === 'workspace_git_commit') {
            // 清除缓存的 diff，下次切 tab 会自动刷新
          }
        },

        onDone() {
          self.isStreaming = false;

          // 添加 assistant 消息到本地
          self.messages.push({
            id: 'stream-' + Date.now(),
            role: 'assistant',
            content: streamingContent,
            tool_calls: toolCalls.length ? toolCalls : null,
          });

          // 重新加载完整消息列表（确保 DB 同步）
          API.getMessages(self.convId).then(function(msgs) {
            self.messages = msgs || [];
            self.renderChat();
            self._scrollToBottom();
          }).catch(function() {
            self.renderChat();
            self._scrollToBottom();
          });

          // 刷新钉板
          API.getWorkspacePins(self.convId).then(function(data) {
            self.pins = data.pins || [];
            self.renderPinBoard();
          }).catch(function() { /* ignore */ });
        },

        onError(content) {
          self.isStreaming = false;
          var el = document.getElementById('ws-streaming-content');
          if (el) el.innerHTML = '<span class="ws-error">错误: ' + escHtml(content) + '</span>';
          self.messages.push({
            id: 'error-' + Date.now(),
            role: 'assistant',
            content: '[错误] ' + content,
          });
          self.renderChat();
        },
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        this.isStreaming = false;
        document.getElementById('ws-streaming-msg')?.remove();
      } else {
        this.isStreaming = false;
        this.messages.push({
          id: 'error-' + Date.now(),
          role: 'assistant',
          content: '[请求失败] ' + e.message,
        });
        this.renderChat();
      }
    }
  },

  stopStreaming() {
    if (this.abortController) {
      this.abortController.abort();
      this.isStreaming = false;
    }
  },

  _scrollToBottom() {
    var el = document.getElementById('ws-messages');
    if (el) {
      setTimeout(function() { el.scrollTop = el.scrollHeight; }, 50);
    }
  },
};
