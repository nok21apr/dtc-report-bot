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
    console.log('🚀 Starting Bot (Download Force Mode)...');

    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    // ล้างไฟล์เก่าทิ้งก่อนเริ่ม เพื่อความชัวร์
    if (fs.existsSync(downloadPath)) {
        fs.rmSync(downloadPath, { recursive: true, force: true });
    }
    fs.mkdirSync(downloadPath);

    // ทดสอบเขียนไฟล์เพื่อเช็ค Permission
    fs.writeFileSync(path.join(downloadPath, 'test_write.txt'), 'test');

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
                '--lang=th-TH,th',
                '--disable-features=IsolateOrigins,site-per-process' // ช่วยเรื่อง Download ในบางเว็บ
            ]
        });

        page = await browser.newPage();
        
        // Timeout 15 นาที
        page.setDefaultNavigationTimeout(900000);
        page.setDefaultTimeout(900000);

        await page.emulateTimezone('Asia/Bangkok');

        // ฟังก์ชันตั้งค่า Download (เรียกใช้ก่อนกดเสมอ)
        const setupDownload = async () => {
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: downloadPath,
            });
        };
        await setupDownload();

        // ---------------------------------------------------------
        // Step 1-4: Login & Fill Form (เหมือนเดิมเพราะผ่านแล้ว)
        // ---------------------------------------------------------
        console.log('🌐 Steps 1-4: Login & Search...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        try {
            await page.waitForSelector('#txtname', { visible: true, timeout: 15000 });
            await page.type('#txtname', DTC_USER);
            await page.type('#txtpass', DTC_PASS);
            await page.click('#btnLogin');
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 30000 });
        } catch (e) { console.log('   (Session might be active, skipping login)'); }

        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // กรอกข้อมูล
        await page.waitForSelector('#speed_max', { visible: true, timeout: 60000 });
        await page.evaluate(() => {
            document.getElementById('speed_max').value = '55';
            
            // สูตรวันที่
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
        // Step 5: Wait 120s (รอข้อมูล)
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Waiting 120s for Data Processing...');
        await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        await new Promise(r => setTimeout(r, 120000));
        console.log('✅ 120s Wait Complete.');

        // ---------------------------------------------------------
        // Step 6: Export & Monitor (ส่วนที่แก้ไข)
        // ---------------------------------------------------------
        console.log('⬇️ Step 6: Exporting...');
        
        await setupDownload(); // ย้ำสิทธิ์อีกรอบ

        let fileFound = null;
        let clickAttempts = 0;
        
        // ลองกดและรอวนไป สูงสุด 3 รอบ
        while (!fileFound && clickAttempts < 3) {
            clickAttempts++;
            console.log(`   👉 Attempt ${clickAttempts}: Clicking Export button...`);
            
            // ใช้ 2 วิธีพร้อมกัน: กดปุ่มจริง และ สั่ง JS
            try {
                await page.click('#btnexport');
            } catch (e) {
                await page.evaluate(() => document.getElementById('btnexport').click());
            }

            // รอไฟล์เข้า 60 วินาทีต่อรอบการกด
            console.log('      Watching download folder (60s)...');
            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 1000));
                
                const files = fs.readdirSync(downloadPath);
                // หาไฟล์อะไรก็ได้ที่ไม่ใช่ .txt (ไฟล์เทส) และไม่ใช่ .crdownload (กำลังโหลด)
                const downloadedFile = files.find(f => f !== 'test_write.txt' && !f.endsWith('.crdownload'));
                
                if (downloadedFile) {
                    fileFound = downloadedFile;
                    break;
                }
            }
            
            if (fileFound) break;
            console.log('      ⚠️ No file yet. Retrying...');
        }

        // ถ้ารอบสุดท้ายแล้วยังไม่มา ให้รอแบบยาวๆ อีก 3 นาที (Last Chance)
        if (!fileFound) {
            console.log('⏳ Final Wait (180s) - Last Chance...');
            for (let i = 0; i < 180; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                const downloadedFile = files.find(f => f !== 'test_write.txt' && !f.endsWith('.crdownload'));
                if (downloadedFile) {
                    fileFound = downloadedFile;
                    break;
                }
            }
        }

        if (!fileFound) {
            // ถ่ายรูปหน้าจอดูซิว่ามี Error อะไรขึ้นไหม
            await page.screenshot({ path: path.join(downloadPath, 'error_step6_failed.png') });
            
            // เช็คไฟล์ใน Folder อีกทีว่ามีอะไรบ้าง
            const existingFiles = fs.readdirSync(downloadPath);
            console.log('📂 Files in folder:', existingFiles);
            
            throw new Error('❌ Step 6 Failed: Download Timeout. No file appeared.');
        }

        console.log(`✅ File Downloaded Successfully: ${fileFound}`);
        
        // รอให้ไฟล์เขียนเสร็จสมบูรณ์ (ขนาดไฟล์นิ่ง)
        await new Promise(r => setTimeout(r, 5000));
        await browser.close();

        // ---------------------------------------------------------
        // Step 7: Email
        // ---------------------------------------------------------
        console.log('📧 Sending Email...');
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
