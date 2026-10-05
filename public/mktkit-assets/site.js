const main = document.querySelector('#main');

const svg = (content, className = '') => `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const icons = {
  pages: svg('<path d="M4 5h16v14H4zM4 9h16M9 5v14"/>'),
  content: svg('<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"/>'),
  campaign: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  ai: svg('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4"/>'),
  team: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 7a3 3 0 0 1 0 6M17 15c2.3.5 4 2.5 4 5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
};

const calendarCells = Array.from({ length: 28 }, (_, i) => `<span class="${i === 17 ? 'selected' : ''}">${i + 1}</span>`).join('');

function appPreview(extraClass = '') {
  const nav = [
    [icons.pages, 'Tổng quan'], [icons.content, 'Nội dung'], [icons.calendar, 'Chiến dịch'],
    [icons.ai, 'AI sáng tạo'], [icons.pages, 'Quản lý Pages'],
  ];
  return `<div class="product-frame ${extraClass}" aria-label="Bản xem trước giao diện MKT Tools">
    <div class="frame-top"><i></i><i></i><i></i></div>
    <div class="app-preview">
      <aside class="app-sidebar">
        <div class="app-logo"><b>M</b>MKT Tools</div>
        ${nav.map(([icon, label], index) => `<div class="app-nav ${index === 0 ? 'active' : ''}">${icon}${label}</div>`).join('')}
        <div class="app-divider"></div>
        <div class="app-nav">${icons.team}Tổ chức</div>
      </aside>
      <div class="app-main">
        <div class="app-toolbar"><div><h3>Tổng quan</h3><p>Theo dõi hoạt động nội dung của các Pages</p></div><span class="app-filter">Tất cả Pages</span></div>
        <div class="app-metrics">
          <div class="app-metric"><small>Nội dung</small><strong>-</strong></div>
          <div class="app-metric"><small>Chờ duyệt</small><strong>-</strong></div>
          <div class="app-metric"><small>Đã lên lịch</small><strong>-</strong></div>
        </div>
        <div class="app-board">
          <div class="app-panel"><div class="app-panel-title">Nội dung gần đây</div>
            <div class="app-row"><i></i><span>Nội dung sản phẩm</span><em>Đã duyệt</em></div>
            <div class="app-row"><i></i><span>Bài viết chiến dịch</span><em>Đã duyệt</em></div>
            <div class="app-row"><i></i><span>Nội dung thương hiệu</span><em>Đã duyệt</em></div>
            <div class="app-row"><i></i><span>Bài đăng theo lịch</span><em>Đã duyệt</em></div>
          </div>
          <div class="app-panel"><div class="app-panel-title">Lịch xuất bản</div><div class="mini-calendar">${calendarCells}</div></div>
        </div>
      </div>
    </div>
  </div>`;
}

const capabilityData = [
  ['pages', 'Quản lý Pages', 'Kết nối và quản lý nhiều Facebook Page trong một nơi.'],
  ['content', 'Tạo và quản lý Content', 'Lên ý tưởng, tạo nội dung và duyệt bài dễ dàng.'],
  ['calendar', 'Lên lịch & xuất bản', 'Đăng bài đúng thời điểm trên đúng Page.'],
  ['campaign', 'Campaigns', 'Lập kế hoạch và theo dõi nội dung theo chiến dịch.'],
  ['ai', 'AI hỗ trợ sáng tạo', 'Viết nội dung và gợi ý ý tưởng bằng AI.'],
  ['team', 'Team & Organization', 'Quản lý thành viên và phân quyền linh hoạt.'],
];

function capabilityStrip() {
  return `<section class="capability-strip"><div class="container capability-grid">${capabilityData.map(([icon, title, copy]) => `
    <article class="capability"><div class="capability-icon">${icons[icon]}</div><h2>${title}</h2><p>${copy}</p></article>`).join('')}</div></section>`;
}

function finalCta() {
  return `<section class="section-blue"><div class="container final-cta"><div><h2>Bắt đầu vận hành marketing gọn hơn</h2><p>Đưa Pages và nội dung về một quy trình rõ ràng.</p></div><a class="button button-primary" href="https://autopost.mktkit.com/register">Dùng thử miễn phí</a></div></section>`;
}

function workflow() {
  return `<section class="section section-blue" id="workflow"><div class="container">
    <div class="section-heading"><h2>Từ ý tưởng đến bài đăng</h2><p>Bốn bước nối liền kế hoạch và xuất bản.</p></div>
    <div class="workflow-steps workflow-four">
      <article class="workflow-step"><span class="step-number">01</span><h3>Kết nối Pages</h3><p>Thêm Pages cần quản lý.</p></article>
      <article class="workflow-step"><span class="step-number">02</span><h3>Tạo nội dung</h3><p>Soạn mới, nhập kế hoạch hoặc dùng AI.</p></article>
      <article class="workflow-step"><span class="step-number">03</span><h3>Duyệt & lên lịch</h3><p>Kiểm tra nội dung và chọn thời điểm đăng.</p></article>
      <article class="workflow-step"><span class="step-number">04</span><h3>Xuất bản</h3><p>Đăng đúng nội dung lên đúng Page.</p></article>
    </div>
  </div></section>`;
}

function homePage() {
  return `<section class="hero"><div class="container hero-grid">
    <div class="hero-copy"><p class="eyebrow">MKT Tools</p><h1>Quản lý Pages, Content và Campaigns trong một nơi</h1><p class="hero-description">Một workspace để tạo, duyệt, lên lịch và xuất bản nội dung cho nhiều Facebook Pages, với AI hỗ trợ khi cần.</p>
      <div class="hero-actions"><a class="button button-primary" href="https://autopost.mktkit.com/register">Dùng thử miễn phí</a><a class="button" href="#workflow">Xem cách hoạt động</a></div>
    </div>${appPreview('hero-frame')}
  </div></section>
  <section class="trial-band"><div class="container trial-inner"><div><p class="eyebrow">Dùng thử MKT Tools</p><h2>Bắt đầu với quy trình thật của đội ngũ</h2><p>Tạo tài khoản và dùng thử theo chính sách đang áp dụng.</p></div><div class="trial-facts" id="trial-facts" hidden aria-live="polite"></div><a class="button button-primary" href="https://autopost.mktkit.com/register">Dùng thử miễn phí</a></div></section>
  <section class="section section-compact"><div class="container"><div class="section-heading"><h2>Một nơi cho toàn bộ quy trình nội dung</h2></div><div class="usp-grid"><article><strong>Tập trung công việc</strong><p>Pages, Content, Campaigns và AI trong cùng hệ thống.</p></article><article><strong>Nhiều Facebook Pages</strong><p>Chuyển phạm vi làm việc mà không mất ngữ cảnh.</p></article><article><strong>Trạng thái rõ ràng</strong><p>Tạo → duyệt → lên lịch → xuất bản.</p></article><article><strong>Quyền truy cập</strong><p>Phân phạm vi theo thành viên và tổ chức.</p></article></div></div></section>
  <section class="section showcase"><div class="container"><div class="section-heading"><h2>MKT Tools trong công việc hằng ngày</h2><p>Bốn màn hình chính nối liền toàn bộ quy trình.</p></div></div></section>
  ${featureSection('', 'Quản lý nhiều Facebook Pages', 'Kết nối Pages và gom theo workspace để luôn làm việc trong đúng phạm vi.', ['Chuyển Page nhanh', 'Ngữ cảnh riêng cho từng Page'], tableMock('pages'))}
  ${featureSection('', 'Quản lý Content theo trạng thái', 'Theo dõi bài viết từ lúc tạo đến khi sẵn sàng xuất bản.', ['Tìm và lọc nội dung', 'Duyệt trước khi lên lịch'], tableMock('content'), true)}
  ${featureSection('', 'Campaigns & lịch nội dung', 'Nhóm bài đăng theo chiến dịch và thời gian triển khai.', ['Kế hoạch tập trung', 'Tiến độ dễ theo dõi'], tableMock('campaigns'))}
  ${featureSection('', 'AI hỗ trợ tạo nội dung', 'Dùng nhà cung cấp AI do tổ chức cấu hình ngay trong luồng làm việc.', ['Cấu hình theo tác vụ', 'Giữ ngữ cảnh thương hiệu'], aiMock(), true)}
  ${workflow()}
  <section class="section section-soft"><div class="container"><div class="section-heading"><h2>Phù hợp với đội ngũ của bạn</h2></div><div class="audience-grid"><article class="audience"><h3>Agency</h3><p>Tách công việc theo từng khách hàng.</p></article><article class="audience"><h3>Đội Marketing</h3><p>Cùng tạo và duyệt nội dung.</p></article><article class="audience"><h3>Người quản lý nhiều Pages</h3><p>Theo dõi tất cả từ một nơi.</p></article></div></div></section>
  <section class="section section-soft pricing-slot" id="pricing"><div class="container"><div class="section-heading"><h2>Gói MKT Tools</h2><p>Thông tin giá được lấy từ cấu hình hiện hành.</p></div><div class="plan-row" id="plan-row"></div></div></section>
  <section class="section-compact"><div class="container help-row"><div><h2>Hướng dẫn & hỗ trợ</h2><p>Tìm cách thiết lập hoặc liên hệ khi cần trợ giúp.</p></div><a class="inline-link" href="/guides">Hướng dẫn sử dụng</a><a class="inline-link" href="mailto:support@mktkit.vn">Liên hệ hỗ trợ</a></div></section>
  ${finalCta()}`;
}

function pageHead(eyebrow, title, description, extra = '') {
  return `<header class="page-head"><div class="container"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p>${extra}</div></header>`;
}

function productsPage() {
  return `${pageHead('Sản phẩm', 'Công cụ cho cách marketing vận hành mỗi ngày', `${publicSiteName} phát triển những sản phẩm tập trung, dễ dùng và phù hợp với quy trình thực tế.`)}
  <section class="section"><div class="container catalog-product"><div><span class="catalog-badge">SẢN PHẨM ĐANG HOẠT ĐỘNG</span><h2>MKT Tools</h2><p>Một workspace để quản lý Pages, nội dung, chiến dịch, AI và lịch xuất bản.</p><a class="button button-primary" href="/products/mkt-tools">Khám phá MKT Tools</a></div>${appPreview()}</div></section>${finalCta()}`;
}

function capabilitiesGrid() {
  return `<div class="product-capabilities">${capabilityData.map(([icon, title, copy]) => `<article class="product-capability"><div class="capability-icon">${icons[icon]}</div><h3>${title}</h3><p>${copy}</p></article>`).join('')}</div>`;
}

function tableMock(type) {
  const configs = {
    pages: { title: 'Quản lý Pages & Nhóm', button: '+ Thêm Page', tabs: ['Tất cả Pages', 'Workspace'], rows: [['Page thương hiệu', 'Facebook', 'Đã kết nối'], ['Page sản phẩm', 'Facebook', 'Đã kết nối'], ['Page khu vực', 'Facebook', 'Đã kết nối']] },
    content: { title: 'Content', button: '+ Tạo nội dung', tabs: ['Tất cả', 'Chờ duyệt', 'Đã duyệt'], rows: [['Nội dung giới thiệu sản phẩm', 'Bài viết', 'Đã duyệt'], ['Nội dung chiến dịch', 'Nhiều ảnh', 'Chờ duyệt'], ['Bài đăng theo lịch', 'Bài viết', 'Đã duyệt']] },
    campaigns: { title: 'Campaigns', button: '+ Tạo campaign', tabs: ['Đang chạy', 'Sắp tới', 'Đã kết thúc'], rows: [['Chiến dịch ra mắt', 'Tháng 10', 'Đang chạy'], ['Nội dung thương hiệu', 'Tháng 10', 'Đang chạy'], ['Kế hoạch định kỳ', 'Hàng tuần', 'Đã lên lịch']] },
    organization: { title: 'Tổ chức & Thành viên', button: '+ Mời thành viên', tabs: ['Tổng quan', 'Thành viên & quyền'], rows: [['Chủ sở hữu', 'Owner', 'Toàn bộ'], ['Content team', 'Member', 'Workspace'], ['Agency partner', 'Member', '2 Pages']] },
  };
  const c = configs[type];
  return `<div class="screen-mock"><div class="screen-head"><strong>${c.title}</strong><span class="screen-button">${c.button}</span></div><div class="screen-tabs">${c.tabs.map((tab, index) => `<span class="${index === 0 ? 'active' : ''}">${tab}</span>`).join('')}</div><div class="screen-table"><div class="screen-table-row"><span>Tên</span><span>Phạm vi</span><span>Trạng thái</span></div>${c.rows.map(row => `<div class="screen-table-row"><span class="avatar-row"><i class="avatar">M</i>${row[0]}</span><span>${row[1]}</span><span class="status">${row[2]}</span></div>`).join('')}</div></div>`;
}

function aiMock() {
  return `<div class="screen-mock"><div class="screen-head"><strong>Cài đặt hệ thống</strong><span class="screen-button">Lưu thay đổi</span></div><div class="screen-tabs"><span class="active">Cấu hình AI</span><span>Facebook</span><span>Telegram</span></div><div class="settings-grid"><div class="setting-box"><strong>Tạo văn bản</strong><div class="fake-input">Chọn nhà cung cấp</div></div><div class="setting-box"><strong>Tạo hình ảnh</strong><div class="fake-input">Chọn mô hình</div></div><div class="setting-box"><strong>API credentials</strong><div class="fake-input">Khóa được bảo mật</div></div><div class="setting-box"><strong>Ngữ cảnh thương hiệu</strong><div class="fake-input">Theo từng Page</div></div></div></div>`;
}

function featureSection(eyebrow, title, copy, bullets, mock, reverse = false) {
  return `<section class="section ${reverse ? 'section-soft' : ''}"><div class="container split ${reverse ? 'reverse' : ''}">${reverse ? mock : ''}<div class="split-copy">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h2>${title}</h2><p>${copy}</p><ul class="check-list">${bullets.map(item => `<li>${item}</li>`).join('')}</ul></div>${reverse ? '' : mock}</div></section>`;
}

function productPage() {
  return `<section class="product-hero"><div class="container"><p class="eyebrow">MKT Tools</p><h1>Vận hành nội dung và Pages trong một workspace</h1><p>Quản lý kế hoạch, sản xuất, phê duyệt và xuất bản mà không phải ghép nối nhiều công cụ rời rạc.</p><div class="hero-actions"><a class="button button-primary" href="https://autopost.mktkit.com/register">Bắt đầu miễn phí</a><a class="button" href="/guides">Xem hướng dẫn</a></div></div></section>
  <section class="product-screenshot"><div class="container">${appPreview()}</div></section>
  <section class="section section-soft"><div class="container"><div class="section-heading"><p class="eyebrow">Khả năng cốt lõi</p><h2>Một luồng làm việc từ Page đến bài đăng</h2></div>${capabilitiesGrid()}</div></section>
  ${featureSection('Quản lý Pages', 'Giữ đúng ngữ cảnh cho từng Page', 'Kết nối Pages, gom theo workspace và làm việc trong đúng phạm vi thương hiệu.', ['Quản lý nhiều Pages', 'Workspace theo khách hàng hoặc nhãn hàng', 'Ngữ cảnh riêng cho từng Page'], tableMock('pages'))}
  ${featureSection('Content', 'Tạo, duyệt và theo dõi nội dung', 'Mọi nội dung có trạng thái rõ ràng để người phụ trách biết việc nào cần xử lý.', ['Soạn thủ công hoặc dùng AI', 'Quản lý phiên bản và trạng thái', 'Lên lịch sau khi duyệt'], tableMock('content'), true)}
  ${featureSection('Campaigns', 'Lập kế hoạch theo chiến dịch', 'Nhóm nội dung theo mục tiêu và thời gian để cả đội theo dõi cùng một kế hoạch.', ['Phạm vi Page rõ ràng', 'Tiến độ theo chiến dịch', 'Hỗ trợ nhập kế hoạch'], tableMock('campaigns'))}
  ${featureSection('AI', 'Dùng AI theo cấu hình của tổ chức', 'Kết nối nhà cung cấp phù hợp và sử dụng AI ngay trong quy trình nội dung.', ['Cấu hình theo tác vụ', 'Credentials thuộc tổ chức', 'Giữ ngữ cảnh thương hiệu'], aiMock(), true)}
  ${featureSection('Team & Organization', 'Phân quyền theo công việc thực tế', 'Mỗi thành viên nhìn thấy đúng Pages và workspace cần thiết cho vai trò của mình.', ['Owner và Member', 'Phạm vi theo workspace hoặc Page', 'Theo dõi hoạt động'], tableMock('organization'))}
  ${workflow()}
  <section class="section"><div class="container"><div class="section-heading center"><p class="eyebrow">Phù hợp với</p><h2>Team in-house, agency và người quản lý nhiều Pages</h2></div><div class="audience-grid"><article class="audience"><h3>Agency</h3><p>Chia tách phạm vi theo khách hàng.</p></article><article class="audience"><h3>Đội marketing</h3><p>Phối hợp trên cùng một quy trình.</p></article><article class="audience"><h3>Multi-page operator</h3><p>Quản lý nhiều Pages mà vẫn rõ ngữ cảnh.</p></article></div></div></section>
  <section class="section section-soft pricing-slot" id="pricing"><div class="container"><div class="section-heading"><p class="eyebrow">Gói dịch vụ</p><h2>Chọn gói phù hợp với quy mô đội ngũ</h2></div><div class="plan-row" id="plan-row"></div></div></section>
  <section class="section"><div class="container faq"><div class="section-heading center"><p class="eyebrow">Câu hỏi thường gặp</p><h2>Trước khi bắt đầu</h2></div>
    <details><summary>MKT Tools phù hợp với ai?</summary><p>Sản phẩm phù hợp với đội marketing, agency và người cần vận hành nhiều Facebook Pages.</p></details>
    <details><summary>Có thể phân quyền theo Page không?</summary><p>Có. Thành viên có thể được cấp phạm vi toàn tổ chức, workspace hoặc Pages cụ thể.</p></details>
    <details><summary>MKT Tools có bắt buộc dùng AI không?</summary><p>Không. Bạn có thể tạo nội dung thủ công, nhập kế hoạch hoặc sử dụng AI khi tổ chức đã cấu hình nhà cung cấp.</p></details>
    <details><summary>Tôi có thể bắt đầu từ đâu?</summary><p>Đăng ký tài khoản, tạo tổ chức và làm theo hướng dẫn kết nối Pages.</p></details>
  </div></section>${finalCta()}`;
}

async function fetchJSON(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 404 ? 'not-found' : 'load-failed');
  return response.json();
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

async function blogPage() {
  const { entries } = await fetchJSON('/api/public-content/blog');
  const content = entries.length ? `<div class="post-grid">${entries.map((entry, index) => `<a class="post-card ${index === 0 ? 'featured-post' : ''}" href="/blog/${entry.slug}"><div><span class="post-category">${entry.category || publicSiteName}</span><h2>${entry.title}</h2><p>${entry.description || ''}</p><span class="inline-link">Đọc bài</span><div class="post-meta">${formatDate(entry.date)} · ${entry.readTime} phút đọc</div></div>${index === 0 ? '<div class="featured-visual">M</div>' : ''}</a>`).join('')}</div>` : `<div class="empty-state"><h2>Chưa có bài viết được xuất bản</h2><p>Các bài viết Markdown sẽ xuất hiện tại đây khi được đánh dấu published.</p></div>`;
  return `${pageHead('Tài nguyên', `Blog ${publicSiteName}`, 'Kiến thức thực tế để vận hành marketing tốt hơn.')}<section class="content-shell"><div class="container">${content}</div></section>`;
}

async function guidesPage() {
  const { entries } = await fetchJSON('/api/public-content/guides');
  const list = entries.length ? `<div class="guide-list">${entries.map(entry => `<a class="guide-row" href="/guides/${entry.slug}"><div><h3>${entry.title}</h3><p>${entry.description || ''}</p></div><span class="inline-link">Xem hướng dẫn</span></a>`).join('')}</div>` : `<div class="empty-state"><h2>Chưa có hướng dẫn được xuất bản</h2><p>Các hướng dẫn Markdown sẽ xuất hiện tại đây khi được đánh dấu published.</p></div>`;
  return `${pageHead('MKT Tools', 'Hướng dẫn sử dụng', 'Thiết lập và sử dụng MKT Tools từng bước.')}<section class="content-shell"><div class="container guide-simple">${list}</div></section>`;
}

function tocLinks(toc) {
  return toc.filter(item => item.level === 2).map(item => `<a href="#${item.id}">${item.title}</a>`).join('');
}

async function contentDetail(kind, slug) {
  const entry = await fetchJSON(`/api/public-content/${kind}/${slug}`);
  const isGuide = kind === 'guides';
  const root = isGuide ? '/guides' : '/blog';
  const rootLabel = isGuide ? 'Hướng dẫn' : 'Blog';
  setMetadata(`${entry.title} - ${publicSiteName}`, entry.description || `${rootLabel} ${publicSiteName}.`, { type: 'article' });
  const meta = isGuide ? `Cập nhật lần cuối: ${formatDate(entry.updatedAt || entry.updated)}` : `${formatDate(entry.date)}${entry.category ? ` · ${entry.category}` : ''} · ${entry.readTime} phút đọc`;
  const header = `<div class="article-header"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">${publicSiteName}</a><span><a href="${root}">${rootLabel}</a></span></nav><h1>${entry.title}</h1>${entry.description ? `<p class="article-intro">${entry.description}</p>` : ''}<div class="article-meta">${meta}</div></div>`;
  if (isGuide) return `<div class="article-wrap guide"><aside class="article-toc"><strong>Trong hướng dẫn này</strong>${tocLinks(entry.toc)}</aside><article>${header}<div class="article-body">${entry.html}</div></article></div>`;
  return `<article class="article-wrap">${header}<div class="article-body">${entry.html}</div><div class="article-cta"><h2>Tiếp tục với MKT Tools</h2><p>Xem hướng dẫn thiết lập và đưa quy trình nội dung vào hoạt động.</p><a class="button button-primary" href="/guides">Xem hướng dẫn</a></div></article>`;
}

