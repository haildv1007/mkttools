# MKT Tools — Thiết kế hệ thống

## 1. Tổng quan

Hệ thống tự động hóa content marketing cho mạng xã hội.

**Quy mô**: 10-20 pages, ~5 bài/page/ngày → 50-100 bài/ngày
**Budget AI**: ~1-2 triệu VND/tháng (~$40-80 USD)

```
┌─────────────────────────────────────────────────────────────┐
│                      ADMIN DASHBOARD                         │
│  (Quản lý pages, lịch đăng, thống kê, import kịch bản)      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      BACKEND API                             │
│                   (Express + TypeScript)                      │
├──────────┬───────────┬────────────┬─────────────────────────┤
│ Campaign │ Content   │ Telegram   │ Social                  │
│ Manager  │ Generator │ Bot        │ Publisher               │
│          │ (AI)      │ (Duyệt)   │ (FB/TikTok)             │
└────┬─────┴─────┬─────┴──────┬────┴──────────┬──────────────┘
     │           │            │               │
┌────▼───┐ ┌────▼────┐ ┌─────▼─────┐ ┌───────▼───────┐
│PostgreSQL│ │ Redis   │ │ Telegram  │ │ Facebook API  │
│(data)   │ │ (queue) │ │ API       │ │ TikTok API    │
└─────────┘ └─────────┘ └───────────┘ └───────────────┘
```

---

## 2. Luồng hoạt động chính

```
Bước 1: Import kịch bản (Excel/Sheet)
   │
   ▼
Bước 2: Hệ thống parse → tạo content schedule theo ngày/giờ
   │
   ▼
Bước 3: Đến giờ → Queue trigger → AI gen bài viết + ảnh
   │
   ▼
Bước 4: Gửi preview qua Telegram Bot cho admin duyệt
   │
   ├── ✅ Duyệt → chuyển sang bước 5
   ├── ✏️ Yêu cầu sửa → quay lại bước 3 (AI sửa theo feedback)
   └── ❌ Reject → hủy, thông báo
   │
   ▼
Bước 5: Auto-post lên Facebook Page / TikTok theo lịch
   │
   ▼
Bước 6: Dashboard cập nhật thống kê
```

---

## 3. Các module chi tiết

### 3.1 Campaign Manager
- Import file Excel/CSV chứa kịch bản marketing
- Cột bắt buộc: `ngày`, `giờ_đăng`, `page`, `chủ_đề`, `loại_content` (ảnh/video/text), `ghi_chú`
- Parse và tạo schedule trong DB
- Hỗ trợ template kịch bản để dùng lại

### 3.2 AI Content Generator
- **Gen bài viết**: Claude API (model Haiku — rẻ, nhanh, đủ tốt cho social content)
  - Input: chủ đề, tone, page info, ghi chú từ kịch bản
  - Output: caption, hashtag, CTA
  - Chi phí ước tính: ~$0.001/bài → 100 bài/ngày × 30 ngày = ~$3/tháng

- **Gen ảnh**: 2 lựa chọn
  - **Flux (qua Replicate)**: ~$0.003/ảnh → 100 ảnh/ngày × 30 = ~$9/tháng ✅ Recommend
  - **DALL-E 3 (OpenAI)**: ~$0.04/ảnh → 100 ảnh/ngày × 30 = ~$120/tháng ❌ Quá budget

- **Video**: Giai đoạn 1 dùng template-based (FFmpeg)
  - Ghép ảnh + text overlay + nhạc nền → video ngắn
  - Free, chạy trên VPS
  - Giai đoạn sau có thể tích hợp Kling/Runway nếu cần

### 3.3 Telegram Bot (Duyệt content)
- Bot gửi preview: ảnh + caption + thông tin page + giờ đăng
- Inline keyboard: [✅ Duyệt] [✏️ Sửa] [❌ Hủy]
- Nếu sửa: admin reply feedback → AI gen lại → gửi lại preview
- Gửi theo lịch duyệt (VD: sáng 8h gửi batch content cả ngày)
- Hỗ trợ nhiều admin (mỗi admin quản lý các page khác nhau)

### 3.4 Social Publisher
- **Facebook Pages** (Graph API):
  - Post text + ảnh/video
  - Schedule post (đặt lịch đăng tương lai)
  - Lấy metrics (reach, like, comment, share)
  - Cần: Facebook App + Page Access Token (long-lived)

- **TikTok** (Content Posting API) — Giai đoạn 2:
  - Upload + publish video
  - Cần app review từ TikTok (mất 1-2 tuần)
  - Chỉ hỗ trợ video, không post ảnh đơn
  - Fallback: gửi Telegram nhắc đăng tay

