window.MKTPageModules = window.MKTPageModules || {};
window.MKTPageModules.settings = () => ({
    async loadSettings() {
        if (this.currentOrganization?.role !== 'OWNER')
            return;
        try {
            const data = await this.api('/dashboard/settings');
            // Telegram/Facebook/timezone only - AI fields are no longer read
            // from here (see "Cấu hình AI" below, org-scoped).
            const loaded = data.settings || {};
            this.secretConfigured = {
                telegram: !!loaded.TELEGRAM_BOT_TOKEN,
                facebook: !!loaded.FACEBOOK_APP_SECRET,
            };
            // Never keep a stored secret (even a masked one) in editable state.
            // A blank secret input means "leave unchanged".
            this.settingsForm = {
                ...loaded,
                DEFAULT_TIMEZONE: loaded.DEFAULT_TIMEZONE || 'Asia/Ho_Chi_Minh',
                TELEGRAM_BOT_TOKEN: '',
                FACEBOOK_APP_SECRET: '',
            };
            this.showKeys = { anthropic: false, openai: false, gemini: false, telegram: false, fbSecret: false };
        }
        catch { }
        // "Cấu hình AI" reads/writes the CURRENT organization's settings -
        // reload whenever this page opens so switching org shows that org's
        // own AI config, never a stale one from a previously viewed org.
        try {
            this.orgAiCreds = await this.api('/ai-credentials');
            await this.loadOrgAiOperations();
        }
        catch (e) {
            console.warn('load AI settings failed', e);
        }
    },
    async saveSettings() {
        this.settingsSaving = true;
        try {
            const payload = { ...this.settingsForm };
            if (!payload.TELEGRAM_BOT_TOKEN)
                delete payload.TELEGRAM_BOT_TOKEN;
            if (!payload.FACEBOOK_APP_SECRET)
                delete payload.FACEBOOK_APP_SECRET;
            await this.api('/dashboard/settings', {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            if (payload.TELEGRAM_BOT_TOKEN)
                this.secretConfigured.telegram = true;
            if (payload.FACEBOOK_APP_SECRET)
                this.secretConfigured.facebook = true;
            this.settingsForm.TELEGRAM_BOT_TOKEN = '';
            this.settingsForm.FACEBOOK_APP_SECRET = '';
            this.showKeys.telegram = false;
            this.showKeys.fbSecret = false;
            this.showToast('Đã lưu cài đặt thành công!');
            await this.loadDashboard();
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
        finally {
            this.settingsSaving = false;
        }
    },
    async changeProvider(type, provider) {
        try {
            await this.api(`/dashboard/providers/${type}`, {
                method: 'PUT',
                body: JSON.stringify({ provider }),
            });
            await this.loadDashboard();
            this.showToast(`Đã chuyển ${type} provider sang ${provider}`);
        }
        catch (e) {
            this.showToast(e.message, 'error');
        }
    },
    async loadOrgAiOperations() {
        try {
            const r = await this.api('/ai-credentials/operations');
            const byOp = Object.fromEntries((r.operations || []).map(o => [o.operation, o]));
            for (const op of ['TEXT_GENERATION', 'IMAGE_GENERATION']) {
                this.orgOpForm[op].provider = byOp[op]?.provider || this.orgOpForm[op].provider;
                this.orgOpForm[op].model = byOp[op]?.model || '';
            }
            await this.loadOrgOpModelOptions('TEXT_GENERATION');
            await this.loadOrgOpModelOptions('IMAGE_GENERATION');
        }
        catch (e) {
            console.warn('load ai operations failed', e);
        }
    },
    async loadOrgOpModelOptions(op) {
        const provider = this.orgOpForm[op].provider;
        if (op === 'TEXT_GENERATION') {
            this.orgOpModelOptions[op] = this.textModelsMap[provider] || [];
            this.orgOpCredentialConfigured[op] = !!(this.orgAiCreds?.credentials || []).find(c => c.provider === provider && c.status === 'CONFIGURED');
            return;
        }
        // IMAGE_GENERATION - ask the backend, which merges the recommended
        // catalog with a live listing from the org's own credential.
        try {
            if (provider === 'gemini') {
                const r = await this.api('/dashboard/gemini-image-models');
                this.orgOpModelOptions[op] = r.models || [];
                this.orgOpCredentialConfigured[op] = !!r.credentialConfigured;
            }
            else if (provider === 'openai') {
                const r = await this.api('/dashboard/openai-image-models');
                this.orgOpModelOptions[op] = r.models || [];
                this.orgOpCredentialConfigured[op] = !!r.credentialConfigured;
            }
            else {
                this.orgOpModelOptions[op] = [];
                this.orgOpCredentialConfigured[op] = false;
            }
        }
        catch (e) {
            // Listing failed - never erase an already-configured model.
            console.warn('load image model options failed', e);
        }
    },
    async onOrgOpProviderChange(op) {
        this.orgOpForm[op].model = '';
        await this.loadOrgOpModelOptions(op);
    },
    async selectOrgProvider(op, provider) {
        this.settingsDropdown = '';
        if (this.orgOpForm[op].provider === provider)
            return;
        this.orgOpForm[op].provider = provider;
        await this.onOrgOpProviderChange(op);
    },
    selectOrgModel(op, model) {
        this.orgOpForm[op].model = model;
        this.settingsDropdown = '';
    },
    selectedModelLabel(op) {
        const id = this.orgOpForm[op].model;
        if (!id)
            return '- Chọn model -';
        return this.orgOpModelOptions[op].find(model => model.id === id)?.name || id;
    },
    timezoneOptions() {
        return [
            { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh (GMT+7)' },
            { value: 'Asia/Bangkok', label: 'Asia/Bangkok (GMT+7)' },
            { value: 'Asia/Tokyo', label: 'Asia/Tokyo (GMT+9)' },
            { value: 'UTC', label: 'UTC (GMT+0)' },
        ];
    },
    timezoneLabel(value) {
        return this.timezoneOptions().find(timezone => timezone.value === value)?.label || value || '- Chọn múi giờ -';
    },
    selectTimezone(value) {
        this.settingsForm.DEFAULT_TIMEZONE = value;
        this.settingsDropdown = '';
    },
    aiProvidersForOperation(op) {
        const providers = (this.orgAiCreds?.providerCatalog || [])
            .filter(item => Object.prototype.hasOwnProperty.call(item.operations || {}, op))
            .map(item => item.provider);
        return providers.length ? providers : (op === 'IMAGE_GENERATION' ? ['gemini', 'openai'] : ['gemini', 'openai', 'claude']);
    },
    aiProviderName(provider) {
        return { gemini: 'Gemini (Google)', openai: 'OpenAI', claude: 'Claude (Anthropic)' }[provider] || provider;
    },
    credentialFor(provider) {
        return (this.orgAiCreds?.credentials || []).find(c => c.provider === provider) || null;
    },
    credentialStatusLabel(provider) {
        const status = this.credentialFor(provider)?.status;
        return status === 'CONFIGURED' ? 'Đã cấu hình' : status === 'DECRYPT_ERROR' ? 'Cần nhập lại' : 'Chưa cấu hình';
    },
    credentialStatusClass(provider) {
        const status = this.credentialFor(provider)?.status;
        return status === 'CONFIGURED' ? 'bg-emerald-50 text-emerald-700' : status === 'DECRYPT_ERROR' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500';
    },
    credentialSummary(provider) {
        const credential = this.credentialFor(provider);
        if (credential?.status === 'DECRYPT_ERROR')
            return 'Không thể đọc credential đã lưu';
        if (credential?.status === 'CONFIGURED')
            return credential.maskedKey || 'API key được lưu an toàn';
        const operations = (this.orgAiCreds?.providerCatalog || []).find(item => item.provider === provider)?.operations || {};
        const supportsText = !!operations.TEXT_GENERATION || ['gemini', 'openai', 'claude'].includes(provider);
        const supportsImage = !!operations.IMAGE_GENERATION || provider === 'gemini' || provider === 'openai';
        if (supportsText && supportsImage)
            return 'Sử dụng cho AI text và AI image';
        if (supportsImage)
            return 'Sử dụng cho AI image';
        return 'Sử dụng cho AI text';
    },
    toggleManualModel(op) {
        const form = this.orgOpForm[op];
        form.useManualModel = !form.useManualModel;
        if (form.useManualModel && !form.manualModel)
            form.manualModel = form.model || '';
    },
    async saveOrgOpSetting(op) {
        this.orgAiError = '';
        const form = this.orgOpForm[op];
        const model = (form.useManualModel ? form.manualModel : form.model || form.manualModel || '').trim();
        if (!form.provider || !model) {
            this.orgAiError = 'Vui lòng chọn Provider và Model.';
            return;
        }
        try {
            await this.api(`/ai-credentials/operations/${op}`, {
                method: 'PUT',
                body: JSON.stringify({ provider: form.provider, model }),
            });
            form.model = model;
            form.useManualModel = false;
            form.manualModel = '';
        }
        catch (e) {
            this.orgAiError = e.message;
        }
    },
    async saveAiCredential() {
        this.credentialModal.error = '';
        if (!this.credentialModal.apiKey || this.credentialModal.apiKey.length < 6) {
            this.credentialModal.error = 'API key không hợp lệ.';
            return;
        }
        this.credentialModal.saving = true;
        try {
            await this.api(`/ai-credentials/${this.credentialModal.provider}`, {
                method: 'PUT',
                body: JSON.stringify({ apiKey: this.credentialModal.apiKey }),
            });
            this.orgAiCreds = await this.api('/ai-credentials');
            await this.loadOrgOpModelOptions('TEXT_GENERATION');
            await this.loadOrgOpModelOptions('IMAGE_GENERATION');
            this.credentialModal.saving = false;
            this.closeAiCredentialModal();
            this.showToast('Đã lưu API key thành công!');
        }
        catch (e) {
            this.credentialModal.error = e.message;
        }
        finally {
            this.credentialModal.saving = false;
        }
    },
    openAiCredentialModal(provider) {
        this.credentialModal = { open: true, provider, apiKey: '', showKey: false, saving: false, error: '' };
        this.$nextTick(() => this.$refs.credentialApiKey?.focus());
    },
    closeAiCredentialModal() {
        if (this.credentialModal.saving)
            return;
        this.credentialModal = { open: false, provider: 'gemini', apiKey: '', showKey: false, saving: false, error: '' };
    },
    async testAiCredential(provider) {
        try {
            const r = await this.api(`/ai-credentials/${provider}/test`, { method: 'POST' });
            alert(`${provider}: ${r.status} - ${r.message}`);
            this.orgAiCreds = await this.api('/ai-credentials');
        }
        catch (e) {
            alert(e.message);
        }
    },
    async removeAiCredential(provider) {
        if (!confirm(`Xoá API key ${provider}?`))
            return;
        try {
            await this.api(`/ai-credentials/${provider}`, { method: 'DELETE' });
            this.orgAiCreds = await this.api('/ai-credentials');
            await this.loadOrgOpModelOptions('TEXT_GENERATION');
            await this.loadOrgOpModelOptions('IMAGE_GENERATION');
        }
        catch (e) {
            alert(e.message);
        }
    }
});
