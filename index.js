const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// รับค่าจาก GitHub Secrets
const DTC_USER = process.env.DTC_USER || 'ttkmbc';
const DTC_PASS = process.env.DTC_PASS || 'mbcgps';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;

(async () => {
    console.log('🚀 เริ่มต้น Script (GitHub Actions Mode)...');

    // ตรวจสอบค่าตัวแปรก่อนเริ่ม (Debug)
    if (!EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ ไม่พบ EMAIL_USER หรือ EMAIL_PASS ตรวจสอบ Settings > Secrets ใน GitHub');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    // สร้างโฟลเดอร์ถ้ายังไม่มี
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    try {
        console.log('🖥️ กำลังเปิด Chrome...');
        
        // --- จุดสำคัญที่แก้ไข ---
        browser = await puppeteer.launch({
            headless: 'new', // หรือใช้ true
            args: [
                '--no-sandbox',               // สำคัญมากสำหรับ GitHub Actions
                '--disable-setuid-sandbox',   // สำคัญมาก
                '--disable-dev-shm-usage',    // แก้ปัญหา Crash (Exit code 254)
                '--disable-gpu',              // ไม่ใช้การ์ดจอ
                '--no-first-run',
                '--no-zygote',
                '--single-process',           // ช่วยลดการกินทรัพยากร
                '--disable-extensions'
            ]
        });

        const page = await browser.newPage();
        
        // ตั้งค่า User Agent ให้เหมือนคนจริงป้องกันการโดนบล็อก
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // --- 1. เข้าสู่ระบบ ---
        console.log('🔑 กำลัง Login...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'networkidle2', timeout: 60000 });
        
        // รอให้ Element ปรากฏก่อนพิมพ์ (กันพลาด)
        await page.waitForSelector('#txtname', { visible: true });
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#btnLogin')
        ]);
        
        // --- 2. ไปหน้ารายงาน ---
        console.log('📂 ไปหน้ารายงาน...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'networkidle2', timeout: 60000 });
        
        // --- 3. กรอกข้อมูล ---
        console.log('📝 กำลังกรอกข้อมูล...');
        await page.waitForSelector('#speed_max');
        await page.$eval('#speed_max', el => el.value = '55');

        // คำนวณวันที่
        const dStart = new Date();
        dStart.setDate(1);
        dStart.setDate(dStart.getDate() - 2);
        const yStart = dStart.getFullYear();
        const mStart = String(dStart.getMonth() + 1).padStart(2, '0');
        const dayStart = String(dStart.getDate()).padStart(2, '0');
        const startDateString = `${yStart}-${mStart}-${dayStart} 00:00`;

        const dEnd = new Date();
        const yEnd = dEnd.getFullYear();
        const mEnd = dEnd.getMonth() + 1;
        const lastDayObj = new Date(yEnd, mEnd, 0);
        const lastDay = String(lastDayObj.getDate()).padStart(2, '0');
        const mEndStr = String(mEnd).padStart(2, '0');
        const endDateString = `${yEnd}-${mEndStr}-${lastDay} 23:59`;

        await page.evaluate((start, end) => {
            document.getElementById('date9').value = start;
            document.getElementById('date10').value = end;
        }, startDateString, endDateString);

        await page.select('#ddlMinute', '1');

        // เลือกทะเบียนทั้งหมด
        await page.evaluate(() => {
            const select = document.getElementById('ddl_truck');
            const options = select.options;
            for (let i = 0; i < options.length; i++) {
                if (options[i].text.includes('ทั้งหมด')) {
                    select.value = options[i].value;
                    break;
                }
            }
            const event = new Event('change', { bubbles: true });
            select.dispatchEvent(event);
        });

        // --- 4. ค้นหาและโหลดไฟล์ ---
        console.log('🔎 กดค้นหา...');
        await page.evaluate(() => {
             const btn = document.querySelector("span[onclick='sertch_data();']");
             if(btn) btn.click();
        });
        
        // รอให้ปุ่ม Export โผล่ (เพิ่ม Timeout ให้นานขึ้นเป็น 3 นาที เผื่อเว็บช้า)
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 180000 });
        } catch (e) {
            throw new Error('รอนานเกินไป ปุ่ม Export ไม่ขึ้น หรือไม่มีข้อมูลรายงาน');
        }

        console.log('⬇️ กดดาวน์โหลด...');
        await page.click('#btnexport');

        // รอไฟล์เข้า
        console.log('⏳ รอไฟล์บันทึก...');
        let fileName;
        for (let i = 0; i < 90; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            // เช็คว่ามีไฟล์ไหม
            if (fs.existsSync(downloadPath)) {
                const files = fs.readdirSync(downloadPath);
                fileName = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
                if (fileName) break;
            }
        }

        if (!fileName) throw new Error("หมดเวลา: ไฟล์ยังโหลดไม่เสร็จ");
        
        const filePath = path.join(downloadPath, fileName);
        console.log(`✅ พบไฟล์: ${fileName} ขนาด: ${fs.statSync(filePath).size} bytes`);

        await browser.close();
        browser = null; // Clear ตัวแปร

        // --- 5. ส่งอีเมล ---
        console.log('📧 กำลังส่งอีเมล...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS
            }
        });

        await transporter.sendMail({
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            subject: `รายงานประจำวัน (DTC Report) - ${new Date().toLocaleDateString()}`,
            text: `รายงานประจำวันแนบมาแล้วครับ\nวันที่: ${new Date().toLocaleString()}`,
            attachments: [{ filename: fileName, path: filePath }]
        });

        console.log('🎉 ส่งเมลสำเร็จ! จบการทำงาน');

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาด:', error);
        // พยายามปิด Browser ถ้ามันยังเปิดอยู่
        if (browser) await browser.close();
        process.exit(1);
    }
})();
