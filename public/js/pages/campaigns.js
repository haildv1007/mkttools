window.MKTPageModules = window.MKTPageModules || {};
window.MKTPageModules.campaigns = () => ({
    async loadCampaigns() {
        try {
            const params = new URLSearchParams();
            if (this.currentScope.type !== 'all') {
                params.set('scopeType', this.currentScope.type);
                params.set('scopeId', this.currentScope.id);
            }
            this.campaigns = await this.api('/campaigns?' + params.toString());
        }
        catch { }
    },
    openCampaignModal(c) {
        this.campaignError = '';
        if (c) {
            this.editingCampaign = c;
            this.campaignForm = {
                name: c.name,
                description: c.description || '',
                pageId: c.pageId || c.page?.id || '',
                startDate: c.startDate ? c.startDate.slice(0, 10) : '',
                endDate: c.endDate ? c.endDate.slice(0, 10) : '',
                genLeadTime: String(c.genLeadTime ?? 30),
                autoApprove: c.autoApprove ?? false,
            };
        }
        else {
            this.editingCampaign = null;
            const defaultPageId = this.currentScope.type === 'page' ? this.currentScope.id : (this.scopePages[0]?.id || '');
            this.campaignForm = { name: '', description: '', pageId: defaultPageId, startDate: '', endDate: '', genLeadTime: '30', autoApprove: false };
        }
        this.showCampaignModal = true;
    },
    async saveCampaign() {
        this.campaignError = '';
        try {
            const body = {
                name: this.campaignForm.name,
                description: this.campaignForm.description || null,
                pageId: this.campaignForm.pageId,
                startDate: this.campaignForm.startDate || undefined,
                endDate: this.campaignForm.endDate || null,
                genLeadTime: Number(this.campaignForm.genLeadTime),
                autoApprove: this.campaignForm.autoApprove,
                userId: this.user.id,
            };
            if (this.editingCampaign) {
                await this.api(`/campaigns/${this.editingCampaign.id}`, { method: 'PUT', body: JSON.stringify(body) });
                this.showToast('Đã cập nhật campaign');
            }
            else {
                await this.api('/campaigns', { method: 'POST', body: JSON.stringify(body) });
                this.showToast('Đã tạo campaign');
            }
            this.showCampaignModal = false;
            await this.loadCampaigns();
        }
        catch (e) {
            this.campaignError = e.message;
        }
    },
    async updateCampaign(id, data) {
        try {
            await this.api(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) });
            await this.loadCampaigns();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async deleteCampaign(c) {
        if (!confirm(`Xóa campaign "${c.name}" và tất cả content?`))
            return;
        try {
            await this.api(`/campaigns/${c.id}`, { method: 'DELETE' });
            this.showToast('Đã xóa campaign');
            await this.loadCampaigns();
            await this.loadDashboard();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    }
});

