#!/bin/bash

# Script chuẩn bị và đóng gói ứng dụng MikroTik Monitor thành file cài đặt
# Phiên bản: 1.0.0
# Tác giả: MikroTik Monitor Team

set -e

# Màu sắc cho output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}===== MikroTik Monitor - Tạo gói cài đặt =====${NC}"
echo -e "${YELLOW}Script này sẽ tạo file cài đặt hoàn chỉnh cho MikroTik Monitor.${NC}"
echo ""

# Kiểm tra Node.js và npm
echo -e "${GREEN}[1/5] Kiểm tra môi trường...${NC}"
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
  echo -e "${RED}Node.js và npm không được cài đặt. Đang cài đặt...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Kiểm tra phiên bản Node.js
NODE_VERSION=$(node -v | tr -d 'v' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
  echo -e "${RED}Node.js phiên bản $NODE_VERSION không đủ. Cần Node.js 16+. Đang cài đặt...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo -e "Node.js: $(node -v)"
echo -e "npm: $(npm -v)"

# Tạo thư mục làm việc tạm thời
TEMP_DIR=$(mktemp -d)
BUILD_DIR="$TEMP_DIR/mikromonitor"
mkdir -p "$BUILD_DIR"

# Clone repository từ GitHub nếu đường dẫn không được cung cấp
echo -e "${GREEN}[2/5] Chuẩn bị mã nguồn...${NC}"

if [ -d "./client" ] && [ -d "./server" ]; then
  echo -e "Phát hiện mã nguồn trong thư mục hiện tại, sao chép..."
  cp -r ./* "$BUILD_DIR/"
  # Loại bỏ các thư mục và file không cần thiết
  rm -rf "$BUILD_DIR/node_modules" "$BUILD_DIR/.git" "$BUILD_DIR/.github" "$BUILD_DIR/.vscode" "$BUILD_DIR/tmp"
else
  echo -e "${RED}Không tìm thấy mã nguồn trong thư mục hiện tại!${NC}"
  read -p "Nhập URL GitHub để clone (để trống để thoát): " GITHUB_URL
  
  if [ -z "$GITHUB_URL" ]; then
    echo -e "${RED}Không có URL được cung cấp. Thoát.${NC}"
    exit 1
  fi
  
  # Clone repository
  git clone "$GITHUB_URL" "$BUILD_DIR"
  # Loại bỏ thư mục .git
  rm -rf "$BUILD_DIR/.git" "$BUILD_DIR/.github" "$BUILD_DIR/.vscode" "$BUILD_DIR/tmp"
fi

# Cài đặt các phụ thuộc và build ứng dụng
echo -e "${GREEN}[3/5] Cài đặt phụ thuộc và build ứng dụng...${NC}"
cd "$BUILD_DIR"

# Cài đặt phụ thuộc
npm install

# Build client
echo -e "Building client..."
npm run build

# Dọn dẹp
echo -e "${GREEN}[4/5] Dọn dẹp và tối ưu hóa package...${NC}"

# Xóa các file và thư mục không cần thiết
rm -rf node_modules/.cache
rm -rf .git .github .vscode .gitignore .env.example
find . -name "*.log" -type f -delete
find . -name "*.test.js" -type f -delete
find . -name "*.test.ts" -type f -delete
find . -name "*.spec.js" -type f -delete
find . -name "*.spec.ts" -type f -delete

# Cài đặt lại các phụ thuộc ở chế độ production
npm ci --production

# Tạo file zip cài đặt
echo -e "${GREEN}[5/5] Tạo file cài đặt...${NC}"
PACKAGE_DIR=$(pwd)
ZIP_FILE="$PACKAGE_DIR/mikromonitor.zip"

# Di chuyển về thư mục cha và nén
cd ..
zip -r "$ZIP_FILE" "mikromonitor" -x "mikromonitor/node_modules/.cache/*" "mikromonitor/.git/*" "mikromonitor/.github/*"

# Lấy script cài đặt và sao chép ra
cp "$BUILD_DIR/install.sh" "$PACKAGE_DIR/"

# Hiển thị thông tin
echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}Đã tạo gói cài đặt thành công!${NC}"
echo -e "${YELLOW}Thông tin file:${NC}"
echo -e "File ZIP: $ZIP_FILE ($(du -h "$ZIP_FILE" | cut -f1))"
echo -e "Script cài đặt: $PACKAGE_DIR/install.sh"
echo -e "${GREEN}===============================================${NC}"
echo -e "Hướng dẫn sử dụng:"
echo -e "1. Sao chép file 'mikromonitor.zip' và 'install.sh' vào máy chủ Ubuntu"
echo -e "2. Phân quyền thực thi cho script: ${YELLOW}chmod +x install.sh${NC}"
echo -e "3. Chạy script cài đặt: ${YELLOW}sudo ./install.sh${NC}"
echo -e "${GREEN}===============================================${NC}"

# Dọn dẹp
rm -rf "$TEMP_DIR"

exit 0