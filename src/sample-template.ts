/** Tạo mẫu báo cáo tuần MẪU (để thử và để bạn tham khảo cách đặt thẻ). Mẫu thật của công ty bạn thay thế sau. */
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, AlignmentType, WidthType } from "docx";
import { TEMPLATES_DIR } from "./config.js";

const p = (t: string, o: { bold?: boolean; center?: boolean } = {}) =>
  new Paragraph({ alignment: o.center ? AlignmentType.CENTER : undefined, children: [new TextRun({ text: t, bold: o.bold, font: "Times New Roman", size: 26 })] });
const cell = (t: string, bold = false) => new TableCell({ children: [p(t, { bold })] });

export async function buildSampleTemplate(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        p("{don_vi}", { bold: true, center: true }),
        p("BÁO CÁO {ky_bao_cao}", { bold: true, center: true }),
        p("Công trình: {ten_cong_trinh}", { center: true }),
        p("Kính gửi: {kinh_gui}"),
        p("I. Căn cứ và tình hình chung"),
        p("{tinh_hinh_chung}"),
        p("II. Khối lượng thực hiện trong kỳ"),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [cell("Hạng mục", true), cell("Đơn vị", true), cell("Khối lượng", true), cell("Ghi chú", true)] }),
            new TableRow({ children: [cell("{#hang_muc}{ten}"), cell("{don_vi_tinh}"), cell("{khoi_luong}"), cell("{ghi_chu}{/hang_muc}")] }),
          ],
        }),
        p("III. Tồn tại, kiến nghị"),
        p("{ton_tai_kien_nghi}"),
        p("{noi_ky}, {ngay_thang}"),
        p("{nguoi_ky}", { bold: true }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

export async function writeSampleTemplate(id = "bao-cao-tuan-mau"): Promise<string> {
  const f = path.join(TEMPLATES_DIR, `${id}.docx`);
  fs.writeFileSync(f, await buildSampleTemplate());
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${id}.json`), JSON.stringify({
    name: "Báo cáo tuần (mẫu thử)", kind: "báo cáo tuần/tháng gửi chủ đầu tư",
    description: "Mẫu thử do hệ thống tạo. Hãy thay bằng mẫu thật của công ty.",
    fields: {
      ky_bao_cao: "Kỳ báo cáo, ví dụ 'TUẦN 47 (từ 15/11/2026 đến 21/11/2026)'",
      kinh_gui: "Đơn vị nhận báo cáo",
      tinh_hinh_chung: "Tóm tắt tình hình thi công trong kỳ, chỉ dựa trên số liệu hiện có",
      hang_muc: "Mỗi dòng một hạng mục: ten, don_vi_tinh, khoi_luong (khối lượng thực hiện TRONG KỲ), ghi_chu",
      ton_tai_kien_nghi: "Tồn tại, vướng mắc, kiến nghị (chỉ nêu điều có trong dữ liệu)",
    },
  }, null, 2));
  return f;
}
if (process.argv[1]?.endsWith("sample-template.ts")) console.log("Đã tạo mẫu thử:", await writeSampleTemplate());
