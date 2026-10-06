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
      [/^(\d+) phút đọc$/, '$1 min read'],
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
      if (!(attr in sources)) sources[attr] = element.getAttribute(attr);
      const next = locale === 'vi' ? sources[attr] : lookup(sources[attr]);
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
        mutation.addedNodes.forEach(translateTree);
      }
      updateLinks();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.MKTI18n = { get locale() { return locale; }, setLocale, t: lookup, translate: translateTree };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
