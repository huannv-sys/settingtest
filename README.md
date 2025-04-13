# MikroTik Monitor - Hướng dẫn cài đặt

MikroTik Monitor là ứng dụng web giám sát và quản lý các thiết bị MikroTik. Ứng dụng cung cấp đầy đủ các tính năng giám sát hiệu suất, phân tích lưu lượng mạng, cảnh báo bảo mật và quản lý thiết bị từ xa.

## Yêu cầu hệ thống

- Ubuntu 18.04 LTS trở lên (hoặc các bản phân phối Linux tương tự)
- Tối thiểu 2GB RAM
- Tối thiểu 20GB dung lượng ổ đĩa
- Kết nối mạng ổn định

## Cài đặt tự động

### Bước 1: Chuẩn bị file cài đặt

Tải file `mikromonitor.zip` và file `install.sh` vào cùng một thư mục trên máy chủ Ubuntu.

### Bước 2: Phân quyền cho script cài đặt

```bash
chmod +x install.sh
```

### Bước 3: Chạy script cài đặt

```bash
sudo ./install.sh
```

Script sẽ:
- Cài đặt các gói phụ thuộc (Node.js, PostgreSQL, và các gói cần thiết khác)
- Tạo cơ sở dữ liệu PostgreSQL
- Cấu hình ứng dụng và tạo service systemd
- Mở cổng tường lửa
- Cung cấp thông tin truy cập khi hoàn tất

## Các script quản lý đi kèm

Sau khi cài đặt, hệ thống bao gồm các script sau:

1. **Sao lưu cơ sở dữ liệu**:
   ```bash
   sudo /opt/mikromonitor/backup.sh
   ```

2. **Cài đặt AbuseIPDB** (để kiểm tra và tự động chặn IP độc hại):
   ```bash
   sudo /opt/mikromonitor/setup_abuseipdb.sh
   ```

3. **Cập nhật ứng dụng** (từ file zip mới):
   ```bash
   sudo /opt/mikromonitor/update.sh
   ```

## Quản lý dịch vụ

- **Xem log hệ thống**:
  ```bash
  sudo journalctl -u mikromonitor -f
  ```

- **Khởi động lại dịch vụ**:
  ```bash
  sudo systemctl restart mikromonitor
  ```

- **Dừng dịch vụ**:
  ```bash
  sudo systemctl stop mikromonitor
  ```

- **Kiểm tra trạng thái**:
  ```bash
  sudo systemctl status mikromonitor
  ```

## Tích hợp tính năng SIEM và phân tích bảo mật

MikroTik Monitor tích hợp các tính năng SIEM (Security Information and Event Management) nâng cao:

1. **Phân tích lưu lượng mạng** - Tự động phát hiện các mẫu lưu lượng bất thường
2. **Kiểm tra danh tiếng IP** - Tích hợp với AbuseIPDB để kiểm tra IP độc hại
3. **Tự động chặn các mối đe dọa** - Tự động thêm các quy tắc tường lửa để chặn các IP nguy hiểm
4. **Phân tích log xác thực** - Phát hiện các nỗ lực đăng nhập bất thường

## Cấu hình tùy chỉnh

Để tùy chỉnh cấu hình, bạn có thể chỉnh sửa file `.env` trong thư mục `/opt/mikromonitor`:

```bash
sudo nano /opt/mikromonitor/.env
```

Sau khi thay đổi cấu hình, khởi động lại dịch vụ:

```bash
sudo systemctl restart mikromonitor
```

## Khắc phục sự cố

- **Ứng dụng không hoạt động**: Kiểm tra log với `sudo journalctl -u mikromonitor -f`
- **Lỗi kết nối cơ sở dữ liệu**: Kiểm tra thông tin kết nối trong file `.env` và đảm bảo PostgreSQL đang chạy
- **Không thể truy cập từ xa**: Kiểm tra cài đặt tường lửa với `sudo ufw status`

## Hỗ trợ

Để được hỗ trợ thêm, vui lòng liên hệ:
- Email: support@mikromonitor.example.com
- Trang web: https://www.mikromonitor.example.com