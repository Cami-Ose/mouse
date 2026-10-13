/**
 * 🧀 奶酪图书馆 + 宝箱
 * 管理复制的原文 + 单句宝箱
 */

function toggleLibCategory(val) {
  const input = document.getElementById('f-lib-folder');
  if (val === '__new__') {
    input.style.display = '';
    input.focus();
  } else {
    input.style.display = 'none';
  }
}

const Library = {
  list: [],
  currentViewId: null,
  treasureList: [],
  showingTreasure: false,

  async load() {
    try {
      this.list = await API.listLibraryEntries();
    } catch (e) {
      this.list = [];
    }
    if (this.showingTreasure) {
      await this._loadTreasure();
    }
    this.render();
  },

  async _loadTreasure() {
    try {
      this.treasureList = await API.listTreasureBox();
    } catch (e) {
      this.treasureList = [];
    }
  },

  render() {
    const el = document.getElementById('library-list');
    if (!el) return;

    if (this.showingTreasure) {
      el.innerHTML = this._renderTreasureView();
      this._bindTreasureEvents();
      return;
    }

    // ── 奶酪视图 ──
    var html = '';

    // 宝箱入口框（搜索栏上方）
    html += '<div class="treasure-entry" onclick="Library.showTreasure()">'
      + '<div class="treasure-entry-icon">'
      + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'
      + '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>'
      + '<line x1="12" y1="22.08" x2="12" y2="12"/>'
      + '</svg>'
      + '</div>'
      + '<div class="treasure-entry-text">'
      + '<div class="treasure-entry-title">宝箱</div>'
      + '<div class="treasure-entry-desc">存了 ' + this.treasureList.length + ' 条单句</div>'
      + '</div>'
      + '<div class="treasure-entry-arrow">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<polyline points="9 18 15 12 9 6"/>'
      + '</svg>'
      + '</div>'
      + '</div>';

    if (this.list.length === 0) {
      el.innerHTML = html + '<div class="empty-state"><p>还没有奶酪，点击右上角添加</p></div>';
      return;
    }

    // 按文件夹分组
    const groups = {};
    for (const e of this.list) {
      const f = e.folder || '未分类';
      if (!groups[f]) groups[f] = [];
      groups[f].push(e);
    }

    for (const [folder, entries] of Object.entries(groups)) {
      html += '<div class="wb-category-section collapsed">'
        + '<div class="wb-category-title" data-action="toggle-section">'
        + '<span class="wb-collapse-icon" style="transform:rotate(-90deg)">'
        + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
        + '</span>'
        + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:-2px 4px 0 0"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" /></svg> ' + escHtml(folder)
        + '<span class="wb-category-count">' + entries.length + '</span>'
        + '</div>'
        + '<div class="wb-section-items">';
      for (const e of entries) {
        const created = e.created_at ? e.created_at.slice(0, 16) : '';
        html += '<div class="list-item" data-action="view" data-id="' + e.id + '">'
          + '<div class="item-info">'
          + '<div class="item-title">' + escHtml(e.title) + '<span class="id-badge">#' + e.id.slice(0, 8) + '</span></div>'
          + '<div class="item-desc">' + escHtml(e.content.slice(0, 100)) + (e.content.length > 100 ? '…' : '') + '</div>'
          + '<div class="item-desc item-time">' + created + (e.source_url ? ' · <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:-2px 2px 0 0"><path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" /><path d="M11 13l9 -9" /><path d="M15 4h5v5" /></svg>' + escHtml(e.source_url) : '') + '</div>'
          + '</div>'
          + '<div class="item-actions">'
          + '<button class="btn btn-sm" data-action="edit" data-id="' + e.id + '">编辑</button>'
          + '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + e.id + '">删除</button>'
          + '</div>'
          + '</div>';
      }
      html += '</div></div>';
    }
    el.innerHTML = html;

    // 事件委托
    if (!el._libDelegateSet) {
      el._libDelegateSet = true;
      el.addEventListener('click', function(e) {
        var target = e.target.closest('[data-action]');
        if (!target) return;
        var action = target.getAttribute('data-action');
        var id = target.getAttribute('data-id');

        if (action === 'toggle-section') {
          var section = target.closest('.wb-category-section');
          if (section) {
            section.classList.toggle('collapsed');
            var icon = section.querySelector('.wb-collapse-icon');
            if (icon) {
              icon.style.transform = section.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
            }
          }
        } else if (action === 'view') {
          Library.viewEntry(id);
        } else if (action === 'edit') {
          e.stopPropagation();
          Library.editEntry(id);
        } else if (action === 'delete') {
          e.stopPropagation();
          Library.removeEntry(id);
        }
      });
    }
  },

  // ─── 奶酪操作 ───────────────────────

  showAddForm() {
    this.showForm(null, { title: '', content: '', source_url: '', folder: '' });
  },

  editEntry(id) {
    const e = this.list.find(x => x.id === id);
    if (e) this.showForm(id, { ...e });
  },

  showForm(id, data) {
    const isEdit = id !== null;
    const folders = [...new Set(this.list.map(e => e.folder).filter(Boolean))];

    Modal.show(`
      <h3>${isEdit ? '编辑奶酪' : '新建奶酪'}</h3>
      <div class="form-group">
        <label>标题</label>
        <input id="f-lib-title" value="${escHtml(data.title)}" placeholder="条目标题">
      </div>
      <div class="form-group">
        <label>内容</label>
        <textarea id="f-lib-content" rows="8" placeholder="原文内容…">${escHtml(data.content)}</textarea>
      </div>
      <div class="form-group">
        <label>来源链接</label>
        <input id="f-lib-url" value="${escHtml(data.source_url)}" placeholder="https://…">
      </div>
      <div class="form-group">
        <label>文件夹</label>
        <div style="display:flex;gap:6px">
          <select id="f-lib-folder-select" style="flex:1" onchange="toggleLibCategory(this.value)">
            <option value="">未分类</option>
            ${folders.map(f => '<option value="' + escHtml(f) + '"' + (data.folder === f ? ' selected' : '') + '>' + escHtml(f) + '</option>').join('')}
            <option value="__new__"${data.folder && !folders.includes(data.folder) ? ' selected' : ''}>+ 新建文件夹</option>
          </select>
          <input id="f-lib-folder" value="${data.folder && !folders.includes(data.folder) ? escHtml(data.folder) : ''}" placeholder="新文件夹名" style="display:none;flex:1">
        </div>
      </div>
    `, async () => {
      const title = document.getElementById('f-lib-title').value.trim();
      const content = document.getElementById('f-lib-content').value.trim();
      const source_url = document.getElementById('f-lib-url').value.trim();
      const catSelect = document.getElementById('f-lib-folder-select');
      const catInput = document.getElementById('f-lib-folder');
      const folder = catSelect.value === '__new__' ? catInput.value.trim() : catSelect.value;

      if (!title || !content) {
        alert('请填写标题和内容');
        return false;
      }

      try {
        if (isEdit) {
          await API.updateLibraryEntry(id, { title, content, source_url, folder });
        } else {
          await API.createLibraryEntry({ title, content, source_url, folder });
        }
        await this.load();
        return true;
      } catch (e) {
        alert('操作失败：' + e.message);
        return false;
      }
    });
  },

  viewEntry(id) {
    const e = this.list.find(x => x.id === id);
    if (!e) return;
    const created = e.created_at ? e.created_at.slice(0, 16) : '';
    const updated = e.updated_at ? e.updated_at.slice(0, 16) : '';

    Modal.show(''
      + '<div class="wb-view">'
      + '<div class="wb-view-title">' + escHtml(e.title) + '<span class="id-badge" style="font-size:12px">#' + e.id.slice(0, 8) + '</span></div>'
      + '<div class="wb-view-meta">'
      + (e.folder ? '<span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:-2px 4px 0 0"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" /></svg>' + escHtml(e.folder) + '</span>' : '')
      + (e.source_url ? '<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:-2px 4px 0 0"><path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" /><path d="M11 13l9 -9" /><path d="M15 4h5v5" /></svg> <a href="' + escHtml(e.source_url) + '" target="_blank">' + escHtml(e.source_url) + '</a></span>' : '')
      + '</div>'
      + '<div class="wb-view-time">'
      + '<span>创建 ' + created + '</span>'
      + '<span>更新 ' + updated + '</span>'
      + '</div>'
      + '<div class="wb-view-content" style="white-space:pre-wrap">' + escHtml(e.content) + '</div>'
      + '<div class="wb-view-footer">'
      + '<button class="btn btn-sm btn-primary" onclick="Modal.hide();Library.editEntry(\'' + e.id + '\')">编辑</button>'
      + '</div>'
      + '</div>', async () => true);
  },

  async removeEntry(id) {
    if (!confirm('确定删除这条奶酪？')) return;
    try {
      await API.deleteLibraryEntry(id);
      await this.load();
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  },

  async search(query) {
    if (this.showingTreasure) return;
    if (!query || query.length < 2) {
      await this.load();
      return;
    }
    try {
      this.list = await API.searchLibraryEntries(query);
    } catch (e) {
      this.list = [];
    }
    this.render();
  },

  // ─── 宝箱入口和视图 ─────────────────

  showTreasure() {
    this.showingTreasure = true;
    document.getElementById('library-search-input').style.display = 'none';
    this._loadTreasure().then(() => this.render());
  },

  hideTreasure() {
    this.showingTreasure = false;
    document.getElementById('library-search-input').style.display = '';
    this.render();
  },

  _renderTreasureView() {
    var html = ''
      + '<div class="treasure-topbar">'
      + '<button class="treasure-back-btn" onclick="Library.hideTreasure()">'
      + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<polyline points="15 18 9 12 15 6"/>'
      + '</svg>'
      + '</button>'
      + '<span class="treasure-topbar-title">宝箱</span>'
      + '</div>';

    // 添加区
    html += '<div class="treasure-add-area">'
      + '<textarea id="treasure-input" rows="2" placeholder="写一句想存的话…" style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);outline:none;font-size:13px;resize:none;box-sizing:border-box;line-height:1.5"></textarea>'
      + '<button id="treasure-add-btn" class="btn btn-sm btn-primary" style="margin-top:8px">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:-2px 4px 0 0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
      + '存起来</button>'
      + '</div>';

    // 卡片列表
    html += '<div class="treasure-cards">';
    if (this.treasureList.length === 0) {
      html += '<div class="empty-state" style="padding:30px 0"><p>宝箱还是空的，写点什么吧</p></div>';
    } else {
      for (var i = 0; i < this.treasureList.length; i++) {
        var e = this.treasureList[i];
        var ts = e.created_at ? e.created_at.slice(0, 16) : '';
        html += '<div class="treasure-card" data-id="' + e.id + '">'
          + '<div class="treasure-card-content">' + escHtml(e.content) + '</div>'
          + '<div class="treasure-card-footer">'
          + '<span class="treasure-card-time">' + ts + '</span>'
          + '<button class="treasure-card-del" data-action="delete-treasure" data-id="' + e.id + '" title="删除">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
          + '<polyline points="3 6 5 6 21 6"/>'
          + '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
          + '</svg>'
          + '</button>'
          + '</div>'
          + '</div>';
      }
    }
    html += '</div>';
    return html;
  },

  _bindTreasureEvents() {
    var addBtn = document.getElementById('treasure-add-btn');
    if (addBtn) addBtn.onclick = function() { Library.addTreasure(); };

    var input = document.getElementById('treasure-input');
    if (input) {
      input.onkeydown = function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          Library.addTreasure();
        }
      };
      input.focus();
    }

    // 删除委托
    var cards = document.querySelector('.treasure-cards');
    if (cards) {
      cards.onclick = function(e) {
        var del = e.target.closest('[data-action="delete-treasure"]');
        if (del) {
          var id = del.getAttribute('data-id');
          Library.removeTreasure(id);
        }
      };
    }
  },

  async addTreasure() {
    var input = document.getElementById('treasure-input');
    if (!input) return;
    var content = input.value.trim();
    if (!content) return;
    try {
      await API.createTreasureBox(content);
      input.value = '';
      await this._loadTreasure();
      this.render();
    } catch (e) {
      alert('添加失败：' + e.message);
    }
  },

  async removeTreasure(id) {
    if (!confirm('确定删除这条？')) return;
    try {
      await API.deleteTreasureBox(id);
      await this._loadTreasure();
      this.render();
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  },
};
