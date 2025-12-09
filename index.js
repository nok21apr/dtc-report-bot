const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// รับค่าจาก GitHub Secrets (เพื่อความปลอดภัย) หรือใส่ตรงๆ ก็ได้
const DTC_USER = process.env.DTC_USER || 'ttkmbc';
const DTC_PASS = process.env.DTC_PASS || 'mbcgps';
const EMAIL_USER = process.env.EMAIL_USER; // อีเมลคนส่ง (Gmail)
const EMAIL_PASS = process.env.EMAIL_PASS; // รหัสผ่านแอป (App Password)
const EMAIL_TO = process.env.EMAIL_TO;     // อีเมลคนรับ

(async () => {
    const downloadPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    try {
        console.log('🚀 เริ่มต้นการทำงาน...');

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // --- 1. เข้าสู่ระบบ ---
        console.log('🔑 กำลัง Login...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'networkidle2' });
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        await Promise.all([
            page.waitForNavigation(),
            page.click('#btnLogin')
        ]);
        await new Promise(r => setTimeout(r, 5000));

        // --- 2. ไปหน้ารายงาน ---
        console.log('navigating to report page...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));

        // --- 3. กรอกข้อมูล ---
        console.log('📝 กำลังกรอกข้อมูลวันที่...');
        await page.$eval('#speed_max', el => el.value = '55');

        // คำนวณวันที่ (ย้อนหลัง 2 วัน ถึง สิ้นเดือนปัจจุบัน ตาม Logic เดิม)
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
        console.log('🔎 กำลังค้นหา...');
        await page.evaluate(() => {
             const btn = document.querySelector("span[onclick='sertch_data();']");
             if(btn) btn.click();
        });
        
        await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
        console.log('⬇️ กำลังดาวน์โหลดไฟล์...');
        await page.click('#btnexport');

        // รอไฟล์
        let fileName;
        for (let i = 0; i < 90; i++) { // รอ 90 วินาที
            await new Promise(resolve => setTimeout(resolve, 1000));
            const files = fs.readdirSync(downloadPath);
            fileName = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
            if (fileName) break;
        }

        if (!fileName) throw new Error("หาไฟล์ไม่เจอ (Timeout)");
        const filePath = path.join(downloadPath, fileName);
        console.log(`✅ ได้ไฟล์แล้ว: ${fileName}`);

        await browser.close();

        // --- 5. ส่งอีเมล ---
        console.log('📧 กำลังส่งอีเมล...');
        
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS // ต้องใช้ App Password
            }
        });

        const mailOptions = {
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            subject: `รายงานประจำวัน (DTC Report) - ${new Date().toLocaleDateString()}`,
            text: 'รายงานประจำวันแนบมาในไฟล์นี้ครับ',
            attachments: [
                {
                    filename: 'report.xlsx',
                    path: filePath
                }
            ]
        };

        await transporter.sendMail(mailOptions);
        console.log('🎉 ส่งเมลสำเร็จ!');

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาด:', error);
        process.exit(1); // แจ้ง GitHub ว่า Job พัง
    }
})();