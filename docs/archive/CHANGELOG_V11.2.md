# VIMS2 Lite — V11.2 Business Intelligence

## เป้าหมาย
เปลี่ยน Dashboard จากหน้าแสดงตัวเลขให้เป็นหน้า **Decision Support** สำหรับเจ้าของร้าน โดยสรุปสัญญาณจากข้อมูลจริงที่มีอยู่แล้วในระบบ

## เพิ่มใหม่
- Business Intelligence / SIGNAL cards
  - Margin signal
  - Capital locked in unrecovered Lots
  - Price realization เทียบราคาตั้งปัจจุบัน
  - Best weekday signal
- Month-end run-rate estimate จากยอดขายเฉลี่ยต่อวัน
- แสดงทุน Stock คงเหลือ / มูลค่าขายตามราคาปัจจุบัน / Upside
- สถานะ Insight: สถานะดี / มีโอกาสปรับปรุง / ต้องจับตา

## แก้ไข
- Custom date range ถูกจำไว้ใน `activeRange` เพื่อให้ realtime refresh กลับมาใช้ช่วงเดิม
- ไม่เพิ่ม/เปลี่ยน database schema

## หลักการคำนวณ
- Margin = (ยอดขาย - cost_price) / ยอดขาย
- Capital locked = remaining capital ของ Lot ที่ recovery < 100%
- Price realization = sale_price / current_price ของสินค้าที่มี current_price
- Run-rate = ยอดขายช่วงที่เลือก / จำนวนวันที่ผ่านในช่วงนั้น แล้วคูณจำนวนวันที่เหลือของเดือนปัจจุบัน

> Run-rate เป็นประมาณการเชิงบริหาร ไม่ใช่ forecast ที่รับประกันยอดขาย
