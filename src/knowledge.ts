import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";

export type Hit = { chunkId: number; docId: number; title: string; source: string; text: string; score: number };

/** Cắt văn bản theo đoạn, mỗi chunk ~maxLen ký tự, có gối đầu nhẹ để không mất ngữ cảnh. */
export function chunkText(text: string, maxLen = 900, overlap = 120): string[] {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).flatMap((p) => {
    if (p.length <= maxLen) return [p];
    const out: string[] = [];
    for (let i = 0; i < p.length; i += maxLen - overlap) out.push(p.slice(i, i + maxLen));
    return out;
  });
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxLen) {
      chunks.push(cur);
      cur = cur.slice(-overlap) + "\n\n" + p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

/** Lưu một tài liệu vào bộ nhớ (bền vững trong SQLite). */
export function addDoc(opts: { title: string; text: string; source?: string; botVisible?: boolean }): { docId: number; chunks: number } {
  const chunks = chunkText(opts.text);
  if (chunks.length === 0) throw new Error("Nội dung rỗng, không có gì để lưu.");
  db.exec("BEGIN");
  try {
    const r = db
      .prepare("INSERT INTO docs(title,source,bot_visible,created_at) VALUES(?,?,?,?)")
      .run(opts.title, opts.source ?? "", opts.botVisible === false ? 0 : 1, Date.now());
    const docId = Number(r.lastInsertRowid);
    const insChunk = db.prepare("INSERT INTO chunks(doc_id,idx,text) VALUES(?,?,?)");
    const insFts = db.prepare("INSERT INTO chunks_fts(rowid,text) VALUES(?,?)");
    chunks.forEach((t, i) => {
      const cr = insChunk.run(docId, i, t);
      insFts.run(Number(cr.lastInsertRowid), `${opts.title}\n${t}`); // đánh chỉ mục cả tiêu đề
    });
    db.exec("COMMIT");
    return { docId, chunks: chunks.length };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function deleteDoc(docId: number): boolean {
  const ids = db.prepare("SELECT id FROM chunks WHERE doc_id=?").all(docId) as { id: number }[];
  if (ids.length === 0 && !db.prepare("SELECT 1 FROM docs WHERE id=?").get(docId)) return false;
  db.exec("BEGIN");
  try {
    const del = db.prepare("DELETE FROM chunks_fts WHERE rowid=?");
    for (const { id } of ids) del.run(id);
    db.prepare("DELETE FROM docs WHERE id=?").run(docId); // chunks xoá theo CASCADE
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function setDocVisibility(docId: number, botVisible: boolean): boolean {
  return Number(db.prepare("UPDATE docs SET bot_visible=? WHERE id=?").run(botVisible ? 1 : 0, docId).changes) > 0;
}

export function listDocs() {
  return db
    .prepare(
      `SELECT d.id, d.title, d.source, d.bot_visible AS botVisible, d.created_at AS createdAt,
              (SELECT COUNT(*) FROM chunks c WHERE c.doc_id=d.id) AS chunks
       FROM docs d ORDER BY d.id DESC`,
    )
    .all() as { id: number; title: string; source: string; botVisible: number; createdAt: number; chunks: number }[];
}

/** Từ khoá của câu hỏi -> truy vấn FTS5 dạng OR (không phụ thuộc dấu tiếng Việt). */
function toFtsQuery(q: string): string | null {
  // Từ dừng so khớp CÓ dấu (tránh nhầm "và" với "vá" khi bỏ dấu)
  const stop = new Set(["là", "và", "có", "không", "thế", "nào", "của", "cho", "tôi", "bạn", "mình", "gì", "ạ", "vậy", "nhé", "ơi", "thì", "được", "bao", "nhiêu", "the", "is", "of"]);
  const words = (q.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 || /\d/.test(w));
  const kept = [...new Set(words)].filter((w) => !stop.has(w));
  if (kept.length === 0) return null;
  return kept.map((w) => `"${w.replace(/"/g, "")}"`).join(" OR ");
}

export function search(query: string, opts: { limit?: number; botOnly?: boolean } = {}): Hit[] {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  const rows = db
    .prepare(
      `SELECT c.id AS chunkId, d.id AS docId, d.title, d.source, c.text, bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.rowid
       JOIN docs d ON d.id = c.doc_id
       WHERE chunks_fts MATCH ? ${opts.botOnly ? "AND d.bot_visible = 1" : ""}
       ORDER BY score LIMIT ?`,
    )
    .all(fts, opts.limit ?? 5) as Hit[];
  return rows;
}

/** Đọc nội dung chữ từ file: txt/md/csv/json/docx/pdf/xlsx. */
export async function extractFileText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  switch (ext) {
    case ".txt": case ".md": case ".csv": case ".json": case ".log":
      return buf.toString("utf8");
    case ".docx": {
      const mammoth = await import("mammoth");
      return (await mammoth.extractRawText({ buffer: buf })).value;
    }
    case ".pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    }
    case ".xlsx": case ".xlsm": {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const out: string[] = [];
      wb.eachSheet((ws) => {
        out.push(`=== Sheet: ${ws.name} ===`);
        let n = 0;
        ws.eachRow({ includeEmpty: false }, (row) => {
          if (n++ >= 500) return;
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => { cells.push(String(cell.text ?? "").replace(/\s+/g, " ").trim()); });
          while (cells.length && !cells[cells.length - 1]) cells.pop();
          if (cells.some(Boolean)) out.push(cells.join(" | "));
        });
      });
      return out.join("\n");
    }
    default:
      throw new Error(`Chưa hỗ trợ định dạng ${ext || "(không đuôi)"}. Hỗ trợ: txt, md, csv, json, docx, pdf, xlsx.`);
  }
}
