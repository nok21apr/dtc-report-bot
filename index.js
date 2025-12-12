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
    console.log('🚀 Starting Bot (Final Robust Version)...');

    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    // ล้างไฟล์เก่าและสร้างโฟลเดอร์ใหม่
    if (fs.existsSync(downloadPath)) {
        fs.rmSync(downloadPath, { recursive: true, force: true });
    }
    fs.mkdirSync(downloadPath);

    // ทดสอบเขียนไฟล์เพื่อยืนยันว่า Save ได้แน่นอน
    try {
        fs.writeFileSync(path.join(downloadPath, 'permission_check.txt'), 'Write OK');
        console.log('✅ Storage Permission Check: Passed');
    } catch (e) {
        throw new Error('❌ Storage Permission Failed: Cannot write to server disk.');
    }

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
        
        // Timeout รวม 20 นาที (ให้เวลานานที่สุด)
        page.setDefaultNavigationTimeout(1200000);
        page.setDefaultTimeout(1200000);

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
            await page.click('#btnLogin');
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 30000 });
            console.log('✅ Login Success');
        } catch (e) {
            console.log('⚠️ Login skipped (Session active or Element missing)');
        }

        // ---------------------------------------------------------
        // Step 2-4: Navigate & Search
        // ---------------------------------------------------------
        console.log('📄 Step 2-4: Navigate & Search...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('#speed_max', { visible: true, timeout: 60000 });
        
        await page.evaluate(() => {
            document.getElementById('speed_max').value = '55';
            
            // สูตรวันที่ (ตาม UI.Vision)
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

        // กดค้นหา
        console.log('🔍 Searching...');
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else document.querySelector("span[onclick='sertch_data();']").click();
        });

        // ---------------------------------------------------------
        // Step 5: Wait 120s (Data Loading)
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Waiting 120s for Table Data...');
        await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        
        // บังคับรอ 120 วินาที เพื่อให้ข้อมูลครบ (เหมือน UI.Vision)
        await new Promise(r => setTimeout(r, 120000));
        console.log('✅ Table Data Ready.');

        // ---------------------------------------------------------
        // Step 6: Export (แก้ไขใหม่: รอไฟล์สร้างอย่างใจเย็น)
        // ---------------------------------------------------------
        console.log('⬇️ Step 6: Exporting...');
        
        let fileFound = null;
        
        // กดปุ่มครั้งแรก
        console.log('   👉 Clicking Export Button...');
        await page.evaluate(() => document.getElementById('btnexport').click());

        // รอไฟล์รอบแรก 180 วินาที (3 นาที) โดยไม่กดซ้ำ
        console.log('   ⏳ Waiting 180s for file generation...');
        for (let i = 0; i < 180; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            // เช็คว่ามีไฟล์ .xlsx ที่ไม่ใช่ไฟล์ขยะ
            const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
            
            if (target) {
                fileFound = target;
                break; // เจอแล้ว ออกจากลูปทันที
            }
            
            // เช็คว่ามีไฟล์ .crdownload (กำลังโหลด) ไหม
            if (files.some(f => f.endsWith('.crdownload'))) {
                // ถ้ามีไฟล์กำลังโหลด ให้รอต่อเงียบๆ ไม่ต้องนับเวลาถอยหลังกดใหม่
                console.log('      Downloading in progress...');
            }
        }

        // ถ้าผ่านไป 3 นาทีแล้วไฟล์ยังไม่มา (และไม่มีไฟล์กำลังโหลด) ให้ลองกดใหม่
        if (!fileFound) {
            console.warn('⚠️ File not started. Retry clicking...');
            await page.evaluate(() => document.getElementById('btnexport').click());
            
            // รอรอบสองอีก 180 วินาที
            for (let i = 0; i < 180; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
                if (target) {
                    fileFound = target;
                    break;
                }
            }
        }

        if (!fileFound) {
            // เช็คไฟล์ใน Folder ครั้งสุดท้ายเพื่อ Debug
            console.log('📂 Files in folder:', fs.readdirSync(downloadPath));
            await page.screenshot({ path: path.join(downloadPath, 'error_step6_timeout.png') });
            throw new Error('❌ Step 6 Failed: File did not arrive.');
        }

        console.log(`✅ File Downloaded: ${fileFound}`);
        
        // รออีก 5 วินาทีเพื่อให้ไฟล์เขียนเสร็จสมบูรณ์ 100%
        await new Promise(r => setTimeout(r, 5000));
        await browser.close();

        // ---------------------------------------------------------
        // Step 7: Send Email
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
            text: `ดาวน์โหลดสำเร็จครับ\nไฟล์: ${fileFound}`,
            attachments: [{ filename: fileFound, path: path.join(downloadPath, fileFound) }]
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
