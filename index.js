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
    console.log('🚀 Starting Bot (Fast Mode & Debug)...');

    if (!EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets not found.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    let page = null; // ประกาศตัวแปร page ไว้ข้างนอกเพื่อให้ catch block เรียกใช้ได้

    try {
        console.log('🖥️ Launching Chrome...');
        
        browser = await puppeteer.launch({
            headless: 'new',
            protocolTimeout: 300000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 5 นาที (เผื่อเว็บช้าจริงๆ)
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
        // ปรับเป็น domcontentloaded เพื่อให้ผ่านไวขึ้น ไม่ต้องรอเน็ตนิ่ง
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('#txtname', { visible: true });
        await page.type('#txtname', DTC_USER, { delay: 20 }); 
        await page.type('#txtpass', DTC_PASS, { delay: 20 });
        
        console.log('👉 Clicking Login...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('#btnLogin')
        ]);
        
        // 2. ไปหน้ารายงาน
        console.log('📂 Navigating to report...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // 3. กรอกข้อมูล
        console.log('📝 Filling form...');
        await page.waitForSelector('#speed_max', { visible: true });
        
        // Clear ค่าเก่าและพิมพ์ใหม่
        await page.evaluate(() => document.getElementById('speed_max').value = '');
        await page.type('#speed_max', '55');

        // คำนวณวันที่ (Timezone Thai)
        const now = new Date();
        const thaiDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
        
        const dStart = new Date(thaiDate);
        dStart.setDate(dStart.getDate() - 2);
        
        const yEnd = thaiDate.getFullYear();
        const mEnd = thaiDate.getMonth() + 1;
        const lastDayObj = new Date(yEnd, mEnd, 0);
        
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        const startDateString = `${formatDate(dStart)} 00:00`;
        const endDateString = `${yEnd}-${String(mEnd).padStart(2, '0')}-${String(lastDayObj.getDate()).padStart(2, '0')} 23:59`;

        console.log(`📅 Date Range: ${startDateString} to ${endDateString}`);

        // Inject ค่าและ Trigger Event
        await page.evaluate((start, end) => {
            const date9 = document.getElementById('date9');
            const date10 = document.getElementById('date10');
            
            date9.value = start;
            date10.value = end;
            
            date9.dispatchEvent(new Event('change', { bubbles: true }));
            date10.dispatchEvent(new Event('change', { bubbles: true }));
        }, startDateString, endDateString);

        await page.select('#ddlMinute', '1');

        // เลือกทะเบียน
        await page.evaluate(() => {
            const select = document.getElementById('ddl_truck');
            const options = select.options;
            for (let i = 0; i < options.length; i++) {
                if (options[i].text.includes('ทั้งหมด')) {
                    select.value = options[i].value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        });

        // 4. ค้นหา
        console.log('🔎 Searching...');
        try {
            // ใช้ JS click โดยตรง ชัวร์กว่า Selector
            await page.evaluate(() => {
                const searchBtn = document.querySelector("span[onclick='sertch_data();']");
                if (searchBtn) searchBtn.click();
                else if (typeof sertch_data === 'function') sertch_data();
            });
        } catch (e) {
            console.error('⚠️ Search click failed, trying alternative...');
        }
        
        console.log('⏳ Waiting for Export button...');
        // รอ Export (ถ้านานเกิน 2 นาที ให้ถ่ายรูปเช็ค)
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
        } catch (e) {
            console.error('❌ Export button not found within 2 mins. Taking screenshot...');
            await page.screenshot({ path: path.join(downloadPath, 'error_no_export.png') });
            throw new Error('Export button missing (Screenshot saved)');
        }

        // 5. ดาวน์โหลด
        console.log('⬇️ Clicking Export...');
        await page.click('#btnexport');

        // รอไฟล์
        console.log('⏳ Waiting for file download...');
        let fileName;
        // รอ 3 นาที
        for (let i = 0; i < 180; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (fs.existsSync(downloadPath)) {
                const files = fs.readdirSync(downloadPath);
                // หาไฟล์ excel หรือ png (ถ้ามี error screenshot)
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
        
        // ถ่ายรูปหน้าจอตอน Error ไว้ดู (ถ้าทำได้)
        if (page && !page.isClosed()) {
            try {
                const screenshotPath = path.join(downloadPath, 'fatal_error.png');
                await page.screenshot({ path: screenshotPath });
                console.log(`📸 Screenshot saved at: ${screenshotPath}`);
            } catch (e) {
                console.error('Could not take screenshot');
            }
        }

        if (browser) await browser.close();
        process.exit(1);
    }
})();