function supportPage() {
  return `${pageHead(publicSiteName, `Hỗ trợ ${publicSiteName}`, 'Tìm hướng dẫn hoặc liên hệ trực tiếp với đội ngũ hỗ trợ.')}
  <section class="section-compact"><div class="container support-simple">
    <a class="support-row" href="/guides"><div><h2>Hướng dẫn sử dụng</h2><p>Thiết lập và sử dụng MKT Tools từng bước.</p></div><span class="inline-link">Xem hướng dẫn</span></a>
    <a class="support-row" href="mailto:support@mktkit.vn"><div><h2>Liên hệ hỗ trợ</h2><p>support@mktkit.vn</p></div><span class="inline-link">Gửi email</span></a>
    <a class="support-row" href="/legal/data-deletion"><div><h2>Xóa dữ liệu</h2><p>Quy trình yêu cầu xóa tài khoản và dữ liệu.</p></div><span class="inline-link">Xem hướng dẫn</span></a>
    <div class="support-row"><div><h2>Chính sách & điều khoản</h2><p>Thông tin pháp lý khi sử dụng ${publicSiteName}.</p></div><div class="support-legal"><a href="/legal/privacy">Bảo mật</a><a href="/legal/terms">Điều khoản</a></div></div>
  </div></section>`;
}

