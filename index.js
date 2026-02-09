const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// รับค่าจาก GitHub Secrets หรือ Environment Variables
const DTC_USER = process.env.DTC_USER;
const DTC_PASS = process.env.DTC_PASS;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;

(async () => {
    console.log('🚀 Starting Bot (Server Mode + Fix Step 2 Timeout)...');

    // ตรวจสอบค่าตัวแปร (สำคัญมากเมื่อรันบน Server)
    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete. Please check your environment variables.');
        // process.exit(1); 
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (fs.existsSync(downloadPath)) fs.rmSync(downloadPath, { recursive: true, force: true });
    fs.mkdirSync(downloadPath);

    let browser = null;
    let page = null;

    try {
        console.log('🖥️ Launching Browser...');
        browser = await puppeteer.launch({
            // ✅ แก้ไข 1: ใช้ 'new' สำหรับรันบน Server
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

        // ตั้งค่าขนาดหน้าจอจำลอง
        await page.setViewport({ width: 1920, height: 1080 });

        await page.emulateTimezone('Asia/Bangkok');
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // ---------------------------------------------------------
        // Step 1: Login
        // ---------------------------------------------------------
        console.log('1️⃣ Step 1: Login...');
        await page.goto('https://gps.dtc.co.th/v2/login', { waitUntil: 'networkidle2' });
        
        // รอ Username และกรอก
        await page.waitForSelector('#Username', { visible: true });
        await page.type('#Username', DTC_USER || 'TEST_USER');
        
        // รอสักนิดก่อนกรอก Password
        await new Promise(r => setTimeout(r, 1000));

        // ✅ แก้ไข 2: ใช้ Selector แบบกว้าง (input type password) แทน ID #password1 ที่อาจจะหาไม่เจอ
        try {
            console.log('   Typing Password...');
            const passwordSelector = 'input[type="password"]';
            await page.waitForSelector(passwordSelector, { visible: true, timeout: 30000 });
            await page.type(passwordSelector, DTC_PASS || 'TEST_PASS');
        } catch (e) {
            console.error('⚠️ Password field fallback...');
            // ถ้าหา input type password ไม่เจอ ลองหาจาก ID เดิม
            await page.type('#password1 > input', DTC_PASS || 'TEST_PASS');
        }
        
        console.log('   Clicking Login...');
        // ✅ แก้ไข 3: กดปุ่ม Login โดยอ้างอิงจาก HTML ที่คุณแนบมา (span.p-button-label text=เข้าสู่ระบบ)
        const loginSuccess = await page.evaluate(() => {
            // หา span ที่มีคำว่า 'เข้าสู่ระบบ' และ class 'p-button-label'
            const spans = Array.from(document.querySelectorAll('span.p-button-label'));
            const loginSpan = spans.find(el => el.textContent.includes('เข้าสู่ระบบ'));
            
            if (loginSpan) {
                loginSpan.click();
                return true;
            } else {
                // Fallback: หาปุ่ม submit ทั่วไป
                const btn = document.querySelector('button[type="submit"]');
                if (btn) { btn.click(); return true; }
            }
            return false;
        });

        if (!loginSuccess) console.log('⚠️ Login button click via JS might have failed, trying Puppeteer click...');

        // รอจนกว่าหน้า Login จะเปลี่ยน (Username หายไป)
        await page.waitForFunction(() => !document.querySelector('#Username'), { timeout: 90000 });
        console.log('✅ Login Success');

        // ---------------------------------------------------------
        // Step 2: Navigate to Report (Modified)
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Go to Report Page...');
        
        // ตัวแปร Selector สำหรับเช็คว่าเข้าหน้า Report สำเร็จ (ช่องกรอกความเร็ว)
        const reportPageIndicator = 'div:nth-of-type(8) input'; 

        // พยายามเข้าด้วย URL ก่อน (วิธีที่ 1)
        try {
            // ✅ แก้ไข: ใช้ 'domcontentloaded' แทน 'networkidle2' เพราะเว็บ GPS มี Data วิ่งตลอดทำให้ Timeout
            await page.goto('https://gps.dtc.co.th/v2/report-main/car-usage/status', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (err) {
            console.log('⚠️ Navigation command timed out (Normal for GPS sites), checking content...');
        }

        // เช็คว่าหน้าเว็บโหลดฟอร์มขึ้นมาหรือยัง
        let arrived = false;
        try {
            await page.waitForSelector(reportPageIndicator, { visible: true, timeout: 10000 });
            arrived = true;
            console.log('✅ Report Page Loaded via URL');
        } catch (e) {
            console.log('⚠️ URL Navigation did not show form immediately.');
        }

        // ถ้ายังไม่เจอหน้า Report ให้ลองกดปุ่มเมนู "รายงานสถานะ" (วิธีที่ 2 - Fallback)
        if (!arrived) {
            console.log('🔄 Attempting to Click Sidebar Menu "รายงานสถานะ"...');
            const menuClicked = await page.evaluate(() => {
                // ค้นหาเมนูที่มีคำว่า "รายงานสถานะ"
                const elements = Array.from(document.querySelectorAll('span, a, div, li'));
                const target = elements.find(el => el.innerText && el.innerText.trim() === 'รายงานสถานะ');
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            });

            if (menuClicked) {
                console.log('   Clicked Sidebar Menu. Waiting for form...');
                await page.waitForSelector(reportPageIndicator, { visible: true, timeout: 60000 });
                console.log('✅ Report Page Loaded via Click');
            } else {
                // ถ้าหาปุ่มไม่เจอ ลอง Screenshot ดู
                 try { 
                    await page.screenshot({ path: path.join(downloadPath, 'step2_failed.png'), fullPage: true });
                } catch(e){}
                throw new Error('❌ Failed to navigate to Report Page (URL and Click failed)');
            }
        }
        
        // ---------------------------------------------------------
        // Step 3: Fill Form
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Fill Form...');

        const speedInputSelector = 'div:nth-of-type(8) input'; 
        // รอเพิ่มขึ้นเผื่อ Server ช้า
        await page.waitForSelector(speedInputSelector, { visible: true, timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // 3.1 Report Type
        console.log('   Selecting Report Type...');
        try {
            await page.click('div.scroll-main div:nth-of-type(4) svg');
            await new Promise(r => setTimeout(r, 2000));
            
            const reportOption = await page.$x("//span[contains(text(), 'ความเร็วเกิน(กำหนดค่าเอง)')]");
            if (reportOption.length > 0) {
                await reportOption[0].click();
            } else {
                await page.click('#pv_id_27_2 > span:nth-of-type(1)').catch(() => {});
            }
        } catch (e) { console.log('⚠️ Report type selection issue.'); }

        // 3.2 Vehicle Group
        console.log('   Selecting Vehicle Group...');
        try {
            await new Promise(r => setTimeout(r, 2000));
            const groupDropdown = 'div:nth-of-type(5) > div.flex-column span';
            if (await page.$(groupDropdown)) {
                await page.click(groupDropdown);
                await new Promise(r => setTimeout(r, 2000));
                const groupOption = await page.$x("//li//span[contains(text(), 'กลุ่มทั้งหมด')]");
                if (groupOption.length > 0) await groupOption[0].click();
            }
        } catch (e) { console.log('⚠️ Skipping Group Selection.'); }

        // 3.3 Select All Vehicles
        console.log('   Selecting All Vehicles...');
        const vehicleSelectSelector = 'div.p-multiselect-label-container';
        await page.waitForSelector(vehicleSelectSelector);
        await page.click(vehicleSelectSelector);
        await new Promise(r => setTimeout(r, 2000));

        const selectAllCheckbox = 'div.p-multiselect-header > div.p-checkbox > input';
        await page.evaluate((sel) => {
            const cb = document.querySelector(sel);
            if (cb) cb.click();
        }, selectAllCheckbox);
        
        await page.keyboard.press('Escape');

        // 3.4 Date Range
        console.log('   Setting Date Range...');
        const d = new Date(); d.setDate(1); d.setDate(d.getDate() - 2); 
        const y = d.getFullYear(); const m = d.getMonth() + 1; const day = d.getDate(); 
        
        const d2 = new Date(); const y2 = d2.getFullYear(); const m2 = d2.getMonth() + 1; 
        const last = new Date(y2, m2, 0).getDate(); 
        
        const pad = (n) => n < 10 ? '0' + n : n;
        const startDateStr = `${pad(day)}/${pad(m)}/${y} 00:00:00`;
        const endDateStr = `${pad(last)}/${pad(m2)}/${y2} 23:59:59`;
        const fullDateString = `${startDateStr} - ${endDateStr}`;
        
        console.log(`      Date: ${fullDateString}`);

        const dateInputSelector = 'div:nth-of-type(7) input';
        await page.click(dateInputSelector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(dateInputSelector, fullDateString, { delay: 10 });
        await page.keyboard.press('Tab');

        // 3.5 Speed
        console.log('   Setting Speed 55...');
        await page.click(speedInputSelector, { clickCount: 3 });
        await page.type(speedInputSelector, '55');

        // 3.6 Duration
        console.log('   Setting Duration 1 min...');
        const durationInputSelector = 'div:nth-of-type(9) div.align-items-center > input';
        if (await page.$(durationInputSelector)) {
            await page.click(durationInputSelector, { clickCount: 3 });
            await page.type(durationInputSelector, '1');
        }

        // ---------------------------------------------------------
        // Step 4: Search
        // ---------------------------------------------------------
        console.log('4️⃣ Step 4: Search...');
        const searchBtnXPath = "//*[@id='app']/div/main/div[2]/div/div[2]/div[2]/div/div/div[4]/button[2]";
        const searchBtn = await page.$x(searchBtnXPath);
        
        if (searchBtn.length > 0) {
            await searchBtn[0].click();
        } else {
            await page.evaluate(() => {
                 const buttons = document.querySelectorAll('button');
                 if(buttons.length > 0) buttons[buttons.length - 1].click();
            });
        }

        // ---------------------------------------------------------
        // Step 5: Wait for Data
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Waiting for Data...');
        try {
            await page.waitForFunction(() => {
                return document.querySelectorAll('button').length > 0;
            }, { timeout: 300000 });
            await new Promise(r => setTimeout(r, 10000));
        } catch (e) {
            console.log('⚠️ Wait timeout, trying to proceed anyway...');
        }

        // ---------------------------------------------------------
        // Step 6: Export & Download (Strict CSV per Recording)
        // ---------------------------------------------------------
        console.log('6️⃣ Step 6: Exporting (CSV)...');
        
        // 1. คลิกปุ่ม Export Menu
        console.log('   Clicking Export Menu...');
        try {
            // รอให้ปุ่มปรากฏ
            await page.waitForSelector('.p-toolbar-group-right', { timeout: 30000 }).catch(() => {});

            const menuClicked = await page.evaluate(() => {
                const toolbar = document.querySelector('.p-toolbar-group-right, .flex.justify-content-end');
                if (toolbar) {
                    const btn = toolbar.querySelector('button, div[role="button"]');
                    if (btn) { btn.click(); return true; }
                }
                return false;
            });
            
            if (!menuClicked) {
                const exBtn = await page.$x("//*[@id='pv_id_38' or contains(@id, 'pv_id_')]/div/svg");
                if (exBtn.length > 0) await exBtn[0].click();
            }
        } catch (e) { console.log('⚠️ Export Menu Click Failed'); }

        await new Promise(r => setTimeout(r, 5000)); // รอเมนูเด้ง

        // 2. เลือก CSV
        console.log('   Selecting CSV Option...');
        const csvSelected = await page.evaluate(() => {
            const items = document.querySelectorAll('li, span.p-menuitem-text');
            for (let item of items) {
                if (item.innerText.trim() === 'CSV') {
                    item.click();
                    return true;
                }
            }
            return false;
        });

        if (!csvSelected) {
            console.log('   Using XPath fallback for CSV...');
            const csvBtn = await page.$x("//span[contains(text(), 'CSV')]");
            if (csvBtn.length > 0) await csvBtn[0].click();
        }

        // รอไฟล์ CSV Download
        console.log('   Waiting for CSV file...');
        let finalFile = null;

        for (let i = 0; i < 300; i++) { // รอสูงสุด 5 นาที
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            const target = files.find(f => f.endsWith('.csv') && !f.endsWith('.crdownload'));
            if (target) {
                finalFile = target;
                break;
            }
            if (i > 0 && i % 30 === 0) console.log(`   ...still waiting (${i}s)`);
        }

        if (!finalFile) throw new Error('❌ Download Timeout: CSV File never arrived.');

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
            subject: `รายงาน DTC Report (CSV) - ${new Date().toLocaleDateString()}`,
            text: `ถึง ผู้เกี่ยวข้อง\nเรื่อง : ความเร็วเกินประจำวัน\n\nสิ่งที่แนบมา\nไฟล์รายงาน CSV: ${finalFile}\n\nด้วยความนับถือ\nBOT REPORT`,
            attachments: [{ filename: finalFile, path: path.join(downloadPath, finalFile) }]
        });

        console.log('🎉 Mission Complete');

    } catch (error) {
        console.error('❌ FATAL ERROR:', error);
        // เก็บ Screenshot เมื่อ Error (สำคัญสำหรับ Debug บน Server)
        if (page && !page.isClosed()) {
            try { 
                await page.screenshot({ path: path.join(downloadPath, 'error_screenshot.png'), fullPage: true });
                console.log('📸 Error screenshot saved to downloads/error_screenshot.png');
            } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
