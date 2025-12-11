const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// รับค่าจาก GitHub Secrets
const DTC_USER = process.env.DTC_USER;
const DTC_PASS = process.env.DTC_PASS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;

(async () => {
    console.log('🚀 Starting Bot (Super Stable Mode)...');

    // ตรวจสอบตัวแปร
    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    let page = null;

    try {
        console.log('🖥️ Launching Browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-accelerated-2d-canvas', // ลดภาระกราฟิก แก้ Crash
                '--disable-software-rasterizer',   // ลดภาระ CPU แก้ Crash
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 3 นาที (กลางๆ ไม่นานเกินไป)
        page.setDefaultNavigationTimeout(180000);
        page.setDefaultTimeout(180000);

        // ตั้งค่า Timezone
        await page.emulateTimezone('Asia/Bangkok');

        // ตั้งค่า Download
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // --- Step 1: เปิดหน้าล็อกอิน ---
        console.log('Command 1: Open Login Page');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });

        // --- Step 2-4: Login (Improved Reliability) ---
        console.log('Command 2-4: Login...');
        await page.waitForSelector('#txtname', { visible: true });
        
        // กรอกข้อมูล
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        console.log('👉 Clicking Login button (JS Method)...');
        
        // ใช้ JavaScript กดปุ่มโดยตรง (เสถียรกว่า page.click)
        await page.evaluate(() => {
            const btn = document.getElementById('btnLogin');
            if(btn) btn.click();
        });

        // รอตรวจสอบว่า Login ผ่านไหม (รอให้ช่อง User หายไป)
        try {
            console.log('⏳ Verifying Login...');
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 15000 });
            console.log('✅ Login Successful (Input disappeared)');
        } catch (e) {
            console.log('⚠️ Login check timed out, trying to click again...');
            // ลองกดซ้ำอีกรอบเผื่อรอบแรกไม่ติด
            await page.evaluate(() => {
                const btn = document.getElementById('btnLogin');
                if(btn) btn.click();
            });
            await new Promise(r => setTimeout(r, 5000));
        }

        // --- Step 6: Force Open Report Page ---
        console.log('Command 6: Go to Report Page');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });

        // เช็คความชัวร์ว่าเข้ามาได้จริงไหม
        const isLoginPage = await page.$('#txtname');
        if (isLoginPage) {
            // ถ่ายรูปเก็บไว้ดูว่าทำไมยังอยู่หน้า Login
            await page.screenshot({ path: path.join(downloadPath, 'error_login_failed.png') });
            throw new Error("Login Failed: Still on login page.");
        }

        // --- Step 8: Type Speed Max ---
        console.log('Command 8: Set Speed Max = 55');
        try {
            await page.waitForSelector('#speed_max', { timeout: 30000 }); // รอ Input นานหน่อย
            await page.evaluate(() => document.getElementById('speed_max').value = '');
            await page.type('#speed_max', '55');
        } catch (e) {
            throw new Error("Cannot find Speed Max input (Page didn't load correctly)");
        }

        // --- Step 9-12: คำนวณวันที่ ---
        console.log('Command 9-12: Calculate & Set Date');
        const dateResult = await page.evaluate(() => {
            var d = new Date(); 
            d.setDate(1); 
            d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); 
            var m = d.getMonth() + 1; 
            var day = d.getDate(); 
            var startDate = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            var d2 = new Date(); 
            var y2 = d2.getFullYear(); 
            var m2 = d2.getMonth() + 1; 
            var lastDay = new Date(y2, m2, 0).getDate(); 
            var endDate = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (lastDay < 10 ? '0' : '') + lastDay + ' 23:59';

            return { start: startDate, end: endDate };
        });

        console.log(`📅 Date Range: ${dateResult.start} to ${dateResult.end}`);

        await page.evaluate((dates) => {
            document.getElementById('date9').value = dates.start;
            document.getElementById('date10').value = dates.end;
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));
        }, dateResult);

        // --- Step 13: Select Minute ---
        console.log('Command 13: Select Minute 1');
        await page.select('#ddlMinute', '1');

        // --- Step 14: Select Truck "All" ---
        console.log('Command 14: Select Truck "All"');
        await page.evaluate(() => {
            var selectElement = document.getElementById('ddl_truck'); 
            var options = selectElement.options; 
            for (var i = 0; i < options.length; i++) { 
                if (options[i].text.includes('ทั้งหมด')) { 
                    selectElement.value = options[i].value; 
                    break; 
                } 
            } 
            var event = new Event('change', { bubbles: true }); 
            selectElement.dispatchEvent(event);
        });

        // --- Step 15: Click Search ---
        console.log('Command 15: Click Search');
        const searchBtn = await page.$x("//span[@onclick='sertch_data();']");
        if (searchBtn.length > 0) {
            await searchBtn[0].click();
        } else {
            console.warn('XPath search failed, trying JS click...');
            await page.evaluate(() => {
                if(typeof sertch_data === 'function') sertch_data();
            });
        }

        // --- Step 16: Wait for Export Button ---
        console.log('Command 16: Waiting for Export button...');
        // รอสูงสุด 2 นาที
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
            console.log('✅ Export button appeared!');
        } catch (e) {
            console.error('⚠️ Warning: Wait timeout, attempting to click anyway...');
            await page.screenshot({ path: path.join(downloadPath, 'debug_no_export.png') });
        }

        // --- Step 17 & 18: Click Export ---
        console.log('Command 17-18: Exporting...');
        // ใช้ JS click ป้องกัน error element not interactive
        await page.evaluate(() => {
             const btn = document.getElementById('btnexport');
             if(btn) btn.click();
        });

        // --- รอไฟล์ดาวน์โหลด ---
        console.log('⏳ Downloading file...');
        let fileName;
        for (let i = 0; i < 60; i++) { // รอ 1 นาที
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            fileName = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
            if (fileName) break;
        }

        if (!fileName) {
            await page.screenshot({ path: path.join(downloadPath, 'error_final.png') });
            throw new Error("File download timeout");
        }
        
        console.log(`✅ File downloaded: ${fileName}`);
        await browser.close();

        // --- ส่งเมล ---
        console.log('📧 Sending Email...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        await transporter.sendMail({
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            subject: `รายงาน DTC Report (Stable Mode) - ${new Date().toLocaleDateString()}`,
            text: `รายงานประจำวัน (Stable Mode)\nช่วงเวลา: ${dateResult.start} ถึง ${dateResult.end}`,
            attachments: [{ filename: fileName, path: path.join(downloadPath, fileName) }]
        });

        console.log('🎉 Mission Complete!');

    } catch (error) {
        console.error('❌ Fatal Error:', error);
        if (page && !page.isClosed()) {
             try { await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') }); } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
