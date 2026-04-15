# Quiz Game Local

Ứng dụng **quiz game chạy trong LAN** với kiến trúc server-authoritative, gồm 2 giao diện:
- **Host Dashboard** (máy điều khiển cuộc thi)
- **Client Join** (điện thoại/máy con tham gia trả lời)

## 1) Tóm tắt chương trình

Hệ thống cho phép host tạo phòng, hiển thị QR để người chơi vào nhanh qua mạng nội bộ, điều khiển từng phase của trò chơi theo thời gian thực bằng Socket.IO.

Luồng phase chính:

`main_slide → lobby → question → reveal → scoreboard → (slide nếu có ảnh) → elimination/final → summary → thankyou`

Điểm nổi bật:
- Tính điểm theo thời gian trả lời còn lại.
- Loại đội theo cấu hình round.
- Bỏ qua `slide` giữa câu nếu `slide_image` rỗng.
- Hỗ trợ **toggle ngôn ngữ VN/EN** ở góc phải trên của trang Host và Client để đồng bộ keyword hiển thị.

---

## 2) Cấu trúc thư mục (tree)

```text
Quiz_game_local2/
├── config.json                 # Cấu hình round, điểm, icon, màu team
├── questions.json              # Ngân hàng câu hỏi + slide cấu hình
├── server.js                   # Server Express + Socket.IO + game flow
├── game_state.json             # Trạng thái game lưu tạm
├── match_history.json          # Lịch sử trận
├── package.json
├── package-lock.json
├── public/
│   ├── host/
│   │   └── index.html          # Giao diện host dashboard
│   ├── client/
│   │   └── index.html          # Giao diện người chơi
│   └── shared/
│       ├── style-base.css      # CSS dùng chung + lang toggle style
│       └── sounds.js           # Điều khiển âm thanh
├── test_simulation.js          # Script test mô phỏng (nếu dùng)
└── walkthrough.md              # Ghi chú/flow tài liệu nội bộ
```

---

## 3) Cài đặt

### Yêu cầu
- Node.js 18+ (khuyến nghị LTS mới)
- npm
- Các thiết bị cùng chung mạng LAN/Wi-Fi

### Các bước

1. Cài dependency:
```bash
npm install
```

2. Chạy server:
```bash
npm start
```
hoặc
```bash
node server.js
```

3. Mở Host Dashboard trên máy điều khiển:
```text
http://localhost:3000/host
```

4. Cho người chơi tham gia:
- Quét QR từ màn host
- Hoặc mở trực tiếp URL LAN hiển thị trên host (vd: `http://192.168.x.x:3000`)

---

## 4) Cách dùng nhanh

1. Host vào `/host`, chờ QR hiển thị.
2. Người chơi vào trang join, chọn icon + nhập tên đội.
3. Host bấm **Bắt đầu trò chơi / Start game**.
4. Host điều khiển các phase bằng thanh control bên dưới.
5. Cuối game có podium, summary và thank-you.

---

## 5) Tùy chỉnh

### `config.json`
- `rounds`: số câu, timer, số đội đi tiếp (`advanceCount`) theo từng round.
- `icons`: danh sách icon chọn đội.
- `scoring`: công thức điểm nền + điểm thưởng theo thời gian.
- `maxTeams`, `minTeamsToStart`: giới hạn đội.

### `questions.json`
- Mỗi câu hỏi có: `text`, `answers`, `correct_index`, `time_limit`, `slide_image`.
- Nếu `slide_image` rỗng (`""`), hệ thống sẽ bỏ qua phase slide câu đó.

---

## 6) Lưu ý khi sử dụng

- **Mạng LAN ổn định** là điều kiện quan trọng nhất để cập nhật realtime mượt.
- Nếu đổi nội dung `config.json`/`questions.json`, nên restart server để áp dụng nhất quán.
- Khi chạy thực tế, nên mở host bằng màn hình lớn để hiển thị scoreboard/reveal tốt hơn.
- Trình duyệt trên điện thoại nên là bản mới để hỗ trợ tốt animation + audio.
- Ngôn ngữ VN/EN dùng `localStorage` theo từng trình duyệt thiết bị; mỗi máy có thể chọn độc lập.

---

## 7) Lệnh hữu ích

```bash
# chạy server
npm start

# kiểm tra cú pháp server
node --check server.js

# kiểm tra JSON hợp lệ
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); JSON.parse(require('fs').readFileSync('questions.json','utf8')); console.log('json ok')"
```
