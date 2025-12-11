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
    console.log('🚀 Starting Bot (Fix Export Issue)...');

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
                '--disable-accelerated-2d-canvas',
                '--disable-software-rasterizer',
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 5 นาที (เผื่อเว็บช้า)
        page.setDefaultNavigationTimeout(300000);
        page.setDefaultTimeout(300000);

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

        // --- Step 2-4: Login ---
        console.log('Command 2-4: Login...');
        await page.waitForSelector('#txtname', { visible: true });
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        console.log('👉 Clicking Login button...');
        await page.evaluate(() => {
            const btn = document.getElementById('btnLogin');
            if(btn) btn.click();
        });

        // รอ Login (รอ User หายไป)
        try {
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 20000 });
            console.log('✅ Login Successful');
        } catch (e) {
            console.log('⚠️ Login check timeout, clicking again...');
            await page.evaluate(() => { if(document.getElementById('btnLogin')) document.getElementById('btnLogin').click(); });
            await new Promise(r => setTimeout(r, 5000));
        }

        // --- Step 6: Force Open Report Page ---
        console.log('Command 6: Go to Report Page');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });

        // --- Step 8: Speed Max ---
        console.log('Command 8: Set Speed Max = 55');
        try {
            await page.waitForSelector('#speed_max', { timeout: 30000 });
            await page.evaluate(() => document.getElementById('speed_max').value = '');
            await page.type('#speed_max', '55');
        } catch (e) {
            throw new Error("Cannot find Speed Max input");
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

        // --- Step 13-14: Select Options ---
        console.log('Command 13-14: Select Options');
        await page.select('#ddlMinute', '1');
        await page.evaluate(() => {
            var selectElement = document.getElementById('ddl_truck'); 
            var options = selectElement.options; 
            for (var i = 0; i < options.length; i++) { 
                if (options[i].text.includes('ทั้งหมด')) { 
                    selectElement.value = options[i].value; 
                    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
                    break; 
                } 
            } 
        });

        // --- Step 15: Search ---
        console.log('Command 15: Click Search');
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else {
                const btn = document.querySelector("span[onclick='sertch_data();']");
                if(btn) btn.click();
            }
        });

        // --- Step 16: Wait for Export Button ---
        console.log('Command 16: Waiting for Export button...');
        // รอสูงสุด 3 นาที (เผื่อข้อมูลเยอะ)
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 180000 });
            console.log('✅ Export button appeared!');
            
            // 🔴 เพิ่มการรอแถมอีก 10 วินาที เผื่อปุ่มมาแต่ข้อมูลยัง Loading อยู่
            console.log('⏳ Safety wait 10s for data loading...');
            await new Promise(r => setTimeout(r, 10000));

        } catch (e) {
            console.error('⚠️ Wait timeout, but forcing click anyway...');
            await page.screenshot({ path: path.join(downloadPath, 'debug_no_export.png') });
        }

        // --- Step 17 & 18: Click Export (with Retry) ---
        console.log('Command 17-18: Exporting...');
        
        let fileFound = false;
        
        // ลองกดครั้งที่ 1
        try {
            // ใช้ page.click (เมาส์จริง) แทน JS เพื่อความชัวร์
            await page.click('#btnexport');
        } catch(e) {
            // ถ้ากดไม่ได้ ให้ลองใช้ JS click
            await page.evaluate(() => document.getElementById('btnexport').click());
        }

        // รอไฟล์ 30 วินาทีแรก
        console.log('⏳ Waiting for file (Attempt 1)...');
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            if (hasFile(downloadPath)) { fileFound = true; break; }
        }

        // ถ้า 30 วิยังไม่มา ลองกดซ้ำ! (Attempt 2)
        if (!fileFound) {
            console.log('⚠️ File not started, clicking Export AGAIN...');
            await page.evaluate(() => {
                const btn = document.getElementById('btnexport');
                if(btn) {
                    btn.click(); // กดแบบ JS
                    btn.dispatchEvent(new Event('click')); // ส่ง Event ซ้ำ
                }
            });
            
            // รอยาวๆ อีก 4 นาที
            console.log('⏳ Waiting for file (Final Wait 240s)...');
            for (let i = 0; i < 240; i++) {
                await new Promise(r => setTimeout(r, 1000));
                if (hasFile(downloadPath)) { fileFound = true; break; }
            }
        }

        if (!fileFound) {
            await page.screenshot({ path: path.join(downloadPath, 'error_final.png') });
            throw new Error("File download timeout after retries");
        }
        
        const fileName = getFileName(downloadPath);
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
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString()}`,
            text: `รายงานประจำวันที่ท่านต้องการครับ`,
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

// ฟังก์ชันช่วยเช็คไฟล์
function hasFile(dir) {
    const files = fs.readdirSync(dir);
    return files.some(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
}

function getFileName(dir) {
    const files = fs.readdirSync(dir);
    return files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
}
