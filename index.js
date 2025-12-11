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
    console.log('🚀 Starting Bot (Stealth Mode)...');

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
            ignoreHTTPSErrors: true, // สำคัญ: ข้าม Error ความปลอดภัย
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security', // ปิดความปลอดภัยเว็บชั่วคราว
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 3 นาที
        page.setDefaultNavigationTimeout(180000);
        page.setDefaultTimeout(180000);

        // ปลอมตัวเป็นคน (สำคัญมากสำหรับ Step 1)
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        });

        await page.emulateTimezone('Asia/Bangkok');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // ---------------------------------------------------------
        // Step 1: Access Website
        // ---------------------------------------------------------
        console.log('🌐 Step 1: Going to DTC Website...');
        
        try {
            await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        } catch (e) {
            console.error('❌ Failed to load page:', e.message);
            throw e;
        }

        // เช็คว่าเข้าเว็บได้จริงไหม
        const pageTitle = await page.title();
        console.log(`📄 Page Title: "${pageTitle}"`); // ดู Log ตรงนี้ว่าขึ้นชื่อเว็บไหม
        
        // ถ่ายรูปดูหน้าตาเว็บหน่อย
        await page.screenshot({ path: path.join(downloadPath, '1_homepage.png') });

        // เช็คว่ามีช่องกรอกรหัสไหม
        const hasLoginInput = await page.$('#txtname');
        if (!hasLoginInput) {
            console.error('❌ Login input not found! Maybe blocked?');
            throw new Error(`Login input missing. Page title: ${pageTitle}`);
        }

        // ---------------------------------------------------------
        // Step 2: Login
        // ---------------------------------------------------------
        console.log('🔐 Step 2: Logging in...');
        
        await page.type('#txtname', DTC_USER, { delay: 100 }); // พิมพ์ช้าๆ
        await page.type('#txtpass', DTC_PASS, { delay: 100 });
        
        await page.screenshot({ path: path.join(downloadPath, '2_filled_login.png') });

        console.log('👉 Clicking Login...');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(e => console.log('Navigation timeout ignored')),
            page.click('#btnLogin')
        ]);

        // ตรวจสอบผลลัพธ์
        await new Promise(r => setTimeout(r, 5000)); // รอ 5 วิ
        await page.screenshot({ path: path.join(downloadPath, '3_after_login.png') });

        if (await page.$('#txtname')) {
             console.error('⚠️ Still on login page. Credentials might be wrong or blocked.');
             throw new Error('Login Failed: Still seeing login inputs');
        }
        console.log('✅ Login Passed (Input disappeared)');

        // ---------------------------------------------------------
        // Step 3: Go to Report
        // ---------------------------------------------------------
        console.log('📄 Step 3: Go to Report Page...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // --- Step 4: Fill Form ---
        console.log('📝 Step 4: Filling Form...');
        await page.waitForSelector('#speed_max', { visible: true, timeout: 60000 });
        
        await page.evaluate(() => {
            document.getElementById('speed_max').value = '55';
            
            // Date Logic (UI.Vision Formula)
            var d = new Date(); d.setDate(1); d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); var m = d.getMonth() + 1; var day = d.getDate(); 
            var start = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            var d2 = new Date(); var y2 = d2.getFullYear(); var m2 = d2.getMonth() + 1; 
            var last = new Date(y2, m2, 0).getDate(); 
            var end = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (last < 10 ? '0' : '') + last + ' 23:59';

            document.getElementById('date9').value = start;
            document.getElementById('date10').value = end;
            
            document.getElementById('ddlMinute').value = '1';
            
            // Select Truck
            const sel = document.getElementById('ddl_truck');
            for(let o of sel.options) {
                if(o.text.includes('ทั้งหมด')) { sel.value = o.value; break; }
            }
        });

        // --- Step 5: Search & Export ---
        console.log('🔍 Step 5: Search & Export...');
        
        // กดค้นหา
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else document.querySelector("span[onclick='sertch_data();']").click();
        });

        // รอ Export
        console.log('⏳ Waiting for Export button...');
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
        } catch(e) {
            await page.screenshot({ path: path.join(downloadPath, 'error_no_export.png') });
            throw new Error('Export button not found');
        }

        // กด Export
        console.log('⬇️ Clicking Export...');
        await page.click('#btnexport');

        // รอไฟล์
        console.log('⏳ Downloading...');
        let foundFile;
        for(let i=0; i<180; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const f = fs.readdirSync(downloadPath).find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
            if(f) { foundFile = f; break; }
        }

        if(!foundFile) throw new Error('Download Timeout');
        
        console.log(`✅ File: ${foundFile}`);
        await browser.close();

        // --- Send Email ---
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
            attachments: [{ filename: foundFile, path: path.join(downloadPath, foundFile) }]
        });

        console.log('🎉 Done!');

    } catch (error) {
        console.error('❌ FATAL ERROR:', error);
        if (page && !page.isClosed()) {
            try { await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') }); } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
