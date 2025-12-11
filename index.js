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
    console.log('🚀 Starting Bot (High Precision Mode)...');

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
                '--disable-accelerated-2d-canvas', // ปิดกราฟิก
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 5 นาที
        page.setDefaultNavigationTimeout(300000);
        page.setDefaultTimeout(300000);

        // ตั้งค่า Timezone เป็นไทย
        await page.emulateTimezone('Asia/Bangkok');

        // ตั้งค่า Download
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // ---------------------------------------------------------
        // Step 1: Login Process (ปรับปรุงใหม่)
        // ---------------------------------------------------------
        console.log('🔐 Step 1: Login Process');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });

        // รอช่องกรอกรหัสมา
        await page.waitForSelector('#txtname', { visible: true, timeout: 60000 });
        
        // ฟังก์ชันช่วย Login
        const performLogin = async () => {
            console.log('   Typing credentials...');
            // Clear ค่าเก่าก่อน (กันพลาด)
            await page.evaluate(() => {
                document.querySelector('#txtname').value = '';
                document.querySelector('#txtpass').value = '';
            });
            await page.type('#txtname', DTC_USER, { delay: 50 });
            await page.type('#txtpass', DTC_PASS, { delay: 50 });
            
            console.log('   Clicking Login...');
            await page.click('#btnLogin');
        };

        await performLogin();

        // ตรวจสอบว่า Login ผ่านไหม (รอหน้า Dashboard หรือ Element ที่มีเฉพาะตอน Login แล้ว)
        try {
            console.log('   Verifying login success...');
            // รอให้ช่อง Login หายไป เป็นสัญญาณว่าเข้าได้แล้ว
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 20000 });
            console.log('✅ Login Verified!');
        } catch (e) {
            console.warn('⚠️ Login might have failed, retrying once...');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#txtname', { visible: true });
            await performLogin();
            // รออีกรอบ
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 20000 });
        }

        // รอสักพักให้ Session นิ่ง
        await new Promise(r => setTimeout(r, 5000));

        // ---------------------------------------------------------
        // Step 2: Go to Report Page
        // ---------------------------------------------------------
        console.log('📄 Step 2: Navigate to Report Page');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // เช็คว่าเด้งกลับมาหน้า Login ไหม
        if (await page.$('#txtname')) {
            throw new Error('❌ Session Lost: Redirected back to login page.');
        }

        // ---------------------------------------------------------
        // Step 3: Fill Form (Direct Injection)
        // ---------------------------------------------------------
        console.log('📝 Step 3: Fill Report Form');
        
        // 3.1 Speed Max
        await page.waitForSelector('#speed_max', { visible: true });
        await page.evaluate(() => {
            const el = document.getElementById('speed_max');
            el.value = '55';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur')); // สำคัญ: เพื่อให้เว็บ Save ค่า
        });

        // 3.2 Calculate Dates (Timezone Thai)
        console.log('   Calculating dates...');
        const dateResult = await page.evaluate(() => {
            // สูตรจาก UI.Vision
            var d = new Date(); 
            d.setDate(1); 
            d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); 
            var m = d.getMonth() + 1; 
            var day = d.getDate(); 
            var startDate = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            var d2 = new Date(); 
            var y2 = d2.getFullYear(); 
            var m2 = d2.getMonth() + 1; 
            var lastDay = new Date(y2, m2, 0).getDate(); 
            var endDate = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (lastDay < 10 ? '0' : '') + lastDay + ' 23:59';

            return { start: startDate, end: endDate };
        });
        console.log(`   Date Range: ${dateResult.start} to ${dateResult.end}`);

        // 3.3 Set Dates
        await page.evaluate((dates) => {
            const d9 = document.getElementById('date9');
            const d10 = document.getElementById('date10');
            
            d9.value = dates.start;
            d10.value = dates.end;
            
            // Trigger ทุก event ที่เป็นไปได้เพื่อให้เว็บรู้ตัว
            [d9, d10].forEach(el => {
                el.dispatchEvent(new Event('focus'));
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur'));
            });
        }, dateResult);

        // 3.4 Select Options
        await page.select('#ddlMinute', '1');
        await page.evaluate(() => {
            const sel = document.getElementById('ddl_truck');
            for (let opt of sel.options) {
                if (opt.text.includes('ทั้งหมด')) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        });

        // ---------------------------------------------------------
        // Step 4: Search & Export
        // ---------------------------------------------------------
        console.log('🔍 Step 4: Search Data');
        
        // กดปุ่มค้นหาผ่าน JS โดยตรง (เลี่ยงปัญหา Element ถูกบัง)
        await page.evaluate(() => {
            if (typeof sertch_data === 'function') {
                sertch_data();
            } else {
                document.querySelector("span[onclick='sertch_data();']").click();
            }
        });

        console.log('⏳ Waiting for Export button...');
        // รอสูงสุด 3 นาที
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 180000 });
            console.log('✅ Export button appeared!');
        } catch (e) {
            await page.screenshot({ path: path.join(downloadPath, 'error_no_export.png') });
            throw new Error('❌ Export button not found (Timeout). Data might be empty.');
        }

        // รอแถม 5 วินาที เผื่อ Loading overlay ยังอยู่
        await new Promise(r => setTimeout(r, 5000));

        console.log('⬇️ Step 5: Clicking Export');
        
        // ดักจับ response เพื่อดูว่ากดแล้วเว็บตอบสนองไหม (Optional Debug)
        const clickExport = async () => {
            // ลองกดแบบ Element Click
            try {
                await page.click('#btnexport');
            } catch (e) {
                // ถ้ากดไม่ได้ ให้กดแบบ JS
                await page.evaluate(() => document.getElementById('btnexport').click());
            }
        };

        await clickExport();

        // ---------------------------------------------------------
        // Step 6: Verify Download
        // ---------------------------------------------------------
        console.log('⏳ Step 6: Waiting for file...');
        
        let foundFile = null;
        // รอ 30 วินาทีแรก
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            foundFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
            if (foundFile) break;
        }

        // ถ้ายังไม่มา ลองกดซ้ำ (Re-click strategy)
        if (!foundFile) {
            console.warn('⚠️ File not started, clicking Export AGAIN...');
            await clickExport();
            
            // รอยาวๆ 4 นาที
            for (let i = 0; i < 240; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                foundFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
                if (foundFile) break;
            }
        }

        if (!foundFile) {
            await page.screenshot({ path: path.join(downloadPath, 'error_download_timeout.png') });
            throw new Error('❌ File download timed out.');
        }

        console.log(`✅ File Downloaded: ${foundFile}`);
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
            text: `ระบบทำงานสำเร็จ\nไฟล์: ${foundFile}`,
            attachments: [{ filename: foundFile, path: path.join(downloadPath, foundFile) }]
        });

        console.log('🎉 Mission Complete!');

    } catch (error) {
        console.error('❌ FATAL ERROR:', error);
        if (page && !page.isClosed()) {
            try {
                await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') });
            } catch (e) {}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
