/**
 * GPT 聊天记录导入 v2 - 支持 ZIP + 图片
 */

const ImportGPT = {
  sessionId: null,
  conversations: [],
  selected: new Set(),

  // ─── 上传文件 ──────────────────────────────

  async uploadFile(file) {
    // 判断文件类型
    var isZip = file.name.toLowerCase().endsWith('.zip');

    if (isZip) {
      // ZIP → multipart/form-data 上传
      var formData = new FormData();
      formData.append('file', file);
      try {
        var resp = await fetch('/api/import/gpt-upload', {
          method: 'POST',
          body: formData,
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function(){ return {detail: resp.statusText}; });
          throw new Error(err.detail || '上传失败');
        }
        resp = await resp.json();
        this.sessionId = resp.session_id;
        this.conversations = resp.conversations || [];
        this.selected = new Set();
        this.renderPreview();
      } catch (e) {
        alert('解析失败: ' + e.message);
      }
    } else {
      // JSON → 原有流程
      var text = await file.text();
      try {
        var resp = await API.request('POST', '/api/import/gpt-preview', { data: text });
        this.sessionId = resp.session_id;
        this.conversations = resp.conversations || [];
        this.selected = new Set();
        this.renderPreview();
      } catch (e) {
        alert('解析失败: ' + e.message);
      }
    }
  },

  // ─── 渲染 ──────────────────────────────────

  renderPreview() {
    const el = document.getElementById('import-list');
    if (!el) return;

    if (!this.conversations.length) {
      el.innerHTML = '<div class="empty-state"><p>未找到可导入的对话</p></div>';
      return;
    }

    el.innerHTML = this.conversations.map((c, i) => {
      const checked = this.selected.has(i) ? 'checked' : '';
      var imgBadge = c.has_images ? ' 🖼️' : '';
      return `
      <div class="import-item ${checked ? 'selected' : ''}" data-idx="${i}">
        <label class="import-checkbox-label">
          <input type="checkbox" class="import-checkbox" data-idx="${i}" ${checked}>
          <div class="import-item-body">
            <div class="import-item-title">${escHtml(c.title)}${imgBadge}</div>
            <div class="import-item-meta">👤 ${c.user_count} 条 · 🤖 ${c.assistant_count} 条 · 共 ${c.total} 条</div>
            <div class="import-item-first">${escHtml(c.first_msg)}</div>
          </div>
        </label>
      </div>`;
    }).join('');

    // 绑定事件
    el.querySelectorAll('.import-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx);
        if (e.target.checked) {
          this.selected.add(idx);
        } else {
          this.selected.delete(idx);
        }
        const item = e.target.closest('.import-item');
        if (item) item.classList.toggle('selected', e.target.checked);
        this.updateCount();
      });
    });
    el.querySelectorAll('.import-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.tagName === 'INPUT') return;
        const cb = item.querySelector('.import-checkbox');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        }
      });
    });

    this.updateCount();
  },

  updateCount() {
    const btn = document.getElementById('btn-import-execute');
    const count = document.getElementById('import-count');
    if (btn) {
      const n = this.selected.size;
      btn.textContent = n ? `导入选中的 ${n} 个对话` : '导入选中的对话';
      btn.disabled = n === 0;
    }
    if (count) {
      count.textContent = `已选 ${this.selected.size} / ${this.conversations.length} 个对话`;
    }
  },

  // ─── 执行导入 ──────────────────────────────

  async execute() {
    if (!this.sessionId || this.selected.size === 0) return;
    if (!confirm(`确定导入 ${this.selected.size} 个对话到 Mouse？`)) return;

    const btn = document.getElementById('btn-import-execute');
    if (btn) { btn.disabled = true; btn.textContent = '导入中…'; }

    try {
      const result = await API.request('POST', '/api/import/gpt-execute', {
        session_id: this.sessionId,
        selected_indices: Array.from(this.selected).sort(),
      });
      alert(`✅ 成功导入 ${result.imported} 个对话！`);
      await Chat.loadConversations();
      if (result.conversation_ids && result.conversation_ids.length) {
        await Chat.switchConversation(result.conversation_ids[0]);
      }
      this.reset();
    } catch (e) {
      alert('导入失败: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = '导入选中的对话'; }
    }
  },

  reset() {
    this.sessionId = null;
    this.conversations = [];
    this.selected = new Set();
    const el = document.getElementById('import-list');
    if (el) el.innerHTML = '<div class="empty-state"><p>选择一个 GPT 导出 JSON 或 ZIP 文件</p></div>';
    this.updateCount();
    const fnEl = document.getElementById('import-file-name');
    if (fnEl) fnEl.textContent = '';
  },
};

// ─── 初始化事件 ──────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    const fileInput = document.getElementById('import-file-input');
    const pickBtn = document.getElementById('btn-import-pick');
    if (fileInput && pickBtn) {
      pickBtn.addEventListener('click', function() {
        fileInput.click();
      });
      fileInput.addEventListener('change', function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        document.getElementById('import-file-name').textContent = file.name;
        ImportGPT.uploadFile(file);
        fileInput.value = '';
      });
    }
    document.getElementById('btn-import-execute')?.addEventListener('click', function() {
      ImportGPT.execute();
    });
  }, 100);
});
