#!/bin/sh
# สร้างโฟลเดอร์ dist/ ที่มีแค่ไฟล์ที่หน้าเว็บใช้จริง (*.html + assets/ + sw.js)
# ใช้เป็น Build command ของ Cloudflare Pages:  sh scripts/build-site.sh   · Build output directory: dist
# ทำไม: ถ้า deploy ทั้ง repo ไฟล์ sql/ tests/ docs/ จะเปิดดูได้จาก URL สาธารณะ
set -e
cd "$(dirname "$0")/.."
rm -rf dist
mkdir dist
cp *.html dist/
cp -r assets dist/
rm -rf dist/assets/css/archive  # ธีมเก่าไม่ได้ใช้ ไม่ต้องขึ้นเว็บ
[ -f sw.js ] && cp sw.js dist/
[ -f _headers ] && cp _headers dist/  # header ความปลอดภัย (CSP ฯลฯ) ของ Cloudflare Pages
echo "dist/ พร้อม deploy: $(find dist -type f | wc -l) ไฟล์"
