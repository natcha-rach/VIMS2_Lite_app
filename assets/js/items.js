let allLots = [];
let allGroups = [];
let itemsCache = [];
let editingItemId = null;
// เก็บสถานะการลงสินค้าแบบทีละตัวของ Bulk Receiving
let bulkState = { lotId:null, group:null, index:0, rows:[], inserted:0, photoPairs:null };
// เก็บรูปชั่วคราวของ Photo Queue ไว้ใน browser ก่อนบันทึกลง Supabase
let photoQueueState = { lotId:null, group:null, itemCount:0, files:[], roles:{}, pairMode:'auto-single' };
// เก็บแถว Bulk Table ชั่วคราว: ตารางนี้เป็น staging ก่อน insert เข้า Supabase
let bulkTableState = { lotId:null, group:null, rows:[], source:'photo-queue' };
let bulkDraftPrompted = false;

const $ = (id) => document.getElementById(id);

// ============================================================
// BULK DRAFT — บันทึกข้อมูลตัวอักษรไว้ใน Browser เพื่อ Resume
// ============================================================
// ข้อจำกัดของ Browser:
//   File object ของรูปไม่สามารถเก็บลง localStorage ได้
//   ดังนั้น Draft จะเก็บเฉพาะข้อมูลตาราง/จำนวนแถว
//   ส่วนรูปจะต้องเลือกใหม่หลัง Refresh
const BULK_DRAFT_KEY = 'vims2_bulk_draft_v10_1';

function saveBulkDraft() {
  try {
    if (!bulkTableState.rows?.length) return;
    const serializableRows = bulkTableState.rows.map(row => ({
      item_name: row.item_name || '',
      size: row.size || '',
      condition: row.condition || 'A',
      tier: row.tier || 'normal',
      price: Number(row.price || 0),
      cost: Number(row.cost || 0),
      hasFiles: Array.isArray(row.files) ? row.files.length : 0
    }));
    localStorage.setItem(BULK_DRAFT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      lotId: bulkTableState.lotId,
      groupId: bulkTableState.group?.id || null,
      source: bulkTableState.source || 'manual',
      rows: serializableRows
    }));
  } catch (error) {
    console.warn('Bulk draft save failed:', error);
  }
}

function clearBulkDraft() {
  localStorage.removeItem(BULK_DRAFT_KEY);
}

function restoreBulkDraft() {
  try {
    const raw = localStorage.getItem(BULK_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft?.rows?.length) return null;
    return draft;
  } catch (error) {
    console.warn('Bulk draft restore failed:', error);
    return null;
  }
}

function maybeOfferBulkDraft() {
  const draft = restoreBulkDraft();
  if (!draft || !$('bulkModal')) return;
  const savedAt = new Date(draft.savedAt);
  const ageHours = (Date.now() - savedAt.getTime()) / 3600000;
  if (ageHours > 24) return clearBulkDraft();

  // ใช้ confirm แบบ native เพื่อไม่เพิ่ม modal ซ้อนให้หน้าจอ Bulk
  const resume = window.confirm(
    `พบ Draft Bulk ${draft.rows.length} รายการ\nบันทึกเมื่อ ${savedAt.toLocaleString('th-TH')}\n\nกด OK เพื่อเปิด Draft ต่อ หรือ Cancel เพื่อลบทิ้ง`
  );
  if (!resume) return clearBulkDraft();

  const lot = allLots.find(x => x.id === draft.lotId);
  const group = allGroups.find(x => x.id === draft.groupId);
  if (!lot || !group) {
    clearBulkDraft();
    return showToast('Draft เดิมหา Lot/Group ไม่พบ จึงเริ่มใหม่');
  }

  // สร้าง rows กลับมา แต่ File รูปจะว่าง เพราะ Browser ไม่สามารถ persist File object ได้
  bulkTableState = {
    lotId: lot.id,
    group,
    source: draft.source || 'resume',
    rows: draft.rows.map(row => ({ ...row, files: [] }))
  };
  $('bulkModal').classList.remove('hidden');
  showBulkTable();
  showBulkStep(2);
  showToast('กู้ Draft แล้ว — กรุณาเลือกรูปใหม่ก่อนบันทึก');
}

// เตือนก่อนปิด/รีเฟรชแท็บถ้ามีรูปที่ยังไม่บันทึกอยู่ใน Bulk Table
// (รูปเป็น File object เก็บได้แค่ใน memory ของแท็บนี้ — Draft กู้คืนได้แค่ตัวอักษร ไม่ใช่รูป)
window.addEventListener('beforeunload', (event) => {
  const hasUnsavedPhotos = (bulkTableState.rows || []).some(row => row.files?.length > 0);
  if (!hasUnsavedPhotos) return;
  event.preventDefault();
  event.returnValue = '';
});

// Realtime ของหน้า Items: reload เมื่ออีก Device เพิ่ม/แก้/ขาย Item หรือเปลี่ยน Group
window.addEventListener('vims:realtime', (event) => {
  const table = event.detail?.table;
  if (table === 'page_refresh' || ['items', 'item_images', 'lots', 'lot_groups'].includes(table)) {
    loadLots();
    loadItems();
  }
});


// จริงเฉพาะครั้งแรกที่หน้าโหลด: ใช้ครั้งเดียวเพื่อ pre-fill Lot/กลุ่มจาก Context
// แล้วปิดสวิตช์ทิ้ง ไม่งั้น realtime reload ครั้งถัดไปจะดึงกลับ Lot เดิมทับที่ผู้ใช้เพิ่งเปลี่ยน
let contextApplied = false;

async function loadLots(preferredLotId = null) {
  // โหลดเฉพาะ field ที่หน้า Item ใช้จริง และเรียง Lot ล่าสุดก่อน
  const { data, error } = await supabaseClient
    .from('lots')
    .select('id, lot_name, purchase_date, total_cost, total_items')
    .order('purchase_date', { ascending: false });

  const selects = ['lotSelect', 'bulkLot']
    .map(id => $(id))
    .filter(Boolean);

  if (error) {
    console.error('[Items] loadLots error:', error);
    selects.forEach(el => {
      el.innerHTML = '<option value="">โหลด Lot ไม่สำเร็จ</option>';
    });
    showToast('โหลด Lot ไม่สำเร็จ: ' + error.message);
    return;
  }

  allLots = data || [];

  // ลำดับความสำคัญ: lot ที่ส่งมาตรงๆ (เช่นหลังบันทึก) > Context (URL > localStorage) > ค่าที่เลือกอยู่แล้ว
  const ctx = window.VimsContext ? VimsContext.resolve() : {};
  const currentLotId = preferredLotId || (!contextApplied && ctx.lotId) || $('lotSelect')?.value || '';

  selects.forEach(el => {
    el.innerHTML = allLots.length
      ? '<option value="">-- เลือก Lot --</option>' +
        allLots.map(l =>
          `<option value="${escapeHtml(l.id)}">${escapeHtml(l.lot_name || '(ไม่มีชื่อ Lot)')}</option>`
        ).join('')
      : '<option value="">-- ยังไม่มี Lot --</option>';

    if (currentLotId && allLots.some(l => l.id === currentLotId)) {
      el.value = currentLotId;
    }
  });

  const selectedLotId = $('lotSelect')?.value || currentLotId || '';
  await loadGroups(selectedLotId);
  if (selectedLotId) await applyLotCostDefault(selectedLotId);
  updateQuickStats();
  renderContextBar();

  if (!contextApplied) {
    contextApplied = true;
    // mode=bulk/rapid มาจากปุ่ม "ทำต่อ" ของ Lot Card — เปิด workflow ที่ค้างไว้ให้อัตโนมัติ
    if (ctx.mode === 'bulk' && selectedLotId) $('openBulk')?.click();
    if (ctx.mode === 'rapid' && ctx.groupId && allGroups.some(g => g.id === ctx.groupId)) startGroup(ctx.groupId);
  }

  if (!bulkDraftPrompted) {
    bulkDraftPrompted = true;
    window.setTimeout(maybeOfferBulkDraft, 150);
  }
}

async function loadGroups(lotId = $('lotSelect')?.value) {
  if (!lotId) { allGroups=[]; renderGroups(); renderGroupOptions(); renderContextBar(); return; }
  const { data, error } = await supabaseClient.from('lot_groups').select('*').eq('lot_id', lotId).order('sort_order');
  if (error) return showToast('โหลดกลุ่มไม่สำเร็จ: ' + error.message);
  allGroups = data || [];
  renderGroups(); renderGroupOptions();

  // pre-fill กลุ่มจาก Context ครั้งแรกที่หน้าโหลดเท่านั้น (ธงเดียวกับ loadLots)
  const ctx = window.VimsContext ? VimsContext.resolve() : {};
  if (!contextApplied && ctx.groupId && allGroups.some(g => g.id === ctx.groupId) && $('groupSelect')) {
    $('groupSelect').value = ctx.groupId;
  }
  renderContextBar();
}

// แถบ Context: บอกว่ากำลังลงของให้ Lot/กลุ่มไหนอยู่ ไม่ต้องเดาจาก dropdown ที่อาจเลื่อนพ้นจอ
async function renderContextBar() {
  const bar = $('contextBar'); if (!bar) return;
  const lotId = $('lotSelect')?.value || '';
  const groupId = $('groupSelect')?.value || '';
  const lot = allLots.find(l => l.id === lotId);
  if (!lot) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');

  const group = allGroups.find(g => g.id === groupId);
  const avgCost = Number(lot.total_items) > 0 ? Number(lot.total_cost) / Number(lot.total_items) : 0;

  let progressText = '';
  if (group) {
    const { data } = await supabaseClient.rpc('get_group_progress', { p_lot_id: lotId });
    const p = (data || []).find(x => x.group_id === group.id);
    if (p) progressText = group.target_qty ? `${p.listed}/${group.target_qty} ชิ้น` : `${p.listed} ชิ้น`;
  }

  bar.innerHTML = `
    <div class="context-bar-main">
      <span class="context-bar-lot">${escapeHtml(lot.lot_name)}</span>
      ${group ? `<span class="context-bar-sep">/</span><span class="context-bar-group">${escapeHtml(group.group_name)}</span>` : `<span class="context-bar-sep">/</span><span class="context-bar-nogroup">ยังไม่เลือกกลุ่ม</span>`}
    </div>
    <div class="context-bar-meta">
      <span>ต้นทุนตั้งต้น ${formatBaht(avgCost)}</span>
      ${progressText ? `<span>· ลงแล้ว ${progressText}</span>` : ''}
    </div>
    <div class="context-bar-actions">
      <button type="button" class="btn btn-ghost btn-sm" id="ctxChangeLot">เปลี่ยน Lot/กลุ่ม</button>
      <a class="btn btn-ghost btn-sm" href="lots.html">กลับไป Lot</a>
    </div>`;
  $('ctxChangeLot')?.addEventListener('click', () => {
    $('lotSelect')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('lotSelect')?.focus();
  });
}

