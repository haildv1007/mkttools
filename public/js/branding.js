(function () {
  const storageKey = 'mkt_platform_product_name';
  const logoStorageKey = 'mkt_platform_logo_url';
  const faviconStorageKey = 'mkt_platform_favicon_url';

  function applyLogo(url, persist) {
    const logoUrl = String(url || '').trim();
    document.querySelectorAll('[data-platform-logo]').forEach((image) => {
      const fallback = image.parentElement?.querySelector('[data-platform-logo-fallback]');
      if (!logoUrl) {
        image.hidden = true;
        image.removeAttribute('src');
        if (fallback) fallback.hidden = false;
        return;
      }
      image.onload = () => { image.hidden = false; if (fallback) fallback.hidden = true; };
      image.onerror = () => { image.hidden = true; if (fallback) fallback.hidden = false; };
      image.src = logoUrl;
      if (image.complete && image.naturalWidth) image.onload();
    });
    if (persist) localStorage.setItem(logoStorageKey, logoUrl);
  }

  function applyFavicon(url, persist) {
    const faviconUrl = String(url || '').trim();
    if (!faviconUrl) return;
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
    if (persist) localStorage.setItem(faviconStorageKey, faviconUrl);
  }

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
    if (Object.prototype.hasOwnProperty.call(config || {}, 'logoUrl')) applyLogo(config.logoUrl, persist);
    if (Object.prototype.hasOwnProperty.call(config || {}, 'faviconUrl')) applyFavicon(config.faviconUrl, persist);
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
    if (event.key === logoStorageKey) applyLogo(event.newValue, false);
    if (event.key === faviconStorageKey) applyFavicon(event.newValue, false);
  });
  const cachedName = localStorage.getItem(storageKey);
  if (cachedName) applyPlatformBrand({ productName: cachedName }, false);
  const cachedLogo = localStorage.getItem(logoStorageKey);
  const cachedFavicon = localStorage.getItem(faviconStorageKey);
  if (cachedLogo) applyLogo(cachedLogo, false);
  if (cachedFavicon) applyFavicon(cachedFavicon, false);
  refreshPlatformBrand();
})();
