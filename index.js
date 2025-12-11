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
    console.log('🚀 Starting Bot (Long Wait Mode)...');

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
        
        // Timeout รวมทั้งระบบ 10 นาที (เผื่อรอนานมาก)
        page.setDefaultNavigationTimeout(600000);
        page.setDefaultTimeout(600000);

        await page.emulateTimezone('Asia/Bangkok');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // ---------------------------------------------------------
        // Step 1: Login
        // ---------------------------------------------------------
        console.log('🌐 Step 1: Login...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        try {
            await page.waitForSelector('#txtname', { visible: true, timeout: 30000 });
            await page.type('#txtname', DTC_USER);
            await page.type('#txtpass', DTC_PASS);
            await page.evaluate(() => document.getElementById('btnLogin').click());
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 30000 });
            console.log('✅ Login Success');
        } catch (e) {
            console.log('⚠️ Login skipped or session active');
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
            document.getElementById('speed_max').value = '55';
            
            var d = new Date(); d.setDate(1); d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); var m = d.getMonth() + 1; var day = d.getDate(); 
            var start = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            var d2 = new Date(); var y2 = d2.getFullYear(); var m2 = d2.getMonth() + 1; 
            var last = new Date(y2, m2, 0).getDate(); 
            var end = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (last < 10 ? '0' : '') + last + ' 23:59';

            document.getElementById('date9').value = start;
            document.getElementById('date10').value = end;
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));

            document.getElementById('ddlMinute').value = '1';
            
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
        // Step 4: Search
        // ---------------------------------------------------------
        console.log('🔍 Step 4: Search...');
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else document.querySelector("span[onclick='sertch_data();']").click();
        });

        // ---------------------------------------------------------
        // Step 5: Wait for Export (แก้ไขจุดนี้)
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Waiting for Report Loading (Max 5 mins)...');
        
        // ตรงนี้คือจุดสำคัญ: ตั้งเวลารอสูงสุดไว้ 300,000 ms (5 นาที)
        // บอทจะรอจนกว่าปุ่ม #btnexport จะโผล่มา ถ้ามาเมื่อไหร่ก็ไปต่อทันที
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
            console.log('✅ Report Loaded! Export button appeared.');
        } catch (e) {
            // ถ้าเกิน 5 นาทีแล้วยังไม่มา ให้ถ่ายรูปส่งมาดู
            await page.screenshot({ path: path.join(downloadPath, 'error_report_timeout.png') });
            throw new Error('❌ Timeout: Report took longer than 5 minutes to load.');
        }

        // รอแถมอีก 10 วินาที เพื่อความชัวร์ (Loading Overlay อาจจะยังไม่หายดี)
        console.log('   Safety wait 10s...');
        await new Promise(r => setTimeout(r, 10000));

        // ---------------------------------------------------------
        // Step 6: Export & Download
        // ---------------------------------------------------------
        console.log('⬇️ Step 6: Exporting...');
        
        let fileDownloaded = false;
        let attempts = 0;
        
        while (!fileDownloaded && attempts < 5) {
            attempts++;
            console.log(`   Attempt ${attempts}: Clicking Export...`);
            
            // กดปุ่ม
            await page.evaluate(() => document.getElementById('btnexport').click());
            
            // รอเช็คไฟล์ 20 วินาที
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                if (files.some(f => f.endsWith('.xlsx') || f.endsWith('.xls'))) {
                    fileDownloaded = true;
                    break;
                }
            }
            if (fileDownloaded) break;
        }

        // รอรอบสุดท้าย 60 วินาที
        if (!fileDownloaded) {
            console.log('⏳ Final Wait for download...');
            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                if (files.some(f => f.endsWith('.xlsx') || f.endsWith('.xls'))) {
                    fileDownloaded = true;
                    break;
                }
            }
        }

        if (!fileDownloaded) throw new Error('Download Failed');

        const finalFile = fs.readdirSync(downloadPath).find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
        console.log(`✅ File: ${finalFile}`);
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
            text: `รายงานประจำวันที่ท่านต้องการครับ`,
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