function renderGroupOptions() {
  // Realtime อาจสั่ง re-render กลางที่ผู้ใช้กำลังกรอกอยู่ — จำค่าที่เลือกไว้แล้วคืนกลับหลัง render
  // เพื่อไม่ให้ "กลุ่มปัจจุบัน" เด้งกลับเป็นไม่ระบุกลุ่มระหว่างที่กำลังลงสินค้า
  const options = '<option value="">ไม่ระบุกลุ่ม</option>' + allGroups.map(g => `<option value="${g.id}">${escapeHtml(g.group_name)} · ${formatBaht(g.base_price)}</option>`).join('');
  const importOptions = allGroups.map(g => `<option value="${g.id}">${escapeHtml(g.group_name)} · ${formatBaht(g.base_price)}</option>`).join('');
  if ($('groupSelect')) {
    const prev = $('groupSelect').value;
    $('groupSelect').innerHTML = options;
    if (prev && allGroups.some(g => g.id === prev)) $('groupSelect').value = prev;
  }
  if ($('importGroupSelect')) {
    const prev = $('importGroupSelect').value;
    $('importGroupSelect').innerHTML = importOptions;
    if (prev && allGroups.some(g => g.id === prev)) $('importGroupSelect').value = prev;
  }
}

function renderGroups() {
  const el = $('groupList'); if (!el) return;
  if (!allGroups.length) { el.innerHTML = '<div class="empty-state">Lot นี้ยังไม่มีกลุ่ม กดเพิ่มกลุ่มด้านบนได้เลย</div>'; return; }
  el.innerHTML = allGroups.map(g => `<div class="group-row"><div><b>${escapeHtml(g.group_name)}</b><span>${g.tier==='head'?'งานหัว':'ปกติ'} · ราคาเริ่ม ${formatBaht(g.base_price)}</span></div><div class="group-actions"><button class="btn btn-primary btn-sm" data-photo-group="${g.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;vertical-align:-3px;margin-right:5px"><polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/></svg>ถ่ายรูปแล้วลงทั้งกอง</button><button class="btn btn-ghost btn-sm" data-start-group="${g.id}">ลงทีละชิ้น</button></div></div>`).join('');
  el.querySelectorAll('[data-start-group]').forEach(btn => btn.onclick = () => startGroup(btn.dataset.startGroup));
  // ปุ่มนี้เปิด Photo Queue เพื่อจัดรูปก่อนกรอกรายละเอียดสินค้า
  el.querySelectorAll('[data-photo-group]').forEach(btn => btn.onclick = () => openPhotoQueue(btn.dataset.photoGroup));
}

// ต้นทุน/ชิ้นของฟอร์มเพิ่มสินค้า 1 ตัว: ดึงจากต้นทุนเฉลี่ยของ Lot ให้อัตโนมัติ (แก้ไขเองได้ถ้าจำเป็น)
async function applyLotCostDefault(lotId) {
  if (!$('costPrice') || !lotId) return;
  $('costPrice').value = await getLotAvgCost(lotId);
}
$('lotSelect')?.addEventListener('change', () => {
  loadGroups($('lotSelect').value);
  applyLotCostDefault($('lotSelect').value);
  persistContext();
});
$('bulkLot')?.addEventListener('change', () => { loadGroups($('bulkLot').value); });
$('groupSelect')?.addEventListener('change', () => { renderContextBar(); persistContext(); });

// บันทึก Lot/กลุ่มที่เลือกอยู่ลง localStorage + sync เข้า URL (ไม่ reload หน้า)
// เพื่อให้ปิดแท็บแล้วเปิดใหม่ หรือแชร์ลิงก์ พากลับมาที่ Lot/กลุ่มเดิมได้
function persistContext() {
  const lotId = $('lotSelect')?.value || null;
  const groupId = $('groupSelect')?.value || null;
  if (window.VimsContext) {
    VimsContext.save({ lotId, groupId });
    const url = new URL(window.location.href);
    if (lotId) url.searchParams.set('lot', lotId); else url.searchParams.delete('lot');
    if (groupId) url.searchParams.set('group', groupId); else url.searchParams.delete('group');
    url.searchParams.delete('mode');
    window.history.replaceState({}, '', url);
  }
}
$('createGroup')?.addEventListener('click', async () => {
  const lotId = $('bulkLot').value;
  const name = $('newGroupName').value.trim();
  const price = Number($('newGroupPrice').value || 0);
  const tier = $('newGroupTier').value;
  if (!lotId || !name) return showToast('เลือก Lot และใส่ชื่อกลุ่มก่อน');
  const { error } = await supabaseClient.from('lot_groups').insert({lot_id:lotId, group_name:name, base_price:price, tier, sort_order:allGroups.length});
  if (error) return showToast('สร้างกลุ่มไม่สำเร็จ: ' + error.message);
  $('newGroupName').value=''; await loadGroups(lotId); showToast('เพิ่มกลุ่มแล้ว');
});

$('itemForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const lotId = $('lotSelect').value;
  if (!lotId) return showToast('กรุณาสร้าง Lot ก่อน');
  const groupId = $('groupSelect').value || null;
  const group = allGroups.find(g => g.id === groupId);
  const payload = {
    id: crypto.randomUUID(),
    lot_id: lotId, group_id: groupId, item_name: $('itemName').value.trim(), size: $('size').value.trim(),
    condition: $('condition').value, tier: $('tier').value, cost_price: Number($('costPrice').value || 0),
    base_price: group ? Number(group.base_price) : Number($('sellPrice').value || 0), current_price: Number($('sellPrice').value || 0), status:'available',
    listed_at: new Date().toISOString()
  };
  if (!payload.item_name) return showToast('กรุณาใส่ชื่อสินค้า');
  const files = Array.from($('singleImages').files || []).slice(0,2);
  const { data, error } = await supabaseClient.from('items').insert(payload).select().single();
  if (error) return showToast('บันทึกไม่สำเร็จ: ' + error.message);

  try {
    if (files.length) await uploadItemImages(data.id, files);
  } catch (imageError) {
    // ถ้ารูปบันทึกไม่ครบ ให้ลบ Item ที่เพิ่งสร้าง เพื่อไม่ให้เกิดสินค้าไร้รูปจากขั้นตอนเดียวกัน
    await supabaseClient.from('items').delete().eq('id', data.id);
    return showToast('บันทึกรูปไม่สำเร็จ จึงยกเลิก Item นี้: ' + imageError.message);
  }

  showToast('เพิ่มสินค้าเรียบร้อย');
  $('itemForm').reset(); $('condition').value='A'; $('tier').value='normal'; $('lotSelect').value=lotId; await loadGroups(lotId); await loadItems();
});

// ย่อรูปฝั่ง client ก่อนอัปโหลด (ด้านยาวสุด ~1600px, JPEG ~0.8) — ลดเวลาอัปโหลดและพื้นที่ Storage
// บนกองใหญ่ 200 ชิ้น x 2 รูป ที่ไม่ย่อไฟล์จาก iPhone กล้องยุคใหม่แต่ละใบหลาย MB รวมกันหลัก GB
// ถ้าย่อไม่สำเร็จ (เช่นเบราว์เซอร์เก่าไม่รองรับ canvas) ให้ใช้ไฟล์ต้นฉบับแทน ไม่ปิดกั้นการอัปโหลด
async function compressImageFile(file, maxDim = 1600, quality = 0.8) {
  if (!file.type || !file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) { bitmap.close?.(); return file; } // รูปเล็กอยู่แล้ว ไม่ต้องย่อ
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) return file;
    const newName = file.name.replace(/\.\w+$/, '') + '.jpg';
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch (error) {
    console.warn('ย่อรูปไม่สำเร็จ ใช้ไฟล์ต้นฉบับแทน:', error);
    return file;
  }
}

