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
    console.log('🚀 Starting Bot (UI.Vision Replica Mode)...');

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
                '--window-size=1920,1080', // จำลองจอใหญ่เหมือนคอมปกติ
                '--lang=th-TH,th' // ตั้งค่าภาษาเป็นไทย
            ]
        });

        page = await browser.newPage();
        
        // Timeout 5 นาที (เผื่อเว็บช้าตามสไตล์ UI.Vision)
        page.setDefaultNavigationTimeout(300000);
        page.setDefaultTimeout(300000);

        // ตั้งค่า Timezone เป็นไทย (สำคัญมาก เพื่อให้สูตรวันที่ตรงกับ UI.Vision บนคอมคุณ)
        await page.emulateTimezone('Asia/Bangkok');

        // ตั้งค่า Download
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // --- Step 1: เปิดหน้าล็อกอิน ---
        console.log('Command 1: Open Login Page');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'networkidle2' });

        // --- Step 2-4: Login ---
        console.log('Command 2-4: Login');
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        await Promise.all([
            page.waitForNavigation(),
            page.click('#btnLogin')
        ]);

        // --- Step 5: Pause 5000 (ตามไฟล์ UI.Vision) ---
        console.log('Command 5: Pause 5s');
        await new Promise(r => setTimeout(r, 5000));

        // --- Step 6: Open Report Page ---
        console.log('Command 6: Open Report Page');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'networkidle2' });

        // --- Step 7: Pause 5000 ---
        console.log('Command 7: Pause 5s');
        await new Promise(r => setTimeout(r, 5000));

        // --- Step 8: Type Speed Max ---
        console.log('Command 8: Set Speed Max = 55');
        await page.waitForSelector('#speed_max');
        await page.evaluate(() => document.getElementById('speed_max').value = ''); // Clear ก่อน
        await page.type('#speed_max', '55');

        // --- Step 9-12: คำนวณวันที่ (สูตรจาก UI.Vision เป๊ะๆ) ---
        console.log('Command 9-12: Calculate & Set Date');
        
        // เราใช้ page.evaluate เพื่อรัน JS ในบริบทของ Browser เหมือน executeScript ของ UI.Vision
        const dateResult = await page.evaluate(() => {
            // สูตร Start Date (Command 9)
            var d = new Date(); 
            d.setDate(1); 
            d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); 
            var m = d.getMonth() + 1; 
            var day = d.getDate(); 
            var startDate = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            // สูตร End Date (Command 11)
            var d2 = new Date(); 
            var y2 = d2.getFullYear(); 
            var m2 = d2.getMonth() + 1; 
            var lastDay = new Date(y2, m2, 0).getDate(); 
            var endDate = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (lastDay < 10 ? '0' : '') + lastDay + ' 23:59';

            return { start: startDate, end: endDate };
        });

        console.log(`📅 Date Range: ${dateResult.start} to ${dateResult.end}`);

        // กรอกวันที่ (Command 10 & 12)
        await page.evaluate((dates) => {
            document.getElementById('date9').value = dates.start;
            document.getElementById('date10').value = dates.end;
            // Trigger Change (สำคัญมาก ไม่งั้นกดค้นหาไม่เจอ)
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));
        }, dateResult);

        // --- Step 13: Select Minute ---
        console.log('Command 13: Select Minute 1');
        await page.select('#ddlMinute', '1');

        // --- Step 14: Select Truck "All" (Execute Script) ---
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

        // --- Step 15: Click Search (XPath) ---
        console.log('Command 15: Click Search');
        // ใช้ XPath เหมือน UI.Vision
        const searchBtn = await page.$x("//span[@onclick='sertch_data();']");
        if (searchBtn.length > 0) {
            await searchBtn[0].click();
        } else {
            // Fallback: ถ้า XPath หาไม่เจอ ให้ใช้ JS Click
            console.warn('XPath search failed, trying JS click...');
            await page.evaluate(() => sertch_data());
        }

        // --- Step 16: Pause 120000 (รอโหลดข้อมูล) ---
        console.log('Command 16: Waiting 120s (Data Loading)...');
        // รอ 2 นาทีเต็มๆ ตามที่คุณตั้งไว้
        // (แต่ผมจะเช็คทุก 5 วินาที เผื่อเสร็จก่อนจะได้ไม่ต้องรอนานเกิน)
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
            console.log('✅ Export button appeared!');
        } catch (e) {
            console.error('⚠️ Warning: Wait timeout, but forcing click anyway...');
        }

        // --- Step 17 & 18: Click Export ---
        console.log('Command 17-18: Exporting...');
        await page.click('#btnexport');

        // --- รอไฟล์ดาวน์โหลด ---
        console.log('⏳ Downloading file...');
        let fileName;
        // รอสูงสุด 3 นาที
        for (let i = 0; i < 180; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            fileName = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
            if (fileName) break;
        }

        if (!fileName) {
            // ถ่ายรูปหน้าจอถ้าหาไฟล์ไม่เจอ
            await page.screenshot({ path: path.join(downloadPath, 'error_no_file.png') });
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
            subject: `รายงาน DTC Report (UI.Vision Clone) - ${new Date().toLocaleDateString()}`,
            text: `รายงานประจำวันที่ท่านต้องการครับ\n(สร้างจาก Logic UI.Vision ต้นฉบับ)`,
            attachments: [{ filename: fileName, path: path.join(downloadPath, fileName) }]
        });

        console.log('🎉 Mission Complete!');

    } catch (error) {
        console.error('❌ Fatal Error:', error);
        if (page) await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') });
        if (browser) await browser.close();
        process.exit(1);
    }
})();
