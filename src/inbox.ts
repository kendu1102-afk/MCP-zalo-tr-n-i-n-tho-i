/**
 * Chủ tài khoản gửi FILE cho nick bot qua Zalo:
 * - .docx có thẻ {ten_truong} -> nạp thành MẪU hồ sơ
 * - PDF/Word/Excel/txt/csv khác -> nạp vào BỘ NHỚ kiến thức (riêng tư)
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { addDoc, extractFileText } from "./knowledge.js";
import { discoverSchema, importTemplate } from "./templates.js";

const INBOX = path.join(DATA_DIR, "inbox");
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "mau";

export async function handleOwnerFile(file: { url: string; name: string }, fetcher: typeof fetch = fetch): Promise<string> {
  fs.mkdirSync(INBOX, { recursive: true, mode: 0o700 });
  const name = path.basename(file.name || "tep");
  const res = await fetcher(file.url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return `⚠ Không tải được tệp "${name}" (HTTP ${res.status}).`;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) return "⚠ Tệp quá lớn (tối đa 50 MB để nạp).";
  const local = path.join(INBOX, `${Date.now()}_${name.replace(/[\\/:*?"<>|]/g, "_")}`);
  fs.writeFileSync(local, buf);
  const ext = path.extname(name).toLowerCase();
  try {
    if (ext === ".docx") {
      const schema = discoverSchema(buf);
      if (schema.scalars.length || Object.keys(schema.loops).length) {
        const id = slug(path.parse(name).name);
        const t = importTemplate(local, id, { name: path.parse(name).name });
        return [
          `✅ Đã nạp MẪU hồ sơ "${t.id}".`,
          `Trường cần điền: ${t.schema.scalars.join(", ") || "—"}`,
          ...Object.entries(t.schema.loops).map(([k, c]) => `Bảng ${k}: ${c.join(", ")}`),
          "Người được cấp quyền giờ có thể nhắn \"làm <loại hồ sơ> ...\" để bot soạn theo mẫu này.",
        ].join("\n");
      }
    }
    const text = (await extractFileText(local)).trim();
    if (!text) return `⚠ "${name}" không có chữ đọc được (có thể là PDF dạng ảnh scan).`;
    const r = addDoc({ title: path.parse(name).name, text, source: `Zalo: ${name}`, botVisible: false });
    const hint = ext === ".docx" ? "\n(Nếu đây là MẪU hồ sơ: mở bằng Word, thay chỗ cần điền bằng thẻ như {kinh_gui}, {noi_dung}, rồi gửi lại.)" : "";
    return `✅ Đã nạp "${name}" vào bộ nhớ (mã ${r.docId}, ${r.chunks} đoạn, riêng tư).\nMuốn bot dùng tài liệu này trả lời bạn bè: /congkhai ${r.docId}${hint}`;
  } catch (e) {
    return `⚠ Chưa nạp được "${name}": ${e instanceof Error ? e.message : e}`;
  } finally {
    fs.rmSync(local, { force: true });
  }
}