async function uploadItemImages(itemId, files) {
  // จำกัดรูปต่อ Item ไว้ที่ 2 รูปตาม Database Contract: sort_order 1/2
  const rawFiles = Array.from(files || []).slice(0, 2);
  const safeFiles = await Promise.all(rawFiles.map(f => compressImageFile(f)));
  const uploadedPaths = [];

  for (let i = 0; i < safeFiles.length; i++) {
    const file = safeFiles[i];
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${itemId}/${crypto.randomUUID()}.${ext}`;

    // 1) Upload binary file ไป Supabase Storage
    const { error: upErr } = await supabaseClient
      .storage
      .from('item-images')
      .upload(path, file, { upsert: false, contentType: file.type });

    if (upErr) {
      // ถ้า Upload ไม่สำเร็จ ให้ส่ง error กลับไปให้ caller ตัดสินใจ rollback
      throw new Error(`อัปโหลดรูป ${i + 1} ไม่สำเร็จ: ${upErr.message}`);
    }

    uploadedPaths.push(path);

    // 2) สร้าง Public URL สำหรับแสดงรูปใน UI
    const { data: urlData } = supabaseClient
      .storage
      .from('item-images')
      .getPublicUrl(path);

    // 3) ผูกไฟล์กับ Item ใน item_images
    const { error: imageRowError } = await supabaseClient
      .from('item_images')
      .insert({
        item_id: itemId,
        image_url: urlData.publicUrl,
        storage_path: path,
        sort_order: i + 1
      });

    if (imageRowError) {
      // ลบไฟล์ที่เพิ่ง upload ถ้าสร้าง row ไม่สำเร็จ เพื่อไม่ให้ Storage มี orphan file
      await supabaseClient.storage.from('item-images').remove([path]);
      throw new Error(`บันทึกข้อมูลรูป ${i + 1} ไม่สำเร็จ: ${imageRowError.message}`);
    }
  }

  // คืน path ให้ caller ใช้ cleanup ได้ถ้าขั้นตอนถัดไปล้มเหลว
  return uploadedPaths;
}

// Receiving Wizard: ไม่ใช่ workflow ใหม่ แต่เป็นตัวช่วยเลือกวิธีลงของที่เหมาะกับจำนวนที่รับเข้า
// แล้วพาไปเครื่องมือเดิมที่เหมาะสม (Photo Queue / ลงทีละชิ้น / ฟอร์มเพิ่มด่วน) พร้อมคำแนะนำสั้นๆ
const WIZARD_HINTS = {
  sack: { count: 150, hint: 'สร้าง/เลือกกลุ่มด้านล่าง ใส่จำนวนที่ต้องลงโดยประมาณ แล้วกด "ถ่ายรูปแล้วลงทั้งกอง" เพื่อเปิด Photo Queue' },
  small: { count: 20, hint: 'สร้าง/เลือกกลุ่มด้านล่าง แล้วกด "ลงทีละชิ้น" — ระบบจะจำราคา/Tier/สภาพล่าสุดให้ ลงต่อเนื่องได้เร็ว' },
  quick: { count: 1, hint: null }
};
document.querySelectorAll('[data-wizard]').forEach(btn => btn.addEventListener('click', () => {
  const mode = btn.dataset.wizard;
  document.querySelectorAll('[data-wizard]').forEach(b => b.classList.toggle('active', b === btn));
  if (mode === 'quick') {
    $('closeBulk')?.click();
    $('focusSingle')?.click();
    return;
  }
  const cfg = WIZARD_HINTS[mode];
  if ($('groupCount')) $('groupCount').value = cfg.count;
  const hintEl = $('wizardHint');
  if (hintEl) { hintEl.textContent = cfg.hint; hintEl.classList.remove('hidden'); }
}));

$('openBulk')?.addEventListener('click', async () => { $('bulkModal').classList.remove('hidden'); $('bulkLot').value=$('lotSelect').value; await loadGroups($('bulkLot').value); showBulkStep(1); });
$('closeBulk')?.addEventListener('click', () => $('bulkModal').classList.add('hidden'));
$('backToGroups')?.addEventListener('click', () => showBulkStep(1));
$('reviewBack')?.addEventListener('click', () => showBulkStep(1));
$('finishBulk')?.addEventListener('click', () => { $('bulkModal').classList.add('hidden'); loadItems(); updateQuickStats(); });

function showBulkStep(n) {
  ['bulkStep1','bulkStep2','bulkStep3'].forEach((id,i)=>$(id).classList.toggle('hidden',i!==n-1));
  document.querySelectorAll('[data-step-label]').forEach(x=>x.classList.toggle('active',Number(x.dataset.stepLabel)===n));
}

async function startGroup(groupId) {
  const group = allGroups.find(g=>g.id===groupId); if(!group) return;
  const count = Math.max(1, Math.min(200, Number($('groupCount').value||1)));
  bulkState={lotId:group.lot_id,group,index:0,rows:Array.from({length:count},()=>null),inserted:0};
  $('bulkImages').value=''; $('bulkName').value=''; $('bulkSize').value=''; $('bulkCondition').value='A'; $('bulkTier').value=group.tier; $('bulkCost').value=await getLotAvgCost(group.lot_id); $('bulkPrice').value=group.base_price;
  renderBulkProgress(); showBulkStep(2);
}

async function getLotAvgCost(lotId) {
  const lot=allLots.find(x=>x.id===lotId); return lot && Number(lot.total_items)>0 ? (Number(lot.total_cost)/Number(lot.total_items)).toFixed(2) : '0';
}
function renderBulkProgress(){ const n=bulkState.index+1,total=bulkState.rows.length; $('progressTitle').textContent=bulkState.group.group_name; $('progressMeta').textContent=`${n} / ${total}`; $('progressBar').style.width=`${Math.round((bulkState.index/total)*100)}%`; }
$('bulkImages')?.addEventListener('change', previewBulkImages);
function previewBulkImages(){ const files=Array.from($('bulkImages').files||[]).slice(0,2); $('photoPreview').innerHTML=files.length?files.map(f=>`<img src="${URL.createObjectURL(f)}" alt="">`).join(''):'<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:55%;height:55%"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg></span><small>เลือก 1–2 รูป</small>'; if(files.length>2) showToast('ระบบใช้แค่ 2 รูปแรก'); }
$('quickEntryForm')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const files=bulkState.photoPairs ? bulkState.photoPairs[bulkState.index].filter(Boolean) : Array.from($('bulkImages').files||[]).slice(0,2); if(!files.length) return showToast('แนะนำให้ใส่อย่างน้อย 1 รูป');
  const payload={lot_id:bulkState.lotId,group_id:bulkState.group.id,item_name:$('bulkName').value.trim(),size:$('bulkSize').value.trim(),condition:$('bulkCondition').value,tier:$('bulkTier').value,cost_price:Number($('bulkCost').value||0),base_price:Number(bulkState.group.base_price||0),current_price:Number($('bulkPrice').value||0),status:'available',listed_at:new Date().toISOString()};
  if(!payload.item_name) return showToast('กรุณาใส่ชื่อสินค้า');
  const {data,error}=await supabaseClient.from('items').insert(payload).select().single(); if(error) return showToast('บันทึกไม่สำเร็จ: '+error.message);
  try {
    await uploadItemImages(data.id,files);
  } catch (imageError) {
    await supabaseClient.from('items').delete().eq('id', data.id);
    return showToast('อัปโหลดรูปไม่สำเร็จ จึงยกเลิก Item นี้: ' + imageError.message);
  }
  bulkState.rows[bulkState.index]=data; bulkState.inserted++; bulkState.index++;
  if(bulkState.index>=bulkState.rows.length){ $('bulkSummary').innerHTML=`<div class="success-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;vertical-align:-3px;margin-right:5px"><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></svg>ลงกลุ่ม <b>${escapeHtml(bulkState.group.group_name)}</b> ครบ ${bulkState.inserted} รายการแล้ว</div>`; showBulkStep(3); }
  else if(bulkState.photoPairs){ await prepareQueuedItem(bulkState.index); }
  else { $('quickEntryForm').reset(); $('bulkCondition').value='A'; $('bulkTier').value=bulkState.group.tier; $('bulkCost').value=await getLotAvgCost(bulkState.lotId); $('bulkPrice').value=bulkState.group.base_price; $('photoPreview').innerHTML='<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:55%;height:55%"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg></span><small>เลือก 1–2 รูป</small>'; renderBulkProgress(); $('bulkName').focus(); }
});

$('focusSingle')?.addEventListener('click',()=>{ $('itemName').focus(); window.scrollTo({top:0,behavior:'smooth'}); });
$('filterStatus')?.addEventListener('change',loadItems); $('searchBox')?.addEventListener('input',loadItems);
// Item ที่เลือกไว้สำหรับ Bulk Action (SKU/checkbox filter — V15/V16)
let selectedItemIds = new Set();

async function loadItems(){
  const status=$('filterStatus').value,q=($('searchBox').value||'').trim();
  const extra=$('filterExtra')?.value||'';
  // ใช้ v_items_list แทน items ตรงๆ เพื่อได้ image_count/age_days/ชื่อ Lot-Group มาในคำสั่งเดียว กรองฝั่ง server ได้ครบ
  // (ยังคง fetchAllRows กันตกหล่นเมื่อเกิน 1000 แถว)
  const {data,error}=await fetchAllRows(()=>{
    let query=supabaseClient.from('v_items_list').select('*').eq('intake_status','listed').order('created_at',{ascending:false});
    if(status!=='all') query=query.eq('status',status);
    if(q) query=query.or(`item_name.ilike.%${q}%,sku.ilike.%${q}%`);
    if(extra==='no_photo') query=query.eq('image_count',0);
    if(extra==='no_price') query=query.or('current_price.is.null,current_price.eq.0');
    if(extra==='age30') query=query.gte('age_days',30);
    if(extra==='age60') query=query.gte('age_days',60);
    if(extra==='age90') query=query.gte('age_days',90);
    return query;
  });
  if(error){$('itemList').innerHTML='<div class="empty-state">โหลดข้อมูลไม่สำเร็จ: '+error.message+'</div>';return;}
  itemsCache=data||[];
  selectedItemIds = new Set([...selectedItemIds].filter(id => itemsCache.some(i => i.id === id)));
  renderItems(); updateQuickStats(); renderBulkActionBar();
}
async function renderItems(){
  if(!itemsCache.length){$('itemList').innerHTML='<div class="empty-state">ไม่มีสินค้าในรายการนี้</div>';return;}
  const ids=itemsCache.map(i=>i.id);
  const {data:imgs}=await fetchAllRows(()=>supabaseClient.from('item_images').select('*').in('item_id',ids).order('sort_order'));
  const byItem={}; (imgs||[]).forEach(x=>(byItem[x.item_id]??=[]).push(x));
  $('itemList').innerHTML=itemsCache.map(i=>{
    const itemImages=byItem[i.id]||[]; const im=itemImages[0];
    const metaBits=[escapeHtml(i.size||'-'), i.condition, i.tier==='head'?'งานหัว':'ปกติ', escapeHtml(i.lot_name||'-')];
    if (i.group_name) metaBits.push(escapeHtml(i.group_name));
    if (i.storage_location) metaBits.push('📍'+escapeHtml(i.storage_location));
    if (Number.isFinite(i.age_days) && i.status==='available') metaBits.push(`ค้าง ${i.age_days} วัน`);
    return `<div class="stock-row">
      <input type="checkbox" class="stock-select" data-select-item="${i.id}" ${selectedItemIds.has(i.id)?'checked':''} ${i.status==='sold'?'disabled title="ขายแล้ว แก้ไม่ได้"':''} />
      <div class="thumb">${im?`<img src="${im.image_url}" alt="">`:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>'}</div>
      <div class="stock-main"><b>${escapeHtml(i.item_name)}${i.sku?` <span class="sku-tag">${escapeHtml(i.sku)}</span>`:''}</b><span>${metaBits.join(' · ')}</span></div>
      <div class="stock-price"><small>ต้นทุน ${formatBaht(i.cost_price)}</small><b>${formatBaht(i.current_price)}</b></div>
      <span class="badge ${i.status}">${i.status==='available'?'พร้อมขาย':i.status==='sold'?'ขายแล้ว':'เสีย'}</span>
      <div class="stock-actions"><button class="btn btn-ghost btn-sm" data-edit-item="${i.id}">แก้ไข</button></div>
    </div>`;
  }).join('');
  $('itemList').querySelectorAll('[data-edit-item]').forEach(btn=>btn.onclick=()=>openEditItem(btn.dataset.editItem));
  $('itemList').querySelectorAll('[data-select-item]').forEach(cb=>cb.addEventListener('change',()=>{
    const id=cb.dataset.selectItem;
    if(cb.checked) selectedItemIds.add(id); else selectedItemIds.delete(id);
    renderBulkActionBar();
  }));
}
function renderBulkActionBar(){
  const bar=$('bulkActionBar'); if(!bar) return;
  const n=selectedItemIds.size;
  bar.classList.toggle('hidden', n===0);
  if($('bulkSelCount')) $('bulkSelCount').textContent=`เลือกแล้ว ${n} รายการ`;
  const groupSel=$('bulkMoveGroup');
  if(groupSel) groupSel.innerHTML='<option value="">-- เลือกกลุ่มปลายทาง --</option>'+allGroups.map(g=>`<option value="${g.id}">${escapeHtml(g.group_name)}</option>`).join('');
}
$('filterExtra')?.addEventListener('change', loadItems);
async function callBulkUpdate(patch, successMsg){
  if(!selectedItemIds.size) return showToast('ยังไม่ได้เลือกรายการ');
  const ids=[...selectedItemIds];
  const {data,error}=await supabaseClient.rpc('bulk_update_items',{p_ids:ids,...patch});
  if(error) return showToast('อัปเดตไม่สำเร็จ: '+error.message);
  showToast(`${successMsg} (${data} รายการ)`);
  selectedItemIds.clear();
  await loadItems();
}
$('bulkApplyPct')?.addEventListener('click', () => {
  const pct=Number($('bulkPct').value||0); if(!pct||pct<=0||pct>=100) return showToast('ใส่ % ลดราคาให้ถูกต้อง (1-99)');
  callBulkUpdate({p_price_multiplier:1-pct/100}, `ลดราคา ${pct}% แล้ว`);
});
$('bulkApplyPrice')?.addEventListener('click', () => {
  const price=Number($('bulkNewPrice').value); if(!Number.isFinite(price)||price<0) return showToast('ใส่ราคาใหม่ให้ถูกต้อง');
  callBulkUpdate({p_new_price:price}, 'ตั้งราคาใหม่แล้ว');
});
$('bulkApplyGroup')?.addEventListener('click', () => {
  const groupId=$('bulkMoveGroup').value||null; if(!groupId) return showToast('เลือกกลุ่มปลายทางก่อน');
  callBulkUpdate({p_set_group:true,p_group_id:groupId}, 'ย้ายกลุ่มแล้ว');
});
$('bulkApplyStorage')?.addEventListener('click', () => {
  const loc=$('bulkStorage').value.trim(); if(!loc) return showToast('ใส่ตำแหน่งเก็บก่อน');
  callBulkUpdate({p_storage_location:loc}, 'ตั้งตำแหน่งเก็บแล้ว');
});
$('bulkApplyDamaged')?.addEventListener('click', () => callBulkUpdate({p_status:'damaged'}, 'ทำเครื่องหมายเสียแล้ว'));
$('bulkApplyAvailable')?.addEventListener('click', () => callBulkUpdate({p_status:'available'}, 'คืนเป็นพร้อมขายแล้ว'));
async function updateQuickStats(){ const {data,error}=await fetchAllRows(()=>supabaseClient.from('items').select('status,cost_price').eq('intake_status','listed')); if(error)return; const rows=data||[]; const available=rows.filter(x=>x.status==='available'); const sold=rows.filter(x=>x.status==='sold'); const value=available.reduce((s,x)=>s+Number(x.cost_price||0),0); $('quickStats').innerHTML=`<div><span>สินค้าทั้งหมด</span><b>${rows.length}</b></div><div><span>พร้อมขาย</span><b>${available.length}</b></div><div><span>ขายแล้ว</span><b>${sold.length}</b></div><div><span>ต้นทุนคงเหลือ</span><b>${formatBaht(value)}</b></div>`; }
function escapeHtml(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function showToast(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2600);}
loadLots(); loadItems();


// ============================================================
// PHOTO QUEUE — workflow ถ่ายรูปจำนวนมากก่อนกรอกรายละเอียด
// ============================================================

// เปิด Photo Queue สำหรับ Group ที่เลือก
async function openPhotoQueue(groupId) {
  // หา Group จาก memory เพื่อรู้ Lot และราคาเริ่มต้น
  const group = allGroups.find((item) => item.id === groupId);
  // ถ้าไม่พบ Group ให้หยุด
  if (!group) return showToast('ไม่พบกลุ่ม');
  // reset state ของ Photo Queue ทุกครั้งที่เริ่มกองใหม่
  photoQueueState = { lotId: group.lot_id, group, itemCount: 20, files: [], roles: {}, pairMode:'auto-single' };
  // แสดงชื่อ Group ใน modal
  $('photoQueueGroup').innerHTML = `<option value="${group.id}">${escapeHtml(group.group_name)}</option>`;
  // ใส่ค่า default จำนวนสินค้า
  $('photoQueueItemCount').value = 20;
  $('photoQueuePairMode').value = 'auto-single';
  // ล้าง input รูปเก่า
  $('photoQueueInput').value = '';
  // เปิด panel
  $('photoQueuePanel').classList.remove('hidden');
  // render สถานะว่าง
  renderPhotoQueue();
}

// ปิด Photo Queue โดยไม่เขียนข้อมูลลงฐานข้อมูล
function closePhotoQueue() {
  $('photoQueuePanel').classList.add('hidden');
  photoQueueState = { lotId:null, group:null, itemCount:0, files:[], roles:{}, pairMode:'auto-single' };
}

// ปุ่มปิด/ยกเลิก Photo Queue
$('closePhotoQueue')?.addEventListener('click', closePhotoQueue);
$('cancelPhotoQueue')?.addEventListener('click', closePhotoQueue);

// เมื่อผู้ใช้เปลี่ยนจำนวนสินค้า ให้ validate ใหม่และ render
$('photoQueueItemCount')?.addEventListener('change', () => {
  // จำกัดจำนวนไว้ไม่เกิน 200
  photoQueueState.itemCount = Math.max(1, Math.min(200, Number($('photoQueueItemCount').value || 1)));
  // ถ้า role บางตัวชี้ไป Item ที่เกินจำนวนใหม่ ให้ลบ role นั้น
  Object.keys(photoQueueState.roles).forEach((key) => { if (photoQueueState.roles[key] > photoQueueState.itemCount) delete photoQueueState.roles[key]; });
  // render ใหม่
  renderPhotoQueue();
});

// เลือกวิธีจับคู่รูปเพื่อให้เหมาะกับงานจริงของร้าน
// auto-single = รูป 1 รูป/สินค้า, เรียงตามชื่อไฟล์
// auto-pair = รูป 2 รูป/สินค้า, จับ 1-2, 3-4, 5-6 ...
// manual = ผสม 1/2 รูป และกำหนดรูปที่ 2 เอง
$('photoQueuePairMode')?.addEventListener('change', () => {
  photoQueueState.pairMode = $('photoQueuePairMode').value || 'auto-single';
  renderPhotoQueue();
});

// รับรูปจาก iPhone และเรียงชื่อแบบ numeric เพื่อให้ IMG_9 มาก่อน IMG_10 อย่างถูกต้อง
$('photoQueueInput')?.addEventListener('change', (event) => {
  // อ่าน File object ทั้งหมดจาก input
  photoQueueState.files = Array.from(event.target.files || []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric:true, sensitivity:'base' }));
  // reset role ของรูปทั้งหมด เพราะชุดรูปเปลี่ยนแล้ว
  photoQueueState.roles = {};
  // ถ้ารูปหลักน้อยกว่าจำนวนสินค้า ให้เตือนภายหลังตอนเริ่ม
  renderPhotoQueue();
});

// แสดง grid รูปทั้งหมดพร้อม dropdown บอกว่าเป็นรูปหลักหรือรูปที่ 2 ของ Item ไหน
function renderPhotoQueue() {
  // อ่านจำนวนรูปที่เลือก
  const total = photoQueueState.files.length;
  // แสดงจำนวนรูป
  $('photoQueueCount').textContent = total;
  // ถ้ายังไม่มีรูป ให้แสดงคำแนะนำ
  if (!total) {
    $('photoQueueGrid').innerHTML = '<div class="empty-state">ยังไม่ได้เลือกรูป เลือกรูปจาก iPhone ได้ครั้งเดียวทั้งกอง</div>';
    return;
  }
  // สร้างการ์ดแต่ละรูป
  $('photoQueueGrid').innerHTML = photoQueueState.files.map((file, index) => {
    // อ่าน role ของรูปนี้: 0 หมายถึงรูปหลัก, 1..200 หมายถึงรูปที่ 2 ของ Item นั้น
    const role = photoQueueState.roles[index] || 0;
    // ถ้า role เป็นเลข แปลว่าเป็นรูปที่ 2 ของ Item นั้น
    const secondary = Number(role) > 0;
    // class ช่วยให้เห็นรูปที่ถูกใช้เป็นรูปที่ 2 ชัดเจน
    const className = secondary ? 'photo-queue-card is-secondary' : 'photo-queue-card';
    // สร้าง URL ชั่วคราวสำหรับ preview ใน browser
    const url = URL.createObjectURL(file);
    // สร้าง option รูปหลักและรูปที่ 2 ของ Item 1..N
    const options = ['<option value="0">รูปหลัก</option>'].concat(Array.from({ length: photoQueueState.itemCount }, (_, itemIndex) => `<option value="${itemIndex + 1}" ${role === itemIndex + 1 ? 'selected' : ''}>รูปที่ 2 → สินค้า #${itemIndex + 1}</option>`)).join('');
    // คืน HTML ของ card
    return `<div class="${className}"><img src="${url}" alt=""><b>${escapeHtml(file.name)}</b><select data-queue-role="${index}">${options}</select></div>`;
  }).join('');
  // ผูก event ทุก dropdown ให้เปลี่ยน role ใน state
  $('photoQueueGrid').querySelectorAll('[data-queue-role]').forEach((select) => {
    select.onchange = () => {
      // อ่าน index ของไฟล์จาก data attribute
      const index = Number(select.dataset.queueRole);
      // อ่าน role ที่ผู้ใช้เลือก
      const role = Number(select.value);
      // ถ้าเลือก 0 ให้ลบ role ออกจาก map เพราะถือว่าเป็นรูปหลัก
      if (role === 0) delete photoQueueState.roles[index];
      // ถ้าเลือกเลข ให้เก็บว่าเป็นรูปที่ 2 ของ Item ไหน
      else photoQueueState.roles[index] = role;
      // render ใหม่เพื่ออัปเดตสีของ card
      renderPhotoQueue();
    };
  });
}

