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
    console.log('🚀 Starting Bot (Clean & Simple Mode)...');

    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (fs.existsSync(downloadPath)) fs.rmSync(downloadPath, { recursive: true, force: true });
    fs.mkdirSync(downloadPath);

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
        
        // Timeout 5 นาที (พอดีๆ ไม่นานเกินรอ)
        page.setDefaultNavigationTimeout(300000);
        page.setDefaultTimeout(300000);

        await page.emulateTimezone('Asia/Bangkok');
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // ---------------------------------------------------------
        // Step 1: Login
        // ---------------------------------------------------------
        console.log('1️⃣ Step 1: Login...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        // รอช่องกรอกรหัส
        await page.waitForSelector('#txtname', { visible: true, timeout: 60000 });
        
        // พิมพ์รหัส
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        // กดปุ่ม Login
        console.log('   Clicking Login...');
        await Promise.all([
            page.evaluate(() => document.getElementById('btnLogin').click()),
            // รอจนกว่าช่อง User จะหายไป (แปลว่าเปลี่ยนหน้าแล้ว)
            page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 60000 })
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
        
        await page.evaluate(() => {
            // Speed
            document.getElementById('speed_max').value = '55';
            
            // Date Formula (UI.Vision)
            var d = new Date(); d.setDate(1); d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); var m = d.getMonth() + 1; var day = d.getDate(); 
            var start = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            var d2 = new Date(); var y2 = d2.getFullYear(); var m2 = d2.getMonth() + 1; 
            var last = new Date(y2, m2, 0).getDate(); 
            var end = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (last < 10 ? '0' : '') + last + ' 23:59';

            document.getElementById('date9').value = start;
            document.getElementById('date10').value = end;
            
            // Trigger Events
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));

            // Options
            document.getElementById('ddlMinute').value = '1';
            const sel = document.getElementById('ddl_truck');
            for(let o of sel.options) {
                if(o.text.includes('ทั้งหมด')) { sel.value = o.value; break; }
            }
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // ---------------------------------------------------------
        // Step 4: Search
        // ---------------------------------------------------------
        console.log('4️⃣ Step 4: Search...');
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else document.querySelector("span[onclick='sertch_data();']").click();
        });

        // ---------------------------------------------------------
        // Step 5: Wait 120s (Hard Wait)
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Waiting 120s (Data Loading)...');
        
        // รอให้ปุ่ม Export โผล่ก่อน
        await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        
        // บังคับรอ 120 วินาที (2 นาที) ตาม UI.Vision
        await new Promise(r => setTimeout(r, 120000));
        console.log('✅ Data Loaded.');

        // ---------------------------------------------------------
        // Step 6: Export & Download
        // ---------------------------------------------------------
        console.log('6️⃣ Step 6: Exporting...');
        
        // ย้ำสิทธิ์อีกรอบ
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // กดปุ่ม Export 1 ครั้ง
        await page.evaluate(() => document.getElementById('btnexport').click());
        
        console.log('   Waiting for file (Max 5 mins)...');
        let finalFile = null;

        // วนลูปเช็คไฟล์ทุก 1 วินาที (นานสุด 5 นาที)
        for (let i = 0; i < 300; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            
            // หาไฟล์ .xlsx ที่เสร็จสมบูรณ์ (ไม่มี .crdownload)
            const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
            
            if (target) {
                finalFile = target;
                break;
            }
            
            if (i > 0 && i % 30 === 0) console.log(`   ...still waiting (${i}s)`);
        }

        if (!finalFile) {
            // ถ้า 5 นาทีแล้วยังไม่มา ให้ลองกดซ้ำอีก 1 ที (Last Resort)
            console.warn('⚠️ Retry clicking Export...');
            await page.evaluate(() => document.getElementById('btnexport').click());
            
            // รออีก 60 วิ
            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
                if (target) { finalFile = target; break; }
            }
        }

        if (!finalFile) throw new Error('❌ Download Timeout: File never arrived.');

        console.log(`✅ File Downloaded: ${finalFile}`);
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
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString()}`,
            text: `ดาวน์โหลดสำเร็จ\nไฟล์: ${finalFile}`,
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
