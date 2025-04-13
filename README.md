# FixxMik

Ứng dụng quản lý thiết bị MikroTik với các tính năng:
- Quản lý bảng ARP
- Quản lý Firewall Rules
- Giám sát thiết bị Client
- Bảo mật và giám sát mạng

## Cấu trúc thư mục

- `client/`: Mã nguồn frontend React
  - `src/components/`: Components UI
    - `clients/`: Components quản lý thiết bị khách hàng
    - `security/`: Components quản lý bảo mật
    - `ui/`: UI components chung
  - `src/pages/`: Các trang trong ứng dụng

- `server/`: Mã nguồn backend
  - `services/`: Các dịch vụ backend
  - `routes.ts`: Định nghĩa API
  - `index.ts`: Entry point

- `shared/`: Mã nguồn dùng chung giữa client và server
  - `schema.ts`: Schema cơ sở dữ liệu

## Cài đặt và chạy

```
# Cài đặt dependencies
npm install

# Tạo schema cơ sở dữ liệu
npm run db:push

# Chạy ứng dụng ở chế độ development
npm run dev

# Build ứng dụng
npm run build

# Chạy ứng dụng đã build
npm start
```