// สร้างคู่รูป [primary, secondary] สำหรับ Item 1..N จาก staging ใน Photo Queue
function buildPhotoPairsFromQueue() {
  const count = photoQueueState.itemCount;
  const files = photoQueueState.files;
  const mode = photoQueueState.pairMode || 'auto-single';
  const pairs = Array.from({ length: count }, () => [null, null]);

  if (mode === 'auto-single') {
    if (files.length < count) return null;
    files.slice(0, count).forEach((file, index) => { pairs[index][0] = file; });
    return pairs;
  }

  if (mode === 'auto-pair') {
    if (files.length < count * 2) return null;
    for (let index = 0; index < count; index++) {
      pairs[index][0] = files[index * 2];
      pairs[index][1] = files[index * 2 + 1];
    }
    return pairs;
  }

  // Manual: รูปที่ไม่ได้กำหนดเป็นรูปที่ 2 จะถูกใช้เป็นรูปหลักตามลำดับ filename
  const primaryFiles = files.filter((_, index) => !photoQueueState.roles[index]);
  if (primaryFiles.length < count) return null;
  primaryFiles.slice(0, count).forEach((file, index) => { pairs[index][0] = file; });
  Object.entries(photoQueueState.roles).forEach(([fileIndex, itemNumber]) => {
    const itemIndex = Number(itemNumber) - 1;
    if (pairs[itemIndex]) pairs[itemIndex][1] = files[Number(fileIndex)];
  });
  return pairs;
}