async function legalPage(slug) {
  const entry = await fetchJSON(`/api/public-content/legal/${slug}`);
  return `<div class="legal-layout"><aside class="article-toc"><strong>Mục lục</strong>${tocLinks(entry.toc)}</aside><article class="legal-content"><h1>${entry.title}</h1><div class="article-meta">Cập nhật lần cuối: ${formatDate(entry.updated)}</div><p class="article-intro">${entry.description || ''}</p><div class="article-body">${entry.html}</div></article></div>`;
}

function notFound(type = 'Trang') {
  return `<section class="not-found"><div><p class="eyebrow">404</p><h1>${type} không tồn tại</h1><p>Nội dung có thể đã được chuyển hoặc chưa được xuất bản.</p><a class="button button-primary" href="/">Về trang chủ</a></div></section>`;
}

const publicSeo = (() => {
  try { return JSON.parse(document.querySelector('#public-seo-config')?.textContent || '{}'); }
  catch { return {}; }
})();
const publicSiteName = publicSeo.siteName || 'MKTKit';
document.querySelectorAll('[data-public-site-name]').forEach(element => { element.textContent = publicSiteName; });

function setMetadata(title, description, options = {}) {
  document.title = title;
  document.querySelector('meta[name="description"]').setAttribute('content', description);
  document.querySelector('meta[property="og:title"]').setAttribute('content', title);
  document.querySelector('meta[property="og:description"]').setAttribute('content', description);
  const canonical = `${(publicSeo.canonicalBaseUrl || location.origin).replace(/\/$/, '')}${location.pathname}`;
  document.querySelector('link[rel="canonical"]').setAttribute('href', canonical);
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical);
  document.querySelector('meta[property="og:type"]')?.setAttribute('content', options.type || 'website');
  document.querySelector('meta[name="robots"]')?.setAttribute('content', options.noindex || !publicSeo.allowIndexing ? 'noindex, nofollow' : 'index, follow');
}

