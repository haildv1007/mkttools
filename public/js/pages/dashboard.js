window.MKTPageModules = window.MKTPageModules || {};
window.MKTPageModules.dashboard = () => ({
    _dashboardAbort: null,
    _dashboardCache: new Map(),
    onTimePresetChange() {
        if (this.dbFilter.preset !== 'custom')
            this.loadDashboard();
    },
    _computeDateRange() {
        const tz = 'Asia/Ho_Chi_Minh';
        const nowLocal = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
        const today = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate());
        const fmt = d => {
            const yy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yy}-${mm}-${dd}`;
        };
        const p = this.dbFilter.preset;
        if (p === 'today') {
            return { dateFrom: fmt(today), dateTo: fmt(today) };
        }
        if (p === 'yesterday') {
            const yd = new Date(today.getTime() - 86400000);
            return { dateFrom: fmt(yd), dateTo: fmt(yd) };
        }
        if (p === 'custom') {
            return { dateFrom: this.dbFilter.customFrom || fmt(new Date(today.getTime() - 30 * 86400000)), dateTo: this.dbFilter.customTo || fmt(today) };
        }
        if (p === 'this_week') {
            const dow = today.getDay() || 7;
            const mon = new Date(today.getTime() - (dow - 1) * 86400000);
            return { dateFrom: fmt(mon), dateTo: fmt(today) };
        }
        if (p === 'last_week') {
            const dow = today.getDay() || 7;
            const thisMon = new Date(today.getTime() - (dow - 1) * 86400000);
            const lastMon = new Date(thisMon.getTime() - 7 * 86400000);
            const lastSun = new Date(thisMon.getTime() - 86400000);
            return { dateFrom: fmt(lastMon), dateTo: fmt(lastSun) };
        }
        if (p === 'this_month') {
            const first = new Date(today.getFullYear(), today.getMonth(), 1);
            return { dateFrom: fmt(first), dateTo: fmt(today) };
        }
        if (p === 'last_month') {
            const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const last = new Date(today.getFullYear(), today.getMonth(), 0);
            return { dateFrom: fmt(first), dateTo: fmt(last) };
        }
        const days = parseInt(p) || 30;
        return { dateFrom: fmt(new Date(today.getTime() - days * 86400000)), dateTo: fmt(today) };
    },
    cancelDashboardRequests() {
        if (this._dashboardAbort) {
            this._dashboardAbort.abort();
            this._dashboardAbort = null;
        }
    },
    async loadDashboard() {
        this.cancelDashboardRequests();
        const controller = new AbortController();
        this._dashboardAbort = controller;
        this.dashboardLoading = true;
        try {
            const params = new URLSearchParams();
            if (this.dbFilter.pageId)
                params.set('pageId', this.dbFilter.pageId);
            if (this.dbFilter.campaignId)
                params.set('campaignId', this.dbFilter.campaignId);
            const range = this._computeDateRange();
            params.set('dateFrom', range.dateFrom);
            params.set('dateTo', range.dateTo);
            if (this.currentScope.type !== 'all') {
                params.set('scopeType', this.currentScope.type);
                params.set('scopeId', this.currentScope.id);
            }
            const cacheKey = params.toString();
            const cached = this._dashboardCache.get(cacheKey);
            if (cached && Date.now() - cached.savedAt < 30000) {
                this.db = cached.data;
                this.dashboardLoading = false;
                requestAnimationFrame(() => this.renderPerfChart());
            }
            const signal = controller.signal;
            const db = await this.api('/dashboard/stats/dashboard?' + params.toString(), { signal });
            if (signal.aborted) return;
            this.db = db;
            this._dashboardCache.set(cacheKey, { data: db, savedAt: Date.now() });
            requestAnimationFrame(() => this.renderPerfChart());
            if (!this._statsLoaded) {
                this.api('/dashboard/stats', { signal }).then(stats => {
                    if (signal.aborted) return;
                    this.stats = stats;
                    this.selectedTextProvider = stats.providers?.activeText || '';
                    this.selectedImageProvider = stats.providers?.activeImage || '';
                    this._statsLoaded = true;
                }).catch(() => {});
            }
        }
        catch (e) {
            if (e?.name === 'AbortError') return;
        }
        if (!controller.signal.aborted) this.dashboardLoading = false;
    },
    async syncFbMetrics() {
        this.fbSyncing = true;
        try {
            const syncBody = { pageId: this.dbFilter.pageId || undefined };
            if (this.currentScope.type !== 'all') {
                syncBody.scopeType = this.currentScope.type;
                syncBody.scopeId = this.currentScope.id;
            }
            const result = await this.api('/dashboard/stats/fb-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(syncBody) });
            const msg = `Sync xong: ${result.synced}/${result.total} bài` + (result.errors?.length ? ` (${result.errors.length} lỗi)` : '');
            alert(msg);
            await this.loadDashboard();
        }
        catch (e) {
            alert('Sync failed: ' + e.message);
        }
        this.fbSyncing = false;
    },
    renderPerfChart() {
        if (typeof Chart === 'undefined')
            return;
        const wrap = document.getElementById('perfChartWrap');
        if (!wrap)
            return;
        const data = this.db?.chart_performance;
        const hasData = data && data.some(d => d.viewers || d.media_views || d.engagement || d.posts_count);
        let emptyDiv = wrap.querySelector('.chart-empty');
        if (!emptyDiv) {
            emptyDiv = document.createElement('div');
            emptyDiv.className = 'chart-empty';
            emptyDiv.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;';
            emptyDiv.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:12px"><i class="ri-bar-chart-box-line" style="font-size:2rem;display:block;margin-bottom:8px"></i><p class="chart-empty-msg"></p></div>';
            wrap.appendChild(emptyDiv);
        }
        if (!hasData) {
            if (this._charts.perf) { this._charts.perf.destroy(); this._charts.perf = null; }
            wrap.querySelectorAll('canvas').forEach(c => c.remove());
            emptyDiv.style.display = 'flex';
            wrap.querySelector('.chart-empty-msg').textContent = (this.db?.top_contents || []).length
                ? 'Không có dữ liệu FB trong khoảng thời gian này. Bấm Sync FB để cập nhật.'
                : 'Chưa có bài đăng nào. Tạo content và đăng bài trước.';
            return;
        }
        emptyDiv.style.display = 'none';
        const labels = data.map(d => { const p = d.date.split('-'); return p[2] + '/' + p[1]; });
        if (this._charts.perf) {
            const chart = this._charts.perf;
            chart.data.labels = labels;
            chart.data.datasets[0].data = data.map(d => d.viewers);
            chart.data.datasets[1].data = data.map(d => d.media_views);
            chart.data.datasets[2].data = data.map(d => d.engagement);
            chart.data.datasets[3].data = data.map(d => d.posts_count);
            chart.update('none');
            return;
        }
        wrap.querySelectorAll('canvas').forEach(c => c.remove());
        const canvas = document.createElement('canvas');
        const w = wrap.clientWidth || 600;
        const h = (wrap.clientHeight || 340) - 4;
        canvas.width = w;
        canvas.height = h;
        wrap.insertBefore(canvas, wrap.firstChild);
        this._charts.perf = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { type: 'line', label: 'Người xem', data: data.map(d => d.viewers), borderColor: '#3b82f6', borderWidth: 2, fill: false, tension: 0, pointRadius: 0, yAxisID: 'y', order: 1 },
                    { type: 'line', label: 'Lượt xem', data: data.map(d => d.media_views), borderColor: '#06b6d4', borderWidth: 2, fill: false, tension: 0, pointRadius: 0, yAxisID: 'y', order: 2 },
                    { type: 'line', label: 'Engagement', data: data.map(d => d.engagement), borderColor: '#8b5cf6', borderWidth: 2, fill: false, tension: 0, pointRadius: 0, yAxisID: 'y', order: 2 },
                    { type: 'bar', label: 'Bài đăng', data: data.map(d => d.posts_count), backgroundColor: 'rgba(99,102,241,0.25)', borderRadius: 2, yAxisID: 'y1', order: 3 },
                ]
            },
            options: {
                responsive: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 12 } } },
                scales: {
                    y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
                    y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { font: { size: 10 }, stepSize: 1 } },
                    x: { ticks: { font: { size: 9 }, maxRotation: 0 }, grid: { display: false } }
                }
            }
        });
    },
    getCampaignEngagement(campaignId, type) {
        if (!this.fbInsights?.pages)
            return 0;
        let reactions = 0, comments = 0, shares = 0;
        for (const pg of this.fbInsights.pages) {
            for (const post of (pg.posts || [])) {
                if (post.campaignId === campaignId) {
                    reactions += post.reactions || 0;
                    comments += post.comments || 0;
                    shares += post.shares || 0;
                }
            }
        }
        if (type === 'reactions')
            return reactions;
        if (type === 'comments')
            return comments;
        if (type === 'shares')
            return shares;
        return reactions + comments + shares;
    },
    async loadTimeline() {
        try {
            const data = await this.api(`/dashboard/stats/timeline?days=${this.timelineDays}`);
            this.renderTimelineChart(data);
        }
        catch { }
    },
    async loadFbInsights() {
        this.fbInsightsLoading = true;
        try {
            const data = await this.api('/dashboard/stats/fb-insights');
            this.fbInsights = data;
        }
        catch (e) {
            this.fbInsights = { pages: [], totals: { totalReactions: 0, totalComments: 0, totalShares: 0, totalClicks: 0, totalViewers: 0, totalMediaViews: 0, totalEngagement: 0, totalFollowers: 0, totalPosts: 0 } };
        }
        this.fbInsightsLoading = false;
    },
    renderTimelineChart(data) {
        const ctx = document.getElementById('timelineChart');
        if (!ctx)
            return;
        if (this._charts.timeline)
            this._charts.timeline.destroy();
        const labels = data.map(d => { const dt = new Date(d.date); return dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }); });
        this._charts.timeline = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Tạo mới', data: data.map(d => d.created), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.3, pointRadius: 3 },
                    { label: 'Đã đăng', data: data.map(d => d.published), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.3, pointRadius: 3 },
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }
        });
    },
    renderStatusChart() {
        const ctx = document.getElementById('statusChart');
        if (!ctx)
            return;
        if (this._charts.status)
            this._charts.status.destroy();
        const bd = this.stats.statusBreakdown || {};
        const entries = Object.entries(bd).filter(([, v]) => v > 0);
        if (!entries.length)
            return;
        const colors = { DRAFT: '#9ca3af', GENERATING: '#60a5fa', PENDING_REVIEW: '#f59e0b', APPROVED: '#34d399', PUBLISHING: '#818cf8', PUBLISHED: '#22c55e', FAILED: '#ef4444', CANCELLED: '#d1d5db', REVISION_REQUESTED: '#f97316' };
        this._charts.status = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: entries.map(([s]) => this.statusLabel(s)), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([s]) => colors[s] || '#9ca3af') }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 }, padding: 8 } } }, cutout: '55%' }
        });
    }
});
