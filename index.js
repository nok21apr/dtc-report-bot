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
    console.log('🚀 Starting Bot...');

    if (!EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: EMAIL_USER or EMAIL_PASS not found in Secrets.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    try {
        console.log('🖥️ Launching Chrome...');
        
        // --- การตั้งค่าเพื่อแก้ Exit Code 254 ---
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // แก้ปัญหา Memory
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        
        // ตั้งค่า User Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // ตั้งค่า Download
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // 1. Login
        console.log('🔑 Logging in...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'networkidle0', timeout: 60000 });
        
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        await Promise.all([
            page.waitForNavigation(),
            page.click('#btnLogin')
        ]);
        
        // 2. ไปหน้ารายงาน
        console.log('📂 Navigating to report...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'networkidle0', timeout: 60000 });
        
        // 3. กรอกข้อมูล
        console.log('📝 Filling form...');
        await page.waitForSelector('#speed_max');
        await page.$eval('#speed_max', el => el.value = '55');

        // คำนวณวันที่ (ตาม Logic เดิมของคุณ)
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
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // 4. ค้นหา
        console.log('🔎 Searching...');
        await page.evaluate(() => {
             const btn = document.querySelector("span[onclick='sertch_data();']");
             if(btn) btn.click();
        });
        
        // รอ Export
        console.log('⏳ Waiting for Export button...');
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 180000 }); // รอ 3 นาที
        } catch (e) {
            throw new Error('Export button not found (Timeout)');
        }

        // 5. ดาวน์โหลด
        console.log('⬇️ Clicking Export...');
        await page.click('#btnexport');

        // รอไฟล์
        console.log('⏳ Waiting for file download...');
        let fileName;
        for (let i = 0; i < 60; i++) { // รอ 60 วินาที
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (fs.existsSync(downloadPath)) {
                const files = fs.readdirSync(downloadPath);
                fileName = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
                if (fileName) break;
            }
        }

        if (!fileName) throw new Error("File download timeout");
        
        const filePath = path.join(downloadPath, fileName);
        console.log(`✅ File downloaded: ${fileName}`);

        await browser.close();
        browser = null;

        // 6. ส่งเมล
        console.log('📧 Sending email...');
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
            subject: `รายงาน DTC Report - ${startDateString.split(' ')[0]}`,
            text: `รายงานประจำวันที่ท่านต้องการครับ`,
            attachments: [{ filename: fileName, path: filePath }]
        });

        console.log('🎉 Done! Email sent.');

    } catch (error) {
        console.error('❌ Crash Error:', error);
        if (browser) await browser.close();
        process.exit(1);
    }
})();