async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  let html;
  try {
    if (path === '/') { setMetadata(`${publicSiteName} - Công cụ giúp marketing vận hành gọn hơn`, `${publicSiteName} giúp đội ngũ quản lý Pages, nội dung, chiến dịch và lịch xuất bản trong một nơi.`); html = homePage(); }
    else if (path === '/products') { setMetadata(`Sản phẩm - ${publicSiteName}`, 'Khám phá MKT Tools, sản phẩm vận hành nội dung và Pages của website.'); html = productsPage(); }
    else if (path === '/products/mkt-tools') { setMetadata('MKT Tools - Quản lý Pages, Content, Campaigns & AI', 'Một workspace để quản lý Pages, Content, Campaigns, AI và lịch xuất bản.'); html = productPage(); }
    else if (path === '/blog') { setMetadata(`Blog ${publicSiteName}`, 'Kiến thức thực tế để vận hành marketing tốt hơn.'); html = await blogPage(); }
    else if (parts[0] === 'blog' && parts[1]) { html = await contentDetail('blog', parts[1]); }
    else if (path === '/guides') { setMetadata(`Hướng dẫn sử dụng MKT Tools - ${publicSiteName}`, 'Thiết lập và sử dụng MKT Tools từng bước.'); html = await guidesPage(); }
    else if (parts[0] === 'guides' && parts[1]) { html = await contentDetail('guides', parts[1]); }
    else if (path === '/support') { setMetadata(`Hỗ trợ ${publicSiteName}`, 'Tìm hướng dẫn và liên hệ hỗ trợ.'); html = supportPage(); }
    else if (path === '/legal/terms') { setMetadata(`Điều khoản sử dụng - ${publicSiteName}`, 'Điều khoản áp dụng khi sử dụng website.'); html = await legalPage('terms'); }
    else if (path === '/legal/privacy') { setMetadata(`Chính sách bảo mật - ${publicSiteName}`, 'Cách website xử lý và bảo vệ thông tin.'); html = await legalPage('privacy'); }
    else if (path === '/legal/data-deletion') { setMetadata(`Xóa dữ liệu - ${publicSiteName}`, 'Hướng dẫn yêu cầu xóa tài khoản và dữ liệu.'); html = await legalPage('data-deletion'); }
    else if (path === '/legal/data-deletion/mkt-tools') { setMetadata(`Xóa dữ liệu MKT Tools - ${publicSiteName}`, 'Quy trình yêu cầu xóa dữ liệu MKT Tools.'); html = await legalPage('mkt-tools-data-deletion'); }
    else { setMetadata(`Trang không tồn tại - ${publicSiteName}`, 'Trang bạn tìm kiếm không tồn tại.', { noindex: true }); html = notFound(); }
  } catch (error) {
    if (error.message === 'not-found') {
      const type = parts[0] === 'guides' ? 'Hướng dẫn' : 'Bài viết';
      setMetadata(`${type} không tồn tại - ${publicSiteName}`, 'Nội dung không tồn tại hoặc chưa được xuất bản.', { noindex: true });
      html = notFound(type);
    } else {
      setMetadata(`Không thể tải nội dung - ${publicSiteName}`, 'Nội dung tạm thời không thể tải.', { noindex: true });
      html = `<section class="not-found"><div><h1>Không thể tải nội dung</h1><p>Vui lòng thử lại sau.</p><a class="button" href="${path}">Tải lại</a></div></section>`;
    }
  }
  main.innerHTML = html;
  const section = parts[0] || '';
  document.querySelector(`[data-section="${section}"]`)?.setAttribute('aria-current', 'page');
  bindPageInteractions();
  if (path === '/' || path === '/products/mkt-tools') loadPlans();
}

