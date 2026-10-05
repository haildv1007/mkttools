window.MKTPageModules = window.MKTPageModules || {};

window.MKTPageModules.pages = () => ({
    pageSearch: '',
    pageListLoading: false,
    pageLoadError: '',
    pageStatuses: {},
    pageActionMenuId: null,
    deletePageTarget: null,
    pageDeleting: false,
    facebookStarting: false,
    facebookModalOpen: false,
    facebookPhase: 'selection',
    facebookPages: [],
    facebookSelectedIds: [],
    facebookSearch: '',
    facebookError: '',
    facebookErrorCode: '',
    facebookResultRows: [],
    _facebookCallbackHandled: false,

    get filteredManagedPages() {
        const query = this.pageSearch.trim().toLocaleLowerCase('vi');
        if (!query)
            return this.pages;
        return this.pages.filter((page) => [page.name, page.externalId, page.platform]
            .filter(Boolean)
            .some((value) => String(value).toLocaleLowerCase('vi').includes(query)));
    },
    get filteredFacebookPages() {
        const query = this.facebookSearch.trim().toLocaleLowerCase('vi');
        if (!query)
            return this.facebookPages;
        return this.facebookPages.filter((page) => [page.name, page.facebookPageId, page.category]
            .filter(Boolean)
            .some((value) => String(value).toLocaleLowerCase('vi').includes(query)));
    },
    get selectedFacebookPages() {
        const selected = new Set(this.facebookSelectedIds);
        return this.facebookPages.filter((page) => selected.has(page.facebookPageId));
    },
    get facebookSuccessCount() {
        return this.facebookResultRows.filter((item) => item.status !== 'error').length;
    },

    facebookCallbackUrl() {
        return `${window.location.origin}/pages`;
    },
    facebookPagePicture(page) {
        if (page.pictureUrl)
            return page.pictureUrl;
        return `https://graph.facebook.com/${encodeURIComponent(page.externalId)}/picture?type=small`;
    },
    async facebookApi(path, options = {}) {
        const headers = { ...options.headers, 'Content-Type': 'application/json' };
        if (this.token)
            headers.Authorization = `Bearer ${this.token}`;
        if (this.currentOrganization?.id)
            headers['X-Organization-Id'] = this.currentOrganization.id;
        const response = await fetch(`/api/facebook${path}`, { ...options, headers });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
            localStorage.removeItem('mkt_token');
            window.location.replace('/login');
            throw Object.assign(new Error('Phiên đăng nhập đã hết hạn.'), { code: 'UNAUTHORIZED' });
        }
        if (!response.ok) {
            const error = new Error(data.message || data.error || 'Không thể kết nối Facebook.');
            error.code = data.error || 'FACEBOOK_REQUEST_FAILED';
            error.details = data;
            throw error;
        }
        return data;
    },
    facebookErrorMessage(errorOrCode) {
        const code = typeof errorOrCode === 'string' ? errorOrCode : errorOrCode?.code;
        const messages = {
            FACEBOOK_APP_NOT_CONFIGURED: 'Facebook App chưa được cấu hình. Vui lòng cấu hình App ID và App Secret trong Cài đặt hệ thống.',
            FACEBOOK_PERMISSION_INSUFFICIENT: 'Tài khoản Facebook chưa cấp đủ quyền để quản lý Pages.',
            FACEBOOK_PAGE_OWNED_BY_OTHER_ORGANIZATION: 'Page này đã được kết nối với một tổ chức khác.',
            FACEBOOK_OAUTH_STATE_INVALID: 'Phiên kết nối Facebook đã hết hạn. Vui lòng thử lại.',
            FACEBOOK_OAUTH_STATE_EXPIRED: 'Phiên kết nối Facebook đã hết hạn. Vui lòng thử lại.',
            FACEBOOK_REDIRECT_URI_MISMATCH: 'Phiên kết nối Facebook không hợp lệ. Vui lòng thử lại.',
            FACEBOOK_REDIRECT_URI_NOT_ALLOWED: 'Địa chỉ callback Facebook chưa được cho phép trong cấu hình hệ thống.',
            FACEBOOK_TOKEN_EXCHANGE_FAILED: 'Không thể hoàn tất kết nối với Facebook. Vui lòng thử lại.',
            FACEBOOK_PAGE_NOT_FOUND: 'Không tìm thấy Page trong phiên kết nối hiện tại. Vui lòng kết nối lại Facebook.',
            ORGANIZATION_ACCESS_DENIED: 'Bạn không có quyền quản lý kết nối Facebook của tổ chức này.',
            SUBSCRIPTION_EXPIRED: 'Gói dịch vụ của tổ chức đã hết hạn.',
            PAGE_LIMIT_REACHED: 'Tổ chức đã đạt giới hạn số lượng Page của gói hiện tại.',
            MISSING_PAGE_IDS: 'Vui lòng chọn ít nhất một Page.',
        };
        return messages[code] || 'Không thể hoàn tất kết nối Facebook. Vui lòng thử lại.';
    },
    cleanFacebookCallbackUrl() {
        const url = new URL(window.location.href);
        ['code', 'state', 'error', 'error_reason', 'error_description', 'error_code'].forEach((key) => url.searchParams.delete(key));
        const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
        history.replaceState({ page: 'pages' }, '', cleanUrl || '/pages');
    },
    async handleFacebookCallback() {
        if (this._facebookCallbackHandled)
            return;
        const params = new URLSearchParams(window.location.search);
        const hasCallback = params.has('code') || params.has('state') || params.has('error');
        if (!hasCallback)
            return;
        this._facebookCallbackHandled = true;
        const oauthError = params.get('error');
        if (oauthError) {
            const reason = params.get('error_reason');
            const description = params.get('error_description');
            this.cleanFacebookCallbackUrl();
            if (oauthError === 'access_denied' || reason === 'user_denied')
                this.showToast('Bạn đã hủy kết nối Facebook.', 'info');
            else
                this.showToast(description || 'Facebook không thể cấp quyền kết nối. Vui lòng thử lại.', 'error');
            return;
        }

        const code = params.get('code');
        const state = params.get('state');
        if (!code || !state) {
            this.cleanFacebookCallbackUrl();
            this.showToast('Phiên kết nối Facebook không hợp lệ. Vui lòng thử lại.', 'error');
            return;
        }

        this.facebookModalOpen = true;
        this.facebookPhase = 'discovering';
        this.facebookError = '';
        try {
            const result = await this.facebookApi('/oauth/callback', {
                method: 'POST',
                body: JSON.stringify({ code, state, redirectUri: this.facebookCallbackUrl() }),
            });
            if (result.organizationId && result.organizationId !== this.currentOrganization?.id) {
                localStorage.setItem('mkt_current_org', result.organizationId);
                await this.loadOrganizations();
                await this.loadWorkspaces();
            }
            await this.discoverFacebookPages();
        }
        catch (error) {
            this.facebookModalOpen = false;
            this.showToast(this.facebookErrorMessage(error), 'error');
        }
        finally {
            this.cleanFacebookCallbackUrl();
        }
    },
    async startFacebookConnect() {
        if (this.facebookStarting)
            return;
        this.facebookStarting = true;
        try {
            const result = await this.facebookApi('/oauth/start', {
                method: 'POST',
                body: JSON.stringify({ redirectUri: this.facebookCallbackUrl() }),
            });
            if (!result.oauthUrl)
                throw Object.assign(new Error('Missing OAuth URL'), { code: 'FACEBOOK_REQUEST_FAILED' });
            window.location.assign(result.oauthUrl);
        }
        catch (error) {
            this.facebookStarting = false;
            this.facebookErrorCode = error.code || '';
            if (error.code === 'FACEBOOK_APP_NOT_CONFIGURED') {
                this.facebookModalOpen = true;
                this.facebookPhase = 'selection';
                this.facebookPages = [];
                this.facebookSelectedIds = [];
                this.facebookError = this.facebookErrorMessage(error);
            }
            else {
                this.showToast(this.facebookErrorMessage(error), 'error');
            }
        }
    },
    async discoverFacebookPages() {
        this.facebookModalOpen = true;
        this.facebookPhase = 'discovering';
        this.facebookError = '';
        this.facebookErrorCode = '';
        try {
            const result = await this.facebookApi('/pages/discover');
            this.facebookPages = Array.isArray(result.pages) ? result.pages : [];
            this.facebookSelectedIds = [];
            this.facebookSearch = '';
            this.facebookPhase = 'selection';
        }
        catch (error) {
            this.facebookPages = [];
            this.facebookSelectedIds = [];
            this.facebookPhase = 'selection';
            this.facebookErrorCode = error.code || '';
            this.facebookError = this.facebookErrorMessage(error);
        }
    },
    isFacebookPageSelectable(page) {
        return !page.alreadyImported && !page.ownedByOtherOrg;
    },
    facebookPageStateLabel(page) {
        if (page.ownedByOtherOrg)
            return 'Thuộc tổ chức khác';
        if (page.alreadyImported)
            return 'Đã kết nối';
        return 'Chưa kết nối';
    },
    toggleFacebookPage(pageId) {
        const page = this.facebookPages.find((item) => item.facebookPageId === pageId);
        if (!page || !this.isFacebookPageSelectable(page))
            return;
        const selected = new Set(this.facebookSelectedIds);
        selected.has(pageId) ? selected.delete(pageId) : selected.add(pageId);
        this.facebookSelectedIds = [...selected];
    },
    async importSelectedFacebookPages() {
        if (!this.facebookSelectedIds.length || this.facebookPhase === 'importing')
            return;
        const requestedIds = [...this.facebookSelectedIds];
        this.facebookPhase = 'importing';
        this.facebookResultRows = [];
        try {
            const response = await this.facebookApi('/pages/import', {
                method: 'POST',
                body: JSON.stringify({ pageIds: requestedIds }),
            });
            const byId = new Map(this.facebookPages.map((page) => [page.facebookPageId, page]));
            const returned = new Map((response.results || []).map((item) => [item.facebookPageId, item]));
            this.facebookResultRows = requestedIds.map((facebookPageId) => ({
                ...(returned.get(facebookPageId) || { facebookPageId, status: 'error', error: 'FACEBOOK_REQUEST_FAILED' }),
                page: byId.get(facebookPageId),
            }));
            this.facebookPhase = 'result';
            await this.refreshPagesAfterMutation();
        }
        catch (error) {
            const message = this.facebookErrorMessage(error);
            const byId = new Map(this.facebookPages.map((page) => [page.facebookPageId, page]));
            this.facebookResultRows = requestedIds.map((facebookPageId) => ({ facebookPageId, status: 'error', error: error.code, errorMessage: message, page: byId.get(facebookPageId) }));
            this.facebookPhase = 'result';
        }
    },
    facebookImportResultLabel(item) {
        if (item.status === 'imported')
            return 'Đã kết nối';
        if (item.status === 'already_imported')
            return 'Đã được kết nối';
        if (item.status === 'reactivated')
            return 'Đã kết nối lại';
        return item.errorMessage || this.facebookErrorMessage(item.error);
    },
    closeFacebookModal() {
        if (this.facebookPhase === 'importing')
            return;
        this.facebookModalOpen = false;
        this.facebookError = '';
        this.facebookErrorCode = '';
    },
    async finishFacebookConnect() {
        await this.refreshPagesAfterMutation();
        this.closeFacebookModal();
    },
    goToFacebookSettings() {
        this.closeFacebookModal();
        this.navigate('settings');
    },
    async refreshPagesAfterMutation() {
        await this.loadPages({ skipCallback: true });
        await this.loadWorkspaces();
        await this.validateScope();
        await this.loadScopePages();
        await this.refreshPageUsage();
        await this.loadDashboard();
        this.$nextTick(() => this.socketSubscribeScope());
    },

    async loadPages(options = {}) {
        this.pageListLoading = true;
        this.pageLoadError = '';
        try {
            const pages = await this.api('/dashboard/pages');
            this.pages = Array.isArray(pages) ? pages : [];
            this.pageStatuses = Object.fromEntries(this.pages.map((page) => [page.id, {
                id: page.id,
                connected: page.connected,
            }]));
        }
        catch (error) {
            this.pageLoadError = error.message || 'Không thể tải danh sách Pages.';
            this.showToast(this.pageLoadError, 'error');
        }
        finally {
            this.pageListLoading = false;
        }
        if (!options.skipCallback)
            await this.handleFacebookCallback();
    },
    isPageConnected(page) {
        const status = this.pageStatuses[page.id];
        if (status)
            return status.connected === true;
        return page.platform !== 'FACEBOOK' && page.isActive === true;
    },
    openManualPageForm() {
        this.editingPage = null;
        this.pageForm = { platform: 'FACEBOOK', name: '', externalId: '', context: '', telegramGroupId: '' };
        this.pageError = '';
        this.showPageModal = true;
    },
    editPage(page) {
        this.editingPage = page;
        this.pageForm = { platform: page.platform, name: page.name, externalId: page.externalId, context: page.context || '', telegramGroupId: page.telegramGroupId || '' };
        this.pageError = '';
        this.showPageModal = true;
    },
    async savePage() {
        this.pageError = '';
        if (!this.pageForm.name || !this.pageForm.externalId) {
            this.pageError = 'Tên Page và Page ID là bắt buộc.';
            return;
        }
        try {
            const payload = { ...this.pageForm, userId: this.user.id };
            if (this.editingPage) {
                await this.api(`/dashboard/pages/${this.editingPage.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                this.showToast('Cập nhật Page thành công');
            }
            else {
                await this.api('/dashboard/pages', { method: 'POST', body: JSON.stringify(payload) });
                this.showToast('Thêm Page thành công');
            }
            this.showPageModal = false;
            await this.refreshPagesAfterMutation();
        }
        catch (error) {
            this.pageError = error.message;
        }
    },
    requestDeletePage(page) {
        this.deletePageTarget = page;
        this.pageDeleting = false;
    },
    async confirmDeletePage() {
        if (!this.deletePageTarget || this.pageDeleting)
            return;
        this.pageDeleting = true;
        const page = this.deletePageTarget;
        try {
            await this.api(`/dashboard/pages/${page.id}`, { method: 'DELETE' });
            this.deletePageTarget = null;
            this.showToast('Đã xóa Page');
            await this.refreshPagesAfterMutation();
        }
        catch (error) {
            this.showToast(error.message, 'error');
        }
        finally {
            this.pageDeleting = false;
        }
    },
    async deletePage(page) {
        this.requestDeletePage(page);
    },

    async loadWorkspaces() {
        try { this.workspaces = await this.api('/workspaces'); }
        catch { }
    },
    async validateScope() {
        const scope = this.currentScope;
        if (scope.type === 'workspace') {
            if (!this.workspaces.find((workspace) => workspace.id === scope.id))
                await this.setScope({ type: 'all' });
        }
        else if (scope.type === 'page' && !this.pages.find((page) => page.id === scope.id)) {
            await this.setScope({ type: 'all' });
        }
    },
    async setScope(scope) {
        this.currentScope = scope;
        localStorage.setItem('mkt_scope', JSON.stringify(scope));
        this.scopeDropdownOpen = false;
        this.scopeSearch = '';
        this.dbFilter.pageId = '';
        this.dbFilter.campaignId = '';
        this.importForm.pageId = scope.type === 'page' ? scope.id : '';
        this.importForm.campaignId = '';
        this.activeTab = false;
        await this.loadScopePages();
        this.loadDashboard();
        if (this.page === 'content') this.loadContent();
        if (this.page === 'campaigns') this.loadCampaigns();
        this.$nextTick(() => this.socketSubscribeScope());
    },
    async loadScopePages() {
        if (!this.pages.length)
            await this.loadPages({ skipCallback: true });
        if (this.currentScope.type === 'page')
            this.scopePages = this.pages.filter((page) => page.id === this.currentScope.id);
        else if (this.currentScope.type === 'workspace') {
            const workspace = this.workspaces.find((item) => item.id === this.currentScope.id);
            this.scopePages = workspace ? this.pages.filter((page) => workspace.pages.some((workspacePage) => workspacePage.id === page.id)) : [];
        }
        else
            this.scopePages = [...this.pages];
    },
    scopeLabel() {
        if (this.currentScope.type === 'workspace') return this.workspaces.find((item) => item.id === this.currentScope.id)?.name || 'Workspace';
        if (this.currentScope.type === 'page') return this.pages.find((item) => item.id === this.currentScope.id)?.name || 'Page';
        return 'Tất cả Pages';
    },
    scopeIcon() {
        if (this.currentScope.type === 'workspace') return 'ri-folders-line';
        if (this.currentScope.type === 'page') return 'ri-pages-line';
        return 'ri-global-line';
    },
    scopeParams() {
        return this.currentScope.type === 'all' ? '' : `&scopeType=${this.currentScope.type}&scopeId=${this.currentScope.id}`;
    },
    filteredWorkspaces() {
        const query = this.scopeSearch.toLowerCase();
        return query ? this.workspaces.filter((workspace) => workspace.name.toLowerCase().includes(query)) : this.workspaces;
    },
    filteredScopePages() {
        const query = this.scopeSearch.toLowerCase();
        return query ? this.pages.filter((page) => page.name.toLowerCase().includes(query)) : this.pages;
    },
    openWorkspaceForm(workspace = null) {
        this.editingWorkspace = workspace;
        this.workspaceForm = workspace ? { name: workspace.name, description: workspace.description || '', pageIds: workspace.pages.map((page) => page.id) } : { name: '', description: '', pageIds: [] };
        this.workspaceError = '';
        this.showWorkspaceModal = true;
        this.scopeDropdownOpen = false;
    },
    async saveWorkspace() {
        this.workspaceError = '';
        if (!this.workspaceForm.name) { this.workspaceError = 'Tên là bắt buộc'; return; }
        try {
            if (this.editingWorkspace) {
                await this.api(`/workspaces/${this.editingWorkspace.id}`, { method: 'PUT', body: JSON.stringify(this.workspaceForm) });
                this.showToast('Cập nhật workspace thành công');
            }
            else {
                await this.api('/workspaces', { method: 'POST', body: JSON.stringify(this.workspaceForm) });
                this.showToast('Tạo workspace thành công');
            }
            this.showWorkspaceModal = false;
            await this.loadWorkspaces();
            await this.loadScopePages();
        }
        catch (error) { this.workspaceError = error.message; }
    },
    async deleteWorkspace(workspace) {
        if (!confirm(`Xóa workspace "${workspace.name}"? (Pages và content không bị ảnh hưởng)`)) return;
        try {
            await this.api(`/workspaces/${workspace.id}`, { method: 'DELETE' });
            if (this.currentScope.type === 'workspace' && this.currentScope.id === workspace.id) await this.setScope({ type: 'all' });
            await this.loadWorkspaces();
            this.showToast('Đã xóa workspace');
        }
        catch (error) { this.showToast(error.message, 'error'); }
    },
    toggleWsPage(pageId) {
        const index = this.workspaceForm.pageIds.indexOf(pageId);
        index >= 0 ? this.workspaceForm.pageIds.splice(index, 1) : this.workspaceForm.pageIds.push(pageId);
    },
});
