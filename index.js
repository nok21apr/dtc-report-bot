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
    console.log('🚀 Starting Bot (Maximum Timeout Mode)...');

    if (!EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets not found.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    try {
        console.log('🖥️ Launching Chrome...');
        
        browser = await puppeteer.launch({
            headless: 'new',
            // เพิ่ม protocolTimeout แก้ปัญหา Chrome ตอบสนองช้า
            protocolTimeout: 300000, 
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        
        // 🔴 ปรับเวลา Timeout เป็น 5 นาที (300,000 ms) หรือ 0 (ไม่จำกัด)
        page.setDefaultNavigationTimeout(300000); 
        page.setDefaultTimeout(300000);

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // 1. Login
        console.log('🔑 Logging in...');
        // ใช้ waitUntil: 'load' เพื่อให้แน่ใจว่าโหลดเสร็จจริง
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'load' });
        
        await page.waitForSelector('#txtname');
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load' }),
            page.click('#btnLogin')
        ]);
        
        // 2. ไปหน้ารายงาน
        console.log('📂 Navigating to report...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'load' });
        
        // 3. กรอกข้อมูล
        console.log('📝 Filling form...');
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
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // 4. ค้นหา
        console.log('🔎 Searching...');
        await page.evaluate(() => {
             const btn = document.querySelector("span[onclick='sertch_data();']");
             if(btn) btn.click();
        });
        
        console.log('⏳ Waiting for Export button...');
        // รอ Export นานสุด 5 นาที
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        } catch (e) {
            console.log('⚠️ Warning: Export button taking too long. Trying to proceed anyway...');
        }

        // 5. ดาวน์โหลด
        console.log('⬇️ Clicking Export...');
        const exportBtn = await page.$('#btnexport');
        if (exportBtn) {
            await page.click('#btnexport');
        } else {
            console.error('❌ Export button not found even after waiting.');
            throw new Error('Export button missing');
        }

        // รอไฟล์ (เพิ่มรอบการรอเป็น 180 วินาที = 3 นาที)
        console.log('⏳ Waiting for file download (Max 3 mins)...');
        let fileName;
        for (let i = 0; i < 180; i++) {
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
        console.error('❌ Fatal Error:', error);
        if (browser) await browser.close();
        process.exit(1);
    }
})();