function bindPageInteractions() {
  const search = document.querySelector('#guide-search');
  if (search) search.addEventListener('input', (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll('[data-guide]').forEach(row => { row.hidden = !row.dataset.search.includes(query); });
    document.querySelectorAll('[data-category]').forEach(group => { group.hidden = !group.querySelector('[data-guide]:not([hidden])'); });
  });
}

async function loadPlans() {
  try {
    const response = await fetch('/api/billing/plans');
    if (!response.ok) return;
    const data = await response.json();
    const plans = Array.isArray(data) ? data : data.plans;
    if (!Array.isArray(plans) || !plans.length) return;
    const row = document.querySelector('#plan-row');
    row.innerHTML = plans.filter(plan => plan.active !== false).map(plan => {
      const limits = [plan.maxPages == null ? 'Không giới hạn Pages' : `${plan.maxPages} Pages`, plan.maxMembers == null ? 'Không giới hạn thành viên' : `${plan.maxMembers} thành viên`].join(' · ');
      const price = Array.isArray(plan.prices) ? plan.prices.find(item => item.amount != null) : null;
      const priceText = price ? ` · ${new Intl.NumberFormat('vi-VN').format(price.amount)} ${price.currency || 'VND'} / ${price.billingMonths} tháng` : '';
      return `<div class="plan-chip"><strong>${plan.name}</strong><span>${limits}${priceText}</span></div>`;
    }).join('');
    if (row.children.length) document.querySelector('#pricing').classList.add('visible');
  } catch { /* Pricing stays hidden when no public pricing data is available. */ }
}

const menu = document.querySelector('.menu-button');
const nav = document.querySelector('.primary-nav');
menu.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') === 'true';
  menu.setAttribute('aria-expanded', String(!open));
  nav.classList.toggle('open', !open);
});

render();
