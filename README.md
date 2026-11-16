# Nhà thông minh ESP32 DevKit qua MQTT

## 1. Chạy server broker

Cài Node.js 22 trở lên. Giải nén ZIP, mở terminal trong thư mục `Nha_Thong_Minh_MQTT` rồi chạy:

```bash
npm ci
npm start
```

Server chạy broker Aedes trên `mqtt://127.0.0.1:1883`, phục vụ web tại `http://localhost:5173` và cho web kết nối MQTT qua WebSocket tại `ws://localhost:5173/mqtt`. Giữ terminal này mở trong lúc demo.

Wokwi trên web dùng Public Gateway nên ESP32 không thể truy cập localhost của bạn. Server kết nối hai chiều với broker thử nghiệm `broker.hivemq.com:1883`. Trạng thái đi từ ESP32 qua broker thử nghiệm rồi tới broker local. Lệnh đi theo chiều ngược lại. Khi terminal hiện **Bridge MQTT đã kết nối**, server đã kết nối được broker thử nghiệm. Broker thử nghiệm là công khai, chỉ dùng dữ liệu và thiết bị mô phỏng.

## 2. Mở frontend

Mở [http://localhost:5173](http://localhost:5173). Trang sẽ báo **Broker đã kết nối** và **Đang chờ ESP32**. Các nút được bật khi nhận được dữ liệu mới từ ESP32.

## 3. Mở ESP32 DevKit trên Wokwi

1. Mở [dự án ESP32 mới trên Wokwi](https://wokwi.com/projects/new/esp32?template=esp32).
2. Thay toàn bộ nội dung hai tab `sketch.ino` và `diagram.json` bằng hai file tương ứng trong thư mục `wokwi/`. Nếu bạn đã có dự án Wokwi với đúng sơ đồ mạch cũ, chỉ cần thay sketch và bổ sung thư viện.
3. Vào **Library Manager → +** và thêm **DHT sensor library for ESPx** cùng **PubSubClient**. Danh sách cũng có trong `wokwi/libraries.txt`.
4. Chạy mô phỏng. Khi Serial Monitor hiện **MQTT connected**, quay lại web. Chờ một gói trạng thái để kiểm tra dòng **ESP32 đang hoạt động**.

## Kiểm tra

| Thao tác | Kết quả dự kiến |
| --- | --- |
| Web → Đèn → Bật hoặc Tắt | LED vàng đổi trạng thái và web hiển thị chế độ tương ứng |
| Web → Đèn → Tự động, giảm ánh sáng của LDR | LED vàng bật khi trời tối theo ngưỡng ADC |
| Web → Quạt → Tự động, đặt DHT22 ở 32 °C | Giá trị nhiệt độ lên web và LED xanh bật. Quạt tắt khi về 28 °C hoặc thấp hơn |
| Web → Mở cửa | Servo mở và cửa tự đóng sau khoảng 5 giây mô phỏng |
| Wokwi → nhấn nút xanh | Cửa mở, web cập nhật trạng thái cửa |
| Wokwi → gạt công tắc an ninh sang phải rồi kích PIR | Còi kêu, web hiển thị giám sát, chuyển động và trạng thái còi |
| Dừng mô phỏng | Web khóa các nút sau khoảng 9 giây không nhận dữ liệu |

Nếu web nhận broker nhưng vẫn chờ ESP32, kiểm tra ba điểm: mô phỏng đang chạy, Serial Monitor đã báo kết nối MQTT, terminal đã báo bridge kết nối. Nếu cổng web 5173 đang được dùng, trên Ubuntu chạy `WEB_PORT=5174 npm start` và mở localhost cổng 5174.

## MQTT để thử bằng MQTTX

Kết nối MQTT TCP tới host `127.0.0.1`, port `1883`, bỏ trống username và password. Tìm tiền tố topic trong dòng log lúc khởi động broker. Tiền tố này cũng nằm ở `HOME_TOPIC` trong sketch.

| Topic với tiền tố tương ứng | Dữ liệu |
| --- | --- |
| `<HOME_TOPIC>/state` | JSON trạng thái, ánh sáng theo ADC, nhiệt độ theo °C và độ ẩm theo % |
| `<HOME_TOPIC>/cmd/lamp` | `AUTO`, `ON`, `OFF` |
| `<HOME_TOPIC>/cmd/fan` | `AUTO`, `ON`, `OFF` |
| `<HOME_TOPIC>/cmd/door` | `OPEN`, `CLOSE` |

Gửi lệnh với QoS 0 và Retain tắt. Khi nhiều nhóm dùng chung bản ZIP, đổi tiền tố cho từng nhóm trong sketch và chạy `HOME_TOPIC='nhathongminh/ma-nhom-rieng' npm start` với cùng tiền tố.

Để chạy hoàn toàn nội bộ, dùng `MQTT_REMOTE= npm start` trên Ubuntu. Nếu muốn dùng Wokwi với broker nội bộ, cần cấu hình [Wokwi Private Gateway](https://docs.wokwi.com/guides/esp32-wifi#the-private-gateway) và đổi `MQTT_HOST` trong sketch thành `host.wokwi.internal`. Với luồng mô phỏng mặc định, giữ nguyên cấu hình.
