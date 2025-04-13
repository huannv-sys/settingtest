#!/bin/bash

# Script cài đặt MikroTik Monitor từ file nén local
# Phiên bản: 1.0.0
# Tác giả: MikroTik Monitor Team
# Sử dụng: ./install.sh

set -e

# Màu sắc cho output
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Tên thư mục giải nén
APP_NAME="mikromonitor"
APP_DIR="/opt/$APP_NAME"
DEFAULT_PORT=5000
DATABASE_NAME="mikromonitor_db"
DATABASE_USER="mikromonitor_user"
DATABASE_PASSWORD="$(openssl rand -hex 12)"

# Kiểm tra quyền sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Vui lòng chạy script với quyền sudo!${NC}"
  exit 1
fi

echo -e "${GREEN}===== MikroTik Monitor - Trình cài đặt tự động =====${NC}"
echo -e "${YELLOW}Script này sẽ cài đặt MikroTik Monitor trên hệ thống của bạn."
echo -e "Quá trình cài đặt bao gồm: Node.js, PostgreSQL, và các gói phụ thuộc.${NC}"
echo ""

# Hỏi về cổng dịch vụ
read -p "Nhập cổng để chạy ứng dụng [mặc định: $DEFAULT_PORT]: " PORT
PORT=${PORT:-$DEFAULT_PORT}

# Hỏi về domain (nếu có)
read -p "Nhập domain cho ứng dụng (để trống nếu chỉ dùng IP): " DOMAIN

# Cài đặt các gói cần thiết
echo -e "${GREEN}[1/7] Cài đặt các gói phụ thuộc...${NC}"
apt-get update
apt-get install -y curl gnupg2 unzip zip git build-essential python3 python3-pip ufw nodejs npm postgresql postgresql-contrib

# Cài đặt Node.js phiên bản mới nhất
echo -e "${GREEN}[2/7] Cài đặt Node.js...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 16 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  apt-get install -y nodejs
fi

# Tạo thư mục ứng dụng
echo -e "${GREEN}[3/7] Thiết lập thư mục ứng dụng...${NC}"
mkdir -p $APP_DIR

# Kiểm tra xem có file ZIP đi kèm không
if [ -f "mikromonitor.zip" ]; then
  echo -e "${GREEN}Phát hiện file cài đặt mikromonitor.zip...${NC}"
  unzip -q mikromonitor.zip -d $APP_DIR
else
  echo -e "${RED}Không tìm thấy file mikromonitor.zip! Vui lòng đảm bảo file này nằm cùng thư mục với script.${NC}"
  exit 1
fi

# Cài đặt các gói phụ thuộc npm
echo -e "${GREEN}[4/7] Cài đặt các gói phụ thuộc JavaScript...${NC}"
cd $APP_DIR
npm install

# Thiết lập cơ sở dữ liệu PostgreSQL
echo -e "${GREEN}[5/7] Thiết lập cơ sở dữ liệu PostgreSQL...${NC}"
sudo -u postgres psql -c "CREATE USER $DATABASE_USER WITH PASSWORD '$DATABASE_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE $DATABASE_NAME OWNER $DATABASE_USER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DATABASE_NAME TO $DATABASE_USER;"

# Tạo file .env
echo -e "${GREEN}[6/7] Tạo file cấu hình môi trường...${NC}"
cat > $APP_DIR/.env << EOL
NODE_ENV=production
PORT=$PORT
DATABASE_URL=postgresql://$DATABASE_USER:$DATABASE_PASSWORD@localhost:5432/$DATABASE_NAME
EOL

# Tạo service systemd
echo -e "${GREEN}[7/7] Tạo service systemd...${NC}"
cat > /etc/systemd/system/mikromonitor.service << EOL
[Unit]
Description=MikroTik Monitor Service
After=network.target postgresql.service

[Service]
Environment=NODE_ENV=production
Type=simple
User=root
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOL

# Cài đặt database schema
echo -e "${GREEN}Đang cài đặt cấu trúc cơ sở dữ liệu...${NC}"
cd $APP_DIR
npm run db:push

# Khởi động service
systemctl daemon-reload
systemctl enable mikromonitor.service
systemctl start mikromonitor.service

# Mở cổng tường lửa
echo -e "${GREEN}Cấu hình tường lửa...${NC}"
ufw allow $PORT/tcp
ufw allow ssh
ufw --force enable

# Hiển thị thông tin
IPADDRESS=$(hostname -I | awk '{print $1}')
echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}Cài đặt MikroTik Monitor hoàn tất!${NC}"
echo -e "${YELLOW}Thông tin truy cập:${NC}"
echo -e "URL: http://$IPADDRESS:$PORT"
if [ ! -z "$DOMAIN" ]; then
  echo -e "Hoặc: http://$DOMAIN:$PORT (sau khi cấu hình DNS)"
