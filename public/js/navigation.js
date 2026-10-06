window.MKTNavigation = {
    routes: { dashboard: '/dashboard', campaigns: '/campaigns', content: '/content', import: '/import', pages: '/pages', settings: '/settings', organization: '/organization' },
    pageFromLocation() {
        const path = window.location.pathname.replace(/\/+$/, '') || '/';
        if (path === '/activity') {
            history.replaceState({ page: 'dashboard' }, '', '/dashboard');
            return 'dashboard';
        }
        return Object.entries(this.routes).find(([, route]) => route === path)?.[0] || 'dashboard';
    },
    state() {
        return {
            navigate(page, options = {}) {
                if (!window.MKTNavigation.routes[page])
                    page = 'dashboard';
                if (this.page === 'organization' && page !== 'organization') {
                    window.dispatchEvent(new CustomEvent('organization-cleanup'));
                }
                if (this.page === 'dashboard' && page !== 'dashboard') {
                    if (this.cancelDashboardRequests) this.cancelDashboardRequests();
                }
                if (this.page === 'content' && page !== 'content') {
                    if (this.destroyContentPerf) this.destroyContentPerf();
                }
                this.page = page;
                if (!options.fromPopState) {
                    const route = window.MKTNavigation.routes[page];
                    const url = page === 'organization' ? route + window.location.search : route;
                    history[options.replace ? 'replaceState' : 'pushState']({ page }, '', url);
                }
                if (page === 'dashboard' && !options.skipDataLoad)
                    this.loadDashboard();
                if (page === 'campaigns' && !options.skipDataLoad)
                    this.loadCampaigns();
                if (page === 'import' && !options.skipDataLoad)
                    this.loadCampaigns();
                if (page === 'content') {
                    if (this.initContentPerf) this.initContentPerf();
                    if (!options.skipDataLoad) {
                        this.loadContent();
                        this.loadCampaigns();
                    }
                }
                if (page === 'pages' && !options.skipDataLoad)
                    this.loadPages();
                if (page === 'settings' && !options.skipDataLoad)
                    this.loadSettings();
            },
        };
    },
    async loadFragments() {
        const names = ['dashboard', 'campaigns', 'content', 'import', 'pages', 'settings', 'organization', 'activity'];
        const host = document.getElementById('page-fragments');
        const fragments = await Promise.all(names.map(async (name) => {
            const response = await fetch(`/pages/${name}.html?v=20261006.4`, { cache: 'no-store' });
            if (!response.ok)
                throw new Error(`Unable to load ${name} page`);
            return response.text();
        }));
        host.innerHTML = fragments.join('\n');
    },
    async bootstrap() {
        await this.loadFragments();
        const alpine = document.createElement('script');
        alpine.src = 'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js';
        document.body.appendChild(alpine);
    },
};
window.addEventListener('popstate', () => {
    const root = document.body._x_dataStack?.[0];
    if (root?.navigate)
        root.navigate(window.MKTNavigation.pageFromLocation(), { fromPopState: true });
});
window.MKTNavigation.bootstrap().catch((error) => {
    console.error(error);
    document.getElementById('page-fragments').innerHTML = '<div class="p-6 text-red-600">Không thể tải giao diện. Vui lòng tải lại trang.</div>';
});