// เริ่ม Bulk Entry จาก Photo Queue
$('startPhotoQueueEntry')?.addEventListener('click', async () => {
  // อ่านจำนวน Item ที่ผู้ใช้ต้องการสร้างจาก Photo Queue
  photoQueueState.itemCount = Math.max(1, Math.min(200, Number($('photoQueueItemCount').value || 1)));
  // สร้างคู่รูป [รูปหลัก, รูปที่ 2] ตาม mapping ที่ผู้ใช้เลือกไว้
  const pairs = buildPhotoPairsFromQueue();
  // ถ้ารูปหลักไม่พอ ให้หยุดก่อนสร้างตาราง
  if (!pairs) return showToast(`รูปหลักไม่พอ: ต้องมีอย่างน้อย ${photoQueueState.itemCount} รูป`);
  // โหลดต้นทุนเฉลี่ยของ Lot ครั้งเดียว แล้วใช้เป็นค่าเริ่มต้นให้ทุกแถว
  const cost = await getLotAvgCost(photoQueueState.lotId);
  // สร้าง staging rows ใน memory; ยังไม่เขียน Database จนกด “บันทึกทั้งหมด”
  bulkTableState = {
    lotId: photoQueueState.lotId,
    group: photoQueueState.group,
    source: 'photo-queue',
    rows: pairs.map((pair, index) => ({
      index,
      files: pair.filter(Boolean),
      item_name: '',
      size: '',
      condition: 'A',
      tier: photoQueueState.group.tier || 'normal',
      price: Number(photoQueueState.group.base_price || 0),
      cost: Number(cost || 0)
    }))
  };
  // ปิด Photo Queue หลังเตรียมข้อมูลสำเร็จ
  $('photoQueuePanel').classList.add('hidden');
  // แสดง Bulk Table เพื่อให้แก้ข้อมูลทั้งกองพร้อมกัน
  showBulkTable();
  showBulkStep(2);
});

// แสดง Bulk Table และซ่อน Quick Entry เพื่อให้ผู้ใช้ทำงานทั้งกองในครั้งเดียว
function showBulkTable() {
  $('bulkTablePanel').classList.remove('hidden');
  $('quickEntryPanel').classList.add('hidden');
  $('bulkTableCount').textContent = bulkTableState.rows.length;
  $('saveBulkTableLabel').textContent = `(${bulkTableState.rows.length} รายการ)`;
  renderBulkTable();
}

// คืน UI จาก Bulk Table ไปยัง Step 1 โดยไม่บันทึกข้อมูล
$('bulkTableBack')?.addEventListener('click', () => {
  $('bulkTablePanel').classList.add('hidden');
  $('quickEntryPanel').classList.remove('hidden');
  showBulkStep(1);
});

// วาดตารางจาก state; input ทุกช่องผูก data-row/data-field เพื่อแก้ state โดยตรง
function renderBulkTable() {
  const rows = bulkTableState.rows || [];
  $('bulkTableBody').innerHTML = rows.map((row, index) => {
    // สร้าง thumbnail จาก File object ที่ยังอยู่ใน browser memory
    const photos = row.files.map(file => `<img src="${URL.createObjectURL(file)}" alt="">`).join('');
    // แสดงข้อความเตือนเมื่อชื่อสินค้ายังว่าง
    const invalid = !String(row.item_name || '').trim();
    return `<tr class="${invalid ? 'bulk-table-row-invalid' : ''}" data-row="${index}">
      <td class="row-no">${index + 1}</td>
      <td><div class="row-photos">${photos || '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:55%;height:55%"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg></span>'}</div></td>
      <td><input class="name-input" data-row="${index}" data-field="item_name" value="${escapeHtml(row.item_name)}" placeholder="เช่น Nike Vintage"><span class="bulk-table-status" data-error-for="${index}">${invalid ? 'ต้องใส่ชื่อสินค้า' : ''}</span></td>
      <td><input data-row="${index}" data-field="size" value="${escapeHtml(row.size)}" placeholder="M"></td>
      <td><select data-row="${index}" data-field="condition"><option value="A" ${row.condition==='A'?'selected':''}>A</option><option value="B" ${row.condition==='B'?'selected':''}>B</option></select></td>
      <td><select data-row="${index}" data-field="tier"><option value="normal" ${row.tier==='normal'?'selected':''}>ปกติ</option><option value="head" ${row.tier==='head'?'selected':''}>งานหัว</option></select></td>
      <td><input class="price-input" type="number" min="0" step="1" data-row="${index}" data-field="price" value="${Number(row.price||0)}"></td>
      <td><input class="cost-input" type="number" min="0" step="0.01" data-row="${index}" data-field="cost" value="${Number(row.cost||0)}" readonly title="ต้นทุนเฉลี่ยจาก Lot"></td>
    </tr>`;
  }).join('');
  // ผูก event ให้ input/select ทุกตัวแก้ state โดยไม่ต้อง re-render ทั้งตารางทุกครั้ง
  $('bulkTableBody').querySelectorAll('[data-row][data-field]').forEach(el => {
    el.addEventListener('input', updateBulkTableField);
    el.addEventListener('change', updateBulkTableField);
    // ทุกการแก้ช่องใน Bulk Table จะ update Draft เพื่อรองรับ Resume
    el.addEventListener('input', saveBulkDraft);
  });
  // bind keyboard/clipboard หลัง render เพราะ input/select ถูกสร้างใหม่ทุกครั้ง
  bindBulkTableKeyboard();
}

// รับค่าจาก input/select แล้วอัปเดต staging row ใน memory
function updateBulkTableField(event) {
  const el = event.currentTarget;
  const rowIndex = Number(el.dataset.row);
  const field = el.dataset.field;
  if (!bulkTableState.rows[rowIndex]) return;
  // แปลงราคา/ต้นทุนเป็น Number; field อื่นเก็บเป็น string
  bulkTableState.rows[rowIndex][field] = ['price','cost'].includes(field) ? Number(el.value || 0) : el.value;
  // อัปเดต validation ของแถวโดยไม่สร้าง DOM ใหม่ทั้งหมด
  const rowEl = el.closest('tr');
  const errorEl = rowEl?.querySelector(`[data-error-for="${rowIndex}"]`);
  const invalid = !String(bulkTableState.rows[rowIndex].item_name || '').trim();
  rowEl?.classList.toggle('bulk-table-row-invalid', invalid);
  if (errorEl) errorEl.textContent = invalid ? 'ต้องใส่ชื่อสินค้า' : '';
}

// ------------------------------------------------------------
// Bulk Table Power Tools
// ส่วนนี้เป็น UX layer ของตาราง: ไม่แตะ Supabase โดยตรง
// Flow: HTML input/select -> bulkTableState -> validate -> Save -> Supabase
// ------------------------------------------------------------
let bulkTableFocus = { row: 0, field: 'item_name' };
const BULK_EDITABLE_FIELDS = ['item_name', 'size', 'condition', 'tier', 'price'];

// จำว่าผู้ใช้กำลังแก้ช่องไหน เพื่อให้ Enter / Fill ลง / Paste เริ่มจากตำแหน่งเดียวกัน
function rememberBulkTableFocus(el) {
  if (!el?.dataset?.row || !el?.dataset?.field) return;
  bulkTableFocus = { row: Number(el.dataset.row), field: el.dataset.field };
  document.querySelectorAll('#bulkTableBody .cell-active').forEach(cell => cell.classList.remove('cell-active'));
  el.closest('td')?.classList.add('cell-active');
}

// คืน element ของช่องในแถว/field ที่ต้องการ โดยไม่ต้องวาดตารางใหม่
function getBulkCell(rowIndex, field) {
  return document.querySelector(`#bulkTableBody [data-row="${rowIndex}"][data-field="${field}"]`);
}

// เขียนค่าจาก state กลับเข้า input/select ของแถวเดียว
function syncBulkCell(rowIndex, field) {
  const el = getBulkCell(rowIndex, field);
  const value = bulkTableState.rows[rowIndex]?.[field] ?? '';
  if (!el) return;
  el.value = value;
}

