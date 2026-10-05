(function () {
  const storageKey = 'mkt_platform_product_name';

  function applyPlatformBrand(config, persist = true) {
    const productName = String(config?.productName || 'MKT Tools').trim() || 'MKT Tools';
    const suffix = document.documentElement.dataset.platformTitleSuffix;
    document.title = suffix ? `${productName} - ${suffix}` : productName;
    document.querySelectorAll('[data-platform-name]').forEach((element) => {
      element.textContent = productName;
    });
    document.querySelectorAll('[data-platform-name-suffix]').forEach((element) => {
      element.textContent = productName + element.dataset.platformNameSuffix;
    });
    if (persist && localStorage.getItem(storageKey) !== productName) localStorage.setItem(storageKey, productName);
  }

  async function refreshPlatformBrand() {
    try {
      const response = await fetch('/api/platform-config', { headers: { Accept: 'application/json' } });
      if (response.ok) applyPlatformBrand(await response.json());
    } catch { /* Keep the HTML fallback when the API is unavailable. */ }
  }

  window.applyPlatformBrand = applyPlatformBrand;
  window.refreshPlatformBrand = refreshPlatformBrand;
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && event.newValue) applyPlatformBrand({ productName: event.newValue }, false);
  });
  const cachedName = localStorage.getItem(storageKey);
  if (cachedName) applyPlatformBrand({ productName: cachedName }, false);
  refreshPlatformBrand();
})();
