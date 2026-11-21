/**
 * Mẫu văn bản của công ty: file .docx đặt trong data/templates/, có các thẻ dạng {ten_truong}.
 * Bảng lặp dòng: đặt {#ds} ở ô đầu và {/ds} ở ô cuối của MỘT dòng, các thẻ con ({ten}, {khoi_luong}...) nằm giữa.
 * Có thể kèm file <id>.json: { "name": "...", "kind": "báo cáo tuần", "description": "...", "fields": { "ten_truong": "mô tả" } }
 */
import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { DOCS_DIR, TEMPLATES_DIR } from "./config.js";

export const MISSING = "[CHƯA CÓ DỮ LIỆU]";
export type Schema = { scalars: string[]; loops: Record<string, string[]> };
export type TemplateInfo = { id: string; name: string; kind: string; description: string; fieldNotes: Record<string, string>; schema: Schema };

const TAG = /\{([#\/^]?)\s*([A-Za-z_][\w.]*)\s*\}/g;
const safeId = (id: string) => /^[A-Za-z0-9_\-]+$/.test(id);

/** Đọc các thẻ trong mẫu (ghép chữ theo từng đoạn vì Word hay tách một thẻ thành nhiều run). */
export function discoverSchema(docx: Buffer): Schema {
  const zip = new PizZip(docx);
  const scalars = new Set<string>();
  const loops: Record<string, string[]> = {};
  const stack: string[] = [];
  const parts = Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f));
  for (const f of parts) {
    const xml = zip.file(f)!.asText();
    for (const para of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
      const text = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      for (const m of text.matchAll(TAG)) {
        const [, kind, name] = m;
        if (kind === "#" || kind === "^") { stack.push(name); loops[name] ??= []; }
        else if (kind === "/") { const i = stack.lastIndexOf(name); if (i >= 0) stack.splice(i, 1); }
        else if (stack.length) { const cur = stack[stack.length - 1]; if (!loops[cur].includes(name)) loops[cur].push(name); }
        else scalars.add(name);
      }
    }
  }
  for (const k of Object.keys(loops)) scalars.delete(k);
  return { scalars: [...scalars], loops };
}

export function listTemplates(): TemplateInfo[] {
  const out: TemplateInfo[] = [];
  for (const f of fs.readdirSync(TEMPLATES_DIR)) {
    if (!f.toLowerCase().endsWith(".docx")) continue;
    const id = f.slice(0, -5);
    if (!safeId(id)) continue;
    try { out.push(getTemplate(id)); } catch { /* bỏ qua file hỏng */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function getTemplate(id: string): TemplateInfo {
  if (!safeId(id)) throw new Error(`Mã mẫu không hợp lệ: ${id}`);
  const file = path.join(TEMPLATES_DIR, `${id}.docx`);
  if (!fs.existsSync(file)) throw new Error(`Không có mẫu "${id}".`);
  let meta: { name?: string; kind?: string; description?: string; fields?: Record<string, string> } = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.json`), "utf8")); } catch { /* không bắt buộc */ }
  return { id, name: meta.name ?? id, kind: meta.kind ?? "", description: meta.description ?? "", fieldNotes: meta.fields ?? {}, schema: discoverSchema(fs.readFileSync(file)) };
}

/** Nhập mẫu từ một file .docx có sẵn. Từ chối mẫu không có thẻ nào (vì sẽ không điền được gì). */
export function importTemplate(srcPath: string, id: string, meta: { name?: string; kind?: string; description?: string; fields?: Record<string, string> } = {}): TemplateInfo {
  if (!safeId(id)) throw new Error("Mã mẫu chỉ gồm chữ không dấu, số, gạch nối, gạch dưới.");
  const buf = fs.readFileSync(srcPath);
  const schema = discoverSchema(buf);
  if (!schema.scalars.length && !Object.keys(schema.loops).length)
    throw new Error("File không có thẻ {ten_truong} nào. Hãy mở mẫu trong Word và thay các chỗ cần điền bằng thẻ, ví dụ {so_van_ban}, {ngay}, {noi_dung}.");
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${id}.docx`), buf);
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${id}.json`), JSON.stringify({ name: meta.name ?? id, kind: meta.kind ?? "", description: meta.description ?? "", fields: meta.fields ?? {} }, null, 2));
  return getTemplate(id);
}

type Value = string | Value[] | { [k: string]: Value };
const fill = (v: unknown): Value => {
  if (Array.isArray(v)) return v.map(fill);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
  const s = v === null || v === undefined ? "" : String(v);
  return s.trim() === "" ? MISSING : s;
};

/** Điền dữ liệu vào mẫu, ghi file vào data/docs/, trả đường dẫn. Trường trống được ghi rõ [CHƯA CÓ DỮ LIỆU]. */
export function renderTemplate(id: string, data: Record<string, unknown>, fileStem: string): string {
  const info = getTemplate(id);
  const zip = new PizZip(fs.readFileSync(path.join(TEMPLATES_DIR, `${id}.docx`)));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "{", end: "}" }, nullGetter: () => MISSING });
  const model: Record<string, Value> = {};
  for (const k of info.schema.scalars) model[k] = fill(data[k]);
  for (const [k, children] of Object.entries(info.schema.loops)) {
    const rows = Array.isArray(data[k]) ? (data[k] as Record<string, unknown>[]) : [];
    model[k] = rows.map((r) => Object.fromEntries(children.map((c) => [c, fill(r?.[c])]))) as Value;
  }
  try {
    doc.render(model);
  } catch (e) {
    const errs = (e as { properties?: { errors?: { message: string }[] } }).properties?.errors;
    throw new Error("Lỗi điền mẫu: " + (errs?.map((x) => x.message).join("; ") ?? (e instanceof Error ? e.message : String(e))));
  }
  const stem = fileStem.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^A-Za-z0-9_\-]+/g, "_").slice(0, 80) || "ho-so";
  const out = path.join(DOCS_DIR, `${stem}.docx`);
  fs.writeFileSync(out, doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }));
  return out;
}

/** Chữ thuần của một file docx (để kiểm tra/đọc lại nội dung). */
export function docxText(file: string): string {
  const zip = new PizZip(fs.readFileSync(file));
  const xml = zip.file("word/document.xml")!.asText();
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("")).join("\n")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
