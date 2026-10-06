window.MKTPageModules = window.MKTPageModules || {};
function mergeModuleObjects(parts) {
    const target = {};
    for (const part of parts)
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(part));
    return target;
}
function app() {
    return mergeModuleObjects([
        {
            token: localStorage.getItem('mkt_token') || '',
            user: JSON.parse(localStorage.getItem('mkt_user') || 'null'),
            page: window.MKTNavigation.pageFromLocation(),
            authState: 'loading',
            onboarding: null,
            showOnboarding: false,
            obStep: 2,
            accountOpen: false,
            accountForm: { name: '', currentPassword: '', newPassword: '' },
            accountMsg: '',
            accountErr: false,
            authMode: 'login',
            authError: '',
            authLoading: false,
            loginForm: { email: '', password: '' },
            registerForm: { name: '', email: '', password: '' },
            currentScope: JSON.parse(localStorage.getItem('mkt_scope') || '{"type":"all"}'),
            workspaces: [],
            organizations: [],
            currentOrganization: null,
            orgSubscription: null,
            orgPageUsage: { used: 0, limit: null },
            orgMemberUsage: { used: 0, limit: null },
            orgSelectorOpen: false,
            orgSettingsOpen: false,
            orgMembers: [],
            orgMemberForm: { email: '', role: 'MEMBER' },
            orgMemberError: '',
            orgAiCreds: null,
            orgAiForm: { provider: 'gemini', apiKey: '', defaultModel: '' },
            orgAiError: '',
            credentialModal: { open: false, provider: 'gemini', apiKey: '', showKey: false, saving: false, error: '' },
            orgOpForm: {
                TEXT_GENERATION: { provider: 'gemini', model: '', useManualModel: false, manualModel: '' },
                IMAGE_GENERATION: { provider: 'gemini', model: '', useManualModel: false, manualModel: '' },
            },
            orgOpModelOptions: { TEXT_GENERATION: [], IMAGE_GENERATION: [] },
            orgOpCredentialConfigured: { TEXT_GENERATION: false, IMAGE_GENERATION: false },
            settingsDropdown: '',
            orgInvitations: [],
            inviteForm: { email: '', role: 'MEMBER', accessMode: 'ALL' },
            inviteError: '',
            lastInviteUrl: '',
            joinToken: '',
            joinPreview: null,
            joinError: '',
            joinLoading: false,
            accessDrawerOpen: false,
            accessTarget: null,
            accessForm: { accessMode: 'ALL', workspaceIds: [], pageIds: [] },
            accessOrgPages: [],
            accessOrgWorkspaces: [],
            scopeDropdownOpen: false,
            scopeSearch: '',
            dbPageDrop: false,
            dbCampDrop: false,
            dbDateDrop: false,
            contentPageDrop: false,
            showWorkspaceModal: false,
            editingWorkspace: null,
            workspaceForm: { name: '', description: '', pageIds: [] },
            workspaceError: '',
            scopePages: [],
            stats: {},
            db: null,
            dbFilter: { pageId: '', campaignId: '', preset: '30d', customFrom: '', customTo: '' },
            dbPendingTab: 'pending',
            dashboardCampaigns: [],
            dashboardPages: [],
            dashboardUpcoming: [],
            dashboardRecent: [],
            dashboardLoading: false,
            dashboardError: '',
            fbSyncing: false,
            fbInsights: null,
            fbInsightsLoading: false,
            timelineDays: 7,
            _charts: {},
            pages: [],
            campaigns: [],
            campaignsLoading: false,
            contentItems: [],
            contentTotal: 0,
            contentFilter: { status: '', pageId: '', search: '', dateFrom: '', dateTo: '', source: '', campaignId: '', media: [], _datePreset: '', _dateLabel: '' },
            dateDrop: false,
            mediaDrop: false,
            sourceDrop: false,
            campaignDrop: false,
            dgPage: 1,
            dgPageSize: 50,
            dgSortBy: 'scheduledAt',
            dgSortDir: 'desc',
            dgDensity: 'normal',
            dgColPanel: false,
            dgActivePreset: 'basic',
            dgStatusCounts: {},
            dgResizing: null,
            dgColSearch: '',
            dgCtxMenu: null,
            dgHeaderFilter: null,
            dgHeaderFilterData: {},
            dgBulkSelected: [],
            dgBulkAll: false,
            dgRowMenu: { open: false, item: null, x: 0, y: 0 },
            dgSavedViews: [],
            dgActiveView: null,
            dgShowSaveView: false,
            dgNewViewName: '',
            dgDragCol: null,
            dgCascadeCampaigns: [],
            _dgDefaultOrder: null,
            dgAllCols: [
                { key: 'checkbox', label: '', w: 36, minW: 36, maxW: 36, visible: true, group: 'system', pinned: true, sortable: false, filterable: false },
                { key: 'thumbnail', label: 'Ảnh', w: 50, minW: 40, maxW: 80, visible: true, group: 'core', pinned: true, sortable: false, filterable: false },
                { key: 'topic', label: 'Chủ đề', w: 220, minW: 120, maxW: 500, visible: true, group: 'core', pinned: true, sortable: true, filterable: false },
                { key: 'status', label: 'Trạng thái', w: 100, minW: 80, maxW: 150, visible: true, group: 'core', pinned: false, sortable: true, filterable: 'multi-select', filterOptions: ['DRAFT', 'GENERATING', 'PENDING_REVIEW', 'REVISION_REQUESTED', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED'] },
                { key: 'page', label: 'Page', w: 140, minW: 80, maxW: 250, visible: true, group: 'core', pinned: false, sortable: false, filterable: 'page-select' },
                { key: 'campaign', label: 'Campaign', w: 130, minW: 80, maxW: 250, visible: true, group: 'core', pinned: false, sortable: false, filterable: 'campaign-select' },
                { key: 'contentType', label: 'Loại', w: 70, minW: 60, maxW: 120, visible: true, group: 'core', pinned: false, sortable: true, filterable: 'multi-select', filterOptions: ['IMAGE', 'VIDEO', 'TEXT'] },
                { key: 'source', label: 'Nguồn', w: 70, minW: 60, maxW: 120, visible: true, group: 'ops', pinned: false, sortable: true, filterable: 'multi-select', filterOptions: ['AI', 'MANUAL', 'IMPORT'] },
                { key: 'scheduledAt', label: 'Lịch đăng', w: 100, minW: 80, maxW: 150, visible: true, group: 'ops', pinned: false, sortable: true, filterable: 'date-range' },
                { key: 'createdAt', label: 'Ngày tạo', w: 80, minW: 60, maxW: 120, visible: false, group: 'ops', pinned: false, sortable: true, filterable: 'date-range' },
                { key: 'publishedAt', label: 'Ngày đăng', w: 100, minW: 70, maxW: 150, visible: false, group: 'ops', pinned: false, sortable: true, filterable: 'date-range' },
                { key: 'notes', label: 'Ghi chú', w: 150, minW: 80, maxW: 400, visible: false, group: 'ops', pinned: false, sortable: false, filterable: false },
                { key: 'result', label: 'Kết quả', w: 140, minW: 80, maxW: 300, visible: false, group: 'ops', pinned: false, sortable: false, filterable: false },
                { key: 'viewers', label: 'Người xem', w: 85, minW: 65, maxW: 120, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: 'numeric' },
                { key: 'mediaViews', label: 'Lượt xem', w: 85, minW: 65, maxW: 120, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: 'numeric' },
                { key: 'engagement', label: 'Engagement', w: 90, minW: 70, maxW: 130, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: false },
                { key: 'reactions', label: 'Reactions', w: 80, minW: 60, maxW: 120, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: 'numeric' },
                { key: 'comments', label: 'Comments', w: 80, minW: 60, maxW: 120, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: 'numeric' },
                { key: 'shares', label: 'Shares', w: 70, minW: 55, maxW: 100, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: 'numeric' },
                { key: 'clicks', label: 'Post Clicks', w: 85, minW: 65, maxW: 120, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: 'numeric' },
                { key: 'engPerViewer', label: 'Eng/Viewer', w: 85, minW: 65, maxW: 120, visible: false, group: 'metrics', pinned: false, sortable: false, filterable: false },
            ],
            dgPresets: [
                { key: 'basic', label: 'Cơ bản', cols: ['checkbox', 'thumbnail', 'topic', 'status', 'page', 'campaign', 'contentType', 'scheduledAt'] },
                { key: 'ops', label: 'Vận hành', cols: ['checkbox', 'thumbnail', 'topic', 'status', 'source', 'page', 'scheduledAt', 'createdAt', 'publishedAt', 'notes', 'result'] },
                { key: 'perf', label: 'Hiệu suất', cols: ['checkbox', 'thumbnail', 'topic', 'status', 'page', 'viewers', 'mediaViews', 'engagement', 'reactions', 'comments', 'shares', 'clicks', 'engPerViewer'] },
                { key: 'all', label: 'Tất cả', cols: null },
            ],
            drawerOpen: false,
            drawerItem: null,
            drawerLoading: false,
            drawerTab: 'content',
            drawerSyncing: false,
            drawerSyncError: '',
            showContentForm: false,
            editingContent: null,
            contentForm: { pageId: '', topic: '', contentType: 'IMAGE', scheduledDate: '', scheduledTime: '09:00', notes: '', imageDescriptions: '', videoFile: null, videoUrl: '', mode: 'ai', generatedText: '', manualVideoUrl: '', images: [], imageInputMode: 'upload', videoInputMode: 'upload', _dragIdx: -1 },
            contentFormError: '',
            contentFormSaving: false,
            dgSummary: null,
            dgSummaryVisible: (() => { try {
                return localStorage.getItem('mkt_dg_summary') !== 'hidden';
            }
            catch {
                return true;
            } })(),
            dgGridMaxH: 0,
            textPopup: { show: false, title: '', content: '' },
            showErrorModal: false,
            errorItem: null,
            revModal: { open: false, item: null, type: 'TEXT', feedback: '', images: [], selImgs: [], loading: false, chatHistory: [], currentText: '', originalText: '', originalImages: [], selectedVersion: 0, versions: [], loadingVersions: false },
            lightbox: { open: false, images: [], index: 0 },
            showPageModal: false,
            editingPage: null,
            pageForm: { platform: 'FACEBOOK', name: '', externalId: '', context: '', telegramGroupId: '' },
            showFbTokenModal: false,
            fbShortToken: '',
            fbPages: [],
            fbTokenError: '',
            fbTokenLoading: false,
            pageError: '',
            showCampaignModal: false,
            editingCampaign: null,
            campaignForm: { name: '', description: '', pageId: '', startDate: '', endDate: '', genLeadTime: '30', autoApprove: false },
            campaignError: '',
            importTab: 'ready',
            importForm: { pageId: '', campaignId: '', campaignName: '', file: null },
            importResult: null,
            importError: '',
            importLoading: false,
            selectedTextProvider: '',
            selectedImageProvider: '',
            settingsForm: {},
            settingsSaving: false,
            secretConfigured: { telegram: false, facebook: false },
            showKeys: { anthropic: false, openai: false, gemini: false, telegram: false, fbSecret: false },
            textModelsMap: {
                claude: [
                    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 - nhanh, rẻ' },
                    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4 - cân bằng' },
                    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 - mạnh nhất' },
                ],
                openai: [
                    { id: 'gpt-5-mini', name: 'GPT-5 Mini - nhanh, rẻ (2026)' },
                    { id: 'gpt-4o-mini', name: 'GPT-4o Mini - nhanh, ổn định' },
                    { id: 'gpt-4o', name: 'GPT-4o - đa năng' },
                    { id: 'gpt-5.5', name: 'GPT-5.5 - mạnh nhất (2026)' },
                ],
                gemini: [
                    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite - siêu nhanh 350 tok/s (7/2026)' },
                    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash - mới nhất, thông minh nhất (9/2026)' },
                    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash - ổn định, rẻ' },
                    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash - nhanh' },
                ],
            },
            geminiImageModels: [],
            openaiImageModels: [],
            testingImageModel: false,
            imageModelTestResult: '',
            imageModelTestSuccess: false,
            toast: { show: false, message: '', type: 'success' },
            actOpen: false,
            actItems: [],
            actTab: 'all',
            actLoading: false,
            actHasMore: false,
            actCursor: null,
            actRunning: 0,
            _actPollTimer: null,
            _socket: null,
            _socketConnected: false,
            _socketFallbackTimer: null,
            _contentVersions: {},
            _reconcileTimer: null,
            activeItems: [],
            activeTab: false,
            async init() {
                this.dgLoadCols();
                // Single auth bootstrap: server session decides authenticated / login / onboarding.
                if (!this.token) {
                    window.location.replace('/login');
                    return;
                }
                try {
                    const sess = await this.api('/auth/session');
                    if (!sess)
                        return;
                    this.user = sess.user;
                    localStorage.setItem('mkt_user', JSON.stringify(sess.user));
                    this.onboarding = sess.onboarding;
                    if (sess.onboarding.state === 'NEEDS_ORGANIZATION') {
                        window.location.replace('/onboarding');
                        return;
                    }
                    this.showOnboarding = sess.onboarding.state === 'ONBOARDING_INCOMPLETE';
                }
                catch (e) {
                    window.location.replace('/login');
                    return;
                }
                this.authState = 'authenticated';
                if (this.token) {
                    await this.loadOrganizations();
                    await Promise.all([this.loadPages(), this.loadWorkspaces()]);
                    await this.validateScope();
                    await this.loadScopePages();
                    if (this.currentScope.type === 'page')
                        this.importForm.pageId = this.currentScope.id;
                    if (this.page === 'dashboard') {
                        await this.loadDashboard();
                        this.loadCampaigns({ preferCache: true });
                    } else {
                        this.navigate(this.page, { replace: true, skipDataLoad: true });
                    }
                    this.fetchActiveItems();
                    this.initSocket();
                }
                window.addEventListener('resize', () => this.dgCalcHeight());
                this.$watch('actOpen', (v) => {
                    if (v) {
                        this.loadActivity();
                        if (!this._socketConnected)
                            this.startActPoll();
                    }
                    else {
                        this.stopActPoll();
                    }
                });
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) {
                        this.loadActivity();
                        this.reconcileContent();
                    }
                });
                setInterval(() => {
                    if (!document.hidden && (this.activeItems.length > 0 || this.actRunning > 0)) {
                        this.fetchActiveItems();
                    }
                }, 5000);
            },
            async api(path, options = {}) {
                return window.MKTApi.request(path, options, {
                    token: this.token,
                    organizationId: this.currentOrganization?.id,
                });
            },
            async logout() {
                this.destroySocket();
                const t = this.token;
                try {
                    if (t)
                        await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } });
                }
                catch { }
                this.token = '';
                this.user = null;
                ['mkt_token', 'mkt_user', 'mkt_current_org', 'mkt_scope'].forEach((k) => localStorage.removeItem(k));
                window.location.replace('/login');
            },
            openAccount() { this.accountForm = { name: this.user?.name || '', currentPassword: '', newPassword: '' }; this.accountMsg = ''; this.accountOpen = true; },
            async saveProfile() {
                try {
                    const r = await this.api('/auth/profile', { method: 'PUT', body: JSON.stringify({ name: this.accountForm.name }) });
                    this.user = r.user;
                    localStorage.setItem('mkt_user', JSON.stringify(r.user));
                    this.accountMsg = 'Đã lưu.';
                    this.accountErr = false;
                }
                catch (e) {
                    this.accountMsg = e.message;
                    this.accountErr = true;
                }
            },
            async changePassword() {
                try {
                    await this.api('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword: this.accountForm.currentPassword, newPassword: this.accountForm.newPassword }) });
                    this.accountForm.currentPassword = '';
                    this.accountForm.newPassword = '';
                    this.user.hasPassword = true;
                    this.accountMsg = 'Đã đổi mật khẩu.';
                    this.accountErr = false;
                }
                catch (e) {
                    this.accountMsg = e.message;
                    this.accountErr = true;
                }
            },
            async resendVerification() {
                try {
                    await this.api('/auth/resend-verification', { method: 'POST', body: '{}' });
                    this.accountMsg = 'Đã gửi lại email xác minh.';
                    this.accountErr = false;
                }
                catch (e) {
                    this.accountMsg = e.message;
                    this.accountErr = true;
                }
            },
            async finishOnboarding() {
                try {
                    await this.api('/auth/onboarding/complete', { method: 'POST', body: '{}' });
                }
                catch { }
                this.showOnboarding = false;
            },
            obConnectPage() {
                this.showOnboarding = false;
                this.navigate('pages');
                this.$nextTick(() => this.startFacebookConnect());
            },
            get importPageCampaigns() {
                if (!this.importForm?.pageId)
                    return [];
                return (this.campaigns || []).filter(c => (c.pageId || c.page?.id) === this.importForm.pageId);
            },
            get dgVisibleCols() {
                const cols = this.dgAllCols.filter(c => c.visible && c.key !== 'checkbox');
                if (this.currentScope.type === 'page')
                    return cols.filter(c => c.key !== 'page');
                return cols;
            },
            initSocket() {
                if (!this.token || this._socket)
                    return;
                const orgId = this.currentOrganization?.id || localStorage.getItem('mkt_current_org') || '';
                const s = io({ auth: { token: this.token, organizationId: orgId }, transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
                this._socket = s;
                s.on('connect', () => {
                    this._socketConnected = true;
                    this.stopActPoll();
                    if (this._socketFallbackTimer) {
                        clearInterval(this._socketFallbackTimer);
                        this._socketFallbackTimer = null;
                    }
                    this.socketSubscribeScope();
                    this.loadActivity();
                    this.reconcileContent();
                });
                s.on('disconnect', () => {
                    this._socketConnected = false;
                    this._socketFallbackTimer = setInterval(() => {
                        if (this.actOpen)
                            this.loadActivity();
                    }, 15000);
                });
                s.on('activity:update', (evt) => {
                    if (!evt?.id)
                        return;
                    const idx = this.actItems.findIndex(a => a.id === evt.id);
                    if (idx >= 0) {
                        this.actItems[idx] = { ...this.actItems[idx], ...evt };
                    }
                    else {
                        if (this.actTab !== 'all' && evt.category !== this.actTab)
                            return;
                        this.actItems.unshift(evt);
                        if (this.actItems.length > 50)
                            this.actItems.length = 50;
                    }
                    this.actRunning = this.actItems.filter(a => a.status === 'running').length;
                });
                s.on('content:update', (evt) => this.handleContentEvent(evt));
                s.on('content:update:global', (evt) => this.handleContentEvent(evt));
                s.on('member:access-changed', () => { this.reconcileMemberAccess(); });
                s.on('org:denied', () => {
                    // Stored org is invalid - clear and reload memberships/scope.
                    localStorage.removeItem('mkt_current_org');
                    this.currentOrganization = null;
                    this.loadOrganizations();
                });
                s.on('page:denied', () => { });
            },
            handleContentEvent(evt) {
                if (!evt?.contentId)
                    return;
                const localVer = this._contentVersions[evt.contentId] || 0;
                if (evt.version <= localVer)
                    return;
                this._contentVersions[evt.contentId] = evt.version;
                if (evt.status === 'started') {
                    const existing = this.activeItems.findIndex(a => a.contentId === evt.contentId);
                    if (existing >= 0) {
                        this.activeItems[existing] = { ...this.activeItems[existing], ...evt };
                    }
                    else {
                        this.activeItems.unshift(evt);
                    }
                }
                else if (evt.status === 'progress') {
                    const idx = this.activeItems.findIndex(a => a.contentId === evt.contentId);
                    if (idx >= 0) {
                        this.activeItems[idx] = { ...this.activeItems[idx], ...evt };
                    }
                    else {
                        this.activeItems.unshift(evt);
                    }
                }
                else if (evt.status === 'completed' || evt.status === 'failed') {
                    const idx = this.activeItems.findIndex(a => a.contentId === evt.contentId);
                    if (idx >= 0) {
                        this.activeItems[idx] = { ...this.activeItems[idx], ...evt };
                        const holdMs = evt.status === 'failed' ? 4000 : 1500;
                        setTimeout(() => {
                            const ri = this.activeItems.findIndex(a => a.contentId === evt.contentId);
                            if (ri >= 0)
                                this.activeItems.splice(ri, 1);
                        }, holdMs);
                    }
                    this.scheduleReconcile();
                }
                this.patchGridRow(evt);
                if (evt.contentStatus && this.drawerOpen && this.drawerItem?.id === evt.contentId) {
                    this.drawerItem.status = evt.contentStatus;
                    if (evt.status === 'completed') {
                        this.openDrawer(this.drawerItem);
                    }
                }
            },
            patchGridRow(evt) {
                if (!evt.contentStatus)
                    return;
                const row = this.contentItems.find(r => r.id === evt.contentId);
                if (row) {
                    row.status = evt.contentStatus;
                }
                if (evt.contentStatus) {
                    this.scheduleReconcile();
                }
            },
            scheduleReconcile() {
                if (this._reconcileTimer)
                    return;
                this._reconcileTimer = setTimeout(() => {
                    this._reconcileTimer = null;
                    this.loadContent();
                }, 500);
            },
            reconcileContent() {
                if (this.page === 'content')
                    this.loadContent();
                this.fetchActiveItems();
            },
            async fetchActiveItems() {
                try {
                    const items = await this.api('/dashboard/content/active');
                    if (!items)
                        return;
                    for (const item of items) {
                        const localVer = this._contentVersions[item.contentId] || 0;
                        if (item.version > localVer) {
                            const idx = this.activeItems.findIndex(a => a.contentId === item.contentId);
                            if (idx >= 0) {
                                this.activeItems[idx] = { ...this.activeItems[idx], ...item };
                            }
                            else {
                                this.activeItems.push(item);
                            }
                            this._contentVersions[item.contentId] = item.version;
                        }
                    }
                    const activeIds = new Set(items.map(i => i.contentId));
                    this.activeItems = this.activeItems.filter(a => activeIds.has(a.contentId) || (a.status !== 'started' && a.status !== 'progress'));
                }
                catch { }
            },
            socketSubscribeScope() {
                if (!this._socket)
                    return;
                const pids = this.scopePages.map(p => p.id);
                this._socket.emit('subscribe:scope', { type: this.currentScope.type, pageIds: pids });
            },
            scopedActiveItems() {
                if (this.currentScope.type === 'all')
                    return this.activeItems;
                const pids = new Set(this.scopePages.map(p => p.id));
                return this.activeItems.filter(a => pids.has(a.pageId));
            },
            activeElapsed(ai) {
                if (!ai.startedAt)
                    return '';
                const s = Math.floor((Date.now() - new Date(ai.startedAt).getTime()) / 1000);
                if (s < 60)
                    return s + 's';
                const m = Math.floor(s / 60);
                if (m < 60)
                    return m + ' phút';
                return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
            },
            destroySocket() {
                if (this._socket) {
                    this._socket.disconnect();
                    this._socket = null;
                }
                this._socketConnected = false;
                if (this._socketFallbackTimer) {
                    clearInterval(this._socketFallbackTimer);
                    this._socketFallbackTimer = null;
                }
            },
            showToast(message, type = 'success') {
                this.toast = { show: true, message, type };
                setTimeout(() => this.toast.show = false, 3000);
            },
            statusLabel(status) {
                const map = {
                    DRAFT: 'Nháp', QUEUED: 'Chờ gen', GENERATING: 'Đang gen', PENDING_REVIEW: 'Chờ duyệt',
                    REVISION_REQUESTED: 'Yêu cầu sửa', APPROVED: 'Đã duyệt',
                    PUBLISHING: 'Đang đăng', PUBLISHED: 'Đã đăng', FAILED: 'Lỗi', CANCELLED: 'Đã hủy',
                };
                return map[status] || status;
            },
            statusClass(status) {
                const map = {
                    DRAFT: 'bg-gray-100 text-gray-600', QUEUED: 'bg-amber-50 text-amber-600', GENERATING: 'bg-blue-50 text-blue-600',
                    PENDING_REVIEW: 'bg-amber-50 text-amber-600', REVISION_REQUESTED: 'bg-orange-50 text-orange-600',
                    APPROVED: 'bg-green-50 text-green-600', PUBLISHING: 'bg-indigo-50 text-indigo-600',
                    PUBLISHED: 'bg-green-100 text-green-700', FAILED: 'bg-red-50 text-red-600',
                    CANCELLED: 'bg-gray-100 text-gray-500',
                };
                return map[status] || 'bg-gray-100 text-gray-600';
            },
            cleanText(raw) {
                if (!raw)
                    return '';
                try {
                    let cleaned = raw.trim();
                    const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
                    if (jsonMatch)
                        cleaned = jsonMatch[1].trim();
                    try {
                        const parsed = JSON.parse(cleaned);
                        if (parsed.text) {
                            let text = parsed.text;
                            if (parsed.hashtags?.length)
                                text += ' ' + parsed.hashtags.map(h => '#' + String(h).replace(/^#/, '')).join(' ');
                            if (parsed.cta)
                                text += ' ' + parsed.cta;
                            return text;
                        }
                    }
                    catch { }
                    const textMatch = cleaned.match(/"text"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|"$)/);
                    if (textMatch) {
                        return textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    }
                }
                catch { }
                return raw;
            },
            providerLabel(name) {
                const map = { claude: 'Claude (Anthropic)', openai: 'GPT (OpenAI)', gemini: 'Gemini (Google)', dalle: 'DALL-E (OpenAI)' };
                return map[name] || name || '-';
            },
            async loadOrganizations() {
                try {
                    const stored = localStorage.getItem('mkt_current_org');
                    // Prefill so first api() call carries the header
                    if (stored)
                        this.currentOrganization = { id: stored };
                    let data;
                    try {
                        data = await this.api('/organizations/current');
                    }
                    catch (err) {
                        if (!stored)
                            throw err;
                        localStorage.removeItem('mkt_current_org');
                        this.currentOrganization = null;
                        data = await this.api('/organizations/current');
                    }
                    this.organizations = data.memberships || [];
                    this.currentOrganization = data.current;
                    this.orgSubscription = data.subscription; // { subscriptionStatus, isTrial, trialDaysRemaining, ... }
                    this.orgPageUsage = data.pageUsage || { used: 0, limit: null };
                    this.orgMemberUsage = data.memberUsage || { used: 0, limit: null };
                    window.MKTOrganizationSnapshot = {
                        organizationId: data.current?.id || null,
                        data,
                        savedAt: Date.now(),
                    };
                    if (data.current)
                        localStorage.setItem('mkt_current_org', data.current.id);
                }
                catch (e) {
                    console.warn('loadOrganizations failed', e);
                }
            },
            async switchOrganization(orgId) {
                if (!orgId || orgId === this.currentOrganization?.id)
                    return;
                localStorage.setItem('mkt_current_org', orgId);
                this.orgSelectorOpen = false;
                // Reset scope-dependent state before reload
                this.currentScope = { type: 'all' };
                this._statsLoaded = false;
                await this.loadOrganizations();
                await this.loadPages();
                await this.loadWorkspaces();
                await this.validateScope();
                await this.loadScopePages();
                await this.loadDashboard();
                if (this.page === 'settings')
                    await this.loadSettings(); // reload THIS org's AI config
                if (this.socket) {
                    try {
                        this.socket.emit('subscribe:org', orgId);
                    }
                    catch { }
                }
            },
            async refreshPageUsage() {
                if (!this.currentOrganization)
                    return;
                try {
                    const d = await this.api(`/organizations/${this.currentOrganization.id}/page-usage`);
                    this.orgPageUsage = d;
                }
                catch { }
            },
            async openOrgSettings() {
                // Organization & member management only (plan/limits, members,
                // invitations, access). AI configuration lives in Cài đặt hệ thống.
                if (!this.currentOrganization)
                    return;
                this.orgSettingsOpen = true;
                try {
                    this.orgMembers = await this.api(`/organizations/${this.currentOrganization.id}/members`);
                    this.orgInvitations = await this.api('/organizations-invitations');
                }
                catch (e) {
                    console.warn('org settings load failed', e);
                }
            },
            async sendInvitation() {
                this.inviteError = '';
                this.lastInviteUrl = '';
                try {
                    const r = await this.api('/organizations-invitations', {
                        method: 'POST',
                        body: JSON.stringify(this.inviteForm),
                    });
                    this.lastInviteUrl = window.location.origin + r.inviteUrl;
                    this.inviteForm = { email: '', role: 'MEMBER', accessMode: 'ALL' };
                    this.orgInvitations = await this.api('/organizations-invitations');
                }
                catch (e) {
                    this.inviteError = e.message;
                }
            },
            async cancelInvitation(id) {
                try {
                    await this.api(`/organizations-invitations/${id}`, { method: 'DELETE' });
                    this.orgInvitations = await this.api('/organizations-invitations');
                }
                catch (e) {
                    alert(e.message);
                }
            },
            async copyInviteUrl(url) {
                try {
                    await navigator.clipboard.writeText(url);
                    alert('Đã sao chép liên kết mời.');
                }
                catch {
                    prompt('Copy link:', url);
                }
            },
            async previewInvitation(token) {
                this.joinError = '';
                this.joinPreview = null;
                try {
                    this.joinPreview = await this.api(`/invitations/${encodeURIComponent(token)}`);
                }
                catch (e) {
                    this.joinError = e.message;
                }
            },
            async acceptInvitation() {
                if (!this.token) {
                    alert('Vui lòng đăng nhập trước.');
                    return;
                }
                this.joinLoading = true;
                this.joinError = '';
                try {
                    await this.api(`/invitations/${encodeURIComponent(this.joinToken)}/accept`, { method: 'POST' });
                    this.joinToken = '';
                    this.joinPreview = null;
                    await this.loadOrganizations();
                    alert('Đã tham gia tổ chức.');
                }
                catch (e) {
                    this.joinError = e.message;
                }
                finally {
                    this.joinLoading = false;
                }
            },
            async openAccessDrawer(member) {
                if (!this.currentOrganization)
                    return;
                this.accessTarget = member;
                try {
                    const [orgPages, orgWs, existing] = await Promise.all([
                        this.api('/dashboard/pages?all=true'),
                        this.api('/workspaces'),
                        this.api(`/organizations/${this.currentOrganization.id}/members/${member.id}/access`),
                    ]);
                    this.accessOrgPages = orgPages || [];
                    this.accessOrgWorkspaces = orgWs || [];
                    this.accessForm = {
                        accessMode: existing.accessMode || 'ALL',
                        workspaceIds: existing.workspaceIds || [],
                        pageIds: existing.pageIds || [],
                    };
                    this.accessDrawerOpen = true;
                }
                catch (e) {
                    alert(e.message);
                }
            },
            toggleAccessWs(id) {
                const s = new Set(this.accessForm.workspaceIds);
                s.has(id) ? s.delete(id) : s.add(id);
                this.accessForm.workspaceIds = [...s];
            },
            toggleAccessPage(id) {
                const s = new Set(this.accessForm.pageIds);
                s.has(id) ? s.delete(id) : s.add(id);
                this.accessForm.pageIds = [...s];
            },
            accessInheritedPageIds() {
                const wsIds = new Set(this.accessForm.workspaceIds);
                const ids = new Set();
                for (const w of this.accessOrgWorkspaces) {
                    if (!wsIds.has(w.id))
                        continue;
                    for (const p of (w.pages || []))
                        ids.add(p.id);
                }
                return ids;
            },
            accessEffectivePageCount() {
                if (this.accessForm.accessMode === 'ALL')
                    return this.accessOrgPages.length;
                const s = new Set();
                for (const id of this.accessInheritedPageIds())
                    s.add(id);
                for (const id of this.accessForm.pageIds)
                    s.add(id);
                return s.size;
            },
            async saveMemberAccess() {
                if (!this.currentOrganization || !this.accessTarget)
                    return;
                try {
                    await this.api(`/organizations/${this.currentOrganization.id}/members/${this.accessTarget.id}/access`, {
                        method: 'PUT',
                        body: JSON.stringify(this.accessForm),
                    });
                    this.accessDrawerOpen = false;
                    this.accessTarget = null;
                    this.orgMembers = await this.api(`/organizations/${this.currentOrganization.id}/members`);
                }
                catch (e) {
                    alert(e.message);
                }
            },
            async reconcileMemberAccess() {
                await this.loadPages();
                await this.loadWorkspaces();
                await this.validateScope();
                await this.loadScopePages();
                await this.loadDashboard();
            },
            async addOrgMember() {
                this.orgMemberError = '';
                try {
                    await this.api(`/organizations/${this.currentOrganization.id}/members`, {
                        method: 'POST',
                        body: JSON.stringify(this.orgMemberForm),
                    });
                    this.orgMemberForm = { email: '', role: 'MEMBER' };
                    this.orgMembers = await this.api(`/organizations/${this.currentOrganization.id}/members`);
                }
                catch (e) {
                    this.orgMemberError = e.message;
                }
            },
            async updateOrgMemberRole(memberId, role) {
                try {
                    await this.api(`/organizations/${this.currentOrganization.id}/members/${memberId}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ role }),
                    });
                    this.orgMembers = await this.api(`/organizations/${this.currentOrganization.id}/members`);
                }
                catch (e) {
                    alert(e.message);
                }
            },
            async removeOrgMember(memberId) {
                if (!confirm('Xoá thành viên này khỏi tổ chức?'))
                    return;
                try {
                    await this.api(`/organizations/${this.currentOrganization.id}/members/${memberId}`, { method: 'DELETE' });
                    this.orgMembers = await this.api(`/organizations/${this.currentOrganization.id}/members`);
                }
                catch (e) {
                    alert(e.message);
                }
            }
        },
        window.MKTNavigation.state(),
        window.MKTPageModules.dashboard(),
        window.MKTPageModules.pages(),
        window.MKTPageModules.campaigns(),
        window.MKTPageModules.content(),
        window.MKTPageModules.import(),
        window.MKTPageModules.settings(),
        window.MKTPageModules.activity(),
    ]);
}