// Fill Down: เอาค่าจากช่องที่กำลัง focus ไปเติมทุกแถวด้านล่าง
// ตัวอย่าง: เลือก Condition = A ที่แถว 1 -> Ctrl+Enter -> แถว 2..200 เป็น A
function fillDownCurrentField() {
  const { row, field } = bulkTableFocus;
  const source = bulkTableState.rows[row];
  if (!source || !BULK_EDITABLE_FIELDS.includes(field)) return showToast('เลือกช่องข้อมูลที่ต้องการ Fill ลงก่อน');
  const value = source[field];
  for (let i = row + 1; i < bulkTableState.rows.length; i++) {
    bulkTableState.rows[i][field] = value;
    syncBulkCell(i, field);
  }
  // ชื่อสินค้าเป็น field ที่มี validation จึงต้อง refresh สีของแถวหลัง Fill ลง
  if (field === 'item_name') refreshBulkTableValidationRows();
  saveBulkDraft(); // Fill ลงแก้หลายสิบแถวพร้อมกัน ต้องบันทึก Draft ทันทีเหมือนแก้ทีละช่อง
  showToast(`Fill ${field} ลง ${Math.max(0, bulkTableState.rows.length - row - 1)} แถว`);
}

// Refresh สถานะ validation ของทุกแถว โดยไม่สร้าง DOM ใหม่
function refreshBulkTableValidationRows() {
  bulkTableState.rows.forEach((row, index) => {
    const rowEl = document.querySelector(`#bulkTableBody tr[data-row="${index}"]`);
    const errorEl = rowEl?.querySelector(`[data-error-for="${index}"]`);
    const invalid = !String(row.item_name || '').trim();
    rowEl?.classList.toggle('bulk-table-row-invalid', invalid);
    if (errorEl) errorEl.textContent = invalid ? 'ต้องใส่ชื่อสินค้า' : '';
  });
}

// สร้าง TSV ของแถวปัจจุบัน เพื่อเอาไปวางใน Excel/Google Sheets ได้ทันที
function buildBulkRowTSV(rowIndex) {
  const row = bulkTableState.rows[rowIndex];
  if (!row) return '';
  return [row.item_name, row.size, row.condition, row.tier, Number(row.price || 0)].join('\t');
}

// Copy Row: คัดลอกเฉพาะข้อมูล ไม่คัดลอกรูป เพราะรูปเป็น File object และไม่ควรถูกส่งผ่าน clipboard
async function copyCurrentBulkRow() {
  const rowIndex = bulkTableFocus.row;
  const text = buildBulkRowTSV(rowIndex);
  if (!text) return showToast('ยังไม่มีแถวให้คัดลอก');
  try {
    await navigator.clipboard.writeText(text);
    showToast(`คัดลอกแถว #${rowIndex + 1} แล้ว`);
  } catch (error) {
    console.error('Clipboard copy error:', error);
    showToast('คัดลอกไม่ได้: เบราว์เซอร์ไม่อนุญาต Clipboard');
  }
}

// อัปเดต state จาก matrix TSV ที่มาจาก Excel/Google Sheets
// Mapping: item_name | size | condition | tier | price
function pasteBulkMatrix(text, startRow, startField) {
  const matrix = String(text || '').replace(/\r/g, '').trimEnd().split('\n').map(line => line.split('\t'));
  if (!matrix.length || !matrix[0].length) return false;
  const startCol = BULK_EDITABLE_FIELDS.indexOf(startField);
  if (startCol < 0) return false;
  let changed = 0;
  matrix.forEach((cells, rOffset) => {
    const rowIndex = startRow + rOffset;
    const row = bulkTableState.rows[rowIndex];
    if (!row) return;
    cells.forEach((raw, cOffset) => {
      const field = BULK_EDITABLE_FIELDS[startCol + cOffset];
      if (!field) return;
      let value = String(raw ?? '').trim();
      if (field === 'condition') value = ['A', 'B'].includes(value.toUpperCase()) ? value.toUpperCase() : row.condition;
      if (field === 'tier') value = ['head', 'normal'].includes(value.toLowerCase()) ? value.toLowerCase() : row.tier;
      if (field === 'price') value = Number(value.replace(/,/g, '') || 0);
      row[field] = value;
      syncBulkCell(rowIndex, field);
      changed++;
    });
  });
  refreshBulkTableValidationRows();
  if (changed > 0) saveBulkDraft(); // วางจาก Excel มักแก้หลายสิบ/ร้อยช่องในทีเดียว ต้องกันหายเหมือนกัน
  return changed > 0;
}

// อ่าน Clipboard ด้วยปุ่ม “วางจาก Excel” แล้วเริ่มที่ช่องที่ focus ล่าสุด
async function pasteFromClipboardButton() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return showToast('Clipboard ไม่มีข้อมูล');
    if (pasteBulkMatrix(text, bulkTableFocus.row, bulkTableFocus.field)) showToast('วางข้อมูลลงตารางแล้ว');
  } catch (error) {
    console.error('Clipboard paste error:', error);
    showToast('วางไม่ได้: ลองกด Ctrl+V ในช่องตารางโดยตรง');
  }
}

// ผูก keyboard workflow ของ Bulk Table: Enter/Shift+Enter และ Ctrl+Enter
function bindBulkTableKeyboard() {
  const body = $('bulkTableBody');
  if (!body || body.dataset.keyboardBound === '1') return;
  body.dataset.keyboardBound = '1';

  body.addEventListener('focusin', event => rememberBulkTableFocus(event.target));

  body.addEventListener('keydown', event => {
    const el = event.target;
    if (!el?.dataset?.row || !el?.dataset?.field) return;
    rememberBulkTableFocus(el);
    const row = Number(el.dataset.row);
    const field = el.dataset.field;

    // Ctrl+Enter = Fill ลงเฉพาะ field ที่กำลังแก้
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      fillDownCurrentField();
      return;
    }

    // Enter = ไปแถวถัดไปในคอลัมน์เดิม; Shift+Enter = ย้อนกลับหนึ่งแถว
    if (event.key === 'Enter') {
      event.preventDefault();
      const nextRow = Math.max(0, Math.min(bulkTableState.rows.length - 1, row + (event.shiftKey ? -1 : 1)));
      const next = getBulkCell(nextRow, field);
      if (next) {
        next.focus();
        if (typeof next.select === 'function' && next.tagName === 'INPUT') next.select();
      }
    }
  });

  // รองรับ Ctrl+V โดยตรงจาก Excel/Google Sheets แม้ไม่ได้กดปุ่ม “วางจาก Excel”
  body.addEventListener('paste', event => {
    const el = event.target;
    if (!el?.dataset?.row || !el?.dataset?.field) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text || !text.includes('\t')) return; // ถ้าเป็นข้อความธรรมดา ให้ browser paste ตามปกติ
    event.preventDefault();
    rememberBulkTableFocus(el);
    if (pasteBulkMatrix(text, Number(el.dataset.row), el.dataset.field)) showToast('วางข้อมูลจาก Excel แล้ว');
  });
}

// ปุ่มเครื่องมือด้านบนของตารางเชื่อมเข้ากับ state ใน browser เท่านั้น
$('fillDownField')?.addEventListener('click', fillDownCurrentField);
$('copyCurrentRow')?.addEventListener('click', copyCurrentBulkRow);
$('pasteClipboard')?.addEventListener('click', pasteFromClipboardButton);

// ตรวจข้อมูลทั้งหมดก่อนเริ่มเขียนลง Supabase
// คืนสรุปรวมทุกปัญหา เช่น "ไม่มีชื่อ 12 รายการ · ไม่มีรูป 4 รายการ" แทนที่จะหยุดที่แถวแรกที่เจอ
function validateBulkTable() {
  const rows = bulkTableState.rows || [];
  if (!rows.length) return 'ยังไม่มีรายการในตาราง';

  const noName = rows.filter(row => !String(row.item_name || '').trim()).length;
  const noPhoto = rows.filter(row => (row.files?.length || 0) < 1).length;
  const tooManyPhoto = rows.filter(row => (row.files?.length || 0) > 2).length;

  const parts = [];
  if (noName) parts.push(`ไม่มีชื่อ ${noName} รายการ`);
  if (noPhoto) parts.push(`ไม่มีรูป ${noPhoto} รายการ`);
  if (tooManyPhoto) parts.push(`รูปเกิน 2 รูป ${tooManyPhoto} รายการ`);

  return parts.join(' · ');
}

// บันทึก Bulk Table แบบ "สองเฟส" (V15):
//   เฟส 1) insert ทั้งกองเป็น intake_status='draft' — ยังไม่โผล่ใน Stock/Sell/Reports (ดู migration v15)
//   เฟส 2) อัปโหลดรูปทีละ Item แล้ว flip เฉพาะแถวที่สำเร็จเป็น 'listed'
// แถวที่อัปโหลดรูปไม่สำเร็จจะ "ค้างเป็น draft" แทนที่จะ rollback ทั้งกอง — กด "ลองใหม่เฉพาะที่ผิด" ได้โดยไม่ต้องอัปโหลดซ้ำทั้ง 200 ใบ
let bulkRetryQueue = null; // { lotId, group, rows: [{item, row}] } — เก็บไว้เผื่อกดลองใหม่

async function runBulkImageUpload(lotId, group, itemRowPairs) {
  const total = itemRowPairs.length;
  const failed = [];
  let done = 0;
  // อัปโหลดพร้อมกันทีละ 4 งาน กันยิง request 200 ชุดพร้อมกันจนเบราว์เซอร์/เน็ตล่ม
  for (let i = 0; i < itemRowPairs.length; i += 4) {
    const chunk = itemRowPairs.slice(i, i + 4);
    await Promise.all(chunk.map(async ({ item, row }) => {
      try {
        await uploadItemImages(item.id, row.files);
        await supabaseClient.from('items').update({ intake_status: 'listed', listed_at: new Date().toISOString() }).eq('id', item.id);
      } catch (imageError) {
        console.warn(`แถว "${row.item_name}" อัปโหลดไม่สำเร็จ ยังคงเป็น draft:`, imageError);
        failed.push({ item, row });
      }
      done++;
    }));
    showToast(`อัปโหลดรูป ${Math.min(done, total)}/${total}`);
  }
  return { succeeded: total - failed.length, failed };
}

