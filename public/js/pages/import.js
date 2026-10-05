window.MKTPageModules = window.MKTPageModules || {};
window.MKTPageModules.import = () => ({
    importPageOpen: false,
    importPageSearch: '',
    importPageActiveIndex: 0,
    importCampaignOpen: false,
    importCampaignActiveIndex: 0,
    importDragging: false,
    get selectedImportPage() {
        return (this.scopePages || []).find((page) => page.id === this.importForm.pageId) || null;
    },
    get filteredImportPages() {
        const query = (this.importPageSearch || '').trim().toLocaleLowerCase('vi');
        if (!query)
            return this.scopePages || [];
        return (this.scopePages || []).filter((page) => page.name.toLocaleLowerCase('vi').includes(query));
    },
    get selectedImportCampaign() {
        return (this.importPageCampaigns || []).find((campaign) => campaign.id === this.importForm.campaignId) || null;
    },
    get importCampaignOptions() {
        return [{ id: '', name: '— Tạo mới —', isNew: true }, ...(this.importPageCampaigns || [])];
    },
    importPagePictureUrl(page) {
        if (!page)
            return '';
        const metadata = page.metadata && typeof page.metadata === 'object' ? page.metadata : {};
        if (page.pictureUrl || metadata.pictureUrl)
            return page.pictureUrl || metadata.pictureUrl;
        if (page.platform === 'FACEBOOK' && page.externalId)
            return `https://graph.facebook.com/${encodeURIComponent(page.externalId)}/picture?type=small`;
        return '';
    },
    importPagePlatformLabel(page) {
        return page?.platform === 'FACEBOOK' ? 'Facebook Page' : 'Page';
    },
    toggleImportPagePicker() {
        if (this.currentScope.type === 'page')
            return;
        this.closeImportCampaignPicker();
        this.importPageOpen ? this.closeImportPagePicker() : this.openImportPagePicker();
    },
    openImportPagePicker(direction = 0) {
        if (this.currentScope.type === 'page')
            return;
        this.importPageOpen = true;
        this.importPageSearch = '';
        const selectedIndex = (this.scopePages || []).findIndex((page) => page.id === this.importForm.pageId);
        this.importPageActiveIndex = selectedIndex >= 0 ? selectedIndex : (direction > 0 ? -1 : 0);
        if (direction)
            this.moveImportPageFocus(direction);
        this.$nextTick(() => {
            if ((this.scopePages || []).length > 5)
                this.$refs.importPageSearch?.focus();
        });
    },
    closeImportPagePicker() {
        this.importPageOpen = false;
        this.importPageSearch = '';
    },
    moveImportPageFocus(direction) {
        if (!this.importPageOpen) {
            this.openImportPagePicker();
            return;
        }
        const count = this.filteredImportPages.length;
        if (!count)
            return;
        this.importPageActiveIndex = (this.importPageActiveIndex + direction + count) % count;
        this.$nextTick(() => document.getElementById(`import-page-option-${this.filteredImportPages[this.importPageActiveIndex]?.id}`)?.scrollIntoView({ block: 'nearest' }));
    },
    chooseActiveImportPage() {
        const page = this.filteredImportPages[this.importPageActiveIndex];
        if (page)
            this.selectImportPage(page);
    },
    selectImportPage(page) {
        if (!page || this.currentScope.type === 'page')
            return;
        if (this.importForm.pageId !== page.id) {
            this.importForm.pageId = page.id;
            this.importForm.campaignId = '';
        }
        this.closeImportCampaignPicker();
        this.closeImportPagePicker();
    },
    toggleImportCampaignPicker() {
        this.closeImportPagePicker();
        this.importCampaignOpen ? this.closeImportCampaignPicker() : this.openImportCampaignPicker();
    },
    openImportCampaignPicker(direction = 0) {
        this.importCampaignOpen = true;
        const selectedIndex = this.importCampaignOptions.findIndex((campaign) => campaign.id === this.importForm.campaignId);
        this.importCampaignActiveIndex = selectedIndex >= 0 ? selectedIndex : (direction > 0 ? -1 : 0);
        if (direction)
            this.moveImportCampaignFocus(direction);
    },
    closeImportCampaignPicker() {
        this.importCampaignOpen = false;
    },
    moveImportCampaignFocus(direction) {
        if (!this.importCampaignOpen) {
            this.openImportCampaignPicker(direction);
            return;
        }
        const count = this.importCampaignOptions.length;
        if (!count)
            return;
        this.importCampaignActiveIndex = (this.importCampaignActiveIndex + direction + count) % count;
        this.$nextTick(() => document.getElementById(`import-campaign-option-${this.importCampaignActiveIndex}`)?.scrollIntoView({ block: 'nearest' }));
    },
    chooseActiveImportCampaign() {
        const campaign = this.importCampaignOptions[this.importCampaignActiveIndex];
        if (campaign)
            this.selectImportCampaign(campaign);
    },
    selectImportCampaign(campaign) {
        this.importForm.campaignId = campaign?.id || '';
        this.closeImportCampaignPicker();
    },
    selectImportFile(event) {
        const file = event.target.files?.[0];
        if (file)
            this.importForm.file = file;
    },
    clearImportFile() {
        this.importForm.file = null;
        if (this.$refs.fileInput)
            this.$refs.fileInput.value = '';
    },
    formatImportFileSize(size) {
        if (!Number.isFinite(size))
            return '';
        if (size < 1024)
            return `${size} B`;
        if (size < 1024 * 1024)
            return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    },
    async importExcel() {
        this.importError = '';
        this.importResult = null;
        this.importLoading = true;
        try {
            const form = new FormData();
            form.append('file', this.importForm.file);
            form.append('pageId', this.importForm.pageId);
            form.append('userId', this.user.id);
            if (this.importForm.campaignId) {
                form.append('campaignId', this.importForm.campaignId);
            }
            else {
                form.append('campaignName', this.importForm.campaignName);
            }
            this.importResult = await this.api('/campaigns/import', { method: 'POST', body: form });
            this.showToast(`Import thành công: ${this.importResult.stats.created} content`);
            this.importForm = { ...this.importForm, campaignId: '', campaignName: '', file: null };
            if (this.$refs.fileInput)
                this.$refs.fileInput.value = '';
            this.loadCampaigns();
        }
        catch (e) {
            this.importError = e.message;
        }
        finally {
            this.importLoading = false;
        }
    },
    handleDrop(e) {
        this.importDragging = false;
        const file = e.dataTransfer.files[0];
        if (file)
            this.importForm.file = file;
    },
    async downloadTemplate(type = 'ready') {
        try {
            const res = await fetch(`/api/campaigns/template?type=${type}`, { headers: { 'Authorization': `Bearer ${this.token}` } });
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = type === 'ai' ? 'mkttools-ai-gen.xlsx' : 'mkttools-co-san.xlsx';
            a.click();
            URL.revokeObjectURL(a.href);
        }
        catch (e) {
            this.showToast('Lỗi tải template', 'error');
        }
    }
});