### 3.5 Admin Dashboard
- Quản lý pages/channels (thêm, sửa, xóa, kết nối token)
- Content calendar (xem lịch đăng dạng calendar view)
- Thống kê: số bài đăng, trạng thái (chờ duyệt/đã duyệt/đã đăng/lỗi)
- Import/export kịch bản
- Quản lý user (thêm admin phụ)

---

## 4. Tech Stack đề xuất

| Thành phần      | Công nghệ              | Lý do                                    |
|-----------------|------------------------|-------------------------------------------|
| Backend API     | Node.js + TypeScript   | Async tốt, ecosystem lớn, dễ deploy VPS  |
| Web framework   | Express.js             | Đơn giản, mature, đủ dùng                |
| Database        | PostgreSQL             | Relational, hỗ trợ JSON, free            |
| ORM             | Prisma                 | Type-safe, migration dễ, DX tốt          |
| Job Queue       | BullMQ + Redis         | Schedule jobs, retry, concurrency control |
| AI Text         | Claude Haiku (Anthropic)| Rẻ (~$0.001/bài), nhanh, chất lượng tốt  |
| AI Image        | Flux via Replicate     | Rẻ (~$0.003/ảnh), chất lượng cao         |
| Video           | FFmpeg (template)      | Free, self-host, đủ cho video đơn giản   |
| Telegram Bot    | node-telegram-bot-api  | Mature, dễ dùng                           |
| Dashboard       | Next.js (React)        | SSR, full-stack, deploy dễ               |
| Deploy          | VPS (Docker Compose)   | Toàn bộ chạy trên 1 VPS                  |

---

## 5. Database Schema (sơ bộ)

```
Users (admin accounts)
  ├── id, email, name, role, telegram_chat_id

Pages (Facebook pages, TikTok channels)
  ├── id, platform (facebook|tiktok), name, page_id
  ├── access_token, status
  └── user_id (admin quản lý)

Campaigns (kịch bản marketing)
  ├── id, name, description, start_date, end_date
  └── user_id

ContentItems (từng bài content)
  ├── id, campaign_id, page_id
  ├── scheduled_at (ngày giờ đăng)
  ├── topic, notes, content_type (image|video|text)
  ├── generated_text, generated_image_url
  ├── status (draft|generating|pending_review|approved|published|failed)
  ├── telegram_message_id
  ├── social_post_id (ID bài đăng trên FB/TikTok)
  └── published_at, metrics_json

ApprovalLogs (lịch sử duyệt)
  ├── id, content_item_id, admin_id
  ├── action (approve|reject|request_edit)
  ├── feedback, created_at
```

---

## 6. Chi phí ước tính hàng tháng

| Hạng mục              | Ước tính          |
|------------------------|-------------------|
| Claude Haiku (text)    | ~$3-5             |
| Flux/Replicate (ảnh)   | ~$9-15            |
| VPS (2-4GB RAM)        | ~$5-15            |
| Redis (chạy cùng VPS)  | $0                |
| PostgreSQL (cùng VPS)  | $0                |
| Telegram Bot           | Free              |
| Facebook API           | Free              |
| **Tổng**               | **~$17-35/tháng** |

→ Nằm trong budget 1-2 triệu VND ✅

---

## 7. Phân pha triển khai

### Phase 1 — MVP (2-3 tuần)
- [ ] Backend API + DB schema
- [ ] Import Excel → tạo schedule
- [ ] AI gen bài viết (Claude Haiku)
- [ ] Telegram Bot duyệt (approve/reject)
- [ ] Đăng bài Facebook Page
- [ ] Dashboard cơ bản (list pages, list content, trạng thái)

### Phase 2 — Hoàn thiện (2-3 tuần)
- [ ] AI gen ảnh (Flux/Replicate)
- [ ] Video template (FFmpeg)
- [ ] Content calendar view
- [ ] Thống kê dashboard
- [ ] Multi-admin

### Phase 3 — Mở rộng
- [ ] TikTok integration
- [ ] AI video generation (Kling/Runway)
- [ ] Auto-optimize (AI phân tích metrics → gợi ý content tốt hơn)
- [ ] A/B testing content

---

## 8. Câu hỏi cần chốt

1. **Tech stack** — Node.js + TS như trên OK không? Hay muốn Python?
2. **AI ảnh** — Flux (rẻ) hay DALL-E (đắt hơn nhưng quen thuộc)?
3. **Dashboard** — Next.js hay muốn dùng framework khác (Vue, Angular)?
4. **Deploy** — Docker Compose trên VPS OK? Hay cần hỗ trợ cPanel?
5. **Phase 1 scope** — Bắt đầu MVP như trên, hay muốn điều chỉnh?
