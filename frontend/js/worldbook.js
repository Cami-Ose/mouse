/**
 * 鼠的纸片管理 — 树形分类 / 搜索 / 摘要 / 命中统计
 */

function escJs(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function toggleWbCategory(val) {
  const input = document.getElementById('f-wb-category');
  if (val === '__new__') {
    input.style.display = '';
    input.focus();
  } else {
    input.style.display = 'none';
  }
}

function toggleSection(el) {
  const section = el.closest('.wb-folder, .wb-category-section');
  if (section) {
    section.classList.toggle('collapsed');
    // 同时旋转箭头图标
    var icon = section.querySelector('.wb-collapse-icon');
    if (icon) {
      icon.style.transform = section.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
    }
  }
}

const WorldBook = {
  list: [],
  currentModalId: null,
  categories: [],
  _catOpen: {},       // { catName: true/false } — 父分类展开状态
  _subcatOpen: {},    // { 'cat|subcat': true/false } — 子分类展开状态
  searchVal: '',

  async load() {
    try {
      this.list = await API.listWorldEntries();
      this.categories = await API.listWorldCategories();
    } catch (e) {
      this.list = [];
      this.categories = [];
    }
    this.searchVal = '';
    this.render();
    if (typeof updateWbCount === 'function') updateWbCount();
    this.matchTestInit();
  },

  async loadByParent(parent, subcat) {
    try {
      this.list = await API.listWorldEntries();
    } catch (e) {
      this.list = [];
    }
    // 过滤出属于该分类的条目
    if (parent) {
      this.list = this.list.filter(function(e) {
        if (subcat) {
          return e.category === parent && e.subcategory === subcat;
        }
        return e.category === parent;
      });
    } else {
      // 未分类
      this.list = this.list.filter(function(e) { return !e.category; });
    }
    this.currentParent = subcat ? parent + ' / ' + subcat : (parent || '未分类');
    this.currentCategory = parent || null;
    this.searchVal = '';
    this.render();
    if (typeof updateWbCount === 'function') updateWbCount();
  },

  showAll() {
    this.load();
  },

  // ─── 树形折叠展开 ─────────────────────

  _toggleCat(name) {
    this._catOpen[name] = !this._catOpen[name];
    this.render();
  },

  _toggleSubcat(cat, sub) {
    var key = cat + '|' + sub;
    this._subcatOpen[key] = !this._subcatOpen[key];
    this.render();
  },

  render() {
    const el = document.getElementById('entry-list');
    if (!el) return;
    this._renderCategoryTree(el);
    // 事件委托：树形折叠展开 + 条目操作（替代内联 onclick）
    if (!el._wbDelegateSet) {
      el._wbDelegateSet = true;
      el.addEventListener('click', function(e) {
        // 操作按钮优先（编辑/删除）
        var btn = e.target.closest('[data-action]');
        if (!btn) {
          // 其次检测文件夹标题点击
          var title = e.target.closest('.wb-folder-title');
          if (!title) return;
          var cat = title.getAttribute('data-category');
          var sub = title.getAttribute('data-subcategory');
          if (sub) {
            WorldBook._toggleSubcat(cat, sub);
          } else if (cat) {
            WorldBook._toggleCat(cat);
          }
          return;
        }
        var action = btn.getAttribute('data-action');
        var id = btn.getAttribute('data-id');
        if (action === 'edit') {
          e.stopPropagation();
          WorldBook.edit(id);
        } else if (action === 'delete') {
          e.stopPropagation();
          WorldBook.remove(id);
        } else if (action === 'view') {
          WorldBook.view(id);
        }
      });
    }
  },

  _renderCategoryTree(el) {
    const cats = this.categories;
    if (cats.length === 0 && this.list.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="icon"><img src="./img/mouse-face.svg" class="icon-img"></div><p>还没有纸片，点击右上角添加</p></div>';
      return;
    }

    var searchVal = (document.getElementById('wb-search-input')?.value || '').toLowerCase();
    var filteredCats = cats;
    if (searchVal) {
      filteredCats = cats.filter(function(c) {
        return c.name.toLowerCase().includes(searchVal)
          || c.subcategories.some(function(s) { return s.name.toLowerCase().includes(searchVal); });
      });
    }

    var html = '<div class="wb-search-bar"><input type="text" id="wb-search-input" placeholder="搜索分类…" value="' + escHtml(searchVal) + '" oninput="WorldBook.render()"></div>';

    if (filteredCats.length === 0) {
      if (!searchVal) {
        html += '<div class="wb-tree-container">';
        html += this._renderUncategorized();
        html += '</div>';
      } else {
        html += '<div class="empty-state"><p>没有匹配的分类</p></div>';
      }
      el.innerHTML = html;
      return;
    }

    html += '<div class="wb-tree-container">';
    for (var ci = 0; ci < filteredCats.length; ci++) {
      var c = filteredCats[ci];
      var cname = c.name;
      var isOpen = this._catOpen[cname] === true;
      var arrow = isOpen ? '▼' : '▶';
      var hasSub = c.subcategories && c.subcategories.length > 0;

      html += '<div class="wb-folder' + (isOpen ? '' : ' collapsed') + '">';
      html += '<div class="wb-folder-title" data-category="' + escHtml(cname) + '">';
      html += '<span class="wb-collapse-icon">' + arrow + '</span>';
      html += '<span class="wb-folder-icon">📁</span> ' + escHtml(cname);
      html += '<span class="wb-category-count">' + c.count + '</span>';
      html += '</div>';

      html += '<div class="wb-folder-items">';
      if (isOpen) {
        // 先显示子分类文件夹
        for (var si = 0; si < c.subcategories.length; si++) {
          var s = c.subcategories[si];
          var sk = cname + '|' + s.name;
          var sOpen = this._subcatOpen[sk] === true;
          var sArrow = sOpen ? '▼' : '▶';

          html += '<div class="wb-folder' + (sOpen ? '' : ' collapsed') + '">';
          html += '<div class="wb-folder-title sub-folder" data-category="' + escHtml(cname) + '" data-subcategory="' + escHtml(s.name) + '" style="padding-left:44px">';
          html += '<span class="wb-collapse-icon">' + sArrow + '</span>';
          html += '<span class="wb-folder-icon">📂</span> ' + escHtml(s.name);
          html += '<span class="wb-category-count">' + s.count + '</span>';
          html += '</div>';

          html += '<div class="wb-folder-items">';
          if (sOpen) {
            var subEntries = this.list.filter(function(e) { return e.category === cname && e.subcategory === s.name; });
            for (var ei2 = 0; ei2 < subEntries.length; ei2++) {
              html += this._renderEntryItem(subEntries[ei2], 56);
            }
          }
          html += '</div></div>';
        }
        // 再显示直接挂在父目录下的条目（无子分类）
        var directEntries = this.list.filter(function(e) { return e.category === cname && !e.subcategory; });
        for (var ei = 0; ei < directEntries.length; ei++) {
          html += this._renderEntryItem(directEntries[ei], 24);
        }
      }
      html += '</div></div>';
    }

    // 非分类条目（始终展开）
    var uncatEntries = this.list.filter(function(e) { return !e.category; });
    if (uncatEntries.length > 0) {
      html += '<div class="wb-folder">';
      html += '<div class="wb-folder-title" style="cursor:default">';
      html += '<span class="wb-folder-icon">📄</span> 未分类';
      html += '<span class="wb-category-count">' + uncatEntries.length + '</span>';
      html += '</div>';
      for (var ei = 0; ei < uncatEntries.length; ei++) {
        html += this._renderEntryItem(uncatEntries[ei], 24);
      }
      html += '</div>';
    }

    html += '</div>';
    el.innerHTML = html;
  },

  _renderUncategorized() {
    var html = '';
    var uncat = this.list.filter(function(e) { return !e.category; });
    for (var e of uncat) {
      html += this._renderEntryItem(e, 0);
    }
    return html;
  },

  _renderEntryList(el) {
    var entries = this.list;
    var parentLabel = this.currentParent || '未分类';

    var html = '<div class="wb-search-bar" style="display:flex;align-items:center;gap:8px">';
    html += '<button class="btn btn-sm" onclick="WorldBook.showAll()">← 全部分类</button>';
    html += '<span style="font-weight:600;font-size:14px">' + escHtml(parentLabel) + '</span>';
    html += '<span class="wb-category-count">' + entries.length + ' 条</span>';
    html += '</div>';

    if (entries.length === 0) {
      html += '<div class="empty-state"><p>这个分类下没有条目</p></div>';
      el.innerHTML = html;
      return;
    }

    html += '<div style="padding:8px 0">';
    for (var e of entries) {
      html += this._renderEntryItem(e, 24);
    }
    html += '</div>';
    el.innerHTML = html;
  },

  _renderEntryItem(e, padLeft) {
    var typeLabels = { persona: '根', event: '事件', project: '项目', method: '方法', note: '笔记' };
    var tl = typeLabels[e.type] || '笔记';
    var formattedTime = e.created_at ? e.created_at.slice(0, 16) : '';
    var summaryText = '';

    if (e.summary) {
      summaryText = escHtml(e.summary.slice(0, 100));
    } else {
      summaryText = escHtml(e.content.slice(0, 80));
    }

    var html = '<div class="list-item" onclick="WorldBook.view(\'' + e.id + '\')" style="padding-left:' + padLeft + 'px">';
    html += '<div class="item-info">';
    html += '<div class="item-title">';
    html += '<span class="wb-type-badge wb-type-' + (e.type || 'note') + '">' + tl + '</span>';
    html += escHtml(e.title);
	html += '<span class="id-badge">#' + e.id.slice(0, 8) + '</span>';
    if (!e.enabled) html += '<span class="default-badge">已禁用</span>';
    html += '<span class="default-badge">P' + e.priority + '</span>';
    if (e.hit_count > 0) html += '<span class="default-badge hit-badge">🔥' + e.hit_count + '</span>';
    html += '</div>';
    html += '<div class="item-desc">' + summaryText + (e.summary && e.summary.length > 100 ? '…' : (!e.summary && e.content.length > 80 ? '…' : '')) + '</div>';
    if (!e.summary) {
      var kw; try { kw = JSON.parse(e.keywords); } catch { kw = []; }
      if (kw.length) html += '<div class="item-desc">关键词：' + kw.map(function(k) { return '<code>' + escHtml(k) + '</code>'; }).join(' ') + '</div>';
    }
    html += '<div class="item-desc item-time">' + formattedTime + '</div>';
    html += '</div>';
    html += '<div class="item-actions">';
    html += '<button class="btn btn-sm" onclick="event.stopPropagation();WorldBook.edit(\'' + e.id + '\')">编辑</button>';
    html += '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();WorldBook.remove(\'' + e.id + '\')">删除</button>';
    html += '</div></div>';
    return html;
  },

  showAddForm() {
    this.showForm(null, { title: '', content: '', summary: '', keywords: '', enabled: true, priority: 0, category: '', subcategory: '', position: 'system' });
  },

  edit(id) {
    const e = this.list.find(x => x.id === id);
    if (e) this.showForm(id, { ...e, keywords: (() => { try { return JSON.parse(e.keywords).join(', '); } catch { return e.keywords; } })() });
  },

  showForm(id, data) {
    this.currentModalId = id;
    const isEdit = id !== null;
    // 提取父分类列表
    var parentCats = [...new Set(this.list.map(function(e) {
      return e.category || '';
    }).filter(Boolean))];

    Modal.show(`
      <h3>${isEdit ? '编辑条目' : '新建条目'}</h3>
      <div class="form-group">
        <label>标题</label>
        <input id="f-wb-title" value="${escHtml(data.title)}" placeholder="条目名称">
      </div>
      <div class="form-group">
        <label>类型</label>
        <select id="f-wb-type">
          <option value="persona" ${data.type === 'persona' ? 'selected' : ''}>根条目 — 长期身份/关系底座</option>
          <option value="event" ${data.type === 'event' ? 'selected' : ''}>事件 — 过程/演化/关键节点</option>
          <option value="project" ${data.type === 'project' ? 'selected' : ''}>项目 — 项目当前状态/未决问题</option>
          <option value="method" ${data.type === 'method' ? 'selected' : ''}>方法 — 共同工作方法/约定</option>
          <option value="note" ${data.type === 'note' ? 'selected' : ''}>笔记 — 一般笔记/备忘</option>
        </select>
      </div>
      <div class="form-group">
        <label>摘要 <span class="hint">简短描述，用于列表展示和搜索</span></label>
        <input id="f-wb-summary" value="${escHtml(data.summary)}" placeholder="用一句话概括这个条目…">
      </div>
      <div class="form-group">
        <label>内容</label>
        <textarea id="f-wb-content" rows="4" placeholder="纸片内容…">${escHtml(data.content)}</textarea>
      </div>
      <div class="form-group">
        <label>关键词（逗号分隔）</label>
        <input id="f-wb-keywords" value="${escHtml(data.keywords)}" placeholder="猫, cat, /猫娘/">
        <div class="hint">用 / 包裹为正则匹配，如 /\\d+岁/</div>
      </div>
      <div class="form-group">
        <label>优先级（越大越优先注入）</label>
        <input id="f-wb-priority" type="number" value="${data.priority}">
      </div>
      <div class="form-group">
        <label>分类</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <select id="f-wb-parent-cat" style="flex:1" onchange="WorldBook._onParentCatChange()">
            <option value="">未分类</option>
            ${parentCats.map(function(c) { return '<option value="' + escHtml(c) + '"' + (data.category === c ? ' selected' : '') + '>' + escHtml(c) + '</option>'; }).join('')}
            <option value="__new__">+ 新建父分类</option>
          </select>
          <input id="f-wb-parent-new" placeholder="父分类名称" style="display:none;flex:1">
          <span style="line-height:32px;color:var(--text-secondary)">/</span>
          <input id="f-wb-child-cat" value="${escHtml(data.subcategory || '')}" placeholder="子分类（可选）" style="flex:1">
        </div>
        <div class="hint">父分类如「人物」，子分类如「朋友」，独立存储</div>
      </div>
      <div class="form-group">
        <label>注入位置</label>
        <select id="f-wb-position">
          <option value="system" ${data.position === 'system' ? 'selected' : ''}>System Prompt</option>
        </select>
      </div>
      <div class="form-group checkbox-group">
        <input type="checkbox" id="f-wb-enabled" ${data.enabled ? 'checked' : ''}>
        <label for="f-wb-enabled">启用</label>
      </div>
      <div class="form-group">
        <label>测试匹配</label>
        <input id="f-wb-test-text" placeholder="输入测试文本…">
        <button class="btn btn-sm" onclick="WorldBook.testMatch()" style="margin-top:4px">测试匹配</button>
        <div id="f-wb-test-result"></div>
      </div>
    `, async () => {
      const title = document.getElementById('f-wb-title').value.trim();
      const type = document.getElementById('f-wb-type').value;
      const summary = document.getElementById('f-wb-summary').value.trim();
      const content = document.getElementById('f-wb-content').value.trim();
      const keywordsStr = document.getElementById('f-wb-keywords').value.trim();
      const priority = parseInt(document.getElementById('f-wb-priority').value) || 0;

      // 分类：父分类 + 子分类独立字段
      var parentCat = document.getElementById('f-wb-parent-cat').value;
      var parentNew = document.getElementById('f-wb-parent-new');
      var category = parentCat === '__new__' ? (parentNew.value.trim()) : parentCat;
      var subcategory = document.getElementById('f-wb-child-cat').value.trim();

      const position = document.getElementById('f-wb-position').value;
      const enabled = document.getElementById('f-wb-enabled').checked;

      if (!title || !content) {
        alert('请填写标题和内容');
        return false;
      }

      const keywords = keywordsStr ? keywordsStr.split(',').map(k => k.trim()).filter(Boolean) : [];

      try {
        if (isEdit) {
          await API.updateWorldEntry(id, { title, content, summary, keywords, priority, category, subcategory, position, enabled, type });
        } else {
          await API.createWorldEntry({ title, content, summary, keywords, priority, category, subcategory, position, enabled, type });
        }
        await this.load();
        return true;
      } catch (e) {
        alert('操作失败：' + e.message);
        return false;
      }
    });
  },

  _onParentCatChange() {
    var sel = document.getElementById('f-wb-parent-cat');
    var input = document.getElementById('f-wb-parent-new');
    if (sel.value === '__new__') {
      input.style.display = '';
      input.focus();
    } else {
      input.style.display = 'none';
    }
  },

  async testMatch() {
    const text = document.getElementById('f-wb-test-text')?.value;
    if (!text) return;
    try {
      const result = await API.testWorldMatch(text);
      const el = document.getElementById('f-wb-test-result');
      if (!result.matched_entries || result.matched_entries.length === 0) {
        el.innerHTML = '<div class="match-result">没有命中的条目</div>';
      } else {
        var html = '<div class="match-result">';
        for (var e of result.matched_entries) {
          var icon = e.match_type === 'exact' ? '✅' : '🔗';
          html += '<div class="match-item ' + e.match_type + '">' +
            '<div>' + icon + ' <span class="match-item-title">' + escHtml(e.title) + '</span>' +
            ' <span class="match-badge">P' + e.priority + '</span></div>';
          if (e.match_reason) html += '<div class="match-reason">(' + escHtml(e.match_reason) + ')</div>';
          html += '<div class="match-item-meta">';
          if (e.category) html += '<span class="match-category">' + escHtml(e.category) + '</span>';
          if (e.type) html += '<span>' + escHtml(e.type) + '</span>';
          html += '</div>';
          if (e.summary) html += '<div class="match-desc">' + escHtml(e.summary) + '</div>';
          html += '</div>';
        }
        html += '</div>';
        el.innerHTML = html;
      }
    } catch (e) {
      alert('测试失败：' + e.message);
    }
  },

  async remove(id) {
    if (!confirm('确定删除这张纸片？')) return;
    try {
      await API.deleteWorldEntry(id);
      await this.load();
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  },

  view(id) {
    const e = this.list.find(x => x.id === id);
    if (!e) return;
    const typeLabels = { persona: '根条目', event: '事件', project: '项目', method: '方法', note: '笔记' };
    const typeLabel = typeLabels[e.type] || '笔记';
    let kw;
    try { kw = JSON.parse(e.keywords); } catch { kw = []; }
    const created = e.created_at ? e.created_at.slice(0, 16) : '';
    const updated = e.updated_at ? e.updated_at.slice(0, 16) : '';
    var hits = e.hit_count || 0;

    Modal.show(`
      <div class="wb-view">
        <div class="wb-view-title">
          <span class="wb-type-badge wb-type-${e.type || 'note'}">${typeLabel}</span>
          ${escHtml(e.title)}
          <span class="id-badge" style="font-size:12px">#${e.id.slice(0, 8)}</span>
        </div>
        <div class="wb-view-meta">
          ${e.category ? `<span>分类：${escHtml(e.category)}${e.subcategory ? ' / ' + escHtml(e.subcategory) : ''}</span>` : ''}
          <span>优先级 P${e.priority}</span>
          <span>🔥 命中 ${hits} 次</span>
          ${!e.enabled ? '<span class="wb-view-disabled">已禁用</span>' : ''}
        </div>
        <div class="wb-view-time">
          <span>创建 ${created}</span>
          <span>更新 ${updated}</span>
        </div>
        ${e.summary ? `<div class="wb-view-summary">摘要：${escHtml(e.summary)}</div>` : ''}
        ${kw.length ? `<div class="wb-view-kw">关键词：${kw.map(k => `<code>${escHtml(k)}</code>`).join(' ')}</div>` : ''}
        <div class="wb-view-content">${escHtml(e.content)}</div>
        <div class="wb-view-footer">
          <button class="btn btn-sm btn-primary" onclick="Modal.hide();WorldBook.edit('${e.id}')">编辑</button>
        </div>
      </div>
    `, async () => true);
  },

  // ─── 匹配测试全页面 ─────────────────────

  showMatchTest() {
    switchView('worldbook-matchtest');
  },

  matchTestInit() {
    var el = document.getElementById('matchtest-input');
    if (el) el.addEventListener('input', WorldBook._matchTestDebounce);
  },

  _matchTestDebounce: null,

  async runMatchTest() {
    var input = document.getElementById('matchtest-input');
    var results = document.getElementById('matchtest-results');
    if (!input || !results) return;
    var text = input.value.trim();
    if (!text) { results.innerHTML = '<div class="empty-state"><p>输入文本开始测试</p></div>'; return; }

    results.innerHTML = '<div class="empty-state"><p>匹配中…</p></div>';
    try {
      const data = await API.testWorldMatch(text);
      if (!data.matched_entries || data.matched_entries.length === 0) {
        results.innerHTML = '<div class="match-result"><div class="match-item none">没有命中的条目</div></div>';
        return;
      }
      var exact = data.matched_entries.filter(function(e) { return e.match_type === 'exact'; });
      var fuzzy = data.matched_entries.filter(function(e) { return e.match_type === 'fuzzy'; });

      var html = '<div class="match-summary">精确命中 <strong>' + exact.length + '</strong> 条，可能关联 <strong>' + fuzzy.length + '</strong> 条</div>';
      if (exact.length) {
        html += '<div class="match-section-label">✅ 精确命中</div>';
        for (var e of exact) {
          html += '<div class="match-item exact">';
          html += '<div><span class="match-item-title">' + escHtml(e.title) + '</span> <span class="match-badge">P' + e.priority + '</span></div>';
          if (e.match_reason) html += '<div class="match-reason">(' + escHtml(e.match_reason) + ')</div>';
          html += '<div class="match-item-meta">';
          if (e.category) html += '<span class="match-category">' + escHtml(e.category) + (e.subcategory ? ' / ' + escHtml(e.subcategory) : '') + '</span>';
          if (e.type) html += '<span>' + escHtml(e.type) + '</span>';
          if (e.hit_count != null) html += '<span>🔥 ' + e.hit_count + '</span>';
          html += '</div>';
          if (e.summary) html += '<div class="match-desc">' + escHtml(e.summary) + '</div>';
          html += '</div>';
        }
      }
      if (fuzzy.length) {
        html += '<div class="match-section-label fuzzy-label">🔗 可能关联</div>';
        for (var e of fuzzy) {
          html += '<div class="match-item fuzzy">';
          html += '<div><span class="match-item-title">' + escHtml(e.title) + '</span> <span class="match-badge">P' + e.priority + '</span></div>';
          if (e.match_reason) html += '<div class="match-reason">(' + escHtml(e.match_reason) + ')</div>';
          html += '<div class="match-item-meta">';
          if (e.category) html += '<span class="match-category">' + escHtml(e.category) + (e.subcategory ? ' / ' + escHtml(e.subcategory) : '') + '</span>';
          if (e.type) html += '<span>' + escHtml(e.type) + '</span>';
          if (e.hit_count != null) html += '<span>🔥 ' + e.hit_count + '</span>';
          html += '</div>';
          if (e.summary) html += '<div class="match-desc">' + escHtml(e.summary) + '</div>';
          html += '</div>';
        }
      }
      results.innerHTML = html;
    } catch (e) {
      results.innerHTML = '<div class="match-item error">匹配失败：' + escHtml(e.message) + '</div>';
    }
  },
};

// debounce for match test
(function() {
  var timer = null;
  WorldBook._matchTestDebounce = function() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() { WorldBook.runMatchTest(); }, 400);
  };
})();
