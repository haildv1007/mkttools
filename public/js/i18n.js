(function () {
  'use strict';

  const STORAGE_KEY = 'mkt_locale';
  const SUPPORTED = ['vi', 'en'];
  const translations = {
    en: {
      'Đi tới nội dung chính': 'Skip to main content',
      'Trang chủ': 'Home',
      'Sản phẩm': 'Products',
      'Hướng dẫn': 'Guides',
      'Hướng dẫn sử dụng': 'User guides',
      'Hỗ trợ': 'Support',
      'Đăng nhập': 'Log in',
      'Đăng ký': 'Sign up',
      'Đăng xuất': 'Log out',
      'Bắt đầu miễn phí': 'Get started free',
      'Dùng thử miễn phí': 'Start free trial',
      'Xem cách hoạt động': 'See how it works',
      'Đang tải nội dung…': 'Loading content…',
      'Đang tải...': 'Loading...',
      'Đang xử lý...': 'Processing...',
      'Đang xác minh...': 'Verifying...',
      'Đang đăng nhập...': 'Signing in...',
      'Bộ công cụ giúp đội ngũ marketing vận hành nhẹ hơn.': 'Tools that make marketing operations simpler.',
      'Tài nguyên': 'Resources',
      'Pháp lý': 'Legal',
      'Điều khoản sử dụng': 'Terms of Service',
      'Chính sách bảo mật': 'Privacy Policy',
      'Xóa dữ liệu': 'Data Deletion',
      'MKT Tools là sản phẩm của': 'MKT Tools is a product of',
      'Quản lý Pages, Content và Campaigns trong một nơi': 'Manage Pages, Content, and Campaigns in one place',
      'Một workspace để tạo, duyệt, lên lịch và xuất bản nội dung cho nhiều Facebook Pages, với AI hỗ trợ khi cần.': 'One workspace to create, review, schedule, and publish content across multiple Facebook Pages, with AI when you need it.',
      'Dùng thử MKT Tools': 'Try MKT Tools',
      'Bắt đầu với quy trình thật của đội ngũ': "Start with your team's real workflow",
      'Tạo tài khoản và dùng thử theo chính sách đang áp dụng.': 'Create an account and start your trial under the current offer.',
      'Một nơi cho toàn bộ quy trình nội dung': 'One place for your entire content workflow',
      'Tập trung công việc': 'Centralize your work',
      'Pages, Content, Campaigns và AI trong cùng hệ thống.': 'Pages, Content, Campaigns, and AI in one system.',
      'Nhiều Facebook Pages': 'Multiple Facebook Pages',
      'Chuyển phạm vi làm việc mà không mất ngữ cảnh.': 'Switch workspaces without losing context.',
      'Trạng thái rõ ràng': 'Clear statuses',
      'Tạo → duyệt → lên lịch → xuất bản.': 'Create → review → schedule → publish.',
      'Quyền truy cập': 'Access control',
      'Phân phạm vi theo thành viên và tổ chức.': 'Set access by member and organization.',
      'MKT Tools trong công việc hằng ngày': 'MKT Tools in your daily workflow',
      'Bốn màn hình chính nối liền toàn bộ quy trình.': 'Four core screens connect the entire workflow.',
      'Quản lý nhiều Facebook Pages': 'Manage multiple Facebook Pages',
      'Kết nối Pages và gom theo workspace để luôn làm việc trong đúng phạm vi.': 'Connect Pages and group them into workspaces so you always work in the right context.',
      'Chuyển Page nhanh': 'Switch Pages quickly',
      'Ngữ cảnh riêng cho từng Page': 'Dedicated context for each Page',
      'Quản lý Content theo trạng thái': 'Manage Content by status',
      'Theo dõi bài viết từ lúc tạo đến khi sẵn sàng xuất bản.': 'Track posts from creation until they are ready to publish.',
      'Tìm và lọc nội dung': 'Search and filter content',
      'Duyệt trước khi lên lịch': 'Review before scheduling',
      'Campaigns & lịch nội dung': 'Campaigns & content calendar',
      'Nhóm bài đăng theo chiến dịch và thời gian triển khai.': 'Group posts by campaign and delivery timeline.',
      'Kế hoạch tập trung': 'Centralized planning',
      'Tiến độ dễ theo dõi': 'Easy-to-track progress',
      'AI hỗ trợ tạo nội dung': 'AI-assisted content creation',
      'Dùng nhà cung cấp AI do tổ chức cấu hình ngay trong luồng làm việc.': "Use your organization's configured AI provider directly in the workflow.",
      'Cấu hình theo tác vụ': 'Configure by task',
      'Giữ ngữ cảnh thương hiệu': 'Preserve brand context',
      'Từ ý tưởng đến bài đăng': 'From idea to published post',
      'Bốn bước nối liền kế hoạch và xuất bản.': 'Four steps connect planning and publishing.',
      'Kết nối Pages': 'Connect Pages',
      'Thêm Pages cần quản lý.': 'Add the Pages you need to manage.',
      'Tạo nội dung': 'Create content',
      'Soạn mới, nhập kế hoạch hoặc dùng AI.': 'Write from scratch, import a plan, or use AI.',
      'Duyệt & lên lịch': 'Review & schedule',
      'Kiểm tra nội dung và chọn thời điểm đăng.': 'Review content and choose when to publish.',
      'Xuất bản': 'Publish',
      'Đăng đúng nội dung lên đúng Page.': 'Publish the right content to the right Page.',
      'Phù hợp với đội ngũ của bạn': 'Built for your team',
      'Đội Marketing': 'Marketing teams',
      'Đội marketing': 'Marketing teams',
      'Cùng tạo và duyệt nội dung.': 'Create and review content together.',
      'Người quản lý nhiều Pages': 'Multi-Page managers',
      'Theo dõi tất cả từ một nơi.': 'Manage everything from one place.',
      'Tách công việc theo từng khách hàng.': 'Separate work by client.',
      'Gói MKT Tools': 'MKT Tools plans',
      'Gói & thanh toán': 'Plans & billing',
      'Gói & thanh toán - MKT Tools': 'Plans & billing - MKT Tools',
      'Thông tin giá được lấy từ cấu hình hiện hành.': 'Pricing reflects the current configuration.',
      'Hướng dẫn & hỗ trợ': 'Guides & support',
      'Tìm cách thiết lập hoặc liên hệ khi cần trợ giúp.': 'Find setup instructions or contact us when you need help.',
      'Liên hệ hỗ trợ': 'Contact support',
      'Bắt đầu vận hành marketing gọn hơn': 'Run leaner marketing operations',
      'Đưa Pages và nội dung về một quy trình rõ ràng.': 'Bring Pages and content into one clear workflow.',

      'Phạm vi làm việc': 'Work scope',
      'Tìm kiếm...': 'Search...',
      'Tất cả Pages': 'All Pages',
      'Page đơn': 'Individual Pages',
      'Tạo Workspace': 'Create Workspace',
      'Vận hành': 'Operations',
      'Tổng quan': 'Overview',
      'Quản trị': 'Administration',
      'Quản lý Pages': 'Manage Pages',
      'Tổ chức & Gói': 'Organization & Plan',
      'Cài đặt hệ thống': 'System Settings',
      'Hoạt động': 'Activity',
      'Tài khoản': 'Account',
      'Sửa': 'Edit',
      'Lưu': 'Save',
      'Lưu thay đổi': 'Save changes',
      'Hủy': 'Cancel',
      'Đóng': 'Close',
      'Xóa': 'Delete',
      'Xác nhận': 'Confirm',
      'Tiếp tục': 'Continue',
      'Quay lại': 'Back',
      'Làm mới': 'Refresh',
      'Thử lại': 'Try again',
      'Tổ chức': 'Organization',
      'Thành viên': 'Members',
      'Vai trò': 'Role',
      'Trạng thái': 'Status',
      'Tên': 'Name',
      'Phạm vi': 'Scope',
      'Mô tả': 'Description',
      'Hành động': 'Actions',
      'Tất cả': 'All',
      'Hôm nay': 'Today',
      'Chưa có dữ liệu': 'No data yet',
      'Không có dữ liệu': 'No data',
      'Đã kết nối': 'Connected',
      'Chưa kết nối': 'Not connected',
      'Đang hoạt động': 'Active',
      'Đã duyệt': 'Approved',
      'Chờ duyệt': 'Pending review',
      'Đã lên lịch': 'Scheduled',
      'Đã xuất bản': 'Published',
      'Bản nháp': 'Draft',
      'Thất bại': 'Failed',
      'Đã hủy': 'Cancelled',
      'Sắp tới': 'Upcoming',
      'Đã kết thúc': 'Completed',
      'Đang chạy': 'Running',
      'Tạo mới': 'Create new',
      'Thêm Page': 'Add Page',
      'Tạo campaign': 'Create campaign',
      'Tạo Campaign': 'Create Campaign',
      'Chiến dịch': 'Campaign',
      'Nội dung': 'Content',
      'Lịch xuất bản': 'Publishing calendar',
      'Nội dung gần đây': 'Recent content',
      'Xem tất cả': 'View all',
      'Bộ lọc': 'Filters',
      'Áp dụng': 'Apply',
      'Đặt lại': 'Reset',

      'Bạn được mời tham gia': "You've been invited to join",
      'Email được mời:': 'Invited email:',
      'Mật khẩu': 'Password',
      'Họ tên': 'Full name',
      'Mật khẩu (≥ 8 ký tự, có chữ và số)': 'Password (8+ characters, letters and numbers)',
      'Xác nhận mật khẩu': 'Confirm password',
      'Mật khẩu mới': 'New password',
      'Mật khẩu hiện tại': 'Current password',
      'Tạo tài khoản': 'Create an account',
      'Quên mật khẩu?': 'Forgot password?',
      'Quên mật khẩu': 'Forgot password',
      'hoặc': 'or',
      'Tiếp tục với Google': 'Continue with Google',
      'Chưa có tài khoản?': "Don't have an account?",
      'Đã có tài khoản?': 'Already have an account?',
      'Tôi đồng ý Điều khoản sử dụng và Chính sách bảo mật.': 'I agree to the Terms of Service and Privacy Policy.',
      'Gửi liên kết đặt lại': 'Send reset link',
      'Quay lại đăng nhập': 'Back to login',
      'Đặt lại mật khẩu': 'Reset password',
      'Về đăng nhập': 'Back to login',
      'Tạo không gian làm việc': 'Create your workspace',
      'Bạn có lời mời đang chờ. Hãy mở liên kết mời trong email, hoặc tạo không gian riêng bên dưới.': 'You have a pending invitation. Open the link in your email, or create your own workspace below.',
      'Tên Organization / doanh nghiệp / team (vd: MKT Agency)': 'Organization / company / team name (e.g. MKT Agency)',
      'Bắt đầu': 'Get started',
      'Đăng nhập hoặc tạo tài khoản bằng email được mời để tham gia.': 'Log in or create an account with the invited email to join.',
      'Chấp nhận lời mời': 'Accept invitation',
      'Bạn cần xác minh email trước khi tham gia.': 'You need to verify your email before joining.',
      'Gửi lại email xác minh': 'Resend verification email',
      'Dùng tài khoản khác': 'Use another account',
      'Đăng nhập Google không thành công. Vui lòng thử lại.': 'Google sign-in failed. Please try again.',
      'Email của tài khoản Google chưa được xác minh.': 'The Google account email has not been verified.',
      'Đăng nhập Google hiện chưa khả dụng.': 'Google sign-in is currently unavailable.',
      'Tài khoản đã bị vô hiệu hóa.': 'This account has been disabled.',
      'Đã có lỗi xảy ra. Vui lòng thử lại.': 'Something went wrong. Please try again.',
      'Đăng nhập không thành công.': 'Sign-in failed.',
      'Mật khẩu xác nhận không khớp.': 'Passwords do not match.',
      'Bạn cần đồng ý Điều khoản / Chính sách.': 'You must agree to the Terms and Privacy Policy.',
      'Đã đặt lại mật khẩu. Bạn có thể đăng nhập.': 'Your password has been reset. You can now log in.',
      'Email đã được xác minh.': 'Email verified.',
      'Không thể chấp nhận lời mời.': 'Unable to accept the invitation.',
      'Đã gửi lại email xác minh.': 'Verification email sent again.',
      'Không tìm thấy lời mời.': 'Invitation not found.',
      'Lời mời đã hết hạn hoặc không còn hiệu lực.': 'This invitation has expired or is no longer valid.',
      'Không thể tải giao diện. Vui lòng tải lại trang.': 'Unable to load the interface. Please reload the page.',
      'Đã sao chép': 'Copied',
      'Có lỗi xảy ra': 'An error occurred',
      'Không thể tải dữ liệu': 'Unable to load data'
    }
  };

  Object.assign(translations.en, {
    'AI tạo nội dung': 'AI content generation',
    'Ẩn cột': 'Hide columns', 'Ẩn kết quả': 'Hide results', 'Hiện kết quả': 'Show results',
    'Ảnh': 'Image', 'Bài đăng': 'Post', 'Bài viết': 'Post', 'Bài viết / Caption': 'Post / Caption',
    'Bài tiếp': 'Next post', 'Bài trước': 'Previous post', 'Bản gốc': 'Original',
    'Bạn không có quyền truy cập': "You don't have access", 'Bảo vệ dữ liệu theo phạm vi tổ chức': 'Organization-scoped data protection',
    'Cần xử lý': 'Needs attention', 'Cập nhật mật khẩu': 'Update password', 'Caption bài đăng': 'Post caption',
    'Cấu hình': 'Configuration', 'Cấu hình AI': 'AI configuration', 'Cấu hình các dịch vụ và tích hợp cho tổ chức hiện tại': 'Configure services and integrations for the current organization',
    'Cấu hình các thiết lập chung của tổ chức': 'Configure general organization settings', 'Cấu hình Facebook App': 'Facebook App configuration',
    'Cấu hình Telegram Bot': 'Telegram Bot configuration', 'Chấp nhận': 'Accept', 'Chat duyệt nội dung': 'Content review chat',
    'Chỉ Owner của tổ chức có thể quản lý cài đặt hệ thống.': 'Only the organization Owner can manage system settings.',
    'Chi tiết Content': 'Content details', 'Chi tiết đơn hàng': 'Order details', 'Chi tiết lỗi': 'Error details', 'Chỉnh sửa': 'Edit',
    'Chờ đến lượt': 'Queued', 'Chọn ảnh:': 'Choose images:', 'Chọn các Page bạn muốn thêm vào MKT Tools': 'Choose the Pages you want to add to MKT Tools',
    'Chọn gói': 'Choose plan', 'Chọn model': 'Choose model', 'Chọn page': 'Choose Page', 'Chọn Page trước để lọc Campaign': 'Choose a Page to filter Campaigns',
    'Chọn Pages': 'Choose Pages', 'Chủ đề': 'Topic', 'Chủ đề / tiêu đề content': 'Content topic / title', 'Chu kỳ': 'Billing cycle',
    'Chủ tài khoản': 'Account owner', 'Chưa có': 'None', 'Chưa có campaign nào.': 'No campaigns yet.', 'Chưa có content nào.': 'No content yet.',
    'Chưa có dữ liệu hiệu suất': 'No performance data yet', 'Chưa có hoạt động nào': 'No activity yet', 'Chưa có lịch sử thanh toán.': 'No billing history yet.',
    'Chưa có media': 'No media', 'Chưa có page nào': 'No Pages yet', 'Chưa có Page nào được kết nối': 'No Pages connected yet',
    'Chưa có thành viên.': 'No members yet.', 'Chưa có workspace.': 'No workspaces yet.', 'Chuyển khoản ngân hàng': 'Bank transfer',
    'Cột': 'Column', 'Đã cấu hình': 'Configured', 'Đã hết hạn': 'Expired', 'Đã thanh toán': 'Paid', 'Đăng': 'Publish',
    'Đang chờ thanh toán': 'Awaiting payment', 'Đang chờ thanh toán...': 'Awaiting payment...', 'Đang chọn': 'Selecting',
    'Đang kết nối Pages...': 'Connecting Pages...', 'Đang kết nối...': 'Connecting...', 'Đang lưu...': 'Saving...', 'Đăng ngay': 'Publish now',
    'Đang tải Campaign...': 'Loading Campaign...', 'Đang tải danh sách Pages...': 'Loading Pages...', 'Đang thực hiện': 'In progress', 'Đang tinh chỉnh...': 'Refining...',
    'Danh sách thành viên': 'Member list', 'Để sau': 'Not now', 'Để sau / Hoàn tất': 'Later / Finish', 'Đến': 'To',
    'Đi tới Cài đặt hệ thống': 'Go to System Settings', 'Đổi file': 'Change file', 'Đơn giá': 'Unit price', 'Đơn hàng của bạn': 'Your order',
    'Đơn hàng đã được thanh toán thành công.': 'Your order has been paid successfully.', 'Đơn thanh toán đã hết hạn': 'Payment order expired',
    'Đồng bộ từ Google Sheets': 'Sync from Google Sheets', 'Dữ liệu hiệu suất từ Facebook': 'Performance data from Facebook',
    'Dữ liệu sẽ có sau khi content được đăng lên Facebook.': 'Data will be available after content is published to Facebook.',
    'DÙNG THỬ': 'TRIAL', 'Dùng thử đã hết hạn': 'Trial expired', 'Duyệt': 'Approve', 'Email chưa được xác minh.': 'Email has not been verified.',
    'Gen lại': 'Regenerate', 'Gen lại nội dung': 'Regenerate content', 'Gen nội dung': 'Generate content', 'Ghi chú': 'Notes',
    'Ghi chú / Yêu cầu cho AI': 'Notes / AI instructions', 'Giờ đăng': 'Publish time', 'Giới hạn': 'Limits', 'Giới hạn phạm vi': 'Scope limits',
    'Giới hạn tài nguyên': 'Resource limits', 'Gỡ file': 'Remove file', 'Gói': 'Plan', 'Gói dịch vụ & Giới hạn': 'Plan & limits',
    'Gói hiện tại': 'Current plan', 'Gửi lời mời': 'Send invitation', 'Hết hạn': 'Expired', 'Hiện tại': 'Current',
    'Hiệu suất Campaign': 'Campaign performance', 'Hiệu suất Page': 'Page performance', 'Hiệu suất theo thời gian': 'Performance over time',
    'Hoàn tất': 'Finish', 'Hoàn tất thanh toán': 'Complete payment', 'Hoạt động': 'Activity', 'Hướng dẫn cho AI': 'AI instructions',
    'Hướng dẫn cột trong file Excel': 'Excel column guide', 'Hướng dẫn lấy Chat ID': 'How to get a Chat ID',
    'Import thành công!': 'Import successful!', 'Kéo thả hoặc click để chọn ảnh (chọn nhiều)': 'Drag and drop or click to select images (multiple)',
    'Kéo thả video hoặc click để chọn': 'Drag and drop a video or click to select', 'Kết nối bằng Access Token': 'Connect with Access Token',
    'Kết nối Facebook': 'Connect Facebook', 'Kết nối Facebook Page': 'Connect Facebook Page', 'Kết nối Facebook Pages': 'Connect Facebook Pages',
    'Kết nối Page để bắt đầu tạo và đăng nội dung. Bạn có thể làm sau.': 'Connect a Page to start creating and publishing content. You can do this later.',
    'Không có': 'None', 'Không có lịch': 'No schedule', 'Không có lịch sử': 'No history', 'Không có lời mời đang chờ.': 'No pending invitations.',
    'Không có nội dung đang xử lý': 'No content in progress', 'Không thể chỉnh sửa': 'Cannot edit', 'Không thể tải chi tiết nội dung.': 'Unable to load content details.',
    'Không tìm thấy Page phù hợp': 'No matching Page found', 'Không tìm thấy Page phù hợp.': 'No matching Page found.', 'Kiểm tra': 'Check',
    'Lịch đăng': 'Publishing schedule', 'Lịch sử thanh toán': 'Billing history', 'Liên hệ để nhận báo giá': 'Contact us for pricing', 'Liên hệ nâng cấp': 'Contact us to upgrade',
    'Link ảnh / Link video': 'Image URL / Video URL', 'Loại': 'Type', 'Loại content': 'Content type', 'Lọc cột này': 'Filter this column', 'Lỗi': 'Error',
    'Lời mời đang chờ': 'Pending invitations', 'Lượt xem': 'Views', 'Lưu quyền': 'Save permissions', 'Lưu View': 'Save view', 'Lưu ý': 'Note',
    'Mã đơn': 'Order ID', 'Mặc định 09:00': 'Default 09:00', 'Mở': 'Open', 'Mô tả (tùy chọn)': 'Description (optional)',
    'Mô tả ảnh': 'Image description', 'Mô tả ảnh (AI gen)': 'Image description (AI generated)', 'Mời thành viên': 'Invite member',
    'Múi giờ': 'Time zone', 'Múi giờ được sử dụng cho lịch đăng và hiển thị thời gian trong tổ chức.': 'The time zone is used for scheduling and displaying times in the organization.',
    'Múi giờ mặc định': 'Default time zone', 'Nâng cấp gói': 'Upgrade plan', 'Nâng cấp hoặc gia hạn': 'Upgrade or renew',
    'Ngân hàng': 'Bank', 'Ngày': 'Date', 'Ngày bắt đầu': 'Start date', 'Ngày đăng': 'Publish date', 'Ngày kết thúc': 'End date',
    'Ngày tạo': 'Created date', 'Ngày tham gia': 'Join date', 'Ngày thanh toán': 'Payment date', 'Người xem': 'Viewer', 'Nguồn': 'Source',
    'Nhà cung cấp': 'Provider', 'Nhập content từ file Excel': 'Import content from Excel', 'Nhập URL': 'Enter URL',
    'Nội dung chuyển khoản:': 'Transfer reference:', 'Nội dung CK': 'Transfer reference', 'Nội dung có sẵn': 'Existing content',
    'Pages đã chọn': 'Selected Pages', 'Pages được cấp riêng': 'Individually assigned Pages', 'Phạm vi truy cập': 'Access scope', 'Phiên bản': 'Version',
    'Quản lý API key cho các dịch vụ AI': 'Manage API keys for AI services', 'Quản lý các Facebook Page đang kết nối với tổ chức': "Manage the organization's connected Facebook Pages",
    'Quản lý Pages & Nhóm': 'Manage Pages & Groups', 'Quản lý quyền': 'Manage permissions', 'Quản lý quyền truy cập': 'Manage access',
    'Quản lý thành viên và phân quyền truy cập trong tổ chức': 'Manage members and organization access',
    'Quản lý thành viên, Pages và gói dịch vụ của tổ chức.': "Manage your organization's members, Pages, and plan.",
    'Quản lý thông tin tổ chức, thành viên và gói dịch vụ': 'Manage organization details, members, and plan',
    'Quay lại Gói & thanh toán': 'Back to Plans & billing', 'Quay về Gói & thanh toán': 'Back to Plans & billing',
    'Sao chép': 'Copy', 'Sao chép nội dung': 'Copy content', 'Sắp đăng (7 ngày)': 'Upcoming (7 days)', 'Sắp hết hạn': 'Expiring soon',
    'Sắp ra mắt': 'Coming soon', 'Sắp xếp giảm dần': 'Sort descending', 'Sắp xếp tăng dần': 'Sort ascending', 'Số lần thử:': 'Attempts:',
    'Số tài khoản': 'Accounts', 'Số tiền': 'Amount', 'Số tiền:': 'Amount:', 'Tải file mẫu': 'Download template', 'Tải mã QR': 'Download QR code',
    'Tải thêm...': 'Load more...', 'Tạo': 'Create', 'Tạo đơn thanh toán mới': 'Create new payment order', 'Tạo lời mời': 'Create invitation',
    'Tất cả Campaign': 'All Campaigns', 'Tên Campaign *': 'Campaign name *', 'Tên Campaign mới': 'New Campaign name', 'Tên cột': 'Column name',
    'Tên Page': 'Page name', 'Tên Workspace': 'Workspace name', 'Thả file Excel vào đây': 'Drop an Excel file here', 'Thanh toán': 'Payment',
    'Thanh toán chưa hoàn tất': 'Payment incomplete', 'Thanh toán lại': 'Pay again', 'Thanh toán qua QR': 'Pay by QR', 'Thanh toán thành công': 'Payment successful',
    'Thành viên': 'Members', 'Thao tác': 'Actions', 'Thêm': 'Add', 'Thêm Page thủ công': 'Add Page manually', 'Thiết lập AI': 'AI setup',
    'Thiết lập chung': 'General settings', 'Thời gian': 'Time', 'Thông tin': 'Information', 'Thông tin đơn hàng': 'Order information',
    'Thủ công': 'Manual', 'Tìm trường': 'Find field', 'Tinh chỉnh AI': 'Refine with AI', 'Toàn bộ': 'Full access',
    'Toàn bộ Organization': 'Entire Organization', 'Toàn bộ tổ chức': 'Entire organization', 'Tóm tắt đơn hàng': 'Order summary',
    'Tổng': 'Total', 'Tổng hợp': 'Summary', 'Tổng thanh toán': 'Total payment', 'Tổng theo bài': 'Per-post total', 'Tổng tiền': 'Total amount'
  });

  // Customer app coverage: page fragments, dialogs, statuses, empty states and
  // action feedback. Keep user-created Page, Campaign and Content values intact.
  Object.assign(translations.en, {
    '· Hết hạn:': '· Expires:', '(đã đầy)': '(limit reached)', '(vượt hạn mức)': '(over limit)',
    'Bỏ qua': 'Skip', 'Cập nhật mật khẩu': 'Update password', 'Chấp nhận': 'Accept',
    'Chưa có page nào': 'No Pages yet', 'Chưa có workspace.': 'No workspaces yet.',
    'Dùng thử': 'Trial', 'Dùng thử · Còn': 'Trial · Remaining', 'Dùng thử đã hết hạn': 'Trial expired',
    'Dữ liệu của bạn vẫn còn. Vui lòng liên hệ để nâng cấp.': 'Your data is still available. Please contact us to upgrade.',
    'Đã hết hạn': 'Expired', 'Đăng nhập:': 'Signed in as:', 'Để sau': 'Later', 'Để sau / Hoàn tất': 'Later / Finish',
    'Email chưa được xác minh.': 'Email not verified.', 'Email/mật khẩu': 'Email/password',
    'Giới hạn': 'Limited', 'Giới hạn phạm vi': 'Limit scope', 'Google - Đã liên kết': 'Google - Connected',
    'Huỷ': 'Cancel', 'Kết nối Facebook Page': 'Connect Facebook Page', 'Liên hệ nâng cấp': 'Contact to upgrade',
    'Lưu quyền': 'Save permissions', 'Mật khẩu mới (≥ 8 ký tự, chữ + số)': 'New password (8+ characters, letters + numbers)',
    'Mô tả (tùy chọn)': 'Description (optional)', 'mời bạn với vai trò': 'invited you as', 'Mời thành viên': 'Invite member',
    'Nâng cấp gói': 'Upgrade plan', 'ngày': 'days', 'Pages được cấp riêng': 'Individually assigned Pages',
    'Quản lý quyền': 'Manage permissions', 'Quản lý quyền truy cập': 'Manage access',
    'Quyền truy cập hiệu lực:': 'Effective access:', 'Sắp hết hạn': 'Expiring soon', 'Tạo lời mời': 'Create invitation',
    'Tên Workspace': 'Workspace name', 'Thêm': 'Add',
    'Thêm API key Gemini / OpenAI / Claude của tổ chức. Key được mã hóa và không hiển thị lại.': "Add your organization's Gemini / OpenAI / Claude API keys. Keys are encrypted and never shown again.",
    'Thiết lập AI': 'AI setup', 'Toàn bộ': 'All',
    'Tổ chức đang bị tạm ngưng: bạn vẫn xem được dữ liệu nhưng không thể thao tác. Vui lòng liên hệ hỗ trợ.': 'Your organization is suspended. You can still view data but cannot make changes. Please contact support.',
    'Tổ chức:': 'Organization:', 'VD: Chuỗi cửa hàng BeKiddo': 'E.g. BeKiddo store chain',
    '· Email được mời:': '· Invited email:', 'Đang đăng nhập:': 'Signed in as:', 'Vai trò:': 'Role:',

    'Bạn đang sử dụng nhiều tài nguyên hơn giới hạn của gói mới. Dữ liệu hiện tại sẽ không bị xóa, nhưng bạn sẽ không thể thêm mới cho tới khi usage trở lại trong giới hạn.': 'Your current usage exceeds the new plan limits. Existing data will not be deleted, but you cannot add more until usage is within the limits.',
    'Chỉ Owner hoặc Admin được thực hiện thanh toán.': 'Only Owners or Admins can make payments.',
    'Chi tiết đơn hàng': 'Order details', 'Chu kỳ': 'Billing period', 'Chủ TK': 'Account holder',
    'Chưa có lịch sử thanh toán.': 'No payment history yet.', 'Còn': 'Remaining', 'đã được kích hoạt.': 'has been activated.',
    'Đơn thanh toán đã hết hạn': 'Payment order expired', 'Hết hạn': 'Expired', 'Hết hạn:': 'Expires:', 'Hiện tại': 'Current',
    'Hoàn tất thanh toán trên ứng dụng ngân hàng. Trạng thái sẽ tự cập nhật khi nhận được xác nhận.': 'Complete payment in your banking app. The status will update automatically after confirmation.',
    'Kiểm tra': 'Check', 'Lịch sử thanh toán': 'Payment history', 'ngày dùng thử': 'trial days', 'Nội dung CK': 'Transfer reference',
    'QR thanh toán': 'Payment QR', 'Quét mã QR để thanh toán': 'Scan the QR code to pay', 'Số tiền': 'Amount',
    'Thanh toán': 'Payment', 'Thanh toán đơn': 'Pay order', 'Thanh toán lại': 'Pay again',
    'Thanh toán thành công': 'Payment successful', 'Thanh toán trực tuyến đang tạm thời chưa khả dụng.': 'Online payment is temporarily unavailable.',
    'Tóm tắt đơn hàng': 'Order summary', 'Vào MKT Tools': 'Go to MKT Tools',
    'Vui lòng đăng nhập để xem thông tin gói.': 'Please log in to view plan information.', 'Xem thêm': 'View more',

    'Chưa có hoạt động nào': 'No activity yet', '- Chọn page -': '- Select Page -',
    '1 giờ': '1 hour', '2 giờ': '2 hours', '4 giờ': '4 hours', '8 giờ': '8 hours', '24 giờ': '24 hours',
    '15 phút': '15 minutes', '30 phút': '30 minutes', 'Chưa có campaign nào.': 'No Campaigns yet.',
    'Mô tả ngắn về campaign...': 'Short Campaign description...', 'Ngày bắt đầu': 'Start date', 'Ngày kết thúc': 'End date',
    'Tên Campaign *': 'Campaign name *', 'Thời gian': 'Time', 'Tự duyệt': 'Auto approve', 'Tự động duyệt': 'Auto approve',
    'VD: Content tháng 10': 'E.g. October content', 'Sửa Campaign': 'Edit Campaign', 'Cập nhật': 'Update',

    '(tối đa 10 ảnh, kéo để sắp xếp)': '(up to 10 images, drag to reorder)', '(trống = tất cả)': '(blank = all)',
    'Ẩn kết quả': 'Hide results', 'Bài trước': 'Previous post', 'Bài viết / Caption': 'Post / Caption', 'Bản gốc': 'Original',
    'Bằng (=)': 'Equals (=)', 'Bình thường': 'Normal', 'Bỏ chọn': 'Clear selection', 'Chi tiết lỗi': 'Error details',
    'Chọn ảnh:': 'Choose images:', 'Chọn page': 'Choose Page', 'Chọn Page trước để lọc Campaign': 'Choose a Page to filter Campaigns',
    'Chủ đề': 'Topic', 'Chưa có content nào.': 'No Content yet.', 'Clicks chi tiết': 'Click details', 'Duyệt': 'Approve',
    'Đã có video': 'Video added', 'Đang chọn': 'Selecting', 'Đang lưu...': 'Saving...', 'Đang thực hiện': 'In progress',
    'ĐANG THỰC HIỆN': 'IN PROGRESS', 'Đang tinh chỉnh...': 'Refining...', 'Đăng': 'Publish', 'Đăng lại': 'Republish',
    'Đăng ngay': 'Publish now', 'Đến': 'To', 'Engagement tổng chia cho Tổng người xem theo bài.': 'Total engagement divided by total per-post viewers.',
    'Gen lại nội dung': 'Regenerate content', 'Gen nội dung': 'Generate content', 'Ghi chú': 'Notes', 'Giá trị...': 'Value...',
    'Giờ đăng': 'Publish time', 'Hiện kết quả': 'Show results', 'Kéo thả hoặc click để chọn ảnh (chọn nhiều)': 'Drag and drop or click to select images (multiple)',
    'Không có lịch sử': 'No history', 'Không thể tải chi tiết nội dung.': 'Unable to load Content details.',
    'Loại': 'Type', 'Loại content': 'Content type', 'Lọc cột này': 'Filter this column', 'Lỗi': 'Error',
    'Lớn hơn (&gt;)': 'Greater than (&gt;)', 'Lớn hơn hoặc bằng (&gt;=)': 'Greater than or equal (&gt;=)',
    'Lưu View': 'Save View', 'Mặc định': 'Default', 'Mô tả ảnh (AI gen)': 'Image description (AI generated)',
    'Mô tả từng ảnh, cách nhau bằng dấu | VD: Ảnh sản phẩm chính | Ảnh lifestyle khách hàng': 'Describe each image, separated by | E.g. Main product image | Customer lifestyle image',
    'Ngày đăng': 'Publish date', 'Nguồn': 'Source', 'Nhập nội dung bài viết đầy đủ...': 'Enter the full post content...',
    'Nhập URL': 'Enter URL', 'Nhiều ảnh cách nhau bằng dấu': 'Multiple images separated by',
    'Nhỏ hơn (&lt;)': 'Less than (&lt;)', 'Nhỏ hơn hoặc bằng (&lt;=)': 'Less than or equal (&lt;=)',
    'Nội dung có sẵn': 'Existing content', 'nội dung khác': 'other items', 'Phiên bản': 'Version',
    'Reactions chi tiết': 'Reaction details', 'Sắp xếp giảm dần': 'Sort descending', 'Sắp xếp tăng dần': 'Sort ascending',
    'Số lần thử:': 'Attempts:', 'Tên view...': 'View name...', 'Thu gọn': 'Collapse', 'Tìm cột...': 'Find column...',
    'Tìm theo chủ đề...': 'Search by topic...', 'Tinh chỉnh AI': 'Refine with AI', 'Tổng hợp': 'Summary',
    'Tổng lượt xem của các bài trong kết quả hiện tại.': 'Total views for posts in the current results.',
    'Tổng Reactions + Comments + Shares.': 'Total Reactions + Comments + Shares.',
    'Tổng số người xem duy nhất của từng bài. Một người xem nhiều bài có thể được tính nhiều lần.': 'Total unique viewers per post. A person who views multiple posts may be counted more than once.',
    'Tổng theo bài': 'Per-post total', 'Tùy chỉnh cột': 'Customize columns', 'Từ': 'From', 'Từ chối': 'Reject',
    'VD: Khuyến mãi mùa thu, sản phẩm mới...': 'E.g. Autumn promotion, new product...',
    'VD: Tone vui vẻ, nhắc đến giảm giá 30%, viết bằng tiếng Việt...': 'E.g. Friendly tone, mention 30% off, write in English...',
    'VD: Viết ngắn hơn, thêm emoji...': 'E.g. Make it shorter, add emoji...', 'Views đã lưu': 'Saved Views',
    'Xác nhận bản': 'Confirm version', 'Xem bài': 'View post', 'Xem lỗi': 'View error', 'Xem trên Facebook': 'View on Facebook',
    'Xóa bộ lọc': 'Clear filters', 'Xóa video': 'Remove video',

    '· chưa sync': '· not synced yet', 'Bài đăng': 'Posts', 'Chưa có': 'None',
    'Dữ liệu hiệu suất từ Facebook': 'Performance data from Facebook', 'Đăng gần đây': 'Recently published',
    'Đến ngày': 'To date', 'Hiệu suất Page': 'Page performance', 'Hiệu suất theo thời gian': 'Performance over time',
    'Không có lịch': 'No schedule', 'Lượt xem': 'Views', 'Ngày': 'Date', 'Người xem': 'Viewers',
    'Sắp đăng (7 ngày)': 'Upcoming (7 days)', 'Số người xem duy nhất của nội dung theo Facebook': 'Unique content viewers reported by Facebook',
    'Tổng số lượt nội dung được xem/displayed/played': 'Total times content was viewed, displayed, or played',
    'Từ ngày': 'From date', 'Tỷ lệ đăng thành công': 'Publishing success rate',

    'Bài viết': 'Post', 'Bắt buộc': 'Required', 'Caption bài đăng': 'Post caption',
    'Chỉ cần điền nội dung vào file → import → duyệt → tự động đăng theo lịch': 'Add content to the file → import → review → automatically publish on schedule',
    'Chỉ cần lên ý tưởng, AI sẽ viết bài': 'Provide ideas and AI will write the posts', 'Chủ đề / tiêu đề content': 'Content topic / title',
    'Đã có bài viết, ảnh, video sẵn rồi': 'I already have posts, images, or videos',
    'Điền chủ đề + ghi chú hướng dẫn → import → AI tự gen content → duyệt → đăng': 'Add topics + instructions → import → AI generates Content → review → publish',
    'Đổi file': 'Change file', 'Gỡ file': 'Remove file', 'hoặc click để chọn': 'or click to choose',
    'Hỗ trợ .xlsx, .csv': 'Supports .xlsx and .csv', 'Hướng dẫn cho AI': 'AI instructions',
    'Kết nối trực tiếp với Google Sheets, mỗi tab = 1 campaign. Đang phát triển...': 'Connect directly to Google Sheets, one tab per Campaign. Coming soon...',
    'Mặc định 09:00': 'Default 09:00', 'Mô tả ảnh, dấu | ngăn cách': 'Image descriptions, separated by |',
    'Ngày đăng (2026-10-01)': 'Publish date (2026-10-01)', 'Nhập content từ file Excel': 'Import Content from Excel',
    'Pages không tìm thấy:': 'Pages not found:', 'Tải file mẫu': 'Download template', 'Tạo': 'Create',
    'Tên Campaign mới': 'New Campaign name', 'Tên cột': 'Column name', 'Thả file Excel vào đây': 'Drop an Excel file here',
    'Tìm Page': 'Find Page', 'Tìm Page...': 'Find Page...', 'VD: Content tháng 10/2026': 'E.g. October 2026 Content',

    'Bạn có thể gán Page/Nhóm sau khi thành viên chấp nhận lời mời.': 'You can assign Pages/Groups after the member accepts the invitation.',
    'Bảo vệ dữ liệu theo phạm vi tổ chức': 'Organization-scoped data protection',
    'Các đơn hàng và giao dịch của tổ chức': 'Organization orders and transactions',
    'Chọn gói phù hợp với nhu cầu của tổ chức. Bạn có thể thay đổi bất cứ lúc nào.': "Choose a plan that fits your organization. You can change it at any time.",
    'Chuyển khoản ngân hàng': 'Bank transfer', 'đã được kích hoạt cho tổ chức của bạn.': 'has been activated for your organization.',
    'Đã thanh toán': 'Paid', 'Đang chờ thanh toán...': 'Awaiting payment...', 'Đơn giá': 'Unit price',
    'Đơn hàng còn hiệu lực trong': 'Order valid for', 'Đơn hàng của bạn': 'Your order',
    'Đơn hàng này không thể tiếp tục thanh toán.': 'This order can no longer be paid.', 'Giá snapshot': 'Price snapshot',
    'Gửi lời mời': 'Send invitation', 'Hoàn tất thanh toán': 'Complete payment',
    'Hoàn tất thanh toán để kích hoạt gói dịch vụ': 'Complete payment to activate your plan', 'Hủy lời mời': 'Cancel invitation',
    'Không có lời mời đang chờ.': 'No pending invitations.', 'Không thể chỉnh sửa': 'Cannot edit',
    'Kiểm tra đúng số tiền và nội dung': 'Verify the amount and transfer reference', 'Liên hệ để nhận báo giá': 'Contact us for pricing',
    'Mã QR của đơn này không còn hiệu lực. Bạn có thể chủ động tạo một đơn mới.': 'This QR code is no longer valid. You can create a new order.',
    'Mã QR thanh toán': 'Payment QR', 'MKT Tools sẽ tự động cập nhật trạng thái': 'MKT Tools will update the status automatically',
    'Mở ứng dụng ngân hàng': 'Open your banking app', 'Nâng cấp hoặc gia hạn': 'Upgrade or renew',
    'Ngày tham gia': 'Join date', 'Ngày thanh toán': 'Payment date', 'NHÓM / WORKSPACES': 'GROUPS / WORKSPACES',
    'Phạm vi truy cập': 'Access scope', 'Quay về Gói & thanh toán': 'Back to Plans & billing',
    'Quét mã bằng ứng dụng ngân hàng của bạn': 'Scan with your banking app', 'Quét mã QR': 'Scan QR code',
    'Sao chép nội dung': 'Copy reference', 'Số tiền:': 'Amount:', 'Tải mã QR': 'Download QR code',
    'Tạo đơn thanh toán mới': 'Create new payment order', 'Thanh toán qua QR': 'Pay by QR', 'Thao tác': 'Actions',
    'Thông tin đơn hàng': 'Order information', 'Tìm Page hoặc Nhóm...': 'Find a Page or Group...',
    'Toàn bộ tổ chức': 'Entire organization', 'Trở lại': 'Back',

    'Bạn có chắc chắn muốn xóa Page “': 'Are you sure you want to delete Page “',
    'Bỏ trống để dùng nhóm mặc định': 'Leave blank to use the default group',
    'Các Page kết nối thành công vẫn được giữ nguyên. Bạn có thể thử lại riêng những Page bị lỗi.': 'Successfully connected Pages are preserved. You can retry failed Pages individually.',
    'Chỉnh sửa': 'Edit', 'Chọn các Page bạn muốn thêm vào MKT Tools': 'Choose the Pages you want to add to MKT Tools',
    'Chưa có Page nào được kết nối': 'No Pages connected yet', 'Context / ADN thương hiệu': 'Brand context / DNA',
    'Dán access token từ Graph API Explorer...': 'Paste an access token from Graph API Explorer...',
    'Dành cho Page legacy hoặc môi trường phát triển.': 'For legacy Pages or development environments.',
    'Dùng tạm trong thời gian Facebook App chưa hoàn tất review. Token chỉ được gửi về server và không hiển thị lại.': 'Use temporarily while the Facebook App review is pending. The token is sent only to the server and is never displayed again.',
    'Đang kết nối...': 'Connecting...', 'Đang tải danh sách Pages...': 'Loading Pages...',
    'Kết nối bằng Access Token': 'Connect with Access Token',
    'Kết nối Facebook để thêm các Page bạn đang quản lý vào MKT Tools.': 'Connect Facebook to add the Pages you manage to MKT Tools.',
    'Kết nối Facebook Pages': 'Connect Facebook Pages', 'Không tìm thấy Page phù hợp.': 'No matching Page found.',
    'Lấy Pages đã lưu': 'Load saved Pages', 'Mô tả thương hiệu để AI hiểu phong cách nội dung': 'Describe the brand so AI understands its content style',
    'Mở menu thao tác': 'Open actions menu', 'Quản lý các Facebook Page đang kết nối với tổ chức': "Manage the organization's connected Facebook Pages",
    'Tạo token từ Graph API Explorer với các quyền': 'Create a token in Graph API Explorer with permissions',
    'Thêm Page thủ công': 'Add Page manually', 'Tìm kiếm Facebook Page': 'Search Facebook Pages',
    'Tìm kiếm Page': 'Search Pages', 'Tìm kiếm Page...': 'Search Pages...',
    'Vui lòng chờ trong giây lát, chúng tôi đang kết nối các Page vào tổ chức.': 'Please wait while we connect the Pages to your organization.',
    'Vui lòng đợi trong giây lát.': 'Please wait a moment.', 'Vui lòng không đóng cửa sổ này trong khi đang kết nối.': 'Do not close this window while connecting.',
    'Vui lòng kiểm tra lỗi bên dưới và thử lại.': 'Review the errors below and try again.', 'Xóa Page': 'Delete Page',
    'Xóa Page?': 'Delete Page?', 'Xóa tìm kiếm': 'Clear search',

    'API key hiện tại không bao giờ được hiển thị. Nhập key mới để thêm hoặc thay thế.': 'The current API key is never displayed. Enter a new key to add or replace it.',
    'App ID của ứng dụng Facebook': 'Facebook App ID', 'Cấu hình AI': 'AI configuration',
    'Cấu hình các dịch vụ và tích hợp cho tổ chức hiện tại': 'Configure services and integrations for the current organization',
    'Cấu hình Facebook App': 'Configure Facebook App', 'Chat duyệt nội dung': 'Content review chat', 'Chọn model': 'Choose model',
    'Gửi một tin nhắn bất kỳ trong group.': 'Send any message in the group.', 'Hướng dẫn lấy Chat ID': 'How to get a Chat ID',
    'Kiểm tra kết nối': 'Test connection', 'Lấy App ID và App Secret tại': 'Get the App ID and App Secret at',
    'Lấy token từ': 'Get the token from', 'Lưu ý': 'Note', 'Múi giờ được sử dụng cho lịch đăng và hiển thị thời gian trong tổ chức.': 'The time zone is used for scheduling and displaying organization times.',
    'Múi giờ này sẽ được sử dụng làm mặc định cho tất cả thành viên trong tổ chức.': 'This time zone is the default for all organization members.',
    'Nhập API key mới': 'Enter a new API key', 'Nhập Facebook App ID': 'Enter Facebook App ID', 'Nhập Model ID': 'Enter Model ID',
    'Nhập một hoặc nhiều Chat ID nhận nội dung cần duyệt.': 'Enter one or more Chat IDs that receive Content for review.',
    'Tạo bot với @BotFather': 'Create a bot with @BotFather',
    'Thiết lập bot Telegram cho việc duyệt nội dung và nhận thông báo': 'Set up a Telegram bot for Content review and notifications',
    'Thiết lập nhà cung cấp và model AI để tạo nội dung và hình ảnh': 'Configure AI providers and models for Content and image generation',
    'Thiết lập ứng dụng Facebook cho việc kết nối và quản lý Pages': 'Configure the Facebook App for connecting and managing Pages',
    'Thông tin': 'Information', 'Tìm trường': 'Find the field', 'Xóa API key': 'Delete API key',

    'Chờ gen': 'Pending generation', 'Cơ bản': 'Basic', 'Đã đăng': 'Published', 'Đang đăng': 'Publishing', 'Đang gen': 'Generating',
    'Hiệu suất': 'Performance', 'Kết quả': 'Results', 'Nháp': 'Draft', 'phút': 'minutes', 'Yêu cầu sửa': 'Revision requested',
    'Vừa xong': 'Just now', 'giờ trước': 'hours ago', 'ngày trước': 'days ago', 'phút trước': 'minutes ago',
    'Đã cập nhật campaign': 'Campaign updated', 'Đã tạo campaign': 'Campaign created', 'Đã xóa campaign': 'Campaign deleted',
    'Cập nhật content thành công': 'Content updated successfully', 'Duyệt content này?': 'Approve this Content?',
    'Đã copy!': 'Copied!', 'Đã duyệt content': 'Content approved', 'Đã đăng lên': 'Published to',
    'Đã đồng bộ metrics': 'Metrics synced', 'Đã đưa vào hàng đợi đăng bài': 'Added to the publishing queue',
    'Đã đưa vào hàng đợi gen content': 'Added to the Content generation queue', 'Đã giữ bản gốc': 'Original version kept',
    'Đã gửi yêu cầu sửa': 'Revision request sent', 'Đã hủy content': 'Content cancelled',
    'Đã lưu và đưa vào hàng đợi gen lại': 'Saved and queued for regeneration', 'Đã xóa content': 'Content deleted',
    'Đăng bài ngay?': 'Publish now?', 'Hôm qua': 'Yesterday', 'Không có nội dung phù hợp để duyệt': 'No eligible Content to approve',
    'Không có nội dung phù hợp để đăng': 'No eligible Content to publish', 'Không có nội dung phù hợp để gen': 'No eligible Content to generate',
    'Không có nội dung phù hợp để gen lại': 'No eligible Content to regenerate', 'Không tải được chi tiết content': 'Unable to load Content details',
    'Không thể copy': 'Unable to copy', 'Lỗi áp dụng phiên bản': 'Failed to apply version', 'Lỗi đồng bộ': 'Sync failed',
    'Lỗi đồng bộ metrics': 'Metrics sync failed', 'Lỗi tinh chỉnh': 'Refinement failed', 'Lý do hủy (tùy chọn):': 'Cancellation reason (optional):',
    'Quá thời gian chờ': 'Timed out', 'Tạo content': 'Create Content', 'Tháng này': 'This month',
    'Thêm content có sẵn → Chờ duyệt': 'Add existing Content → Pending review', 'Thêm content thành công': 'Content added successfully',
    'Tuần này': 'This week', 'Tùy chỉnh': 'Custom', 'Vui lòng điền Chủ đề và Ngày đăng': 'Enter a Topic and Publish date',
    'Vui lòng điền Page, Chủ đề và Ngày đăng': 'Enter a Page, Topic, and Publish date', 'Yêu cầu chỉnh sửa gì?': 'What should be revised?',
    'Chưa có bài đăng nào. Tạo content và đăng bài trước.': 'No posts yet. Create and publish Content first.',
    'Không có dữ liệu FB trong khoảng thời gian này. Bấm Sync FB để cập nhật.': 'No Facebook data for this period. Click Sync FB to update.',
    'Không thể tải dữ liệu tổng quan.': 'Unable to load overview data.', '- Tạo mới -': '- Create new -', 'Lỗi tải template': 'Failed to load template',
    'Đã cập nhật quyền truy cập': 'Access updated', 'Đã cập nhật tên tổ chức': 'Organization name updated',
    'Đã chọn': 'Selected', 'Đã gửi lời mời': 'Invitation sent', 'Đã hủy lời mời': 'Invitation cancelled',
    'Đã sao chép nội dung chuyển khoản': 'Transfer reference copied', 'Đã xóa thành viên': 'Member removed',
    'Đang cập nhật...': 'Updating...', 'Đang chờ': 'Pending', 'Đơn thanh toán đã hết hạn.': 'Payment order expired.',
    'Gia hạn': 'Renew', 'Gói này hiện không còn khả dụng.': 'This plan is no longer available.',
    'Không có ngày hết hạn': 'No expiration date', 'Không thể sao chép. Vui lòng thử lại.': 'Unable to copy. Please try again.',
    'Không thể tải thông tin thanh toán. Vui lòng thử lại.': 'Unable to load payment information. Please try again.',
    'Kỳ hạn này chưa có giá': 'No price for this billing period', 'Liên hệ': 'Contact', 'Quản trị viên cũ': 'Former administrator',
    'Thanh toán hiện chưa khả dụng.': 'Payment is currently unavailable.', 'Thành viên & quyền': 'Members & permissions',
    'Bạn đã hủy kết nối Facebook.': 'You cancelled the Facebook connection.',
    'Bạn không có quyền quản lý kết nối Facebook của tổ chức này.': "You don't have permission to manage this organization's Facebook connection.",
    'Cập nhật Page thành công': 'Page updated successfully', 'Cập nhật workspace thành công': 'Workspace updated successfully',
    'Chưa lưu Facebook User Access Token. Vui lòng nhập token tại Cài đặt hệ thống.': 'No Facebook User Access Token saved. Enter one in System Settings.',
    'Đã được kết nối': 'Connected', 'Đã kết nối lại': 'Reconnected', 'Đã xóa Page': 'Page deleted', 'Đã xóa workspace': 'Workspace deleted',
    'Địa chỉ callback Facebook chưa được cho phép trong cấu hình hệ thống.': 'The Facebook callback URL is not allowed in system configuration.',
    'Facebook App chưa được cấu hình. Vui lòng cấu hình App ID và App Secret trong Cài đặt hệ thống.': 'The Facebook App is not configured. Set the App ID and App Secret in System Settings.',
    'Facebook không thể cấp quyền kết nối. Vui lòng thử lại.': 'Facebook could not grant connection permission. Please try again.',
    'Gói dịch vụ của tổ chức đã hết hạn.': "The organization's plan has expired.",
    'Hãy lưu Facebook User Access Token tại Cài đặt hệ thống trước.': 'Save the Facebook User Access Token in System Settings first.',
    'Không thể hoàn tất kết nối Facebook. Vui lòng thử lại.': 'Unable to complete the Facebook connection. Please try again.',
    'Không thể hoàn tất kết nối với Facebook. Vui lòng thử lại.': 'Unable to complete the connection with Facebook. Please try again.',
    'Không thể kết nối Facebook.': 'Unable to connect Facebook.', 'Không thể tải danh sách Pages.': 'Unable to load Pages.',
    'Không tìm thấy Page trong phiên kết nối hiện tại. Vui lòng kết nối lại Facebook.': 'No Page was found in the current connection session. Reconnect Facebook.',
    'Page này đã được kết nối với một tổ chức khác.': 'This Page is connected to another organization.',
    'Phiên đăng nhập đã hết hạn.': 'Your session has expired.', 'Phiên kết nối Facebook đã hết hạn. Vui lòng thử lại.': 'The Facebook connection session expired. Please try again.',
    'Phiên kết nối Facebook không hợp lệ. Vui lòng thử lại.': 'The Facebook connection session is invalid. Please try again.',
    'Tài khoản Facebook chưa cấp đủ quyền để quản lý Pages.': 'The Facebook account has not granted enough permissions to manage Pages.',
    'Tạo workspace thành công': 'Workspace created successfully', 'Tên là bắt buộc': 'Name is required',
    'Tên Page và Page ID là bắt buộc.': 'Page name and Page ID are required.', 'Thêm Page thành công': 'Page added successfully',
    'Thuộc tổ chức khác': 'Belongs to another organization', 'Tổ chức đã đạt giới hạn số lượng Page của gói hiện tại.': 'The organization has reached the Page limit for its current plan.',
    'Vui lòng chọn ít nhất một Page.': 'Select at least one Page.', 'Đã lưu cài đặt thành công!': 'Settings saved successfully!'
  });

  Object.assign(translations.en, {
    'Bỏ ghim': 'Unpin', 'Ghim': 'Pin',
    'https://... (link ảnh trực tiếp)': 'https://... (direct image URL)',
    'https://... (link video trực tiếp)': 'https://... (direct video URL)',
    'IMAGE (Text + Ảnh)': 'IMAGE (Text + Image)', 'TEXT (Chỉ text)': 'TEXT (Text only)', 'VIDEO (Có video)': 'VIDEO (With video)',
    'JPG, PNG, GIF, WebP - tối đa 20MB/ảnh': 'JPG, PNG, GIF, WebP - up to 20MB/image',
    'MP4, MOV, AVI, WebM, MKV - tối đa 500MB': 'MP4, MOV, AVI, WebM, MKV - up to 500MB',
    'content, bỏ qua': 'Content, skip', 'và': 'and',
    ', sau đó thêm bot vào group hoặc chat cá nhân.': ', then add the bot to a group or private chat.',
    'Đã cấu hình - để trống nếu không muốn thay đổi ·': 'Configured - leave blank to keep unchanged ·',
    'để lấy thêm hoặc cập nhật Page mà không cần dán lại token.': 'to load or update Pages without pasting the token again.',
    'Quản lý Pages &amp; Nhóm': 'Manage Pages &amp; Groups', 'Sau lần lưu đầu tiên, vào': 'After the first save, go to',
    'Nhập App Secret': 'Enter App Secret', 'Dán User Access Token': 'Paste User Access Token', 'Nhập Bot Token': 'Enter Bot Token',
    'tài liệu API getUpdates': 'getUpdates API documentation', 'trên Telegram': 'on Telegram', 'trong kết quả.': 'in the response.',
    'User Token được đổi sang loại dài hạn; Page Token lấy từ token này được lưu mã hóa cho từng Page.': 'The User Token is exchanged for a long-lived token; Page Tokens derived from it are encrypted for each Page.',
    'và gọi endpoint bằng Bot Token của bạn.': 'and call the endpoint with your Bot Token.',
    'Claude Haiku 4.5 - nhanh, rẻ': 'Claude Haiku 4.5 - fast, affordable',
    'Claude Opus 4.6 - mạnh nhất': 'Claude Opus 4.6 - most capable',
    'Claude Sonnet 4 - cân bằng': 'Claude Sonnet 4 - balanced',
    'Gemini 2.5 Flash - ổn định, rẻ': 'Gemini 2.5 Flash - stable, affordable',
    'Gemini 3.5 Flash-Lite - siêu nhanh 350 tok/s (7/2026)': 'Gemini 3.5 Flash-Lite - ultra-fast 350 tok/s (7/2026)',
    'Gemini 3.8 Flash - mới nhất, thông minh nhất (9/2026)': 'Gemini 3.8 Flash - newest, most capable (9/2026)',
    'GPT-4o - đa năng': 'GPT-4o - versatile', 'GPT-4o Mini - nhanh, ổn định': 'GPT-4o Mini - fast, stable',
    'GPT-5 Mini - nhanh, rẻ (2026)': 'GPT-5 Mini - fast, affordable (2026)', 'GPT-5.5 - mạnh nhất (2026)': 'GPT-5.5 - most capable (2026)',
    'Đã đổi mật khẩu.': 'Password changed.', 'Đã lưu.': 'Saved.',
    'Gửi tin nhắn Telegram': 'Send a Telegram message', 'Liên hệ qua Zalo': 'Contact via Zalo', 'Nhắn tin qua Facebook': 'Message on Facebook',
    'bỏ qua': 'skip', 'hoàn tất': 'completed', 'Không thể tải chi tiết nội dung': 'Unable to load Content details',
    'lỗi': 'failed', 'Lỗi:': 'Error:', 'thành công': 'successful', 'Chưa có gói': 'No plan',
    'Đang tạo': 'Generating', 'Lên lịch': 'Scheduled', '/ trang': '/ page',
    'Đang tạo...': 'Generating...', 'Đã tạo': 'Generated', 'Chưa tạo': 'Not generated',
    'Đang đăng...': 'Publishing...', 'Chưa đăng': 'Not published',
    '7 ngày qua': 'Last 7 days', '14 ngày qua': 'Last 14 days', '30 ngày qua': 'Last 30 days',
    'Tuần trước': 'Last week', 'Tháng trước': 'Last month', 'Tùy chọn...': 'Custom...'
  });

  Object.assign(translations.en, {
    'AI Text (Viết bài)': 'AI Text (Writing)',
    'AI Image (Tạo ảnh)': 'AI Image (Generation)',
    'Chọn nhà cung cấp và model cho AI tạo nội dung': 'Choose a provider and model for AI content generation',
    'Chọn nhà cung cấp và model cho AI tạo hình ảnh': 'Choose a provider and model for AI image generation',
    'Chọn từ danh sách': 'Choose from list',
    'Nhập Model ID khác': 'Enter another Model ID',
    'Thay đổi': 'Change',
    'Chưa cấu hình': 'Not configured',
    'Cần nhập lại': 'Needs re-entry',
    'Sử dụng cho AI text': 'Used for AI text',
    'Đã cấu hình - để trống nếu không muốn thay đổi': 'Configured — leave blank to keep unchanged',
    'Đã lưu token dài hạn và mã hóa trên server - để trống nếu không muốn thay đổi': 'A long-lived token is encrypted on the server — leave blank to keep unchanged',
    'Không giới hạn Page': 'Unlimited Pages',
    'Không giới hạn Pages': 'Unlimited Pages',
    'Không giới hạn thành viên': 'Unlimited members',
    'Tất cả Page': 'All Pages',
    'Tất cả Page trong WS': 'All Pages in workspace',
    'Top Content theo Engagement': 'Top Content by Engagement'
  });

  Object.assign(translations.en, {
    '· Toàn bộ Organization': '· Entire organization',
    'Chưa gán gói': 'No plan assigned', 'Chưa xác minh': 'Unverified', 'Đã xác minh': 'Verified',
    'Đặt mật khẩu': 'Set password', 'Đổi mật khẩu': 'Change password', 'Kết thúc:': 'Ends:',
    'Không thời hạn': 'No expiration', 'page đã chọn': 'Pages selected', 'Sửa Workspace': 'Edit Workspace',
    'Tạo Workspace mới': 'Create new Workspace', 'Không giới hạn': 'Unlimited', 'tháng': 'months', 'thành viên': 'members', 'bài': 'posts',
    'đang chạy': 'running', 'Hàng loạt': 'Bulk', 'Hệ thống': 'System', 'Mã lỗi:': 'Error code:',
    '(ảnh': '(image', '⏳ Chờ đến lượt': '⏳ Queued', '✓ Hoàn tất': '✓ Completed', '✕ Thất bại': '✕ Failed',
    '⟳ Đang đăng': '⟳ Publishing', '⟳ Đang gen': '⟳ Generating', 'Chỉ văn bản': 'Text only',
    'Có ảnh': 'Has image', 'Có video': 'Has video', 'Đã copy': 'Copied',
    'Đã thêm vào hàng đợi gen': 'Added to the generation queue',
    'Engagement chia cho số Người xem duy nhất.': 'Engagement divided by unique viewers.',
    'Ghim trái': 'Pin left', 'gốc': 'original', 'Kết quả từ': 'Results from', 'Lịch sử': 'History',
    'Lọc:': 'Filter:', 'mục đã chọn': 'items selected', 'nội dung': 'items',
    'Số người xem duy nhất của nội dung theo Facebook.': 'Unique viewers for the Content on Facebook.',
    'Sửa bài viết': 'Edit post', 'Sửa Content': 'Edit Content', 'Thêm Content mới': 'Add new Content',
    'Vui lòng chỉ nhập ảnh hoặc video cho một bài viết': 'Please add either images or a video to one post, not both',
    'Tổng comments trên bài viết.': 'Total comments on the post.',
    'Tổng lượt click trên bài viết theo Facebook.': 'Total post clicks on Facebook.',
    'Tổng reactions trên bài viết.': 'Total reactions on the post.',
    'Tổng shares trên bài viết.': 'Total shares on the post.',
    'Tổng số lượt nội dung được xem/displayed/played; một người có thể tạo nhiều lượt xem.': 'Total times the Content was viewed, displayed, or played; one person may generate multiple views.',
    'Xem đầy đủ': 'View full details', '· sync lần cuối': '· last synced',
    'Engagement / Người xem × 100': 'Engagement / Viewers × 100', 'lỗi khác)': 'other errors)',
    'Tổng lượt click trên bài viết theo Facebook': 'Total post clicks on Facebook',
    'Tổng số lượt nội dung được xem/displayed/played; một người có thể tạo nhiều lượt xem': 'Total times the Content was viewed, displayed, or played; one person may generate multiple views',
    'Tùy chọn': 'Custom', 'Σ Eng:': 'Σ Engagement:', 'Σ Viewers:': 'Σ Viewers:',
    'Gồm: Ngày, Giờ, Chủ đề, Loại, Bài viết, Link ảnh/video': 'Includes: Date, Time, Topic, Type, Post, Image/video URL',
    'Gồm: Ngày, Giờ, Chủ đề, Loại, Ghi chú, Mô tả ảnh': 'Includes: Date, Time, Topic, Type, Notes, Image description',
    '● Đang hoạt động': '● Active', 'Chưa đặt tên': 'Unnamed', 'Đang dùng thử': 'Trial active',
    'Đang tạo đơn...': 'Creating order...', 'Đơn thanh toán đã hủy': 'Payment order cancelled',
    'Tạo lại thanh toán': 'Create payment again', 'Thanh toán thành công!': 'Payment successful!',
    'Tiếp tục thanh toán': 'Continue payment', 'Vui lòng liên hệ quản trị viên để được tư vấn.': 'Please contact an administrator for assistance.',
    'Xem chi tiết': 'View details', 'Chỉnh sửa Page': 'Edit Page', 'Đã kết nối thành công': 'Connected successfully',
    'Đang chuyển hướng...': 'Redirecting...', 'Đang kiểm tra...': 'Checking...', 'Đang xóa...': 'Deleting...',
    'Kết nối': 'Connect', 'Không thể kết nối Pages': 'Unable to connect Pages',
    'Kiểm tra và lấy Pages': 'Check and load Pages', 'Pages vào MKT Tools.': 'Pages to MKT Tools.',
    'Tài khoản này không có Page nào có thể quản lý.': 'This account has no manageable Pages.',
    'API key đã sẵn sàng': 'API key is ready', 'Chưa cấu hình App Secret': 'App Secret is not configured',
    'Chưa có API key cho nhà cung cấp này': 'No API key for this provider',
    'Khi lưu, hệ thống tự xác thực, đổi sang token dài hạn và mã hóa trên server.': 'When saved, the system validates it, exchanges it for a long-lived token, and encrypts it on the server.',
    'Lưu API key': 'Save API key'
  });

  function normalizeLocale(value) {
    const locale = String(value || '').toLowerCase().split('-')[0];
    return SUPPORTED.includes(locale) ? locale : null;
  }

  const queryLocale = normalizeLocale(new URLSearchParams(location.search).get('lang'));
  const storedLocale = normalizeLocale(localStorage.getItem(STORAGE_KEY));
  let locale = queryLocale || storedLocale || 'vi';
  let sourceTitle = document.title;
  if (queryLocale) localStorage.setItem(STORAGE_KEY, queryLocale);

  function lookup(source) {
    if (locale === 'vi' || !source) return source;
    const table = translations[locale] || {};
    const exact = table[source];
    if (exact) return exact;

    const leading = source.match(/^\s*/)[0];
    const trailing = source.match(/\s*$/)[0];
    const clean = source.trim();
    if (table[clean]) return leading + table[clean] + trailing;

    let value = clean;
    const replacements = [
      [/^(\d+) Pages$/, '$1 Pages'],
      [/^(\d+) Page$/, '$1 Page'],
      [/^(\d+) thành viên$/, '$1 members'],
      [/^(\d+)\s*\/\s*(\d+|∞) thành viên$/, '$1 / $2 members'],
      [/^(\d+) tháng$/, '$1 months'],
      [/^\/\s*(\d+) tháng$/, '/ $1 months'],
      [/^(\d+)\/(\d+) bài$/, '$1/$2 posts'],
      [/^(\d+) bài$/, '$1 posts'],
      [/^(\d+) page đã chọn$/i, '$1 Pages selected'],
      [/^(\d+) mục đã chọn$/, '$1 items selected'],
      [/^\(\+(\d+) lỗi khác\)$/, '(+$1 other errors)'],
      [/^Đã kết nối thành công (\d+) Pages vào MKT Tools\.$/, 'Successfully connected $1 Pages to MKT Tools.'],
      [/^(\d+|∞) Pages, (\d+|∞) thành viên$/, '$1 Pages, $2 members'],
      [/^(\d+) Pages · (\d+) thành viên$/, '$1 Pages · $2 members'],
      [/^Không giới hạn Pages · Không giới hạn thành viên$/, 'Unlimited Pages · Unlimited members'],
      [/^(\d+) Pages · Không giới hạn thành viên$/, '$1 Pages · Unlimited members'],
      [/^Không giới hạn Pages · (\d+) thành viên$/, 'Unlimited Pages · $1 members'],
      [/^(\d+) phút đọc$/, '$1 min read'],
      [/^(\d+) ngày qua$/, 'Last $1 days'],
      [/^(\d+) phút$/, '$1 minutes'],
      [/^(\d+) giờ$/, '$1 hours'],
      [/^(\d+) ngày$/, '$1 days'],
      [/^(\d+) nội dung$/, '$1 items'],
      [/^Kết quả từ (\d+) nội dung$/, 'Results from $1 items'],
      [/^Dữ liệu hiệu suất từ Facebook · sync lần cuối (.+)$/, 'Facebook performance data · last synced $1'],
      [/^· sync lần cuối (.+)$/, '· last synced $1'],
      [/^Dùng thử · Còn (.+)$/, 'Trial · $1 remaining'],
      [/^Còn (.+)$/, '$1 remaining'],
      [/^Hết hạn: (.+)$/, 'Expires: $1'],
      [/^Tổ chức:\s*(.+)$/, 'Organization: $1'],
      [/^Vai trò:\s*(.+)$/, 'Role: $1'],
      [/^Chào,\s*(.+)$/, 'Welcome, $1'],
      [/^Trang\s+(\d+)\s+\/\s+(\d+)$/, 'Page $1 / $2'],
      [/^Đã chọn\s+(\d+)$/, '$1 selected']
    ];
    for (const [pattern, replacement] of replacements) {
      if (pattern.test(value)) return leading + value.replace(pattern, replacement) + trailing;
    }
    return source;
  }

  const translatedNodes = new WeakMap();
  const translatedAttributes = new WeakMap();
  const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'aria-placeholder', 'alt'];

  function translateTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim()) return;
    let state = translatedNodes.get(node);
    if (!state || node.nodeValue !== state.rendered) {
      state = { source: node.nodeValue, rendered: node.nodeValue };
      translatedNodes.set(node, state);
    }
    const next = locale === 'vi' ? state.source : lookup(state.source);
    state.rendered = next;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function translateElement(element) {
    if (!(element instanceof Element) || element.closest('[data-i18n-ignore]')) return;
    let sources = translatedAttributes.get(element);
    if (!sources) {
      sources = {};
      translatedAttributes.set(element, sources);
    }
    for (const attr of ATTRIBUTES) {
      if (!element.hasAttribute(attr)) continue;
      const current = element.getAttribute(attr);
      let state = sources[attr];
      if (!state || current !== state.rendered) {
        state = { source: current, rendered: current };
        sources[attr] = state;
      }
      const next = locale === 'vi' ? state.source : lookup(state.source);
      state.rendered = next;
      if (element.getAttribute(attr) !== next) element.setAttribute(attr, next);
    }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (parent && (parent.closest('[data-i18n-ignore]') || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) node.nodeType === Node.TEXT_NODE ? translateTextNode(node) : translateElement(node);
  }

  function updateLinks() {
    document.querySelectorAll('a[href]').forEach((anchor) => {
      const raw = anchor.getAttribute('href');
      if (!raw || raw.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(raw)) return;
      try {
        const url = new URL(raw, location.href);
        const isMkt = url.origin === location.origin || /(^|\.)mktkit\.(com|vn)$/i.test(url.hostname);
        if (!isMkt) return;
        if (locale === 'en') url.searchParams.set('lang', 'en');
        else url.searchParams.delete('lang');
        anchor.href = url.toString();
      } catch (_) {}
    });
  }

  function renderSwitcher() {
    let switcher = document.querySelector('[data-locale-switcher]');
    if (!switcher) {
      switcher = document.createElement('div');
      switcher.dataset.localeSwitcher = '';
      switcher.dataset.i18nIgnore = '';
      switcher.className = 'mkt-locale-switcher mkt-locale-switcher--floating';
      document.body.appendChild(switcher);
    }
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Language');
    if (!switcher.querySelector('[data-locale]')) {
      switcher.innerHTML = '<button type="button" data-locale="vi">VI</button><span aria-hidden="true">/</span><button type="button" data-locale="en">EN</button>';
    }
    switcher.querySelectorAll('[data-locale]').forEach((button) => {
      const active = button.dataset.locale === locale;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.onclick = () => setLocale(button.dataset.locale);
    });
  }

  function setLocale(nextLocale) {
    const next = normalizeLocale(nextLocale);
    if (!next || next === locale) return;
    locale = next;
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    document.title = locale === 'en' ? lookup(sourceTitle) : sourceTitle;
    translateTree(document.body);
    renderSwitcher();
    updateLinks();
    document.dispatchEvent(new CustomEvent('mkt:locale-changed', { detail: { locale } }));
  }

  function init() {
    document.documentElement.lang = locale;
    sourceTitle = document.title;
    document.title = locale === 'en' ? lookup(sourceTitle) : sourceTitle;
    translateTree(document.body);
    renderSwitcher();
    updateLinks();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateTextNode(mutation.target);
        if (mutation.type === 'attributes') translateElement(mutation.target);
        mutation.addedNodes.forEach(translateTree);
      }
      updateLinks();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  }

  window.MKTI18n = { get locale() { return locale; }, setLocale, t: lookup, translate: translateTree };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
