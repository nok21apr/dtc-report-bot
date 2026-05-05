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
    console.log('🚀 Starting Bot (Auto-Retry on Empty File Mode)...');

    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (fs.existsSync(downloadPath)) fs.rmSync(downloadPath, { recursive: true, force: true });
    fs.mkdirSync(downloadPath);

    let browser = null;
    let page = null;
    let finalFile = null; // ย้ายตัวแปรมารอนอก Loop

    try {
        console.log('🖥️ Launching Browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 1 นาที
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        await page.emulateTimezone('Asia/Bangkok');
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // ---------------------------------------------------------
        // Step 1: Login
        // ---------------------------------------------------------
        console.log('1️⃣ Step 1: Login...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('#txtname', { visible: true });
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        await Promise.all([
            page.evaluate(() => document.getElementById('btnLogin').click()),
            page.waitForFunction(() => !document.querySelector('#txtname'))
        ]);
        console.log('✅ Login Success');

        // ---------------------------------------------------------
        // Step 2: Navigate to Report
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Go to Report Page...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // ---------------------------------------------------------
// Step 3: Fill Form
// ---------------------------------------------------------
console.log('3️⃣ Step 3: Fill Form...');

await page.waitForSelector('#speed_max', { visible: true });
await page.waitForSelector('#ddl_truck', { visible: true }); 
await new Promise(r => setTimeout(r, 2000));

await page.evaluate(() => {
    document.getElementById('speed_max').value = '55';
    
    // คำนวณวันเริ่มต้น (คงเดิม)
    var d = new Date(); d.setDate(1); d.setDate(d.getDate() - 2); 
    var y = d.getFullYear(); var m = d.getMonth() + 1; var day = d.getDate(); 
    var start = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

    // คำนวณวันสิ้นสุด (ปรับใหม่: เป็นวันที่ 2 ของเดือนถัดไป)
    var d2 = new Date(); 
    d2.setDate(1); // ป้องกันบั๊กกรณีรันสคริปต์ช่วงสิ้นเดือนที่มี 31 วัน
    d2.setMonth(d2.getMonth() + 1); // บวกไป 1 เดือน
    
    var y2 = d2.getFullYear(); 
    var m2 = d2.getMonth() + 1; 
    // กำหนดวันที่เป็น '02' เสมอ ตามความต้องการ
    var end = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-02 23:59';

    document.getElementById('date9').value = start;
    document.getElementById('date10').value = end;
    
    document.getElementById('date9').dispatchEvent(new Event('change'));
    document.getElementById('date10').dispatchEvent(new Event('change'));

    document.getElementById('ddlMinute').value = '1';
    
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

        // =========================================================
        // 🔄 RETRY LOOP: Step 4, 5, 6 (Search -> Wait -> Check)
        // =========================================================
        const MAX_RETRIES = 3; // จำนวนครั้งที่จะลองใหม่
        let isFileValid = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            console.log(`\n🔄 Attempt ${attempt}/${MAX_RETRIES}: Searching and Exporting...`);

            // ---------------------------------------------------------
            // Step 4: Search
            // ---------------------------------------------------------
            console.log('4️⃣ Step 4: Clicking Search...');
            await page.evaluate(() => {
                if(typeof sertch_data === 'function') sertch_data();
                else document.querySelector("span[onclick='sertch_data();']").click();
            });

            // ---------------------------------------------------------
            // Step 5: Wait for Data (Smart Wait)
            // ---------------------------------------------------------
            console.log('⏳ Step 5: Waiting for Data...');
            try {
                // รอให้ Network นิ่ง 3 วิ (แปลว่าโหลดเสร็จ) แต่ไม่เกิน 5 นาที
                await page.waitForNetworkIdle({ idleTime: 3000, timeout: 300000 });
            } catch (e) {
                console.log('⚠️ Network Wait Timeout, proceeding anyway...');
            }
            await page.waitForSelector('#btnexport', { visible: true, timeout: 60000 });
            await new Promise(r => setTimeout(r, 3000)); // รอ Render หน้าจอ

            // ---------------------------------------------------------
            // Step 6: Export & Check File Size
            // ---------------------------------------------------------
            console.log('6️⃣ Step 6: Exporting...');
            
            // เคลียร์ไฟล์เก่าในโฟลเดอร์ก่อนโหลดใหม่ (ถ้ามี)
            if (fs.existsSync(downloadPath)) {
                fs.readdirSync(downloadPath).forEach(f => fs.unlinkSync(path.join(downloadPath, f)));
            }

            await page.evaluate(() => document.getElementById('btnexport').click());
            
            console.log('   Waiting for file...');
            let downloadedFile = null;

            // รอไฟล์ 2 นาที
            for (let i = 0; i < 120; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
                if (target) {
                    downloadedFile = target;
                    break;
                }
            }

            if (!downloadedFile) {
                console.warn('⚠️ No file downloaded in this attempt.');
                continue; // ไปรอบถัดไป
            }

            // 🔍 ตรวจสอบขนาดไฟล์
            const filePath = path.join(downloadPath, downloadedFile);
            const stats = fs.statSync(filePath);
            const fileSizeInBytes = stats.size;
            const fileSizeInKB = fileSizeInBytes / 1024;

            console.log(`📄 File found: ${downloadedFile} | Size: ${fileSizeInKB.toFixed(2)} KB`);

            if (fileSizeInKB < 10) { // <--- เงื่อนไข: ถ้าน้อยกว่า 10KB
                console.warn(`❌ File is too small (<10KB). Likely empty content. Retrying...`);
                // ไฟล์จะถูกลบอัตโนมัติในรอบถัดไปตรงบรรทัด "เคลียร์ไฟล์เก่า"
            } else {
                console.log(`✅ File size is OK (>10KB). Proceeding.`);
                finalFile = downloadedFile;
                isFileValid = true;
                break; // <--- สำเร็จ! ออกจาก Loop
            }
        }
        // =========================================================

        if (!isFileValid || !finalFile) {
            throw new Error(`❌ Failed to get valid file after ${MAX_RETRIES} attempts.`);
        }

        await browser.close();

        // ---------------------------------------------------------
        // Step 7: Email
        // ---------------------------------------------------------
        console.log('📧 Step 7: Sending Email...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        await transporter.sendMail({
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            // แก้ไขวันที่เป็น YYYY-MM-DD (2026-03-02) ตามที่ขอ
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })}`,
            text: `ถึง ผู้เกี่ยวข้อง\n\nรายงานความเร็วเกิน โปรดติดตามทะเบียนที่เกิดปัญหา\nไฟล์: ${finalFile}\n\nด้วยความนับถือ\nDTC BOT REPORT`,
            attachments: [{ filename: finalFile, path: path.join(downloadPath, finalFile) }]
        });

        console.log('🎉 Mission Complete!');

    } catch (error) {
        console.error('❌ FATAL ERROR:', error.message);
        if (page && !page.isClosed()) {
            try { 
                await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') }); 
            } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
