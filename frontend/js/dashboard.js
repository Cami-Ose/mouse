/**
 * 📊 控制台仪表盘
 * 今日消息数、图书馆/纸片统计、月消息热力图
 */

const Dashboard = {
  data: null,
  monthOffset: 0,
  images: [],

  async load() {
    try {
      this.data = await API.getStats();
    } catch (e) {
      this.data = { todayMessages: 0, todayLibrary: 0, todayWorldbook: 0, dailyMessages: [] };
    }
    this.monthOffset = 0;
    await this._loadProviders();
    await this._loadImages();
    this.render();
  },

  async _loadImages() {
    try {
      this.images = await API.listImages(200, 0);
    } catch (e) {
      this.images = [];
    }
  },

  async _loadProviders() {
    try {
      this.providers = await API.listProviders();
    } catch (e) {
      this.providers = [];
    }
  },

  renderProviderSelect() {
    if (!this.providers || this.providers.length <= 1) return '';
    var html = '<div class="provider-select-row"><label>API 线路</label><select id="dashboard-provider-select" onchange="Dashboard._switchProvider(this.value)">';
    for (var i = 0; i < this.providers.length; i++) {
      var p = this.providers[i];
      var sel = Chat.providerId === p.id ? ' selected' : '';
      var mark = p.is_default ? ' ⭐' : '';
      html += '<option value="' + p.id + '"' + sel + '>' + escHtml(p.name) + mark + '</option>';
    }
    html += '</select></div>';
    return html;
  },

  _switchProvider(id) {
    Chat.providerId = id;
    localStorage.setItem('mouse_provider_id', id);
  },

  render() {
    var el = document.getElementById('dashboard-content');
    if (!el) return;
    if (!this.data) { el.innerHTML = '<div class="empty-state"><p>加载中…</p></div>'; return; }

    var html = '';

    // API 线路选择
    html += this.renderProviderSelect();

    // 统计卡片
    html += '<div class="stats-cards">';
    html += this._card('今日消息', this.data.todayMessages, this._chatIcon());
    html += this._card('今日奶酪', this.data.todayLibrary, this._bookIcon());
    html += this._card('今日纸片', this.data.todayWorldbook, this._noteIcon());
    html += '</div>';

    // 热力图
    html += '<div class="heatmap-section">';
    html += this._buildHeatmap(this.data.dailyMessages || []);
    html += '</div>';

    // tooltip
    html += '<div id="heatmap-tooltip"></div>';

    // 图片历史
    html += this._renderImageGrid();

    el.innerHTML = html;
    this._bindNav();
    this._bindTooltip();
    this._bindImageGrid();
  },

  _card(label, count, iconSvg) {
    return '<div class="stat-card"><div class="stat-icon">' + iconSvg + '</div><div class="stat-count">' + count + '</div><div class="stat-label">' + label + '</div></div>';
  },

  _chatIcon() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  },
  _bookIcon() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>';
  },
  _noteIcon() {
    return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  },

  _buildHeatmap(daily) {
    var map = {};
    for (var i = 0; i < daily.length; i++) {
      map[daily[i].date] = daily[i].count;
    }

    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + this.monthOffset;
    while (month < 0) { month += 12; year--; }
    while (month > 11) { month -= 12; year++; }

    var firstDay = new Date(year, month, 1);
    var lastDay = new Date(year, month + 1, 0);
    var daysInMonth = lastDay.getDate();

    // 按当月最大条数动态分色阶
    var maxCount = 0;
    for (var d = 1; d <= daysInMonth; d++) {
      var c = map[_fmtDate(new Date(year, month, d))] || 0;
      if (c > maxCount) maxCount = c;
    }

    var startDow = firstDay.getDay();
    var startCol = (startDow === 0) ? 6 : startDow - 1;

    var totalCells = startCol + daysInMonth;
    var weeks = Math.ceil(totalCells / 7);

    var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    var title = year + '年 ' + monthNames[month];
    var dayLabels = ['一','二','三','四','五','六','日'];

    var html = '';

    // 导航
    html += '<div class="heatmap-nav">';
    html += '<button class="heatmap-nav-btn" data-offset="-1">‹</button>';
    html += '<span class="heatmap-nav-title">' + title + '</span>';
    html += '<button class="heatmap-nav-btn" data-offset="1">›</button>';
    html += '</div>';

    // 网格
    html += '<div class="heatmap-month-grid">';
    var day = 1;
    for (var row = 0; row < 7; row++) {
      html += '<div class="heatmap-row">';
      html += '<div class="heatmap-day-label">' + dayLabels[row] + '</div>';
      for (var col = 0; col < weeks; col++) {
        var cellIdx = col * 7 + row;
        if (cellIdx < startCol || day > daysInMonth) {
          html += '<div class="heatmap-cell empty"></div>';
        } else {
          var dateStr = _fmtDate(new Date(year, month, day));
          var count = map[dateStr] || 0;
          var level = _heatLevel(count, maxCount);
          html += '<div class="heatmap-cell l' + level + '" data-date="' + dateStr + '" data-count="' + count + '">' + day + '</div>';
          day++;
        }
      }
      html += '</div>';
    }
    html += '</div>';

    // 图例
    html += '<div class="heatmap-legend"><span class="legend-text">少</span>';
    for (var l = 0; l <= 4; l++) {
      html += '<div class="heatmap-cell l' + l + '"></div>';
    }
    html += '<span class="legend-text">多</span></div>';

    return html;
  },

  _bindNav() {
    var self = this;
    document.querySelectorAll('.heatmap-nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        self.monthOffset += parseInt(this.dataset.offset);
        self.render();
      });
    });
  },

  _bindTooltip() {
    var cells = document.querySelectorAll('.heatmap-month-grid .heatmap-cell:not(.empty)');
    var tooltip = document.getElementById('heatmap-tooltip');
    if (!tooltip || !cells.length) return;

    cells.forEach(function(cell) {
      cell.addEventListener('mouseenter', function(e) {
        var date = this.dataset.date;
        var count = this.dataset.count;
        var parts = date.split('-');
        var label = parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';
        tooltip.innerHTML = '<div class="ht-date">' + label + '</div><div class="ht-count">' + count + ' 条消息</div>';
        tooltip.classList.add('show');
        _moveTooltip(e);
      });

      cell.addEventListener('mousemove', _moveTooltip);

      cell.addEventListener('mouseleave', function() {
        tooltip.classList.remove('show');
      });
    });
  },

  // ─── 图片历史 ──────────────────────

  _renderImageGrid() {
    if (!this.images || this.images.length === 0) {
      return '<div class="image-history-section"><div class="image-history-header">'
        + this._imageIcon() + ' 图片历史</div>'
        + '<div class="empty-state" style="padding:20px 0"><p>还没有发过图片</p></div></div>';
    }

    var html = '<div class="image-history-section">'
      + '<div class="image-history-header">'
      + this._imageIcon() + ' 图片历史'
      + '<span class="image-history-count">' + this.images.length + ' 张</span>'
      + '</div>'
      + '<div class="image-grid">';

    for (var i = 0; i < this.images.length; i++) {
      var img = this.images[i];
      html += '<div class="image-grid-item" data-url="' + img.url + '" data-time="' + (img.created_at || '') + '" data-conv-id="' + (img.conversation_id || '') + '" onclick="Dashboard._openLightbox(this)">'
        + '<img src="' + img.url + '" alt="图片" loading="lazy">'
        + '</div>';
    }

    html += '</div></div>';
    return html;
  },

  _imageIcon() {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin:-2px 6px 0 0">'
      + '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>'
      + '<circle cx="8.5" cy="8.5" r="1.5"/>'
      + '<polyline points="21 15 16 10 5 21"/>'
      + '</svg>';
  },

  _bindImageGrid() {
    // 绑定操作由 onclick 内联完成，无需额外委托
  },

  _openLightbox(el) {
    var url = el.getAttribute('data-url');
    var time = el.getAttribute('data-time') || '';
    var convId = el.getAttribute('data-conv-id') || '';
    if (!url) return;
    // 从当前对话列表中查找标题
    var convTitle = '';
    if (convId && Chat.conversations) {
      for (var i = 0; i < Chat.conversations.length; i++) {
        if (Chat.conversations[i].id === convId) {
          convTitle = escHtml(Chat.conversations[i].title || '未命名对话');
          break;
        }
      }
    }
    if (!convTitle) convTitle = escHtml(convId ? '对话已删除' : '');
    Modal.show(''
      + '<div class="image-lightbox">'
      + '<img src="' + url + '" alt="图片" style="max-width:100%;max-height:70vh;border-radius:var(--radius);display:block;margin:0 auto">'
      + '<div class="image-lightbox-info">'
      + (time ? '<span class="image-lightbox-time">' + time + '</span>' : '')
      + (convTitle ? '<span class="image-lightbox-conv">来自：' + convTitle + '</span>' : '')
      + '</div>'
      + '</div>', async () => true);
  },
};

// ─── 辅助函数 ──────────────────────────

function _fmtDate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function _heatLevel(count, max) {
  if (count === 0 || max === 0) return 0;
  var ratio = count / max;
  if (ratio <= 0.1) return 1;
  if (ratio <= 0.3) return 2;
  if (ratio <= 0.6) return 3;
  return 4;
}

function _moveTooltip(e) {
  var tooltip = document.getElementById('heatmap-tooltip');
  if (!tooltip) return;
  var x = e.clientX + 12;
  var y = e.clientY - 10;
  var rect = tooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 10) {
    x = e.clientX - rect.width - 12;
  }
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}
