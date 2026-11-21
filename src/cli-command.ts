/**
 * Chạy lệnh quản trị ngay trên máy (giống nhắn cho nick bot), ví dụ:
 *   npm run lenh -- "/drive G:\My Drive\Zalo hien truong"
 *   npm run lenh -- "/congtrinh them Cầu ABC | ABC"
 *   npm run lenh -- /trangthai
 */
import { isAdminCommand, runAdminCommand } from "./admin.js";

const text = process.argv.slice(2).join(" ").trim();
if (!isAdminCommand(text)) { console.log(runAdminCommand("cli", "/huongdan")); process.exit(text ? 1 : 0); }
console.log(runAdminCommand("cli", text));
