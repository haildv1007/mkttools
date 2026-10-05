window.MKTPageModules = window.MKTPageModules || {};
window.MKTPageModules.content = () => ({
    _contentAbort: null,
    _thumbObserver: null,
    contentLoading: false,

    initContentPerf() {
        this._thumbObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const img = entry.target;
                const src = img.dataset.src;
                if (src) {
                    img.src = src;
                    img.removeAttribute('data-src');
                }
                this._thumbObserver.unobserve(img);
            }
        }, { rootMargin: '100px' });
    },

    destroyContentPerf() {
        if (this._contentAbort) { this._contentAbort.abort(); this._contentAbort = null; }
        if (this._thumbObserver) { this._thumbObserver.disconnect(); this._thumbObserver = null; }
    },

    observeThumbnails() {
        if (!this._thumbObserver) return;
        this.$nextTick(() => {
            const container = this.$refs.dgScroll;
            if (!container) return;
            const imgs = container.querySelectorAll('img[data-src]');
            for (const img of imgs) this._thumbObserver.observe(img);
        });
    },

    dgCalcHeight() {
        const el = this.$refs.dgGridShell;
        if (!el) {
            this.dgGridMaxH = 0;
            return;
        }
        const top = el.getBoundingClientRect().top;
        const vh = window.innerHeight;
        const h = Math.floor(vh - top - 16);
        if (h > 100 && Math.abs(h - this.dgGridMaxH) > 2)
            this.dgGridMaxH = h;
    },
    setDatePreset(k) {
        const today = new Date();
        const fmt = d => d.toISOString().slice(0, 10);
        let from = '', to = '';
        const labels = { today: 'Hôm nay', yesterday: 'Hôm qua', week: 'Tuần này', month: 'Tháng này', custom: 'Tùy chỉnh' };
        if (k === 'today') {
            from = to = fmt(today);
        }
        else if (k === 'yesterday') {
            const y = new Date(today);
            y.setDate(y.getDate() - 1);
            from = to = fmt(y);
        }
        else if (k === 'week') {
            const d = new Date(today);
            d.setDate(d.getDate() - d.getDay() + 1);
            from = fmt(d);
            to = fmt(today);
        }
        else if (k === 'month') {
            from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
            to = fmt(today);
        }
        else if (k === 'custom') {
            this.contentFilter._datePreset = 'custom';
            this.contentFilter._dateLabel = 'Tùy chỉnh';
            return;
        }
        this.contentFilter.dateFrom = from;
        this.contentFilter.dateTo = to;
        this.contentFilter._datePreset = k;
        this.contentFilter._dateLabel = labels[k] || '';
        this.dateDrop = false;
        this.dgPage = 1;
        this.loadContent();
    },
    async loadContent() {
        if (this._contentAbort) this._contentAbort.abort();
        const ac = new AbortController();
        this._contentAbort = ac;
        this.contentLoading = true;
        try {
            const params = new URLSearchParams();
            const hf = this.dgHeaderFilterData || {};
            if (this.contentFilter.status)
                params.set('status', this.contentFilter.status);
            else if (hf.status?.length)
                params.set('statuses', hf.status.join(','));
            if (this.contentFilter.pageId)
                params.set('pageId', this.contentFilter.pageId);
            else if (hf.pageIds?.length)
                params.set('pageIds', hf.pageIds.join(','));
            if (this.contentFilter.search)
                params.set('search', this.contentFilter.search);
            if (hf.scheduledAt_from || this.contentFilter.dateFrom)
                params.set('dateFrom', hf.scheduledAt_from || this.contentFilter.dateFrom);
            if (hf.scheduledAt_to || this.contentFilter.dateTo)
                params.set('dateTo', hf.scheduledAt_to || this.contentFilter.dateTo);
            if (this.contentFilter.source)
                params.set('source', this.contentFilter.source);
            else if (hf.source?.length)
                params.set('sources', hf.source.join(','));
            if (this.contentFilter.campaignId)
                params.set('campaignId', this.contentFilter.campaignId);
            else if (hf.campaignIds?.length)
                params.set('campaignIds', hf.campaignIds.join(','));
            if (this.contentFilter.media?.length)
                params.set('media', this.contentFilter.media.join(','));
            const metricFilter = {};
            const metricKeys = { viewers: 'fb_reach', mediaViews: 'fb_media_views', reactions: 'fb_reactions', comments: 'fb_comments', shares: 'fb_shares', clicks: 'fb_clicks' };
            for (const [colKey, metricKey] of Object.entries(metricKeys)) {
                const mf = hf[colKey];
                if (mf && mf.op && mf.val !== '' && mf.val !== undefined)
                    metricFilter[metricKey] = { op: mf.op, val: Number(mf.val) };
            }
            if (Object.keys(metricFilter).length)
                params.set('metricFilter', JSON.stringify(metricFilter));
            if (hf.createdAt_from)
                params.set('createdFrom', hf.createdAt_from);
            if (hf.createdAt_to)
                params.set('createdTo', hf.createdAt_to);
            if (hf.publishedAt_from)
                params.set('publishedFrom', hf.publishedAt_from);
            if (hf.publishedAt_to)
                params.set('publishedTo', hf.publishedAt_to);
            params.set('page', String(this.dgPage));
            params.set('pageSize', String(this.dgPageSize));
            params.set('sortBy', this.dgSortBy);
            params.set('sortDir', this.dgSortDir);
            if (this.currentScope.type !== 'all') {
                params.set('scopeType', this.currentScope.type);
                params.set('scopeId', this.currentScope.id);
            }
            const data = await this.api(`/dashboard/content?${params}`, { signal: ac.signal });
            if (ac.signal.aborted) return;
            this.contentItems = data.items;
            this.contentTotal = data.total;
            if (data.statusCounts)
                this.dgStatusCounts = data.statusCounts;
            if (data.summary)
                this.dgSummary = data.summary;
            this.dgBulkSelected = [];
            this.dgBulkAll = false;
            this.$nextTick(() => { this.dgCalcHeight(); this.observeThumbnails(); });
        }
        catch (e) { if (e?.name === 'AbortError') return; }
        finally { if (!ac.signal.aborted) this.contentLoading = false; }
    },
    dgColStyle(col, ci) {
        let s = 'min-width:' + col.minW + 'px; width:' + col.w + 'px; max-width:' + (col.maxW || 600) + 'px;';
        if (col.pinned) {
            let left = 80;
            const vis = this.dgVisibleCols;
            for (let i = 0; i < ci; i++) {
                if (vis[i].pinned)
                    left += vis[i].w;
            }
            s += ' left:' + left + 'px;';
            const nextCol = vis[ci + 1];
            if (!nextCol || !nextCol.pinned)
                s += ' box-shadow: 2px 0 4px -2px rgba(0,0,0,0.1);';
        }
        else {
            s += ' position:relative;';
        }
        return s;
    },
    dgSort(key) {
        if (this.dgSortBy === key) {
            this.dgSortDir = this.dgSortDir === 'asc' ? 'desc' : 'asc';
        }
        else {
            this.dgSortBy = key;
            this.dgSortDir = 'desc';
        }
        this.dgPage = 1;
        this.loadContent();
    },
    dgSetPreset(key) {
        this.dgActivePreset = key;
        const preset = this.dgPresets.find(p => p.key === key);
        if (!preset)
            return;
        for (const col of this.dgAllCols) {
            col.visible = preset.cols === null ? true : preset.cols.includes(col.key);
        }
        this.dgSaveCols();
    },
    dgSaveCols() {
        try {
            const state = this.dgAllCols.map(c => ({ key: c.key, visible: c.visible, w: c.w, pinned: c.pinned }));
            const order = this.dgAllCols.map(c => c.key);
            localStorage.setItem('mkt_dg_cols', JSON.stringify({ state, order, preset: this.dgActivePreset, density: this.dgDensity, view: this.dgActiveView }));
        }
        catch { }
    },
    dgLoadCols() {
        this._dgDefaultOrder = this.dgAllCols.map(c => c.key);
        try {
            const raw = localStorage.getItem('mkt_dg_cols');
            if (!raw)
                return;
            const saved = JSON.parse(raw);
            let colStates, order;
            if (Array.isArray(saved)) {
                colStates = saved;
                order = null;
            }
            else {
                colStates = saved.state || [];
                order = saved.order;
                if (saved.preset)
                    this.dgActivePreset = saved.preset;
                if (saved.density)
                    this.dgDensity = saved.density;
                if (saved.view !== undefined)
                    this.dgActiveView = saved.view;
            }
            if (colStates.length) {
                for (const s of colStates) {
                    const col = this.dgAllCols.find(c => c.key === s.key);
                    if (col) {
                        col.visible = s.visible;
                        col.w = s.w;
                        if (s.pinned !== undefined)
                            col.pinned = s.pinned;
                    }
                }
            }
            if (order && order.length) {
                const sorted = [];
                for (const k of order) {
                    const c = this.dgAllCols.find(x => x.key === k);
                    if (c)
                        sorted.push(c);
                }
                for (const c of this.dgAllCols) {
                    if (!sorted.includes(c))
                        sorted.push(c);
                }
                this.dgAllCols.splice(0, this.dgAllCols.length, ...sorted);
            }
            const views = JSON.parse(localStorage.getItem('mkt_dg_views') || '[]');
            if (views.length)
                this.dgSavedViews = views;
            const hf = JSON.parse(localStorage.getItem('mkt_dg_hfilters') || '{}');
            if (Object.keys(hf).length)
                this.dgHeaderFilterData = hf;
        }
        catch { }
    },
    dgResetCols() {
        const defaults = this._dgDefaultOrder || this.dgAllCols.map(c => c.key);
        const defPreset = this.dgPresets.find(p => p.key === 'basic');
        const sorted = [];
        for (const k of defaults) {
            const c = this.dgAllCols.find(x => x.key === k);
            if (c)
                sorted.push(c);
        }
        this.dgAllCols.splice(0, this.dgAllCols.length, ...sorted);
        for (const col of this.dgAllCols) {
            col.visible = defPreset.cols === null ? true : defPreset.cols.includes(col.key);
            col.pinned = ['checkbox', 'thumbnail', 'topic'].includes(col.key);
        }
        this.dgActivePreset = 'basic';
        this.dgActiveView = null;
        this.dgHeaderFilterData = {};
        localStorage.removeItem('mkt_dg_hfilters');
        this.dgSaveCols();
        this.dgPage = 1;
        this.loadContent();
    },
    dgDropCol(targetKey) {
        if (!this.dgDragCol || this.dgDragCol === targetKey)
            return;
        const arr = this.dgAllCols;
        const fromIdx = arr.findIndex(c => c.key === this.dgDragCol);
        const toIdx = arr.findIndex(c => c.key === targetKey);
        if (fromIdx < 0 || toIdx < 0)
            return;
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        this.dgSaveCols();
    },
    dgOpenCtxMenu(e, col) {
        if (col.key === 'checkbox')
            return;
        this.dgCtxMenu = { x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 250), col };
    },
    dgAutoSize(col) {
        const sizes = { thumbnail: 50, topic: 280, status: 110, page: 160, campaign: 150, contentType: 80, source: 75, scheduledAt: 110, createdAt: 90, publishedAt: 110, notes: 180, result: 160 };
        col.w = sizes[col.key] || col.minW + 30;
        this.dgSaveCols();
    },
    dgToggleAll() {
        if (this.dgBulkAll) {
            this.dgBulkSelected = [];
            this.dgBulkAll = false;
        }
        else {
            this.dgBulkSelected = this.contentItems.map(i => i.id);
            this.dgBulkAll = true;
        }
    },
    dgToggleRow(id) {
        const idx = this.dgBulkSelected.indexOf(id);
        if (idx >= 0)
            this.dgBulkSelected.splice(idx, 1);
        else
            this.dgBulkSelected.push(id);
        this.dgBulkAll = this.dgBulkSelected.length === this.contentItems.length && this.contentItems.length > 0;
    },
    dgOpenRowMenu(e, item) {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const menuH = 250;
        const y = (r.bottom + menuH > window.innerHeight) ? Math.max(4, r.top - menuH) : r.bottom + 4;
        this.dgRowMenu = { open: true, item, x: r.left, y };
    },
    dgOpenHeaderFilter(col, x, y) {
        x = x || 200;
        y = y || 200;
        this.dgHeaderFilter = { x: Math.min(x, window.innerWidth - 300), y: Math.min(y, window.innerHeight - 350), col };
        if (col.filterable === 'campaign-select')
            this.dgLoadCascadeCampaigns();
    },
    dgHasHeaderFilter(key) {
        const d = this.dgHeaderFilterData;
        if (d[key] && ((Array.isArray(d[key]) && d[key].length) || (typeof d[key] === 'object' && d[key].val)))
            return true;
        if (key === 'page' && d.pageIds?.length)
            return true;
        if (key === 'campaign' && d.campaignIds?.length)
            return true;
        if (d[key + '_from'] || d[key + '_to'])
            return true;
        return false;
    },
    dgToggleHeaderFilterOpt(key, val) {
        if (!this.dgHeaderFilterData[key])
            this.dgHeaderFilterData[key] = [];
        const arr = this.dgHeaderFilterData[key];
        const idx = arr.indexOf(val);
        if (idx >= 0)
            arr.splice(idx, 1);
        else
            arr.push(val);
    },
    dgClearHeaderFilter(key) {
        const col = this.dgAllCols.find(c => c.key === key);
        if (!col)
            return;
        if (col.filterable === 'page-select')
            delete this.dgHeaderFilterData.pageIds;
        else if (col.filterable === 'campaign-select')
            delete this.dgHeaderFilterData.campaignIds;
        else if (col.filterable === 'date-range') {
            delete this.dgHeaderFilterData[key + '_from'];
            delete this.dgHeaderFilterData[key + '_to'];
        }
        else
            delete this.dgHeaderFilterData[key];
        try {
            localStorage.setItem('mkt_dg_hfilters', JSON.stringify(this.dgHeaderFilterData));
        }
        catch { }
        this.dgPage = 1;
        this.loadContent();
    },
    dgApplyHeaderFilter() {
        try {
            localStorage.setItem('mkt_dg_hfilters', JSON.stringify(this.dgHeaderFilterData));
        }
        catch { }
        this.dgPage = 1;
        this.loadContent();
    },
    async dgLoadCascadeCampaigns() {
        try {
            const pageIds = this.dgHeaderFilterData.pageIds || [];
            const pids = pageIds.length ? pageIds.join(',') : this.scopePages.map(p => p.id).join(',');
            if (!pids) {
                this.dgCascadeCampaigns = this.campaigns;
                return;
            }
            const data = await this.api(`/dashboard/content/campaigns-for-pages?pageIds=${pids}`);
            this.dgCascadeCampaigns = data || [];
        }
        catch {
            this.dgCascadeCampaigns = this.campaigns;
        }
    },
    dgSaveView() {
        if (!this.dgNewViewName.trim())
            return;
        const view = {
            name: this.dgNewViewName.trim(),
            cols: this.dgAllCols.map(c => ({ key: c.key, visible: c.visible, w: c.w, pinned: c.pinned })),
            order: this.dgAllCols.map(c => c.key),
            sortBy: this.dgSortBy, sortDir: this.dgSortDir, density: this.dgDensity,
            headerFilters: JSON.parse(JSON.stringify(this.dgHeaderFilterData)),
        };
        this.dgSavedViews.push(view);
        this.dgActiveView = this.dgSavedViews.length - 1;
        this.dgActivePreset = '';
        try {
            localStorage.setItem('mkt_dg_views', JSON.stringify(this.dgSavedViews));
        }
        catch { }
        this.dgNewViewName = '';
        this.dgShowSaveView = false;
        this.dgSaveCols();
    },
    dgApplyView(idx) {
        const v = this.dgSavedViews[idx];
        if (!v)
            return;
        this.dgActiveView = idx;
        this.dgActivePreset = '';
        if (v.sortBy) {
            this.dgSortBy = v.sortBy;
            this.dgSortDir = v.sortDir || 'desc';
        }
        if (v.density)
            this.dgDensity = v.density;
        if (v.headerFilters) {
            this.dgHeaderFilterData = JSON.parse(JSON.stringify(v.headerFilters));
            try {
                localStorage.setItem('mkt_dg_hfilters', JSON.stringify(this.dgHeaderFilterData));
            }
            catch { }
        }
        if (v.cols) {
            for (const s of v.cols) {
                const col = this.dgAllCols.find(c => c.key === s.key);
                if (col) {
                    col.visible = s.visible;
                    col.w = s.w;
                    if (s.pinned !== undefined)
                        col.pinned = s.pinned;
                }
            }
        }
        if (v.order) {
            const sorted = [];
            for (const k of v.order) {
                const c = this.dgAllCols.find(x => x.key === k);
                if (c)
                    sorted.push(c);
            }
            for (const c of this.dgAllCols) {
                if (!sorted.includes(c))
                    sorted.push(c);
            }
            this.dgAllCols.splice(0, this.dgAllCols.length, ...sorted);
        }
        this.dgSaveCols();
        this.dgPage = 1;
        this.loadContent();
    },
    dgDeleteView(idx) {
        this.dgSavedViews.splice(idx, 1);
        if (this.dgActiveView === idx)
            this.dgActiveView = null;
        else if (this.dgActiveView > idx)
            this.dgActiveView--;
        try {
            localStorage.setItem('mkt_dg_views', JSON.stringify(this.dgSavedViews));
        }
        catch { }
        this.dgSaveCols();
    },
    dgStartResize(e, col) {
        const startX = e.clientX;
        const startW = col.w;
        const onMove = (ev) => { col.w = Math.max(col.minW, Math.min(col.maxW || 600, startW + ev.clientX - startX)); };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); this.dgSaveCols(); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    },
    dgMetric(item, key) {
        const m = item.metrics;
        if (!m || !item.socialPostId)
            return '—';
        const v = m[key];
        return v === null || v === undefined ? '—' : v === 0 ? '0' : Number(v).toLocaleString('vi-VN');
    },
    dgEngagement(item) {
        const m = item.metrics;
        if (!m || !item.socialPostId)
            return '—';
        const v = (m.fb_reactions || 0) + (m.fb_comments || 0) + (m.fb_shares || 0);
        return v === 0 ? '0' : v.toLocaleString('vi-VN');
    },
    dgEngPerViewer(item) {
        const m = item.metrics;
        if (!m || !item.socialPostId)
            return '—';
        const viewers = m.fb_reach || 0;
        if (!viewers)
            return '—';
        const eng = (m.fb_reactions || 0) + (m.fb_comments || 0) + (m.fb_shares || 0);
        return (eng / viewers * 100).toFixed(1) + '%';
    },
    async regenerateContent(id) {
        try {
            await this.api(`/dashboard/content/${id}/regenerate`, { method: 'POST' });
            this.showToast('Đã đưa vào hàng đợi gen content');
            setTimeout(() => this.loadContent(), 2000);
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async deleteContent(id, topic) {
        if (!confirm(`Xóa content "${topic}"?`))
            return;
        try {
            await this.api(`/dashboard/content/${id}`, { method: 'DELETE' });
            this.showToast('Đã xóa content');
            await this.loadContent();
            await this.loadDashboard();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async publishNow(id) {
        if (!confirm('Đăng bài ngay?'))
            return;
        try {
            const data = await this.api(`/dashboard/content/${id}/publish-now`, { method: 'POST' });
            this.showToast(data.message || 'Đã đưa vào hàng đợi đăng bài');
            setTimeout(() => this.loadContent(), 3000);
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    bulkResultMsg(r, actionName) {
        const parts = [actionName + ' hoàn tất'];
        const count = r.generated || r.approved || r.published || r.deleted || 0;
        if (count)
            parts.push(count + ' thành công');
        if (r.skipped)
            parts.push(r.skipped + ' bỏ qua');
        if (r.errors)
            parts.push(r.errors + ' lỗi');
        return parts.join(' · ');
    },
    async bulkRegenerate() {
        const ids = [...this.dgBulkSelected];
        const eligible = this.contentItems.filter(i => ids.includes(i.id) && ['PENDING_REVIEW', 'REVISION_REQUESTED', 'APPROVED'].includes(i.status) && i.source === 'AI_GEN');
        const skip = ids.length - eligible.length;
        let msg = `Gen lại ${eligible.length} nội dung?`;
        if (skip)
            msg += `\n${skip} nội dung không phù hợp sẽ được bỏ qua.`;
        if (!eligible.length) {
            this.showToast('Không có nội dung phù hợp để gen lại', 'error');
            return;
        }
        if (!confirm(msg))
            return;
        try {
            const r = await this.api('/dashboard/content/bulk/generate', { method: 'POST', body: JSON.stringify({ ids: eligible.map(i => i.id) }) });
            this.showToast(this.bulkResultMsg(r, 'Gen lại'));
            this.dgBulkSelected = [];
            this.dgBulkAll = false;
            setTimeout(() => this.loadContent(), 2000);
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async bulkGenerate() {
        const ids = [...this.dgBulkSelected];
        const eligible = this.contentItems.filter(i => ids.includes(i.id) && ['DRAFT', 'FAILED'].includes(i.status));
        const skip = ids.length - eligible.length;
        let msg = `Gen ${eligible.length} nội dung?`;
        if (skip)
            msg += `\n${skip} nội dung không phù hợp trạng thái sẽ được bỏ qua.`;
        if (!eligible.length) {
            this.showToast('Không có nội dung phù hợp để gen', 'error');
            return;
        }
        if (!confirm(msg))
            return;
        try {
            const r = await this.api('/dashboard/content/bulk/generate', { method: 'POST', body: JSON.stringify({ ids }) });
            this.showToast(this.bulkResultMsg(r, 'Gen'));
            this.dgBulkSelected = [];
            this.dgBulkAll = false;
            setTimeout(() => this.loadContent(), 2000);
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async bulkApprove() {
        const ids = [...this.dgBulkSelected];
        const eligible = this.contentItems.filter(i => ids.includes(i.id) && i.status === 'PENDING_REVIEW');
        const skip = ids.length - eligible.length;
        let msg = `Duyệt ${eligible.length} nội dung?`;
        if (skip)
            msg += `\n${skip} nội dung không phù hợp trạng thái sẽ được bỏ qua.`;
        if (!eligible.length) {
            this.showToast('Không có nội dung phù hợp để duyệt', 'error');
            return;
        }
        if (!confirm(msg))
            return;
        try {
            const r = await this.api('/dashboard/content/bulk/approve', { method: 'POST', body: JSON.stringify({ ids, userId: this.user?.id }) });
            this.showToast(this.bulkResultMsg(r, 'Duyệt'));
            this.dgBulkSelected = [];
            this.dgBulkAll = false;
            await this.loadContent();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async bulkPublish() {
        const ids = [...this.dgBulkSelected];
        const eligible = this.contentItems.filter(i => ids.includes(i.id) && ['APPROVED', 'FAILED'].includes(i.status) && i.generatedText);
        const skip = ids.length - eligible.length;
        let msg = `Đăng ${eligible.length} nội dung lên Facebook?`;
        if (skip)
            msg += `\n${skip} nội dung không phù hợp sẽ được bỏ qua.`;
        if (!eligible.length) {
            this.showToast('Không có nội dung phù hợp để đăng', 'error');
            return;
        }
        if (!confirm(msg))
            return;
        try {
            const r = await this.api('/dashboard/content/bulk/publish', { method: 'POST', body: JSON.stringify({ ids }) });
            this.showToast(this.bulkResultMsg(r, 'Đăng'));
            this.dgBulkSelected = [];
            this.dgBulkAll = false;
            setTimeout(() => this.loadContent(), 3000);
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async bulkDelete() {
        const ids = [...this.dgBulkSelected];
        if (!confirm(`Xóa ${ids.length} nội dung?\nHành động này không thể hoàn tác.`))
            return;
        try {
            const r = await this.api('/dashboard/content/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) });
            this.showToast(this.bulkResultMsg(r, 'Xóa'));
            this.dgBulkSelected = [];
            this.dgBulkAll = false;
            await this.loadContent();
            await this.loadDashboard();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    openContentForm() {
        this.editingContent = null;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const formPages = this.scopePages.length ? this.scopePages : this.pages;
        this.contentForm = {
            pageId: this.currentScope.type === 'page' ? this.currentScope.id : (formPages[0]?.id || ''),
            topic: '',
            contentType: 'IMAGE',
            scheduledDate: tomorrow.toISOString().split('T')[0],
            scheduledTime: '09:00',
            notes: '',
            imageDescriptions: '',
            videoFile: null,
            videoUrl: '',
            mode: 'ai',
            generatedText: '',
            manualVideoUrl: '',
            images: [],
            imageInputMode: 'upload',
            videoInputMode: 'upload',
            _dragIdx: -1,
        };
        this.contentFormError = '';
        this.showContentForm = true;
    },
    editContent(item, forceMode) {
        this.editingContent = item;
        const d = new Date(item.scheduledAt);
        const isManual = item.source !== 'AI_GEN';
        const existingImages = [];
        if (item.generatedImages?.length) {
            item.generatedImages.forEach(img => existingImages.push({ url: img.url || img.localPath, file: null }));
        }
        else if (item.generatedImageUrl) {
            existingImages.push({ url: item.generatedImageUrl, file: null });
        }
        this.contentForm = {
            pageId: item.pageId,
            topic: item.topic,
            contentType: item.contentType,
            scheduledDate: d.toISOString().split('T')[0],
            scheduledTime: d.toTimeString().slice(0, 5),
            notes: item.notes || '',
            imageDescriptions: item.imageDescriptions || '',
            videoFile: null,
            videoUrl: item.generatedVideoUrl || '',
            mode: forceMode || (isManual ? 'manual' : 'ai'),
            generatedText: item.generatedText || '',
            manualVideoUrl: item.generatedVideoUrl || '',
            images: existingImages,
            imageInputMode: 'upload',
            videoInputMode: item.generatedVideoUrl ? 'url' : 'upload',
            _dragIdx: -1,
            _locked: !!forceMode,
        };
        this.contentFormError = '';
        this.showContentForm = true;
    },
    async saveContent() {
        this.contentFormError = '';
        if (!this.contentForm.pageId || !this.contentForm.topic || !this.contentForm.scheduledDate) {
            this.contentFormError = 'Vui lòng điền Page, Chủ đề và Ngày đăng';
            return;
        }
        this.contentFormSaving = true;
        try {
            const scheduledAt = `${this.contentForm.scheduledDate}T${this.contentForm.scheduledTime || '09:00'}:00`;
            const isManual = this.contentForm.mode === 'manual';
            const payload = {
                pageId: this.contentForm.pageId,
                topic: this.contentForm.topic,
                contentType: this.contentForm.contentType,
                scheduledAt,
                notes: this.contentForm.notes,
                imageDescriptions: this.contentForm.imageDescriptions,
            };
            if (isManual) {
                const urlImages = this.contentForm.images.filter(i => i.url && !i.file);
                Object.assign(payload, {
                    generatedText: this.contentForm.generatedText,
                    imageUrl: urlImages.length > 0 ? urlImages[0].url : '',
                    videoUrl: this.contentForm.manualVideoUrl,
                    imageUrls: urlImages.map(i => i.url),
                });
            }
            let contentId;
            if (this.editingContent) {
                const updated = await this.api(`/dashboard/content/${this.editingContent.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });
                contentId = updated.id;
                if (!this.contentForm.videoUrl && this.editingContent.generatedVideoUrl && !isManual) {
                    await this.api(`/dashboard/content/${contentId}/video`, { method: 'DELETE' });
                }
                this.showToast('Cập nhật content thành công');
            }
            else {
                const created = await this.api('/dashboard/content', {
                    method: 'POST',
                    body: JSON.stringify({ ...payload, userId: this.user.id }),
                });
                contentId = created.id;
                this.showToast(isManual ? 'Thêm content có sẵn → Chờ duyệt' : 'Thêm content thành công');
            }
            const fileImages = this.contentForm.images.filter(i => i.file);
            if (fileImages.length > 0 && contentId) {
                const form = new FormData();
                fileImages.forEach(i => form.append('images', i.file));
                await this.api(`/dashboard/content/${contentId}/upload-images`, { method: 'POST', body: form });
            }
            if (this.contentForm.videoFile && contentId) {
                const form = new FormData();
                form.append('video', this.contentForm.videoFile);
                await this.api(`/dashboard/content/${contentId}/upload-video`, { method: 'POST', body: form });
            }
            this.showContentForm = false;
            await this.loadContent();
        }
        catch (e) {
            this.contentFormError = e.message;
        }
        finally {
            this.contentFormSaving = false;
        }
    },
    openLightbox(images, index = 0) {
        const urls = images.map(img => typeof img === 'string' ? img : (img.url || img.localPath || ''));
        this.lightbox = { open: true, images: urls.filter(Boolean), index };
    },
    async saveAndRegenerate() {
        this.contentFormError = '';
        if (!this.contentForm.topic || !this.contentForm.scheduledDate) {
            this.contentFormError = 'Vui lòng điền Chủ đề và Ngày đăng';
            return;
        }
        this.contentFormSaving = true;
        try {
            const contentId = this.editingContent.id;
            const scheduledAt = `${this.contentForm.scheduledDate}T${this.contentForm.scheduledTime || '09:00'}:00`;
            await this.api(`/dashboard/content/${contentId}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    topic: this.contentForm.topic,
                    notes: this.contentForm.notes,
                    imageDescriptions: this.contentForm.imageDescriptions,
                    scheduledAt,
                }),
            });
            await this.api(`/dashboard/content/${contentId}/regenerate`, { method: 'POST' });
            this.showContentForm = false;
            this.showToast('Đã lưu và đưa vào hàng đợi gen lại');
            await this.loadContent();
        }
        catch (e) {
            this.contentFormError = e.message;
        }
        finally {
            this.contentFormSaving = false;
        }
    },
    addImageFiles(files) {
        for (const f of files) {
            if (this.contentForm.images.length >= 10)
                break;
            this.contentForm.images.push({ url: '', file: f });
        }
    },
    addImageUrl(url) {
        if (!url || this.contentForm.images.length >= 10)
            return;
        this.contentForm.images.push({ url, file: null });
    },
    reorderImage(from, to) {
        if (from === to)
            return;
        const imgs = this.contentForm.images;
        const item = imgs.splice(from, 1)[0];
        imgs.splice(to, 0, item);
    },
    showTextPopup(title, content) {
        this.textPopup = { show: true, title, content: content || '' };
    },
    viewResult(item) {
        this.openDrawer(item);
    },
    viewError(item) {
        this.errorItem = item;
        this.showErrorModal = true;
    },
    async copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Đã copy!');
        }
        catch {
            this.showToast('Không thể copy', 'error');
        }
    },
    async genAllDrafts() {
        const drafts = this.contentItems.filter(i => i.status === 'DRAFT');
        if (!drafts.length)
            return;
        if (!confirm(`Gen content cho ${drafts.length} bài Draft?`))
            return;
        try {
            await this.api('/dashboard/content/generate-all-drafts', { method: 'POST' });
            this.showToast(`Đã đưa ${drafts.length} bài vào hàng đợi gen`);
            setTimeout(() => this.loadContent(), 2000);
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async approveContent(id) {
        if (!confirm('Duyệt content này?'))
            return;
        try {
            await this.api(`/dashboard/content/${id}/approve`, { method: 'POST', body: JSON.stringify({ userId: this.user.id }) });
            this.showToast('Đã duyệt content');
            await this.loadContent();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async rejectContent(id) {
        const feedback = prompt('Lý do hủy (tùy chọn):');
        if (feedback === null)
            return;
        try {
            await this.api(`/dashboard/content/${id}/reject`, { method: 'POST', body: JSON.stringify({ userId: this.user.id, feedback }) });
            this.showToast('Đã hủy content');
            await this.loadContent();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async requestEditContent(id) {
        const feedback = prompt('Yêu cầu chỉnh sửa gì?');
        if (!feedback)
            return;
        try {
            await this.api(`/dashboard/content/${id}/request-edit`, { method: 'POST', body: JSON.stringify({ userId: this.user.id, feedback }) });
            this.showToast('Đã gửi yêu cầu sửa');
            await this.loadContent();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async openRevisionModal(item) {
        let images = item.generatedImages || [];
        let imgArr = Array.isArray(images) ? images : [];
        if (imgArr.length === 0 && item.generatedImageUrl) {
            imgArr = [{ url: item.generatedImageUrl }];
        }
        this.revModal = {
            open: true, item, type: 'TEXT', feedback: '',
            images: [...imgArr],
            originalText: item.generatedText || '',
            originalImages: [...imgArr],
            selImgs: [], loading: false, chatHistory: [],
            currentText: item.generatedText || '',
            selectedVersion: -1,
            versions: [],
            loadingVersions: true,
        };
        // Load saved revision history
        try {
            const revisions = await this.api(`/dashboard/content/${item.id}/revisions`);
            if (revisions && revisions.length > 0) {
                this.revModal.versions = revisions;
                this.revModal.originalText = revisions[0].generatedText || item.generatedText || '';
                this.revModal.originalImages = revisions[0].generatedImages || imgArr;
                // Pre-fill chat history from saved versions (skip version 0 = original)
                revisions.filter(r => r.version > 0).forEach(r => {
                    this.revModal.chatHistory.push({
                        feedback: r.feedback || '',
                        type: 'TEXT',
                        selImgs: [],
                        status: 'done',
                        newText: r.generatedText || '',
                        newImages: r.generatedImages || [],
                        error: '',
                        savedVersion: r.version,
                    });
                });
                // Select the latest version
                this.revModal.selectedVersion = this.revModal.chatHistory.length;
            }
            else {
                this.revModal.selectedVersion = 0;
            }
        }
        catch (e) {
            this.revModal.selectedVersion = 0;
        }
        this.revModal.loadingVersions = false;
    },
    closeRevModal() {
        this.revModal.open = false;
        this.revModal.loading = false;
        this.revModal.chatHistory.forEach(msg => { if (msg.status === 'loading')
            msg.status = 'cancelled'; });
    },
    async submitRevision() {
        const m = this.revModal;
        if (!m.feedback.trim() || !m.item)
            return;
        const msg = { feedback: m.feedback.trim(), type: m.type, selImgs: [...m.selImgs], status: 'loading', newText: '', newImages: null, error: '' };
        m.chatHistory.push(msg);
        const feedbackText = m.feedback.trim();
        m.feedback = '';
        m.loading = true;
        this.$nextTick(() => { if (this.$refs.revChatArea)
            this.$refs.revChatArea.scrollTop = this.$refs.revChatArea.scrollHeight; });
        try {
            const body = {
                revisionType: msg.type,
                feedbackText,
                userId: this.user?.id || 'system',
            };
            if ((msg.type === 'IMAGE' || msg.type === 'TEXT_AND_MEDIA') && msg.selImgs.length > 0) {
                body.selectedMediaIds = msg.selImgs;
            }
            await this.api(`/dashboard/content/${m.item.id}/revision`, {
                method: 'POST', body: JSON.stringify(body),
            });
            // Poll revisions endpoint for new version
            const prevVersionCount = m.chatHistory.filter(h => h.status === 'done').length;
            let attempts = 0;
            const poll = async () => {
                if (!m.open || msg.status !== 'loading')
                    return;
                attempts++;
                try {
                    const revisions = await this.api(`/dashboard/content/${m.item.id}/revisions`);
                    const doneVersions = (revisions || []).filter(r => r.version > 0);
                    if (doneVersions.length > prevVersionCount) {
                        const latest = doneVersions[doneVersions.length - 1];
                        const updated = await this.api(`/dashboard/content/${m.item.id}`);
                        msg.status = 'done';
                        msg.newText = latest.generatedText || '';
                        msg.newImages = latest.generatedImages || [];
                        msg.savedVersion = latest.version;
                        m.selectedVersion = m.chatHistory.indexOf(msg) + 1;
                        m.item = { ...m.item, ...updated };
                        m.loading = false;
                        m.selImgs = [];
                        this.$nextTick(() => { if (this.$refs.revChatArea)
                            this.$refs.revChatArea.scrollTop = this.$refs.revChatArea.scrollHeight; });
                        return;
                    }
                }
                catch (e) { }
                if (attempts < 60)
                    setTimeout(poll, 3000);
                else {
                    msg.status = 'error';
                    msg.error = 'Quá thời gian chờ';
                    m.loading = false;
                }
            };
            setTimeout(poll, 3000);
        }
        catch (e) {
            msg.status = 'error';
            msg.error = e.message || 'Lỗi tinh chỉnh';
            m.loading = false;
            m.selImgs = [];
        }
    },
    async confirmRevisionVersion() {
        const m = this.revModal;
        const ver = m.selectedVersion;
        try {
            if (ver === 0) {
                await this.api(`/dashboard/content/${m.item.id}`, {
                    method: 'PATCH', body: JSON.stringify({ generatedText: m.originalText }),
                });
            }
            else {
                const chosen = m.chatHistory[ver - 1];
                if (chosen && ver < m.chatHistory.length) {
                    await this.api(`/dashboard/content/${m.item.id}`, {
                        method: 'PATCH', body: JSON.stringify({
                            ...(chosen.newText ? { generatedText: chosen.newText } : {}),
                        }),
                    });
                }
            }
        }
        catch (e) {
            this.showToast('Lỗi áp dụng phiên bản', 'error');
        }
        m.open = false;
        this.loadContent();
        if (this.drawerItem?.id === m.item?.id)
            this.refreshDrawer(m.item.id);
        this.showToast(ver === 0 ? 'Đã giữ bản gốc' : `Đã chọn phiên bản ${ver}`);
    },
    async openDrawer(item) {
        this.drawerOpen = true;
        this.drawerLoading = true;
        this.drawerTab = 'content';
        this.drawerItem = null;
        this.drawerSyncError = '';
        try {
            const data = await this.api(`/dashboard/content/${item.id}`);
            this.drawerItem = data;
        }
        catch (e) {
            this.drawerItem = null;
            this.showToast('Không tải được chi tiết content', 'error');
        }
        finally {
            this.drawerLoading = false;
        }
    },
    closeDrawer() {
        this.drawerOpen = false;
        this.drawerItem = null;
    },
    async refreshDrawer(id) {
        if (!this.drawerOpen)
            return;
        try {
            const data = await this.api(`/dashboard/content/${id}`);
            this.drawerItem = data;
        }
        catch (e) { }
        await this.loadContent();
    },
    drawerPrevDisabled() {
        if (!this.drawerItem || !this.contentItems?.length)
            return true;
        const idx = this.contentItems.findIndex(i => i.id === this.drawerItem.id);
        return idx <= 0;
    },
    drawerNextDisabled() {
        if (!this.drawerItem || !this.contentItems?.length)
            return true;
        const idx = this.contentItems.findIndex(i => i.id === this.drawerItem.id);
        return idx < 0 || idx >= this.contentItems.length - 1;
    },
    async drawerPrev() {
        if (this.drawerPrevDisabled())
            return;
        const idx = this.contentItems.findIndex(i => i.id === this.drawerItem.id);
        await this.openDrawer(this.contentItems[idx - 1]);
    },
    async drawerNext() {
        if (this.drawerNextDisabled())
            return;
        const idx = this.contentItems.findIndex(i => i.id === this.drawerItem.id);
        await this.openDrawer(this.contentItems[idx + 1]);
    },
    drawerNavLabel() {
        if (!this.drawerItem || !this.contentItems?.length)
            return '';
        const idx = this.contentItems.findIndex(i => i.id === this.drawerItem.id);
        return idx >= 0 ? `${idx + 1} / ${this.contentItems.length}` : '';
    },
    drawerWorkflowSteps() {
        if (!this.drawerItem)
            return [];
        const s = this.drawerItem.status;
        const all = [
            { label: 'Nháp', status: 'DRAFT' },
            { label: 'Đang gen', status: 'GENERATING' },
            { label: 'Chờ duyệt', status: 'PENDING_REVIEW' },
            { label: 'Đã duyệt', status: 'APPROVED' },
            { label: 'Đang đăng', status: 'PUBLISHING' },
            { label: 'Đã đăng', status: 'PUBLISHED' },
        ];
        const order = ['DRAFT', 'GENERATING', 'PENDING_REVIEW', 'APPROVED', 'PUBLISHING', 'PUBLISHED'];
        const curIdx = order.indexOf(s);
        const special = { REVISION_REQUESTED: 2, FAILED: 5, CANCELLED: -1 };
        if (s === 'CANCELLED')
            return [{ label: 'Đã hủy', done: true, active: true, color: 'gray' }];
        return all.map((step, i) => {
            const si = order.indexOf(step.status);
            let done = false, active = false, color = '';
            if (s in special) {
                const pos = special[s];
                done = si < pos;
                active = si === pos;
                color = s === 'FAILED' ? 'red' : s === 'REVISION_REQUESTED' ? 'orange' : '';
                if (active)
                    step = { ...step, label: s === 'FAILED' ? 'Lỗi' : s === 'REVISION_REQUESTED' ? 'Yêu cầu sửa' : step.label };
            }
            else {
                done = si < curIdx;
                active = si === curIdx;
            }
            return { ...step, done, active, color };
        });
    },
    drawerHistory() {
        if (!this.drawerItem)
            return [];
        const item = this.drawerItem;
        const events = [];
        if (item.createdAt)
            events.push({ time: item.createdAt, label: 'Tạo content', icon: 'ri-add-circle-line', color: 'text-gray-500' });
        if (item.source === 'AI_GEN' && item.generatedText)
            events.push({ time: item.updatedAt, label: 'AI tạo nội dung', icon: 'ri-sparkling-line', color: 'text-blue-500' });
        if (item.approvalLogs?.length) {
            for (const log of [...item.approvalLogs].reverse()) {
                const actionLabel = { APPROVE: 'Duyệt', REJECT: 'Từ chối', REQUEST_EDIT: 'Yêu cầu sửa' }[log.action] || log.action;
                const color = log.action === 'APPROVE' ? 'text-green-500' : log.action === 'REJECT' ? 'text-red-500' : 'text-orange-500';
                const icon = log.action === 'APPROVE' ? 'ri-check-line' : log.action === 'REJECT' ? 'ri-close-line' : 'ri-edit-line';
                events.push({ time: log.createdAt, label: `${actionLabel} bởi ${log.user?.name || 'N/A'}${log.feedback ? ': ' + log.feedback : ''}`, icon, color });
            }
        }
        if (item.publishedAt)
            events.push({ time: item.publishedAt, label: 'Đã đăng lên ' + (item.page?.platform || 'Facebook'), icon: 'ri-send-plane-fill', color: 'text-green-600' });
        if (item.status === 'FAILED' && item.errorMessage)
            events.push({ time: item.updatedAt, label: 'Lỗi: ' + item.errorMessage, icon: 'ri-error-warning-line', color: 'text-red-500' });
        events.sort((a, b) => new Date(a.time) - new Date(b.time));
        return events;
    },
    drawerPerfVal(key) {
        if (!this.drawerItem?.metrics)
            return '—';
        const m = this.drawerItem.metrics;
        if (key === '_engagement') {
            const v = (m.fb_reactions || 0) + (m.fb_comments || 0) + (m.fb_shares || 0);
            return v.toLocaleString('vi-VN');
        }
        if (key === '_eng_per_viewer') {
            const eng = (m.fb_reactions || 0) + (m.fb_comments || 0) + (m.fb_shares || 0);
            const viewers = m.fb_reach || 0;
            if (!viewers)
                return '—';
            return (eng / viewers * 100).toFixed(2) + '%';
        }
        const v = m[key];
        if (v == null)
            return '—';
        return Number(v).toLocaleString('vi-VN');
    },
    async drawerSyncMetrics() {
        if (!this.drawerItem?.id)
            return;
        this.drawerSyncing = true;
        this.drawerSyncError = '';
        try {
            const data = await this.api(`/dashboard/content/${this.drawerItem.id}/sync-metrics`, { method: 'POST' });
            this.drawerItem = data;
            this.showToast('Đã đồng bộ metrics');
            await this.loadContent();
        }
        catch (e) {
            this.drawerSyncError = e.message || 'Lỗi đồng bộ';
            this.showToast('Lỗi đồng bộ metrics', 'error');
        }
        finally {
            this.drawerSyncing = false;
        }
    },
    drawerEditContent() {
        if (!this.drawerItem)
            return;
        const item = this.drawerItem;
        this.closeDrawer();
        this.editContent(item);
    },
    sourceLabel(source) {
        return { AI_GEN: 'AI Gen', AI: 'AI Gen', MANUAL: 'Thủ công', IMPORT: 'Thủ công' }[source] || source;
    },
    toggleMediaFilter(val) {
        if (!this.contentFilter.media) this.contentFilter.media = [];
        const idx = this.contentFilter.media.indexOf(val);
        if (idx >= 0) this.contentFilter.media.splice(idx, 1);
        else this.contentFilter.media.push(val);
        this.dgPage = 1;
        this.loadContent();
    }
});

