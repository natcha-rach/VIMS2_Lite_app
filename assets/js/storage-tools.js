/* ==========================================================
   storage-tools.js — ลดพื้นที่รูป (การ์ด "พื้นที่ที่ใช้ไป" หน้าบัญชี) V20
   Supabase ฟรีให้ Storage 1 GB — ที่กินพื้นที่คือรูปเต็ม (~200–400 KB/รูป) ไม่ใช่ข้อมูลขาย

   1) สร้างรูปย่อให้รูปเก่า: รูปที่อัปก่อน V19 ยังไม่มี thumb → หน้าขายโหลดรูปเต็ม ช้าและเปลืองเน็ต
      ดึงรูปเต็ม → ย่อเหลือ 400px ใน browser → อัปขึ้น item-images → จด thumb_url/thumb_path
   2) ลบรูปเต็มของชิ้นที่ขายไปเกิน 6 เดือน: เหลือรูปย่อไว้ดูย้อนหลัง
      ลบไฟล์ใน Storage แล้วเปลี่ยน image_url → รูปย่อ + จด full_removed_at (migration_v21)
      ทำเมื่อเจ้าของกดเองเท่านั้น (ลบแล้วกู้ไม่ได้) — ไม่ตั้งเวลาอัตโนมัติ
   ========================================================== */