$('saveBulkTable')?.addEventListener('click', async () => {
  const validationError = validateBulkTable();
  if (validationError) return showToast(validationError);
  const button = $('saveBulkTable');
  button.disabled = true;
  const rows = bulkTableState.rows;
  const group = bulkTableState.group;
  const lotId = bulkTableState.lotId;
  try {
    // เฟส 1: insert ทั้งกองเป็น draft ก่อน — ยังไม่นับเป็น "ลงแล้ว" ใน Lot reconciliation จนกว่าจะอัปโหลดรูปสำเร็จ
    const payload = rows.map(row => ({
      id: crypto.randomUUID(),
      lot_id: lotId,
      group_id: group.id,
      item_name: String(row.item_name).trim(),
      size: String(row.size || '').trim(),
      condition: row.condition === 'B' ? 'B' : 'A',
      tier: row.tier === 'head' ? 'head' : 'normal',
      cost_price: Number(row.cost || 0),
      base_price: Number(group.base_price || row.price || 0),
      current_price: Number(row.price || group.base_price || 0),
      status: 'available',
      intake_status: 'draft'
    }));
    const { data: inserted, error } = await supabaseClient.from('items').insert(payload).select();
    if (error) throw error;
    if (!inserted || inserted.length !== rows.length) throw new Error('Supabase คืนจำนวน Item ไม่ครบ');

    // เฟส 2: อัปโหลดรูป + flip เป็น listed เฉพาะแถวที่สำเร็จ
    const pairs = rows.map((row, i) => ({ item: inserted[i], row }));
    const { succeeded, failed } = await runBulkImageUpload(lotId, group, pairs);

    if (failed.length) {
      bulkRetryQueue = { lotId, group, rows: failed };
      bulkTableState = { lotId, group, rows: failed.map(f => f.row), source: 'retry' };
      showToast(`บันทึกสำเร็จ ${succeeded}/${rows.length} — เหลือ ${failed.length} รายการรูปอัปโหลดไม่ผ่าน`);
      $('bulkSummary').innerHTML = `<div class="warn-box">บันทึกสำเร็จ ${succeeded}/${rows.length} รายการ<br>เหลือ ${failed.length} รายการที่รูปอัปโหลดไม่ผ่าน (ยังอยู่ในสต็อกแบบ draft ไม่ขึ้น Stock/Sell) — กด "ลองใหม่เฉพาะที่ผิด" ด้านล่างได้เลยโดยไม่ต้องอัปโหลดซ้ำทั้งกอง<br><button type="button" class="btn btn-primary btn-sm" id="retryFailedUploads" style="margin-top:8px">ลองใหม่เฉพาะที่ผิด (${failed.length})</button></div>`;
      $('retryFailedUploads')?.addEventListener('click', retryFailedBulkUploads);
    } else {
      bulkRetryQueue = null;
      bulkTableState = { lotId:null, group:null, rows:[], source:'photo-queue' };
      clearBulkDraft();
      $('bulkTablePanel').classList.add('hidden');
      $('quickEntryPanel').classList.remove('hidden');
      $('bulkSummary').innerHTML = `<div class="success-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;vertical-align:-3px;margin-right:5px"><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></svg>บันทึกสินค้า ${inserted.length} รายการสำเร็จ</div>`;
    }
    showBulkStep(3);
    await loadItems();
    await loadGroups(lotId);
  } catch (error) {
    console.error('Bulk Table save error:', error);
    showToast('บันทึกกองไม่สำเร็จ: ' + error.message);
  } finally {
    button.disabled = false;
  }
});

// ลองอัปโหลดรูปใหม่เฉพาะแถวที่ค้างเป็น draft — Item เดิมยังอยู่ ไม่ต้อง insert ซ้ำ ไม่ต้องอัปโหลดที่สำเร็จแล้วซ้ำ
async function retryFailedBulkUploads() {
  if (!bulkRetryQueue || !bulkRetryQueue.rows.length) return;
  const { lotId, group, rows } = bulkRetryQueue;
  showToast(`กำลังลองใหม่ ${rows.length} รายการ...`);
  const { succeeded, failed } = await runBulkImageUpload(lotId, group, rows);
  if (failed.length) {
    bulkRetryQueue = { lotId, group, rows: failed };
    bulkTableState = { lotId, group, rows: failed.map(f => f.row), source: 'retry' };
    $('bulkSummary').innerHTML = `<div class="warn-box">ลองใหม่สำเร็จ ${succeeded}/${rows.length} — เหลือ ${failed.length} รายการยังอัปโหลดไม่ผ่าน<br><button type="button" class="btn btn-primary btn-sm" id="retryFailedUploads" style="margin-top:8px">ลองใหม่เฉพาะที่ผิด (${failed.length})</button></div>`;
    $('retryFailedUploads')?.addEventListener('click', retryFailedBulkUploads);
  } else {
    bulkRetryQueue = null;
    bulkTableState = { lotId:null, group:null, rows:[], source:'photo-queue' };
    clearBulkDraft();
    $('bulkTablePanel').classList.add('hidden');
    $('quickEntryPanel').classList.remove('hidden');
    $('bulkSummary').innerHTML = `<div class="success-box">ลองใหม่สำเร็จครบทุกรายการแล้ว</div>`;
  }
  await loadItems();
  await loadGroups(lotId);
}

// เตรียมรูปของ Item ที่กำลังกรอกเข้า file input ของ Quick Entry
async function prepareQueuedItem(index) {
  // อ่านคู่รูปของ Item ปัจจุบัน
  const pair = bulkState.photoPairs[index] || [];
  // สร้าง DataTransfer เพื่อใส่ File object เข้า input type=file
  const transfer = new DataTransfer();
  // เพิ่มรูปหลักถ้ามี
  if (pair[0]) transfer.items.add(pair[0]);
  // เพิ่มรูปที่สองถ้ามี
  if (pair[1]) transfer.items.add(pair[1]);
  // นำ FileList ไปใส่ input
  $('bulkImages').files = transfer.files;
  // แสดง preview ของรูปที่เตรียมไว้
  previewBulkImages();
  // reset fields ที่ผู้ใช้ต้องกรอก
  $('bulkName').value = '';
  $('bulkSize').value = '';
  $('bulkCondition').value = 'A';
  $('bulkTier').value = bulkState.group.tier;
  // ใช้ต้นทุนเฉลี่ยของ Lot
  $('bulkCost').value = await getLotAvgCost(bulkState.lotId);
  // ใช้ราคาตั้งต้นของ Group
  $('bulkPrice').value = bulkState.group.base_price;
  // อัปเดต progress
  renderBulkProgress();
  // focus ชื่อสินค้าเพื่อให้พิมพ์ได้ทันที
  $('bulkName').focus();
}

// Excel import: อ่าน Excel + จับรูปตาม photo_count แล้วส่งเข้า Bulk Table ก่อนบันทึก
$('downloadTemplate')?.addEventListener('click', () => {
  // Template นี้ใช้เป็นสัญญาระหว่าง Excel กับ Bulk Table: 1 แถว = 1 Item
  const ws = XLSX.utils.json_to_sheet([
    {item_name:'Nike Vintage',size:'M',condition:'A',tier:'normal',price:199,photo_count:2},
    {item_name:'Adidas Tee',size:'L',condition:'A',tier:'normal',price:159,photo_count:1}
  ]);
  // สร้าง Workbook ใหม่ใน browser โดยไม่ต้องส่งไฟล์ไป Server
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'items');
  XLSX.writeFile(wb, 'VIMS2_Items_Template.xlsx');
});

let importedRows = [];

$('excelInput')?.addEventListener('change', async event => {
  // อ่านไฟล์ Excel ที่ผู้ใช้เลือกใน browser
  const file = event.target.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  // XLSX อ่านทั้ง .xlsx/.xls/.csv แล้วคืน worksheet ให้เรา
  const workbook = XLSX.read(buffer, {type:'array'});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // แปลงแถว Excel เป็น object โดยให้ช่องว่างกลายเป็น string ว่าง
  const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
  // Normalize ชื่อ column ให้ตรงกับ schema ที่ Bulk Table ใช้
  importedRows = rows.map(row => ({
    item_name: String(row.item_name || row.name || '').trim(),
    size: String(row.size || '').trim(),
    condition: ['A','B'].includes(String(row.condition || '').toUpperCase()) ? String(row.condition).toUpperCase() : 'A',
    tier: String(row.tier || '').toLowerCase() === 'head' ? 'head' : 'normal',
    price: Number(row.price || row.sell_price || 0),
    photo_count: Math.max(1, Math.min(2, Number(row.photo_count || 1)))
  })).filter(row => row.item_name);
  // จำกัด Bulk operation ไม่เกิน 200 Item ตาม Requirement ของร้าน
  if (importedRows.length > 200) return showToast('ครั้งละไม่เกิน 200 รายการ');
  if (!importedRows.length) return showToast('ไม่พบข้อมูลสินค้าใน Excel');
  showToast(`อ่าน Excel แล้ว ${importedRows.length} รายการ`);
});

$('importExcelBtn')?.addEventListener('click', async () => {
  // Excel ต้องถูกอ่านก่อนจึงจะเริ่ม mapping รูปได้
  if (!importedRows.length) return showToast('เลือก Excel ก่อน');
  // เลือก Group ที่ Item ทั้งชุดจะถูกผูกไว้
  const groupId = $('importGroupSelect').value;
  if (!groupId) return showToast('เลือกกลุ่มก่อน');
  const group = allGroups.find(g => g.id === groupId);
  if (!group) return showToast('ไม่พบกลุ่มที่เลือก');
  // เรียงรูปด้วย numeric filename เพื่อให้ IMG_9 มาก่อน IMG_10
  const files = Array.from($('excelImages').files || []).sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
  // รวมจำนวนรูปที่ Excel ระบุว่าต้องใช้ทั้งหมด
  const expected = importedRows.reduce((sum, row) => sum + row.photo_count, 0);
  if (files.length !== expected) return showToast(`จำนวนรูปไม่ตรง: Excel ต้องการ ${expected} รูป แต่เลือก ${files.length} รูป`);
  // คำนวณต้นทุนเฉลี่ยของ Lot ครั้งเดียวแล้วใช้กับทุกแถว
  const cost = await getLotAvgCost(group.lot_id);
  let fileIndex = 0;
  // แปลง Excel rows + รูป เป็น staging rows ของ Bulk Table
  const rows = importedRows.map((row, index) => {
    const itemFiles = files.slice(fileIndex, fileIndex + row.photo_count);
    fileIndex += row.photo_count;
    return {
      index,
      files: itemFiles,
      item_name: row.item_name,
      size: row.size,
      condition: row.condition,
      tier: row.tier,
      price: Number(row.price || group.base_price || 0),
      cost: Number(cost || 0)
    };
  });
  // เก็บข้อมูลไว้ใน staging และให้ผู้ใช้ตรวจ/แก้ก่อนบันทึกจริง
  bulkTableState = {lotId:group.lot_id, group, rows, source:'excel'};
  importedRows = [];
  $('excelInput').value = '';
  $('excelImages').value = '';
  // แสดงตารางตรวจสอบแทนการ insert ทันที เพื่อให้ Excel มี workflow เดียวกับ Photo Queue
  showBulkTable();
  showBulkStep(2);
  saveBulkDraft();
  showToast(`เตรียมตาราง ${rows.length} รายการแล้ว ตรวจสอบก่อนบันทึกได้เลย`);
});


