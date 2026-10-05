window.MKTPageModules = window.MKTPageModules || {};
window.MKTPageModules.activity = () => ({
    async loadActivity(append = false) {
        if (this.actLoading)
            return;
        this.actLoading = true;
        try {
            const params = new URLSearchParams();
            if (this.actTab !== 'all')
                params.set('category', this.actTab);
            params.set('limit', '30');
            if (append && this.actCursor)
                params.set('cursor', this.actCursor);
            const data = await this.api(`/dashboard/activity?${params}`);
            if (!data)
                return;
            if (append) {
                this.actItems = [...this.actItems, ...data.items];
            }
            else {
                this.actItems = data.items;
            }
            this.actHasMore = data.hasMore;
            this.actCursor = data.nextCursor;
            this.actRunning = this.actItems.filter(a => a.status === 'running').length;
        }
        catch (e) {
            console.error('Activity load failed:', e);
        }
        finally {
            this.actLoading = false;
        }
    },
    startActPoll() {
        this.stopActPoll();
        this._actPollTimer = setInterval(() => {
            if (this.actOpen)
                this.loadActivity();
        }, 10000);
    },
    stopActPoll() {
        if (this._actPollTimer) {
            clearInterval(this._actPollTimer);
            this._actPollTimer = null;
        }
    },
    actTimeAgo(dateStr) {
        if (!dateStr)
            return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const s = Math.floor(diff / 1000);
        if (s < 60)
            return 'Vừa xong';
        const m = Math.floor(s / 60);
        if (m < 60)
            return m + ' phút trước';
        const h = Math.floor(m / 60);
        if (h < 24)
            return h + ' giờ trước';
        const d = Math.floor(h / 24);
        return d + ' ngày trước';
    }
});

