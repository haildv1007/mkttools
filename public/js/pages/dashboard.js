window.MKTPageModules = window.MKTPageModules || {};
window.MKTPageModules.dashboard = () => ({
    _dashboardAbort: null,
    _dashboardRequestId: 0,
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
        const requestId = ++this._dashboardRequestId;
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
                requestAnimationFrame(() => {
                    if (requestId === this._dashboardRequestId) this.renderPerfChart();
                });
            }
            const signal = controller.signal;
            const db = await this.api('/dashboard/stats/dashboard?' + params.toString(), { signal });
            if (signal.aborted || requestId !== this._dashboardRequestId) return;
            this.db = db;
            this._dashboardCache.set(cacheKey, { data: db, savedAt: Date.now() });
            requestAnimationFrame(() => {
                if (requestId === this._dashboardRequestId) this.renderPerfChart();
            });
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
        const wrap = document.getElementById('perfChartWrap');
        if (!wrap)
            return;
        const data = Array.isArray(this.db?.chart_performance) ? this.db.chart_performance : [];
        const hasData = data && data.some(d => d.viewers || d.media_views || d.engagement || d.posts_count);
        if (this._charts.perf) { this._charts.perf.destroy(); this._charts.perf = null; }
        if (!hasData) {
            const message = (this.db?.top_contents || []).length
                ? 'Không có dữ liệu FB trong khoảng thời gian này. Bấm Sync FB để cập nhật.'
                : 'Chưa có bài đăng nào. Tạo content và đăng bài trước.';
            wrap.innerHTML = `<div class="absolute inset-0 flex items-center justify-center text-center text-xs text-gray-400"><div><i class="ri-bar-chart-box-line block mb-2 text-3xl"></i><p>${message}</p></div></div>`;
            return;
        }
        const width = 1000, height = 285, left = 48, right = 18, top = 14, bottom = 48;
        const plotW = width - left - right, plotH = height - top - bottom;
        const maxMetric = Math.max(1, ...data.flatMap(d => [d.viewers || 0, d.media_views || 0, d.engagement || 0]));
        const maxPosts = Math.max(1, ...data.map(d => d.posts_count || 0));
        const x = i => left + (data.length === 1 ? plotW / 2 : i * plotW / (data.length - 1));
        const metricY = v => top + plotH - (v / maxMetric) * plotH;
        const postY = v => top + plotH - (v / maxPosts) * plotH;
        const line = (key, color) => `<polyline points="${data.map((d, i) => `${x(i).toFixed(1)},${metricY(d[key] || 0).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
        const barWidth = Math.max(3, Math.min(22, plotW / Math.max(data.length, 1) * .55));
        const bars = data.map((d, i) => {
            const y = postY(d.posts_count || 0);
            return `<rect x="${(x(i) - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, top + plotH - y).toFixed(1)}" rx="2" fill="#c7d2fe"/>`;
        }).join('');
        const tickStep = Math.max(1, Math.ceil(data.length / 8));
        const xTicks = data.map((d, i) => {
            if (i % tickStep !== 0 && i !== data.length - 1) return '';
            const p = d.date.split('-');
            return `<text x="${x(i).toFixed(1)}" y="${height - 25}" text-anchor="middle" font-size="10" fill="#94a3b8">${p[2]}/${p[1]}</text>`;
        }).join('');
        const grid = [0, .25, .5, .75, 1].map(r => {
            const y = top + plotH * (1 - r);
            return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}" stroke="#eef2f7"/><text x="${left-8}" y="${y+3}" text-anchor="end" font-size="10" fill="#94a3b8">${Math.round(maxMetric*r)}</text>`;
        }).join('');
        wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="block h-full w-full" role="img" aria-label="Biểu đồ hiệu suất">${grid}${bars}${line('viewers','#3b82f6')}${line('media_views','#06b6d4')}${line('engagement','#8b5cf6')}${xTicks}</svg>`;
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
