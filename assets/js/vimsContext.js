// ==========================================================
// VIMS Context — จำ Lot/กลุ่ม/โหมดล่าสุดที่ผู้ใช้ทำงานอยู่
// ==========================================================
// ลำดับความสำคัญ: URL (?lot=&group=&mode=) > localStorage (ค่าล่าสุด) > ไม่มี
// ทำไมต้องมีไฟล์นี้แยก: หน้า Lots, Items, Sell ต้องอ่าน/เขียน context เดียวกัน
// เพื่อให้ปุ่ม "ทำต่อ" จาก Lot Card พา Deep Link มาเปิด Lot/กลุ่มเดิมได้ และถ้าเปิด
// items.html ตรงๆ โดยไม่มี query string ระบบก็ยังจำ Lot/กลุ่มล่าสุดที่ใช้งานให้
const VIMS_CONTEXT_KEY = 'vims2_context_v1';

const VimsContext = {
  // อ่านค่าจาก URL query string ปัจจุบัน
  fromUrl() {
    const p = new URLSearchParams(window.location.search);
    return {
      lotId: p.get('lot') || null,
      groupId: p.get('group') || null,
      mode: p.get('mode') || null
    };
  },

  // อ่านค่าล่าสุดที่เคยบันทึกไว้ใน browser นี้
  fromStorage() {
    try {
      const raw = localStorage.getItem(VIMS_CONTEXT_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn('VimsContext: อ่าน localStorage ไม่สำเร็จ', error);
      return {};
    }
  },

  // รวม URL (สำคัญกว่า) กับ localStorage (ค่าสำรอง) เป็น context เดียว
  resolve() {
    const url = this.fromUrl();
    const stored = this.fromStorage();
    return {
      lotId: url.lotId || stored.lotId || null,
      groupId: url.groupId || stored.groupId || null,
      mode: url.mode || null
    };
  },

  // บันทึก Lot/กลุ่มล่าสุดที่ผู้ใช้กำลังทำงานอยู่ เพื่อใช้เป็นค่าเริ่มต้นครั้งถัดไป
  save(partial) {
    try {
      const current = this.fromStorage();
      localStorage.setItem(VIMS_CONTEXT_KEY, JSON.stringify({ ...current, ...partial }));
    } catch (error) {
      console.warn('VimsContext: บันทึก localStorage ไม่สำเร็จ', error);
    }
  },

  // สร้างลิงก์ไปหน้า Items พร้อม context เพื่อใช้ทำปุ่ม "ทำต่อ" / deep link จากหน้า Lots
  itemsUrl({ lotId, groupId, mode }) {
    const p = new URLSearchParams();
    if (lotId) p.set('lot', lotId);
    if (groupId) p.set('group', groupId);
    if (mode) p.set('mode', mode);
    return `items.html?${p.toString()}`;
  }
};

window.VimsContext = VimsContext;
