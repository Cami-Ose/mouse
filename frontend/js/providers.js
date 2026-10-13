/**
 * API 线路管理
 */

const Providers = {
  list: [],
  currentModalId: null,

  async load() {
    try {
      this.list = await API.listProviders();
    } catch (e) {
      this.list = [];
    }
    this.render();
  },

  render() {
    const el = document.getElementById('provider-list');
    if (!el) return;

    if (this.list.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="icon">🔌</div><p>还没有 API 线路，点击右上角添加</p></div>';
      return;
    }

    el.innerHTML = this.list.map(p => `
      <div class="list-item">
        <div class="item-info">
          <div class="item-title">
            ${p.name}
            ${p.is_default ? '<span class="default-badge">默认</span>' : ''}
          </div>
          <div class="item-desc">${p.model} · ${p.base_url}</div>
        </div>
        <div class="item-actions">
          ${!p.is_default ? `<button class="btn btn-sm" onclick="Providers.setDefault('${p.id}')">设为默认</button>` : ''}
          <button class="btn btn-sm" onclick="Providers.edit('${p.id}')">编辑</button>
          <button class="btn btn-sm btn-danger" onclick="Providers.remove('${p.id}')">删除</button>
        </div>
      </div>
    `).join('');
  },

  showAddForm() {
    this.showForm(null, { name: '', base_url: '', api_key: '', model: '' });
  },

  edit(id) {
    const p = this.list.find(x => x.id === id);
    if (p) this.showForm(id, p);
  },

  showForm(id, data) {
    this.currentModalId = id;
    const isEdit = id !== null;
    Modal.show(`
      <h3>${isEdit ? '编辑线路' : '添加线路'}</h3>
      <div class="form-group">
        <label>名称</label>
        <input id="f-provider-name" value="${escHtml(data.name)}" placeholder="例如：我的 OpenAI">
      </div>
      <div class="form-group">
        <label>Base URL</label>
        <input id="f-provider-url" value="${escHtml(data.base_url)}" placeholder="https://api.openai.com/v1">
      </div>
      <div class="form-group">
        <label>API Key</label>
        <input id="f-provider-key" type="password" value="${escHtml(data.api_key)}" placeholder="sk-...">
      </div>
      <div class="form-group">
        <label>模型</label>
        <input id="f-provider-model" value="${escHtml(data.model)}" placeholder="gpt-3.5-turbo">
      </div>
    `, async () => {
      const fields = {
        name: document.getElementById('f-provider-name').value.trim(),
        base_url: document.getElementById('f-provider-url').value.trim(),
        api_key: document.getElementById('f-provider-key').value.trim(),
        model: document.getElementById('f-provider-model').value.trim(),
      };
      if (!fields.name || !fields.base_url || !fields.api_key || !fields.model) {
        alert('请填写所有字段');
        return false;
      }
      try {
        if (isEdit) {
          await API.updateProvider(id, fields);
        } else {
          await API.createProvider(fields);
        }
        await this.load();
        return true;
      } catch (e) {
        alert('操作失败：' + e.message);
        return false;
      }
    });
  },

  async setDefault(id) {
    try {
      await API.setDefaultProvider(id);
      await this.load();
    } catch (e) {
      alert('操作失败：' + e.message);
    }
  },

  async remove(id) {
    if (!confirm('确定删除这条线路？')) return;
    try {
      await API.deleteProvider(id);
      await this.load();
    } catch (e) {
      alert('删除失败：' + e.message);
    }
  },
};