// ============================================================
// ITEM EDIT — แก้ไขสินค้า + รูป + Group + ประวัติ โดยไม่ลบ Sale History
// ============================================================
let editItemImages = [];

// เปิด Edit Modal จาก Item ID ที่มาจาก Stock Card
async function openEditItem(itemId) {
  // หา Item จาก cache ก่อน เพื่อลด query ที่ไม่จำเป็น
  const item = itemsCache.find(x => x.id === itemId);
  if (!item) return showToast('ไม่พบสินค้า');
  editingItemId = itemId;
  $('editItemId').value = itemId;
  $('editItemMeta').textContent = `${item.item_name} · ${item.status === 'sold' ? 'ขายแล้ว' : item.status === 'damaged' ? 'เสีย' : 'พร้อมขาย'}`;
  $('editItemName').value = item.item_name || '';
  $('editSize').value = item.size || '';
  $('editCondition').value = item.condition || 'A';
  $('editTier').value = item.tier || 'normal';
  $('editStatus').value = item.status || 'available';
  $('editBasePrice').value = Number(item.base_price || 0);
  $('editCurrentPrice').value = Number(item.current_price || 0);
  $('editCostPrice').value = Number(item.cost_price || 0);
  $('editLotName').value = item.lots?.lot_name || '-';
  $('editImages').value = '';

  // Group ต้องเป็น Group ของ Lot เดิมเท่านั้น เพื่อไม่ทำให้ relation Lot/Group ผิด
  const { data: groups, error: groupError } = await supabaseClient.from('lot_groups').select('*').eq('lot_id', item.lot_id).order('sort_order');
  if (groupError) return showToast('โหลดกลุ่มไม่สำเร็จ: ' + groupError.message);
  $('editGroup').innerHTML = '<option value="">ไม่ระบุกลุ่ม</option>' + (groups || []).map(g => `<option value="${g.id}">${escapeHtml(g.group_name)} · ${formatBaht(g.base_price)}</option>`).join('');
  $('editGroup').value = item.group_id || '';

  // โหลดรูปปัจจุบันเพื่อให้ผู้ใช้เห็นว่ามีรูป 1 หรือ 2 รูป
  const { data: images, error: imageError } = await supabaseClient.from('item_images').select('*').eq('item_id', itemId).order('sort_order');
  if (imageError) return showToast('โหลดรูปไม่สำเร็จ: ' + imageError.message);
  editItemImages = images || [];
  renderEditCurrentImages();

  // Sold Item ยังแก้ข้อมูลสินค้าได้ แต่ห้ามเปลี่ยนสถานะกลับเป็น Available/Damaged
  $('editStatus').disabled = item.status === 'sold';
  $('editItemWarning').textContent = item.status === 'sold'
    ? 'สินค้านี้ขายแล้ว: แก้ชื่อ/รูป/ราคา/รายละเอียดได้ แต่ระบบจะไม่อนุญาตให้เปลี่ยนสถานะกลับเป็นพร้อมขายหรือเสีย เพื่อรักษาประวัติการขาย'
    : '';

  await loadItemHistory(itemId);
  $('editItemModal').classList.remove('hidden');
}

// แสดงรูปเดิมใน Edit Modal; รูปใหม่จะยังไม่ถูก upload จนกด Save
function renderEditCurrentImages() {
  if (!editItemImages.length) {
    $('editCurrentImages').innerHTML = '<div class="edit-image-empty">ยังไม่มีรูปสินค้า</div>';
    return;
  }
  $('editCurrentImages').innerHTML = editItemImages.map((img, index) => `<div class="edit-image-card"><img src="${img.image_url}" alt=""><span>รูปที่ ${index + 1}</span></div>`).join('');
}

// โหลดประวัติการแก้ไขจาก Supabase; ใช้สำหรับ audit trail ของ Item แต่ละตัว
async function loadItemHistory(itemId) {
  const { data, error } = await supabaseClient.from('item_change_history').select('*').eq('item_id', itemId).order('created_at', {ascending:false}).limit(30);
  if (error) {
    $('itemHistoryList').innerHTML = '<div class="empty-state">ยังไม่ได้รัน migration_v7.sql</div>';
    return;
  }
  if (!data?.length) {
    $('itemHistoryList').innerHTML = '<div class="empty-state">ยังไม่มีประวัติการแก้ไข</div>';
    return;
  }
  $('itemHistoryList').innerHTML = data.map(entry => {
    const changes = entry.changed_fields || {};
    const labels = {item_name:'ชื่อสินค้า',size:'Size',condition:'สภาพ',tier:'Tier',status:'สถานะ',group_id:'กลุ่ม',cost_price:'ต้นทุน',base_price:'ราคาตั้งต้น',current_price:'ราคาปัจจุบัน'};
    const rows = Object.entries(changes).map(([field, value]) => {
      const oldValue = value?.old ?? '-'; const newValue = value?.new ?? '-';
      return `<div class="history-change"><b>${labels[field] || field}</b><span>${escapeHtml(String(oldValue))} → <strong>${escapeHtml(String(newValue))}</strong></span></div>`;
    }).join('');
    return `<div class="history-row"><div class="history-row-head"><span>${entry.action === 'image_replace' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:inline-block;vertical-align:-3px"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg> เปลี่ยนรูป' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:-1px;margin-right:3px"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> แก้ข้อมูล'}</span><span>${new Date(entry.created_at).toLocaleString('th-TH')}</span></div><div class="history-changes">${rows || '<div>มีการเปลี่ยนแปลง</div>'}</div></div>`;
  }).join('');
}

function closeEditItem() {
  $('editItemModal').classList.add('hidden');
  editingItemId = null;
  editItemImages = [];
  $('editImages').value = '';
}
$('closeEditItem')?.addEventListener('click', closeEditItem);
$('cancelEditItem')?.addEventListener('click', closeEditItem);
$('editItemModal')?.addEventListener('click', event => { if (event.target === $('editItemModal')) closeEditItem(); });

// Preview รูปใหม่ก่อน Save; ไม่แตะ Storage จนกว่าจะ submit form
$('editImages')?.addEventListener('change', event => {
  const files = Array.from(event.target.files || []).slice(0,2);
  if (event.target.files.length > 2) showToast('ระบบใช้รูปใหม่แค่ 2 รูปแรก');
  const previews = files.map((file, index) => `<div class="edit-image-card"><img src="${URL.createObjectURL(file)}" alt=""><span>รูปใหม่ ${index + 1}</span></div>`).join('');
  $('editCurrentImages').innerHTML = previews || editItemImages.map((img, index) => `<div class="edit-image-card"><img src="${img.image_url}" alt=""><span>รูปที่ ${index + 1}</span></div>`).join('');
});

function changedFieldMap(before, after) {
  const fields = ['item_name','size','condition','tier','status','group_id','cost_price','base_price','current_price'];
  const result = {};
  fields.forEach(field => {
    const oldValue = before[field] ?? null; const newValue = after[field] ?? null;
    if (String(oldValue) !== String(newValue)) result[field] = {old: oldValue, new: newValue};
  });
  return result;
}

// Save: เรียก RPC เพื่อ update Item + history ใน transaction เดียว จากนั้นค่อยจัดการรูปใน Storage
$('editItemForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const item = itemsCache.find(x => x.id === editingItemId);
  if (!item) return showToast('ไม่พบสินค้า');
  const saveButton = $('saveEditItem'); saveButton.disabled = true;
  try {
    const next = {
      item_name: $('editItemName').value.trim(), size: $('editSize').value.trim(), condition: $('editCondition').value,
      tier: $('editTier').value, status: $('editStatus').value, group_id: $('editGroup').value || null,
      cost_price: Number($('editCostPrice').value || 0), base_price: Number($('editBasePrice').value || 0), current_price: Number($('editCurrentPrice').value || 0)
    };
    if (!next.item_name) return showToast('กรุณาใส่ชื่อสินค้า');
    if (next.status !== 'sold' && item.status === 'sold') return showToast('สินค้าที่ขายแล้วเปลี่ยนกลับไม่ได้');
    const changed = changedFieldMap(item, next);
    const { error } = await supabaseClient.rpc('update_item_with_history', {
      p_item_id: editingItemId, p_item_name: next.item_name, p_size: next.size, p_condition: next.condition, p_tier: next.tier,
      p_status: next.status, p_group_id: next.group_id, p_cost_price: next.cost_price, p_base_price: next.base_price,
      p_current_price: next.current_price, p_changed_fields: changed
    });
    if (error) throw error;

    // ถ้าเลือกไฟล์ใหม่: ลบรายการรูปเดิม + ลบไฟล์เดิมใน Storage + upload รูปใหม่ 1–2 รูป
    const newFiles = Array.from($('editImages').files || []).slice(0,2);
    if (newFiles.length) {
      for (const oldImage of editItemImages) {
        if (oldImage.storage_path) await supabaseClient.storage.from('item-images').remove([oldImage.storage_path]);
      }
      await supabaseClient.from('item_images').delete().eq('item_id', editingItemId);
      await uploadItemImages(editingItemId, newFiles);
      await supabaseClient.from('item_change_history').insert({item_id: editingItemId, action:'image_replace', changed_fields:{old_count:editItemImages.length,new_count:newFiles.length}});
    }

    showToast('บันทึกการแก้ไขแล้ว');
    closeEditItem();
    await loadItems();
  } catch (error) {
    console.error('Edit Item error:', error);
    showToast('แก้ไขไม่สำเร็จ: ' + error.message);
  } finally {
    saveButton.disabled = false;
  }
});
