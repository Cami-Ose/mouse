/**
 * 应用初始化 + 标签页路由
 */

// ─── Modal 工具 ────────────────────

const Modal = {
  _onConfirm: null,

  show(html, onConfirm) {
    this._onConfirm = onConfirm;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  hide() {
    document.getElementById('modal-overlay').classList.add('hidden');
    this._onConfirm = null;
  },
};

// ─── 更新侧栏鼠的纸片计数 ──────────

function updateWbCount() {
  const count = document.getElementById('wb-count');
  if (count) count.textContent = (WorldBook.list || []).length;
}

// ─── 初始化 + 事件绑定 ───────────────

document.addEventListener('DOMContentLoaded', async () => {
  // ── 优先处理 Hash 路由（避免闪一下才切视图） ──
  var hashView = window.location.hash.replace('#', '') || '';
  if (hashView && ['chat','worldbook','library','dashboard','providers','import','worldbook-matchtest'].includes(hashView)) {
    switchView(hashView);
  }

  // ── 数据加载（独立 try/catch，加载失败不影响事件绑定） ──
  try {
    await Chat.loadConversations();
  } catch (e) {
    console.warn('加载对话列表失败:', e);
  }
  try {
    await Providers.load();
  } catch (e) {
    console.warn('加载 API 线路失败:', e);
  }
  try {
    await WorldBook.load();
    updateWbCount();
  } catch (e) {
    console.warn('加载世界书失败:', e);
  }

  // 如果没有对话，自动创建第一个
  if (Chat.conversations.length === 0) {
    try {
      const conv = await API.createConversation({ title: '新对话' });
      Chat.conversations.push(conv);
      Chat.currentConvId = conv.id;
      Chat.renderConversations();
    } catch (e) {
      console.error('创建初始对话失败:', e);
    }
  } else {
    Chat.currentConvId = Chat.conversations[0].id;
    try {
      await Chat.switchConversation(Chat.currentConvId);
    } catch (e) {
      console.warn('切换对话失败:', e);
    }
  }

  // 获取 provider：优先上次选择 → 默认 → 第一条
  try {
    const providers = await API.listProviders();
    const saved = localStorage.getItem('mouse_provider_id');
    const savedMatch = saved ? providers.find(p => p.id === saved) : null;
    const def = providers.find(p => p.is_default) || providers[0];
    Chat.providerId = savedMatch ? savedMatch.id : (def ? def.id : null);
  } catch { /* ignore */ }

  // ── 事件绑定 ──
  document.getElementById('btn-send')?.addEventListener('click', () => {
    if (Chat.isStreaming) {
      Chat.stopStreaming();
    } else {
      Chat.send();
    }
  });
  document.getElementById('message-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      Chat.send();
    }
  });
  // 输入框自适应高度 + 发送按钮状态
  const msgInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('btn-send');
  function updateInputState() {
    // 自适应高度
    msgInput.style.height = 'auto';
    msgInput.style.height = msgInput.scrollHeight + 'px';
    // 发送按钮状态
    var preview = document.getElementById('img-preview');
    var hasImage = preview && !preview.classList.contains('hidden') && preview.querySelector('img');
    var hasText = msgInput.value.trim().length > 0;
    if (hasText || hasImage) {
      sendBtn.classList.remove('inactive');
      sendBtn.classList.add('active');
    } else {
      sendBtn.classList.remove('active');
      sendBtn.classList.add('inactive');
    }
  }
  msgInput?.addEventListener('input', updateInputState);
  // 初始状态
  if (sendBtn) { sendBtn.classList.add('inactive'); }
  document.getElementById('btn-new-chat')?.addEventListener('click', () => Chat.newConversation());
  // 移动端侧栏开关
  function toggleSidebar(show) {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    if (!sidebar) return;
    if (show === undefined) show = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', show);
    if (backdrop) backdrop.classList.toggle('show', show);
  }
  document.getElementById('sidebar-toggle')?.addEventListener('click', function() { toggleSidebar(); });
  document.getElementById('sidebar-backdrop')?.addEventListener('click', function() { toggleSidebar(false); });
  // 切换对话时自动关侧栏
  var origSwitchConv = Chat.switchConversation;
  Chat.switchConversation = function(id) {
    toggleSidebar(false);
    return origSwitchConv.call(Chat, id);
  };
  // 新建对话时自动关侧栏
  var origNewConv = Chat.newConversation;
  Chat.newConversation = function() {
    toggleSidebar(false);
    return origNewConv.call(Chat);
  };

  // 移动端：点击气泡显示操作按钮
  if (window.innerWidth <= 768) {
    document.getElementById('messages-container')?.addEventListener('click', function(e) {
      var msg = e.target.closest('.message');
      // 清除其他消息的 show-actions
      document.querySelectorAll('.message.show-actions').forEach(function(m) {
        if (m !== msg) m.classList.remove('show-actions');
      });
      if (msg) {
        // 只有有操作按钮的消息才切换
        if (msg.querySelector('.msg-actions')) {
          msg.classList.toggle('show-actions');
        }
      }
    });
  }

  document.getElementById('sidebar-worldbook')?.addEventListener('click', (e) => {
    // 点表头：聊天/世界书切换
    if (e.target.closest('.sidebar-section-header')) {
      toggleSidebar(false);
      const currentView = document.querySelector('.view.active')?.id;
      switchView(currentView === 'view-chat' ? 'worldbook' : 'chat');
    }
  });
  document.getElementById('search-conv')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.conv-item');
    items.forEach(el => {
      const title = el.querySelector('.conv-title')?.textContent?.toLowerCase() || '';
      el.style.display = title.includes(q) ? '' : 'none';
    });
  });
  document.getElementById('btn-add-entry')?.addEventListener('click', () => WorldBook.showAddForm());
  document.getElementById('btn-add-provider')?.addEventListener('click', () => Providers.showAddForm());
  document.getElementById('btn-import-gpt')?.addEventListener('click', () => switchView('import'));

  // 图片上传由 chat.js 的 DOMContentLoaded 独立处理
  document.getElementById('modal-cancel')?.addEventListener('click', () => Modal.hide());
  document.getElementById('modal-confirm')?.addEventListener('click', async () => {
    if (Modal._onConfirm) {
      const result = await Modal._onConfirm();
      if (result !== false) Modal.hide();
    }
  });
  document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) Modal.hide();
  });

  document.getElementById('btn-dashboard')?.addEventListener('click', () => switchView('dashboard'));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') Chat.send();
  });

  // ── Hash 变化监听（浏览器前进/后退） ──
  window.addEventListener('hashchange', function() {
    var v = window.location.hash.replace('#', '') || 'chat';
    if (['chat','worldbook','worldbook-matchtest','providers','library','dashboard','import'].includes(v)) {
      switchView(v);
    }
  });
});

// ─── 视图切换 + Hash 路由 ──────────────

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  document.getElementById(`view-${view}`)?.classList.add('active');

  // 更新顶栏标题
  const titles = { chat: '聊天', worldbook: '鼠的纸片', 'worldbook-matchtest': '匹配测试', providers: 'API 线路', library: '奶酪图书馆', dashboard: '控制台', import: '导入' };
  document.getElementById('current-view-title').textContent = titles[view] || '聊天';

  // 同步 URL hash（避免死循环）
  var hash = '#' + view;
  if (window.location.hash !== hash) {
    history.replaceState(null, '', hash);
  }

  // 切换到图书馆时加载数据
  if (view === 'library') Library.load();
  // 切换到控制台时加载数据
  if (view === 'dashboard') Dashboard.load();
}

