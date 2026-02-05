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
    console.log('🚀 Starting Bot (Clean & Simple Mode + Fix Select Truck)...');

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
        
        // Timeout 5 นาที
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
        
        await page.waitForSelector('#txtname', { visible: true, timeout: 60000 });
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        console.log('   Clicking Login...');
        await Promise.all([
            page.evaluate(() => document.getElementById('btnLogin').click()),
            page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 60000 })
        ]);
        console.log('✅ Login Success');

        // ---------------------------------------------------------
        // Step 2: Navigate to Report
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Go to Report Page...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // ---------------------------------------------------------
        // Step 3: Fill Form (แก้ไขจุดเลือกทะเบียนรถ)
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Fill Form...');
        
        // รอให้ช่องกรอกข้อมูลสำคัญๆ โผล่มาก่อน
        await page.waitForSelector('#speed_max', { visible: true });
        await page.waitForSelector('#ddl_truck', { visible: true }); // เพิ่ม: รอให้ Dropdown รถโผล่มา
        
        // รอสักนิดเพื่อให้ตัวเลือกใน Dropdown โหลดมาครบ (บางทีเว็บโหลดข้อมูลรถทีหลัง)
        await new Promise(r => setTimeout(r, 10000));

        await page.evaluate(() => {
            // Speed (Command 8)
            document.getElementById('speed_max').value = '55';
            
            // Date Formula (UI.Vision Command 9-12)
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

            // Options (Command 13)
            document.getElementById('ddlMinute').value = '1';
            
            // --- Select Truck (UI.Vision Command 14) ---
            // ใช้โค้ด JavaScript ตามที่ระบุในไฟล์ UI.Vision เป๊ะๆ
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
        await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        await new Promise(r => setTimeout(r, 300000));
        console.log('✅ Data Loaded.');

        // ---------------------------------------------------------
        // Step 6: Export & Download
        // ---------------------------------------------------------
        console.log('6️⃣ Step 6: Exporting...');
        
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        await page.evaluate(() => document.getElementById('btnexport').click());
        
        console.log('   Waiting for file (Max 5 mins)...');
        let finalFile = null;

        for (let i = 0; i < 300; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
            if (target) {
                finalFile = target;
                break;
            }
            if (i > 0 && i % 30 === 0) console.log(`   ...still waiting (${i}s)`);
        }

        if (!finalFile) {
            console.warn('⚠️ Retry clicking Export...');
            await page.evaluate(() => document.getElementById('btnexport').click());
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
            text: `ถึง ผู้เกี่ยวข้อง\nไฟล์: ${finalFile}\nด้วยความนับถือ\nBOT REPORT`,
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






