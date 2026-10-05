(function () {
  'use strict';
  if (window.__mktSupportWidgetLoaded) return;
  window.__mktSupportWidgetLoaded = true;

  const icons = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8.5 8A8.7 8.7 0 0 1 8 18.7L3 20l1.3-4.6A8 8 0 1 1 20 11.5Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    messenger: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.4 2 2 6.1 2 11.2c0 2.9 1.4 5.4 3.7 7.1V22l3.4-1.9c.9.3 1.9.4 2.9.4 5.6 0 10-4.1 10-9.3S17.6 2 12 2Zm1 12.4-2.5-2.7-4.9 2.7 5.4-5.7 2.6 2.7 4.8-2.7-5.4 5.7Z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.7 3.4-3.1 17.1c-.2 1.2-.9 1.5-1.9.9l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9-4.7-1.5c-1-.3-1.1-1 .2-1.5L20 2.7c.9-.3 1.9.2 1.7.7Z"/></svg>',
    zalo: '<span aria-hidden="true">Zalo</span>'
  };
  const hints = { messenger: 'Nhắn tin qua Facebook', telegram: 'Gửi tin nhắn Telegram', zalo: 'Liên hệ qua Zalo' };
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const safeUrl = (value) => { try { const u = new URL(value, location.origin); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; } };

  fetch('/api/platform-config', { headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('config')))
    .then((config) => {
      const support = config && config.support;
      const channels = Array.isArray(support && support.channels)
        ? support.channels.filter((item) => item && item.enabled && safeUrl(item.url) && icons[item.id])
        : [];
      if (!support || !support.enabled || !channels.length) return;

      const root = document.createElement('div');
      root.className = 'mkt-support';
      root.innerHTML = '<section class="mkt-support__panel" id="mkt-support-panel" role="dialog" aria-modal="false" aria-labelledby="mkt-support-title">'
        + '<header class="mkt-support__head"><span class="mkt-support__head-icon">' + icons.chat + '</span><div class="mkt-support__heading"><h2 class="mkt-support__title" id="mkt-support-title">' + escapeHtml(support.title || 'Hỗ trợ khách hàng') + '</h2><p class="mkt-support__subtitle">' + escapeHtml(support.subtitle || 'Đội ngũ luôn sẵn sàng hỗ trợ bạn') + '</p></div><button class="mkt-support__close" type="button" aria-label="Đóng hỗ trợ">×</button></header>'
        + '<div class="mkt-support__status"><span class="mkt-support__status-dot"></span>Đang trực tuyến</div><div class="mkt-support__channels">'
        + channels.map((item) => '<a class="mkt-support__channel mkt-support__channel--' + item.id + '" href="' + escapeHtml(safeUrl(item.url)) + '" target="_blank" rel="noopener noreferrer"><span class="mkt-support__channel-icon">' + icons[item.id] + '</span><span class="mkt-support__channel-text"><strong>' + escapeHtml(item.label || item.id) + '</strong><span>' + hints[item.id] + '</span></span><span class="mkt-support__arrow" aria-hidden="true">›</span></a>').join('')
        + '</div></section>'
        + '<button class="mkt-support__launcher" type="button" aria-label="Mở hỗ trợ" aria-controls="mkt-support-panel" aria-expanded="false">' + icons.chat + '<span>Hỗ trợ</span></button>';
      document.body.appendChild(root);
      const launcher = root.querySelector('.mkt-support__launcher');
      const close = root.querySelector('.mkt-support__close');
      const setOpen = (open) => { root.classList.toggle('is-open', open); launcher.setAttribute('aria-expanded', String(open)); };
      launcher.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
      close.addEventListener('click', () => { setOpen(false); launcher.focus(); });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && root.classList.contains('is-open')) { setOpen(false); launcher.focus(); } });
      document.addEventListener('click', (event) => { if (root.classList.contains('is-open') && !root.contains(event.target)) setOpen(false); });
    })
    .catch(() => {});
})();