fi
echo -e "${YELLOW}Thông tin cơ sở dữ liệu:${NC}"
echo -e "Database: $DATABASE_NAME"
echo -e "Username: $DATABASE_USER"
echo -e "Password: $DATABASE_PASSWORD"
echo -e "${YELLOW}Lưu ý: Vui lòng lưu thông tin trên để sử dụng sau này.${NC}"
echo -e "${GREEN}===============================================${NC}"
echo -e "Để xem log của ứng dụng: ${YELLOW}sudo journalctl -u mikromonitor -f${NC}"
echo -e "Để khởi động lại ứng dụng: ${YELLOW}sudo systemctl restart mikromonitor${NC}"
echo -e "${GREEN}===============================================${NC}"

# Tạo script backup
cat > $APP_DIR/backup.sh << EOL
#!/bin/bash
BACKUP_DIR="\$HOME/mikromonitor_backups"
BACKUP_FILE="\$BACKUP_DIR/mikromonitor_\$(date +%Y%m%d_%H%M%S).sql"
mkdir -p \$BACKUP_DIR
echo "Đang sao lưu cơ sở dữ liệu PostgreSQL..."
PGPASSWORD="$DATABASE_PASSWORD" pg_dump -U $DATABASE_USER -h localhost $DATABASE_NAME > \$BACKUP_FILE
echo "Sao lưu hoàn tất: \$BACKUP_FILE"
EOL

chmod +x $APP_DIR/backup.sh

# Tạo script cập nhật từ file zip
cat > $APP_DIR/update.sh << EOL
#!/bin/bash
if [ "\$EUID" -ne 0 ]; then
  echo "Vui lòng chạy script với quyền sudo!"
  exit 1
fi

if [ ! -f "mikromonitor.zip" ]; then
  echo "Không tìm thấy file mikromonitor.zip! Vui lòng đảm bảo file này nằm cùng thư mục với script."
  exit 1
fi

echo "Đang dừng dịch vụ..."
systemctl stop mikromonitor.service

echo "Sao lưu thư mục cũ..."
BACKUP_DIR="/opt/mikromonitor_backup_\$(date +%Y%m%d_%H%M%S)"
mkdir -p \$BACKUP_DIR
cp -r $APP_DIR/* \$BACKUP_DIR/

echo "Cập nhật ứng dụng..."
unzip -q -o mikromonitor.zip -d $APP_DIR

echo "Cài đặt các gói phụ thuộc..."
cd $APP_DIR
npm install

echo "Cập nhật cơ sở dữ liệu..."
npm run db:push

echo "Khởi động lại dịch vụ..."
systemctl start mikromonitor.service

echo "Cập nhật hoàn tất!"
EOL

chmod +x $APP_DIR/update.sh

# Tạo script cài đặt AbuseIPDB
cat > $APP_DIR/setup_abuseipdb.sh << EOL
#!/bin/bash
if [ "\$EUID" -ne 0 ]; then
  echo "Vui lòng chạy script với quyền sudo!"
  exit 1
fi

read -p "Nhập API key cho AbuseIPDB: " API_KEY

if [ -z "\$API_KEY" ]; then
  echo "API key không được để trống!"
  exit 1
fi

# Lưu API key vào file .env
if grep -q "ABUSEIPDB_API_KEY" $APP_DIR/.env; then
  sed -i "s/ABUSEIPDB_API_KEY=.*/ABUSEIPDB_API_KEY=\$API_KEY/" $APP_DIR/.env
else
  echo "ABUSEIPDB_API_KEY=\$API_KEY" >> $APP_DIR/.env
fi

# Thiết lập ngưỡng tin cậy
read -p "Nhập ngưỡng tin cậy cho cảnh báo (1-100, mặc định: 90): " THRESHOLD
THRESHOLD=\${THRESHOLD:-90}

if ! [[ "\$THRESHOLD" =~ ^[0-9]+$ ]] || [ \$THRESHOLD -lt 1 ] || [ \$THRESHOLD -gt 100 ]; then
  echo "Ngưỡng tin cậy phải là số từ 1 đến 100!"
  exit 1
fi

if grep -q "ABUSEIPDB_THRESHOLD" $APP_DIR/.env; then
  sed -i "s/ABUSEIPDB_THRESHOLD=.*/ABUSEIPDB_THRESHOLD=\$THRESHOLD/" $APP_DIR/.env
else
  echo "ABUSEIPDB_THRESHOLD=\$THRESHOLD" >> $APP_DIR/.env
fi

# Khởi động lại dịch vụ
systemctl restart mikromonitor.service

echo "Đã cấu hình thành công AbuseIPDB với API key và ngưỡng tin cậy \$THRESHOLD%."
echo "Ứng dụng sẽ tự động chặn các IP có độ tin cậy dưới \$THRESHOLD%."
EOL

chmod +x $APP_DIR/setup_abuseipdb.sh

exit 0