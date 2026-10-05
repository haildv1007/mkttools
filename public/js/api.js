window.MKTApi = {
    _inflight: new Map(),
    async request(path, options = {}, context = {}) {
        const headers = { ...options.headers };
        const token = context.token || localStorage.getItem('mkt_token') || '';
        if (token)
            headers.Authorization = `Bearer ${token}`;
        if (!(options.body instanceof FormData))
            headers['Content-Type'] = 'application/json';
        const organizationId = context.organizationId || localStorage.getItem('mkt_current_org');
        if (organizationId)
            headers['X-Organization-Id'] = organizationId;
        const url = path.startsWith('/api/') ? path : `/api${path}`;
        const method = String(options.method || 'GET').toUpperCase();
        const requestKey = method === 'GET' ? `${organizationId || '-'}:${url}` : '';
        if (requestKey && this._inflight.has(requestKey))
            return this._inflight.get(requestKey);

        const run = async () => {
            const controller = new AbortController();
            const timeoutMs = Number(options.timeoutMs) || 15000;
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const externalSignal = options.signal;
            const abortFromExternal = () => controller.abort();
            if (externalSignal)
                externalSignal.addEventListener('abort', abortFromExternal, { once: true });
            try {
                const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
                const response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
                const data = await response.json().catch(() => ({}));
                if (response.status === 401 && token) {
                    localStorage.removeItem('mkt_token');
                    window.location.replace('/login');
                    return null;
                }
                if (!response.ok)
                    throw new Error(data.message || data.error || 'Request failed');
                return data;
            }
            catch (error) {
                if (error?.name === 'AbortError' && !externalSignal?.aborted)
                    throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
                throw error;
            }
            finally {
                clearTimeout(timeout);
                if (externalSignal)
                    externalSignal.removeEventListener('abort', abortFromExternal);
            }
        };

        const promise = run();
        if (requestKey)
            this._inflight.set(requestKey, promise);
        try {
            return await promise;
        }
        finally {
            if (requestKey && this._inflight.get(requestKey) === promise)
                this._inflight.delete(requestKey);
        }
    },
};