(function () {
  const box = document.getElementById("storageTools");
  if (!box || !window.supabaseClient) return;
  const BUCKET = "item-images";
  const SOLD_MONTHS = 6;
  let busy = false;
  let stop = false;

  async function countMissingThumbs() {
    const { count, error } = await supabaseClient.from("item_images").select("id", { count: "exact", head: true }).is("thumb_url", null);
    return error ? null : count;
  }
  function oldSoldQuery(head) {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - SOLD_MONTHS);
    return supabaseClient.from("item_images")
      .select(head ? "id,items!inner(id)" : "id,item_id,storage_path,thumb_url,thumb_path,items!inner(status,sold_at)", head ? { count: "exact", head: true } : undefined)
      .eq("items.status", "sold").lt("items.sold_at", cutoff.toISOString())
      .not("thumb_url", "is", null).not("storage_path", "is", null).is("full_removed_at", null);
  }

  async function render() {
    const [missing, oldSold] = await Promise.all([countMissingThumbs(), oldSoldQuery(true)]);
    const v21 = !oldSold.error; // ยังไม่มีคอลัมน์ full_removed_at = ยังไม่ได้รัน migration_v21
    box.innerHTML = `
      <div class="st-tool">
        <div><b>สร้างรูปย่อให้รูปเก่า</b><small>${missing === null ? "ยังดูไม่ได้ — รัน migration_v19 ก่อน" : missing ? `${missing.toLocaleString("th-TH")} รูปยังไม่มีรูปย่อ — หน้าขายต้องโหลดรูปเต็ม (ช้า)` : "ทุกรูปมีรูปย่อแล้ว"}</small></div>
        <button type="button" class="btn btn-ghost" data-act="thumbs" ${missing ? "" : "disabled"}>สร้างรูปย่อ</button>
      </div>
      <div class="st-tool">
        <div><b>ลบรูปเต็มของที่ขายเกิน ${SOLD_MONTHS} เดือน</b><small>${!v21 ? "ใช้ได้หลังรัน sql/migration_v21_offline_markdown.sql" : oldSold.count ? `${oldSold.count.toLocaleString("th-TH")} รูป · เหลือรูปย่อไว้ดูย้อนหลัง` : "ไม่มีรูปที่ต้องลบ"}</small></div>
        <button type="button" class="btn btn-ghost" data-act="purge" ${v21 && oldSold.count ? "" : "disabled"}>ลบรูปเต็ม</button>
      </div>
      <div class="st-progress hidden"><div class="st-bar"><i></i></div><span></span><button type="button" class="btn btn-ghost btn-sm" data-act="stop">หยุด</button></div>`;
  }

  function progress(done, total, text) {
    const p = box.querySelector(".st-progress");
    p.classList.remove("hidden");
    p.querySelector("i").style.width = `${total ? (done / total) * 100 : 0}%`;
    p.querySelector("span").textContent = text || `${done}/${total}`;
  }

  // ย่อรูปจาก URL (ต้องดึงแบบ cors — bucket สาธารณะของ Supabase รองรับ)
  async function makeThumb(url) {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`โหลดรูปไม่ได้ (${res.status})`);
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.72));
    if (!blob) throw new Error("ย่อรูปไม่สำเร็จ");
    return blob;
  }

  async function backfillThumbs() {
    const { data, error } = await fetchAllRows(() => supabaseClient.from("item_images").select("id,item_id,image_url").is("thumb_url", null));
    if (error) return Notify.error("โหลดรายการรูปไม่สำเร็จ", error);
    let ok = 0; const failed = [];
    for (let i = 0; i < data.length && !stop; i++) {
      const img = data[i];
      progress(i, data.length, `กำลังย่อรูป ${i + 1}/${data.length}`);
      try {
        const blob = await makeThumb(img.image_url);
        const path = `${img.item_id}/thumb_${crypto.randomUUID()}.jpg`;
        const up = await supabaseClient.storage.from(BUCKET).upload(path, blob, { upsert: false, contentType: "image/jpeg" });
        if (up.error) throw up.error;
        const thumbUrl = supabaseClient.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        const { error: e2 } = await supabaseClient.from("item_images").update({ thumb_url: thumbUrl, thumb_path: path }).eq("id", img.id);
        if (e2) { await supabaseClient.storage.from(BUCKET).remove([path]); throw e2; }
        ok++;
      } catch (err) {
        failed.push(err?.message || String(err));
      }
    }
    progress(data.length, data.length, "เสร็จแล้ว");
    if (failed.length) Notify.warning(`สร้างรูปย่อแล้ว ${ok} รูป · ไม่สำเร็จ ${failed.length} รูป`, failed.slice(0, 2).join(" / "), { hint: "รูปที่ไม่สำเร็จมักเป็นไฟล์ที่หายไปจาก Storage แล้ว — หน้าขายยังใช้รูปเต็ม/ไอคอนแทนได้" });
    else Notify.success(`สร้างรูปย่อแล้ว ${ok} รูป`, stop ? "หยุดกลางทาง — กดอีกครั้งเพื่อทำต่อ" : "หน้าขายจะโหลดรูปเร็วขึ้น");
  }

  async function purgeFullImages() {
    const { data, error } = await fetchAllRows(() => oldSoldQuery(false));
    if (error) return Notify.error("โหลดรายการรูปไม่สำเร็จ", error);
    if (!data.length) return;
    if (!(await Notify.confirm({
      title: `ลบรูปเต็ม ${data.length} รูป?`,
      message: `ของที่ขายไปเกิน ${SOLD_MONTHS} เดือน · เหลือรูปย่อ 400px ไว้ดูย้อนหลัง\nลบแล้วกู้คืนไม่ได้ (ข้อมูลการขาย/ราคา/กำไรไม่หาย)`,
      confirmText: "ลบรูปเต็ม", danger: true,
    }))) return;
    let done = 0;
    for (let i = 0; i < data.length && !stop; i += 50) {
      const batch = data.slice(i, i + 50);
      progress(i, data.length, `กำลังลบ ${i + 1}–${i + batch.length} / ${data.length}`);
      const rm = await supabaseClient.storage.from(BUCKET).remove(batch.map((x) => x.storage_path));
      if (rm.error) { Notify.error("ลบไฟล์ใน Storage ไม่สำเร็จ", rm.error, { hint: `ลบไปแล้ว ${done} รูป — กดอีกครั้งเพื่อทำต่อ` }); break; }
      // ชี้รูปหลักไปที่รูปย่อแทน · storage_path = รูปย่อ เพื่อให้การลบสินค้าภายหลังลบไฟล์ถูกตัว
      for (const x of batch) {
        const { error: e2 } = await supabaseClient.from("item_images")
          .update({ image_url: x.thumb_url, storage_path: x.thumb_path, full_removed_at: new Date().toISOString() }).eq("id", x.id);
        if (!e2) done++;
      }
    }
    progress(data.length, data.length, "เสร็จแล้ว");
    Notify.success(`ลบรูปเต็มแล้ว ${done} รูป`, "พื้นที่ Storage ที่การ์ดด้านบนจะอัปเดตเมื่อรีเฟรชหน้า");
  }

  box.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "stop") { stop = true; return; }
    if (!act || busy) return;
    busy = true; stop = false;
    box.querySelectorAll("[data-act='thumbs'],[data-act='purge']").forEach((b) => (b.disabled = true));
    try {
      if (act === "thumbs") await backfillThumbs();
      if (act === "purge") await purgeFullImages();
    } finally {
      busy = false;
      render();
    }
  });
  render();
})();
