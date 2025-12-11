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
    console.log('🚀 Starting Bot (Download Master Mode)...');

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
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 5 นาที
        page.setDefaultNavigationTimeout(300000);
        page.setDefaultTimeout(300000);

        await page.emulateTimezone('Asia/Bangkok');

        // ฟังก์ชันตั้งค่า Download (แยกออกมาเพื่อเรียกใช้ซ้ำ)
        const setupDownload = async () => {
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: downloadPath,
            });
        };
        await setupDownload();

        // จัดการ Dialog/Alert อัตโนมัติ (เผื่อมี popup เด้ง)
        page.on('dialog', async dialog => {
            console.log(`⚠️ Alert detected: ${dialog.message()}`);
            await dialog.accept();
        });

        // ---------------------------------------------------------
        // Step 1: Login
        // ---------------------------------------------------------
        console.log('🌐 Step 1: Opening Website...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        // Login Logic
        try {
            await page.waitForSelector('#txtname', { visible: true, timeout: 30000 });
            await page.type('#txtname', DTC_USER);
            await page.type('#txtpass', DTC_PASS);
            
            console.log('🔐 Logging in...');
            // ใช้ JS Click ชัวร์สุด
            await page.evaluate(() => document.getElementById('btnLogin').click());
            
            // รอให้ช่อง User หายไป
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 30000 });
            console.log('✅ Login Success');
        } catch (e) {
            console.log('⚠️ Already logged in or Login skipped');
        }

        // ---------------------------------------------------------
        // Step 2: Go to Report
        // ---------------------------------------------------------
        console.log('📄 Step 2: Navigate to Report...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });

        // ---------------------------------------------------------
        // Step 3: Fill Form
        // ---------------------------------------------------------
        console.log('📝 Step 3: Fill Form...');
        await page.waitForSelector('#speed_max', { visible: true, timeout: 60000 });
        
        await page.evaluate(() => {
            // Speed
            document.getElementById('speed_max').value = '55';
            
            // Date Calculation (Timezone Thai)
            var d = new Date(); 
            d.setDate(1); 
            d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); var m = d.getMonth() + 1; var day = d.getDate(); 
            var start = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            var d2 = new Date(); var y2 = d2.getFullYear(); var m2 = d2.getMonth() + 1; 
            var last = new Date(y2, m2, 0).getDate(); 
            var end = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (last < 10 ? '0' : '') + last + ' 23:59';

            document.getElementById('date9').value = start;
            document.getElementById('date10').value = end;
            
            // Trigger Change
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));

            // Minute
            document.getElementById('ddlMinute').value = '1';
            
            // Truck
            const sel = document.getElementById('ddl_truck');
            for(let o of sel.options) {
                if(o.text.includes('ทั้งหมด')) { 
                    sel.value = o.value; 
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    break; 
                }
            }
        });

        // ---------------------------------------------------------
        // Step 4: Search & Export (The Critical Part)
        // ---------------------------------------------------------
        console.log('🔍 Step 4: Search...');
        
        // กดค้นหา
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else document.querySelector("span[onclick='sertch_data();']").click();
        });

        console.log('⏳ Waiting for Export button...');
        await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
        console.log('✅ Export button appeared!');

        // รอแถม 5 วินาที เผื่อปุ่มยังกดไม่ได้ (Loading บัง)
        await new Promise(r => setTimeout(r, 5000));

        // ย้ำสิทธิ์ Download อีกรอบก่อนกด (กันพลาด)
        await setupDownload();

        console.log('⬇️ Step 5: Clicking Export (Loop Strategy)...');
        
        let fileDownloaded = false;
        let attempts = 0;
        
        // วนลูปกดปุ่ม จนกว่าไฟล์จะมา (ลอง 5 ครั้ง)
        while (!fileDownloaded && attempts < 5) {
            attempts++;
            console.log(`   👉 Click Attempt ${attempts}...`);
            
            // กดปุ่ม (ใช้ JS Click เพราะแม่นยำกว่า)
            await page.evaluate(() => document.getElementById('btnexport').click());
            
            // รอเช็คไฟล์ 15 วินาที
            console.log('      Checking file...');
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                // เช็คว่ามีไฟล์ .xlsx หรือ .xls โผล่มาไหม
                if (files.some(f => f.endsWith('.xlsx') || f.endsWith('.xls'))) {
                    fileDownloaded = true;
                    break;
                }
            }
            
            if (fileDownloaded) break;
            console.log('      File not found yet, retrying click...');
        }

        // รอรอบสุดท้ายยาวๆ เผื่อเน็ตช้า
        if (!fileDownloaded) {
            console.log('⏳ Final Wait (60s)...');
            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                if (files.some(f => f.endsWith('.xlsx') || f.endsWith('.xls'))) {
                    fileDownloaded = true;
                    break;
                }
            }
        }

        if (!fileDownloaded) {
            // ถ่ายรูปไว้ดูต่างหน้า
            await page.screenshot({ path: path.join(downloadPath, 'error_download_failed.png') });
            throw new Error('❌ Download Timeout: File did not appear after multiple clicks.');
        }

        // หาชื่อไฟล์
        const finalFile = fs.readdirSync(downloadPath).find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
        console.log(`✅ File Downloaded: ${finalFile}`);
        await browser.close();

        // ---------------------------------------------------------
        // Step 6: Send Email
        // ---------------------------------------------------------
        console.log('📧 Step 6: Sending Email...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        await transporter.sendMail({
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString()}`,
            text: `ระบบทำงานสำเร็จ\nไฟล์: ${finalFile}`,
            attachments: [{ filename: finalFile, path: path.join(downloadPath, finalFile) }]
        });

        console.log('🎉 Mission Complete!');

    } catch (error) {
        console.error('❌ FATAL ERROR:', error);
        if (page && !page.isClosed()) {
            try { await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') }); } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
