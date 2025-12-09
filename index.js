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
    console.log('🚀 Starting Bot (Enhanced Stability Mode)...');

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
            protocolTimeout: 300000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1920,1080' // กำหนดขนาดหน้าจอให้เหมือนคอมปกติ
            ]
        });

        const page = await browser.newPage();
        
        // Timeout 5 นาที
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
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('#txtname');
        await page.type('#txtname', DTC_USER, { delay: 50 }); // พิมพ์ทีละตัวเหมือนคน
        await page.type('#txtpass', DTC_PASS, { delay: 50 });
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('#btnLogin')
        ]);
        
        // 2. ไปหน้ารายงาน
        console.log('📂 Navigating to report...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'networkidle2' });
        
        // 3. กรอกข้อมูล (ปรับปรุงใหม่ แก้ปัญหา Timezone และ Event Trigger)
        console.log('📝 Filling form with Thai Date logic...');
        await page.waitForSelector('#speed_max');
        
        // Clear ค่าเก่าและพิมพ์ใหม่ (ชัวร์กว่าการยัด value)
        await page.click('#speed_max', { clickCount: 3 });
        await page.type('#speed_max', '55');

        // คำนวณวันที่แบบระบุ Timezone เป็นไทย (ป้องกันปัญหา UTC)
        const now = new Date();
        const thaiDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
        
        // คำนวณวันเริ่มต้น (ย้อนหลัง 2 วัน)
        const dStart = new Date(thaiDate);
        dStart.setDate(dStart.getDate() - 2);
        
        // คำนวณวันสิ้นสุด (สิ้นเดือน)
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

        // Inject ค่าและ Trigger Event (จุดสำคัญที่แก้ไข) 🔴
        await page.evaluate((start, end) => {
            const date9 = document.getElementById('date9');
            const date10 = document.getElementById('date10');
            
            date9.value = start;
            date10.value = end;
            
            // แจ้งเว็บว่าค่าเปลี่ยนแล้วนะ (สำคัญมาก!)
            date9.dispatchEvent(new Event('change', { bubbles: true }));
            date9.dispatchEvent(new Event('input', { bubbles: true }));
            date10.dispatchEvent(new Event('change', { bubbles: true }));
            date10.dispatchEvent(new Event('input', { bubbles: true }));
        }, startDateString, endDateString);

        await page.select('#ddlMinute', '1');

        // เลือกทะเบียน
        await page.evaluate(() => {
            const select = document.getElementById('ddl_truck');
            const options = select.options;
            let found = false;
            for (let i = 0; i < options.length; i++) {
                if (options[i].text.includes('ทั้งหมด')) {
                    select.value = options[i].value;
                    found = true;
                    break;
                }
            }
            if(found) {
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // 4. ค้นหา
        console.log('🔎 Searching...');
        // ลองกดด้วย Selector เดิม ถ้าไม่ได้ให้ลองวิธีอื่น
        try {
            await page.waitForSelector("span[onclick='sertch_data();']", { timeout: 5000 });
            await page.click("span[onclick='sertch_data();']");
        } catch (e) {
            console.log('⚠️ Standard search button not found, trying JS execution...');
            await page.evaluate(() => {
                if(typeof sertch_data === 'function') {
                    sertch_data(); // เรียกฟังก์ชันของเว็บโดยตรงเลย (ชัวร์สุด)
                } else {
                    console.error('Function sertch_data not found!');
                }
            });
        }
        
        console.log('⏳ Waiting for Export button...');
        // รอ Export
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        } catch (e) {
            console.log('⚠️ Warning: Export button taking too long. Check if data exists.');
            // ถ่ายรูปหน้าจอตอน Error เก็บไว้ดู (ถ้า Run บน Local จะเห็นไฟล์นี้)
            try { await page.screenshot({ path: 'error_screenshot.png' }); } catch(err){}
        }

        // 5. ดาวน์โหลด
        console.log('⬇️ Clicking Export...');
        const exportBtn = await page.$('#btnexport');
        if (exportBtn) {
            // ดักจับ Request ดาวน์โหลด
            await page.click('#btnexport');
        } else {
            throw new Error('Export button missing - No data found or login failed');
        }

        // รอไฟล์
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
