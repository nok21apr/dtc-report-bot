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
    console.log('🚀 Starting Bot (Patient Mode)...');

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
        
        // Timeout รวม 15 นาที (เผื่อรอนานมาก)
        page.setDefaultNavigationTimeout(900000);
        page.setDefaultTimeout(900000);

        await page.emulateTimezone('Asia/Bangkok');

        // ฟังก์ชันตั้งค่า Download
        const setupDownload = async () => {
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: downloadPath,
            });
        };
        await setupDownload();

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
        // Step 2: Navigate & Fill Form
        // ---------------------------------------------------------
        console.log('📄 Step 2: Navigate & Fill Form...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
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
            
            document.getElementById('ddlMinute').value = '1';
            
            const sel = document.getElementById('ddl_truck');
            for(let o of sel.options) {
                if(o.text.includes('ทั้งหมด')) { sel.value = o.value; break; }
            }
            // Trigger Change
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
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
        // Step 5: Wait 120s (รอข้อมูลตารางโหลด)
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Waiting 120s for Table Data...');
        await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        // บังคับรอ 120 วินาที
        await new Promise(r => setTimeout(r, 120000));
        console.log('✅ Table Data Ready.');

        // ---------------------------------------------------------
        // Step 6: Export & Download (รอไฟล์สร้าง 120s)
        // ---------------------------------------------------------
        console.log('⬇️ Step 6: Clicking Export...');
        
        // ย้ำสิทธิ์ดาวน์โหลดอีกที
        await setupDownload();

        // กดปุ่ม Export
        await page.evaluate(() => document.getElementById('btnexport').click());

        console.log('⏳ Step 6: Waiting 120s for File Generation (Server Processing)...');
        // 🔴 บังคับรออีก 120 วินาที ให้ Server สร้างไฟล์ Excel ก่อน
        await new Promise(r => setTimeout(r, 120000));
        
        console.log('👀 Checking for file...');
        
        let fileDownloaded = false;
        // ให้เวลาเพิ่มอีก 3 นาที สำหรับการดาวน์โหลดจริง (เผื่อเน็ตช้า)
        for (let i = 0; i < 180; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            // หาไฟล์ .xlsx ที่ไม่ใช่ .crdownload
            if (files.some(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'))) {
                fileDownloaded = true;
                break;
            }
            if (i % 30 === 0) console.log(`   ...downloading ${i}s`);
        }

        if (!fileDownloaded) {
            // ถ้ายังไม่มา ลองกดซ้ำอีกที (เผื่อรอบแรกกดวืด)
            console.warn('⚠️ File not found. Retrying click...');
            await page.evaluate(() => document.getElementById('btnexport').click());
            
            // รออีก 2 นาที
            for (let i = 0; i < 120; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                if (files.some(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'))) {
                    fileDownloaded = true;
                    break;
                }
            }
        }

        if (!fileDownloaded) {
            await page.screenshot({ path: path.join(downloadPath, 'error_step6_timeout.png') });
            throw new Error('❌ Step 6 Failed: File did not download after wait.');
        }

        const finalFile = fs.readdirSync(downloadPath).find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
        console.log(`✅ File Downloaded: ${finalFile}`);
        
        // รอให้ไฟล์เขียนเสร็จสมบูรณ์
        await new Promise(r => setTimeout(r, 5000));
        
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
