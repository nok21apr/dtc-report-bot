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
    console.log('🚀 เริ่มต้น Script (GitHub Actions Mode Fixed)...');

    // ตรวจสอบค่าตัวแปร
    if (!EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ ไม่พบ EMAIL_USER หรือ EMAIL_PASS ตรวจสอบ Settings > Secrets');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    try {
        console.log('🖥️ กำลังเปิด Chrome...');
        
        // --- 🔴 จุดแก้ Exit Code 254 (สำคัญที่สุด) ---
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',               // ต้องมี
                '--disable-setuid-sandbox',   // ต้องมี
                '--disable-dev-shm-usage',    // แก้เมมเต็ม/Crash
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'            // ลดโหลด
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // --- เริ่มขั้นตอนปกติ ---
        console.log('1. Login...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'networkidle2', timeout: 60000 });
        
        await page.waitForSelector('#txtname', { visible: true });
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#btnLogin')
        ]);
        
        console.log('2. Navigate Report...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('3. Fill Form...');
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

        console.log('4. Search...');
        await page.evaluate(() => {
             const btn = document.querySelector("span[onclick='sertch_data();']");
             if(btn) btn.click();
        });
        
        // รอ Export (เพิ่มเวลาเป็น 3 นาที)
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 180000 });
        } catch (e) {
            throw new Error('Timeout waiting for Export button');
        }

        console.log('5. Download...');
        await page.click('#btnexport');

        console.log('6. Waiting for file...');
        let fileName;
        for (let i = 0; i < 90; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (fs.existsSync(downloadPath)) {
                const files = fs.readdirSync(downloadPath);
                fileName = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
                if (fileName) break;
            }
        }

        if (!fileName) throw new Error("Timeout: File not found");
        
        const filePath = path.join(downloadPath, fileName);
        console.log(`✅ File found: ${fileName}`);

        await browser.close();
        browser = null;

        console.log('7. Sending Email...');
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
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString()}`,
            text: `รายงานประจำวันที่ท่านต้องการครับ`,
            attachments: [{ filename: fileName, path: filePath }]
        });

        console.log('🎉 Success!');

    } catch (error) {
        console.error('❌ Error:', error);
        if (browser) await browser.close();
        process.exit(1);
    }
})();
