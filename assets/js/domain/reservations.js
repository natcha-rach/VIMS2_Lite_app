/* ==========================================================
   domain/reservations.js — ชั้น Domain: สถานะวันนัดของการจอง (ไม่แตะ DOM / Supabase)
   ใครเรียก: sell.js (แท็บจอง, ป้ายจำนวน, เตือนเลยนัด)
   เทสต์: tests/reservations.test.js
   ========================================================== */
(function (root) {
  const DAY = 86400000;
  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  // อีกกี่วันถึงวันนัด (ติดลบ = เลยนัด) · ไม่กำหนดวัน = null
  function daysLeft(dueDate, now = new Date()) {
    if (!dueDate) return null;
    return Math.round((dayStart(dueDate + "T00:00:00") - dayStart(now)) / DAY);
  }

  // [{r, daysLeft}] เรียง: ใกล้/เลยนัดก่อน ไม่กำหนดวันไว้ท้าย
  function sortByDue(reservations, now = new Date()) {
    return reservations.map((r) => ({ r, daysLeft: daysLeft(r.due_date, now) }))
      .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
  }

  const isOverdue = (row) => row.daysLeft !== null && row.daysLeft < 0;

  const api = { daysLeft, sortByDue, isOverdue };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Reservations = api;
})(typeof window !== "undefined" ? window : globalThis);
