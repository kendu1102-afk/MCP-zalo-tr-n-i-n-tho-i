import { Zalo, type Credentials } from "zca-js";
import { LoginQRCallbackEventType } from "zca-js";
import { QR_PATH, SESSION_PATH } from "./config.js";
import { saveSession } from "./zalo.js";
import { firstRunPairCode } from "./pairing.js";

console.log("Đang tạo mã QR đăng nhập Zalo...");
const zalo = new Zalo();
await zalo.loginQR({ qrPath: QR_PATH }, async (ev) => {
  switch (ev.type) {
    case LoginQRCallbackEventType.QRCodeGenerated:
      await ev.actions.saveToFile(QR_PATH);
      console.log(`\nMở file ảnh này rồi quét bằng Zalo trên điện thoại (Cá nhân > biểu tượng QR > Quét):\n  ${QR_PATH}\n`);
      break;
    case LoginQRCallbackEventType.QRCodeScanned:
      console.log(`Đã quét bởi "${ev.data.display_name}". Hãy bấm XÁC NHẬN trên điện thoại.`);
      break;
    case LoginQRCallbackEventType.QRCodeExpired:
      console.log("Mã QR hết hạn, đang tạo lại...");
      ev.actions.retry();
      break;
    case LoginQRCallbackEventType.QRCodeDeclined:
      console.log("Bạn đã từ chối trên điện thoại. Chạy lại lệnh để thử lại.");
      process.exit(1);
    case LoginQRCallbackEventType.GotLoginInfo: {
      const c: Credentials = { cookie: ev.data.cookie, imei: ev.data.imei, userAgent: ev.data.userAgent };
      saveSession(c);
      console.log(`Đăng nhập thành công. Đã lưu phiên vào ${SESSION_PATH} (giữ bí mật file này).`);
      const code = firstRunPairCode();
      if (code) console.log(`\n>>> MÃ GHÉP NỐI TÀI KHOẢN CHỦ: ${code} (hiệu lực 24 giờ)\n    Sau khi chạy bot, dùng Zalo CHÍNH của bạn nhắn cho nick bot:  /ketnoi ${code}\n    (Nick chính cần kết bạn với nick bot.)`);
      break;
    }
  }
});
process.exit(0);
