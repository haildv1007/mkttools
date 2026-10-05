function organizationPage() {
    return { token: '', user: null, org: null, subscription: {}, pageUsage: {}, memberUsage: {}, pages: [], workspaces: [], scopeOpen: false, scope: { type: 'all' }, tab: 'overview', tabs: [{ id: 'overview', label: 'Tổng quan', icon: 'ri-home-5-line' }, { id: 'members', label: 'Thành viên & quyền', icon: 'ri-team-line' }, { id: 'billing', label: 'Gói & thanh toán', icon: 'ri-bank-card-line' }], loading: true, error: '', editingName: false, editName: '', members: [], invitations: [], inviteOpen: false, invite: { email: '', role: 'MEMBER', accessMode: 'ALL' }, permissionOpen: false, permissionLoading: false, permission: { member: null, role: 'MEMBER', accessMode: 'ALL', workspaceIds: [], pageIds: [], availableWorkspaces: [], availablePages: [] }, resourceSearch: '', saving: false, toast: '', billing: {}, plans: [], periods: [1, 3, 12], selectedPeriod: 3, selectedPlan: null, history: [], activeCheckout: null, paymentJustCompleted: false, checkoutLoading: false, checkoutError: '', checkingOut: false, poll: null, countdown: '', countdownTimer: null,
        get isOwner() { return this.org?.role === 'OWNER'; }, async init() { this.token = localStorage.getItem('mkt_token') || ''; if (!this.token) {
            location.href = '/login';
            return;
        } const q = new URLSearchParams(location.search).get('tab'); this.tab = ['overview', 'members', 'billing'].includes(q) ? q : 'overview'; await this.loadOverview(); if (!this.isOwner && this.tab !== 'overview') {
            this.tab = 'overview';
            history.replaceState({}, '', '/organization?tab=overview');
        } await this.loadTab(); const order = new URLSearchParams(location.search).get('order'); if (order && this.isOwner) {
            this.tab = 'billing';
            await this.resumeOrder(order);
        } },
        async api(url, o = {}) { return window.MKTApi.request(url, o, { token: this.token, organizationId: this.org?.id }); },
        async retryLoad() { if (!this.org)
            await this.loadOverview(); if (this.org)
            await this.loadTab(); },
        async loadOverview() { this.loading = true; this.error = ''; try {
            const savedOrgId = localStorage.getItem('mkt_current_org');
            const snapshot = window.MKTOrganizationSnapshot;
            const d = snapshot?.organizationId === savedOrgId && Date.now() - snapshot.savedAt < 5000
                ? snapshot.data
                : await this.api('/api/organizations/current');
            this.org = d.current;
            this.subscription = d.subscription || {};
            this.pageUsage = d.pageUsage || {};
            this.memberUsage = d.memberUsage || {};
            if (this.org)
                localStorage.setItem('mkt_current_org', this.org.id);
        }
        catch (e) {
            this.error = e.message;
        }
        finally {
            this.loading = false;
        } },
        async loadShellScope() { try {
            [this.pages, this.workspaces] = await Promise.all([this.api('/api/dashboard/pages'), this.api('/api/workspaces')]);
            const saved = JSON.parse(localStorage.getItem('mkt_scope') || '{"type":"all"}');
            this.scope = saved?.type ? saved : { type: 'all' };
        }
        catch { } }, scopeLabel() { if (this.scope.type === 'workspace')
            return this.workspaces.find(x => x.id === this.scope.id)?.name || 'Tất cả Pages'; if (this.scope.type === 'page')
            return this.pages.find(x => x.id === this.scope.id)?.name || 'Tất cả Pages'; return 'Tất cả Pages'; }, scopeCountLabel() { if (this.scope.type === 'workspace')
            return `${this.workspaces.find(x => x.id === this.scope.id)?.pageCount || 0} Pages`; if (this.scope.type === 'page')
            return 'Page đơn'; return `${this.pages.length} Pages`; }, setScope(s) { this.scope = s; localStorage.setItem('mkt_scope', JSON.stringify(s)); this.scopeOpen = false; }, logout() { localStorage.removeItem('mkt_token'); location.href = '/login'; },
        async loadTab() { if (this.tab === 'members' && this.isOwner)
            await this.loadMembers(); if (this.tab === 'billing' && this.isOwner)
            await this.loadBilling(); }, goTab(t) { if (!this.isOwner && t !== 'overview')
            return; if (t !== 'billing')
            this.clearPaymentTimers(); this.tab = t; history.pushState({}, '', `/organization?tab=${t}`); this.activeCheckout = null; this.loadTab(); },
        async saveName() { if (!this.editName.trim())
            return; this.saving = true; try {
            await this.api(`/api/organizations/${this.org.id}`, { method: 'PATCH', body: JSON.stringify({ name: this.editName.trim() }) });
            this.org.name = this.editName.trim();
            this.editingName = false;
            this.say('Đã cập nhật tên tổ chức');
        }
        catch (e) {
            this.say(e.message);
        }
        finally {
            this.saving = false;
        } },
        async loadMembers() { this.loading = true; this.error = ''; try {
            [this.members, this.invitations] = await Promise.all([this.api(`/api/organizations/${this.org.id}/members`), this.api('/api/organizations-invitations')]);
            this.invitations = this.invitations.filter(i => i.status === 'PENDING');
        }
        catch (e) {
            this.error = e.message;
        }
        finally {
            this.loading = false;
        } },
        async sendInvite() { this.saving = true; try {
            await this.api('/api/organizations-invitations', { method: 'POST', body: JSON.stringify(this.invite) });
            this.inviteOpen = false;
            this.invite = { email: '', role: 'MEMBER', accessMode: 'ALL' };
            this.say('Đã gửi lời mời');
            await this.loadMembers();
        }
        catch (e) {
            this.say(e.message);
        }
        finally {
            this.saving = false;
        } }, async cancelInvite(i) { if (!confirm(`Hủy lời mời gửi tới ${i.email}?`))
            return; try {
            await this.api(`/api/organizations-invitations/${i.id}`, { method: 'DELETE' });
            this.say('Đã hủy lời mời');
            await this.loadMembers();
        }
        catch (e) {
            this.say(e.message);
        } }, async removeMember(m) { if (!confirm(`Xóa ${m.email} khỏi tổ chức?`))
            return; try {
            await this.api(`/api/organizations/${this.org.id}/members/${m.id}`, { method: 'DELETE' });
            this.say('Đã xóa thành viên');
            await this.loadMembers();
        }
        catch (e) {
            this.say(e.message);
        } },
        async openPermission(m) { this.permissionOpen = true; this.permissionLoading = true; this.resourceSearch = ''; try {
            const d = await this.api(`/api/organizations/${this.org.id}/members/${m.id}/detail`);
            this.permission = { ...d, member: d.member || m, role: d.member?.role || m.role, workspaceIds: d.workspaceIds || [], pageIds: d.pageIds || [], availableWorkspaces: d.availableWorkspaces || [], availablePages: d.availablePages || [] };
        }
        catch (e) {
            this.say(e.message);
            this.permissionOpen = false;
        }
        finally {
            this.permissionLoading = false;
        } }, async savePermission() { this.saving = true; try {
            const m = this.permission.member;
            if (this.permission.role !== m.role)
                await this.api(`/api/organizations/${this.org.id}/members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ role: this.permission.role }) });
            await this.api(`/api/organizations/${this.org.id}/members/${m.id}/access`, { method: 'PUT', body: JSON.stringify({ accessMode: this.permission.accessMode, workspaceIds: this.permission.workspaceIds, pageIds: this.permission.pageIds }) });
            this.permissionOpen = false;
            this.say('Đã cập nhật quyền truy cập');
            await this.loadMembers();
        }
        catch (e) {
            this.say(e.message);
        }
        finally {
            this.saving = false;
        } }, filteredResources(a = []) { const q = this.resourceSearch.toLowerCase(); return a.filter(x => (x.name || '').toLowerCase().includes(q)); },
        async loadBilling() { this.loading = true; this.error = ''; try {
            const [billing, plans, h] = await Promise.all([this.api('/api/billing/context'), this.api('/api/billing/plans'), this.api('/api/billing/orders?page=1&pageSize=10')]);
            this.billing = billing;
            this.plans = plans;
            this.history = h.items || [];
            const ps = [...new Set(this.plans.flatMap(p => (p.prices || []).map(x => x.billingMonths)))].sort((a, b) => a - b);
            if (ps.length) {
                this.periods = ps;
                if (!ps.includes(this.selectedPeriod))
                    this.selectedPeriod = ps[0];
            }
        }
        catch (e) {
            this.error = e.message;
        }
        finally {
            this.loading = false;
        } },
        planPriceObject(p) { return p?.prices?.find(x => x.billingMonths === this.selectedPeriod) || null; },
        planPrice(p) { return this.planPriceObject(p)?.amount ?? null; },
        planForOrder(o = this.activeCheckout) { return this.plans.find(p => p.code === o?.planCodeSnapshot) || null; },
        isCurrentPlan(p) { return this.billing.subscription?.planCode === p?.code; },
        selectPlan(p) { if (!this.planPriceObject(p))
            return; this.selectedPlan = p; },
        planAction(p) { if (!this.planPriceObject(p))
            return 'Liên hệ'; if (this.selectedPlan?.id === p.id)
            return 'Đã chọn'; if (this.isCurrentPlan(p))
            return 'Gia hạn'; return 'Chọn gói'; },
        checkoutLabel() { if (!this.selectedPlan)
            return 'Thanh toán'; return this.isCurrentPlan(this.selectedPlan) ? `Gia hạn ${this.selectedPlan.name}` : `Nâng cấp lên ${this.selectedPlan.name}`; },
        setOrderUrl(id, replace = false) { const url = `/organization?tab=billing${id ? `&order=${encodeURIComponent(id)}` : ''}`; history[replace ? 'replaceState' : 'pushState']({}, '', url); },
        clearPaymentTimers() { clearInterval(this.poll); clearInterval(this.countdownTimer); this.poll = null; this.countdownTimer = null; },
        async handlePopState() { const q = new URLSearchParams(location.search); const nextTab = q.get('tab') || 'overview'; const orderId = q.get('order'); if (!['overview', 'members', 'billing'].includes(nextTab))
            return; if (nextTab !== 'billing') {
            this.clearPaymentTimers();
            this.activeCheckout = null;
            this.tab = nextTab;
            await this.loadTab();
            return;
        } this.tab = 'billing'; if (orderId) {
            if (this.activeCheckout?.id !== orderId)
                await this.resumeOrder(orderId);
        }
        else {
            this.clearPaymentTimers();
            this.activeCheckout = null;
            await this.loadBilling();
        } },
        async startCheckout() { if (this.checkingOut)
            return; const priceId = this.planPriceObject(this.selectedPlan)?.id; if (!priceId)
            return this.say('Kỳ hạn này chưa có giá'); if (!this.billing.paymentEnabled)
            return this.say('Thanh toán hiện chưa khả dụng.'); this.checkingOut = true; this.checkoutError = ''; try {
            const o = await this.api('/api/billing/orders', { method: 'POST', body: JSON.stringify({ planPriceId: priceId }) });
            await this.openOrder(o);
        }
        catch (e) {
            this.checkoutError = this.paymentErrorMessage(e);
            this.say(this.checkoutError);
        }
        finally {
            this.checkingOut = false;
        } },
        async resumeOrder(id) { this.checkoutLoading = true; this.checkoutError = ''; this.paymentJustCompleted = false; this.clearPaymentTimers(); try {
            const o = await this.api(`/api/billing/orders/${encodeURIComponent(id)}`);
            await this.openOrder(o, true);
        }
        catch (e) {
            this.checkoutError = this.paymentErrorMessage(e);
            this.activeCheckout = null;
        }
        finally {
            this.checkoutLoading = false;
        } },
        async openOrder(o, replaceUrl = false) { this.clearPaymentTimers(); this.checkoutError = ''; if (o.status === 'PENDING') {
            try {
                const c = await this.api(`/api/billing/orders/${encodeURIComponent(o.id)}/checkout`, { method: 'POST' });
                this.activeCheckout = { ...o, ...c, id: o.id, status: 'PENDING' };
                this.setOrderUrl(o.id, replaceUrl);
                this.startPolling();
            }
            catch (e) {
                const fresh = await this.api(`/api/billing/orders/${encodeURIComponent(o.id)}`).catch(() => o);
                this.activeCheckout = fresh;
                this.checkoutError = fresh.status === 'EXPIRED' ? '' : this.paymentErrorMessage(e);
                this.setOrderUrl(o.id, replaceUrl);
            }
        }
        else {
            this.activeCheckout = o;
            this.setOrderUrl(o.id, replaceUrl);
            if (o.status === 'PAID')
                await this.refreshAfterPayment();
        } },
        startPolling() { this.clearPaymentTimers(); const tick = () => { const d = new Date(this.activeCheckout?.expiresAt).getTime() - Date.now(); this.countdown = d <= 0 ? 'Đang cập nhật...' : `${Math.floor(d / 60000)}:${String(Math.floor((d % 60000) / 1000)).padStart(2, '0')}`; }; tick(); this.countdownTimer = setInterval(tick, 1000); this.poll = setInterval(async () => { const code = this.activeCheckout?.orderCode; if (!code)
            return; try {
            const o = await this.api(`/api/billing/orders/code/${encodeURIComponent(code)}`);
            if (o.status !== 'PENDING') {
                this.clearPaymentTimers();
                this.activeCheckout = { ...this.activeCheckout, ...o };
                if (o.status === 'PAID') {
                    this.paymentJustCompleted = true;
                    await this.refreshAfterPayment();
                }
            }
        }
        catch { } }, 7000); },
        async refreshAfterPayment() { await Promise.all([this.loadBilling(), this.loadOverview()]); },
        closeCheckout() { this.clearPaymentTimers(); this.activeCheckout = null; this.paymentJustCompleted = false; this.checkoutError = ''; this.setOrderUrl(null); },
        async recreateExpiredOrder() { const plan = this.planForOrder(); if (!plan)
            return this.say('Gói này hiện không còn khả dụng.'); this.selectedPlan = plan; this.selectedPeriod = this.activeCheckout.billingMonths; this.closeCheckout(); await this.startCheckout(); },
        async copyTransferContent() { const content = this.activeCheckout?.checkout?.transferContent; if (!content)
            return; try {
            await navigator.clipboard.writeText(content);
            this.say('Đã sao chép nội dung chuyển khoản');
        }
        catch { this.say('Không thể sao chép. Vui lòng thử lại.'); } },
        paymentErrorMessage(e) { const message = String(e?.message || ''); if (/PAYMENTS_DISABLED|tạm thời chưa khả dụng/i.test(message))
            return 'Thanh toán hiện chưa khả dụng.'; if (/PAYMENT_NOT_CONFIGURED|Cấu hình thanh toán/i.test(message))
            return 'Thanh toán hiện chưa khả dụng.'; if (/ORDER_NOT_PAYABLE|EXPIRED/i.test(message))
            return 'Đơn thanh toán đã hết hạn.'; return 'Không thể tải thông tin thanh toán. Vui lòng thử lại.'; },
        destroy() { this.clearPaymentTimers(); }, initial(s = '?') { return s.trim().charAt(0).toUpperCase(); }, usageLabel(u = {}, suffix = '') { return `${u.used ?? '-'} / ${u.limit == null ? '∞' : u.limit}${suffix ? ' ' + suffix : ''}`; }, usagePct(u = {}) { return u.limit ? Math.min(100, (u.used || 0) / u.limit * 100) : 0; }, limitText(n, label) { return n == null ? `Không giới hạn ${label}` : `${n} ${label}`; }, fmtDate(d) { return d ? new Date(d).toLocaleDateString('vi-VN') : '-'; }, fmtDateTime(d) { return d ? new Date(d).toLocaleString('vi-VN') : '-'; }, fmtVND(n) { return n == null ? '-' : new Intl.NumberFormat('vi-VN').format(n) + 'đ'; }, expiryText() { if (this.subscription.isTrial)
            return `Còn ${this.subscription.trialDaysRemaining ?? '-'} ngày dùng thử`; return this.subscription.expiresAt ? `Hiệu lực đến ${this.fmtDate(this.subscription.expiresAt)}` : 'Không có ngày hết hạn'; }, billingExpiryText() { const s = this.billing.subscription || {}; return s.isTrial ? `Còn ${s.trialDaysRemaining ?? '-'} ngày dùng thử` : s.expiresAt ? `Hiệu lực đến ${this.fmtDate(s.expiresAt)}` : 'Không có ngày hết hạn'; }, subStatus(s) { return { ACTIVE: 'Đang hoạt động', TRIAL: 'Dùng thử', EXPIRED: 'Hết hạn', NONE: 'Chưa có gói' }[s] || s || '-'; }, subStatusClass(s) { return s === 'ACTIVE' ? 'bg-emerald-50 text-emerald-600' : s === 'TRIAL' ? 'bg-amber-50 text-amber-600' : s === 'EXPIRED' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'; }, roleLabel(r) { return { OWNER: 'OWNER', MANAGER: 'MANAGER', MEMBER: 'MEMBER', ADMIN: 'Quản trị viên cũ' }[r] || r; }, roleClass(r) { return r === 'OWNER' ? 'bg-brand-50 text-brand-600' : r === 'MANAGER' ? 'bg-blue-50 text-blue-600' : r === 'ADMIN' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-600'; }, accessSummary(m) { if (m.isAllAccess || m.accessMode === 'ALL')
            return 'Toàn bộ tổ chức'; const p = m.effectivePageCount ?? m.pageGrantCount ?? 0, w = m.workspaceGrantCount ?? 0; return `Giới hạn · ${p} Pages${w ? ' / ' + w + ' Nhóm' : ''}`; }, orderStatus(s) { return { PENDING: 'Đang chờ', PAID: 'Đã thanh toán', EXPIRED: 'Hết hạn', CANCELLED: 'Đã hủy', FAILED: 'Thất bại' }[s] || s; }, orderStatusClass(s) { return s === 'PAID' ? 'bg-emerald-50 text-emerald-600' : s === 'PENDING' ? 'bg-amber-50 text-amber-600' : s === 'FAILED' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'; }, say(s) { this.toast = s; setTimeout(() => this.toast = '', 3000); } };
}
