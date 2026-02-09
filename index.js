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
    console.log('🚀 Starting Bot (Final Version: Select by ID pv_id_32_2)...');

    // ตรวจสอบค่าตัวแปร
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
            headless: 'new', // ใช้ 'new' สำหรับ Server (GitHub Actions)
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
        await page.setViewport({ width: 1920, height: 1080 });
        await page.emulateTimezone('Asia/Bangkok');
        
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // ---------------------------------------------------------
        // Step 1: Login
        // ---------------------------------------------------------
        console.log('1️⃣ Step 1: Login...');
        await page.goto('https://gps.dtc.co.th/v2/login', { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('#Username', { visible: true });
        await page.type('#Username', DTC_USER || 'TEST_USER');
        await new Promise(r => setTimeout(r, 1000));

        try {
            console.log('   Typing Password...');
            const passwordSelector = 'input[type="password"]';
            await page.waitForSelector(passwordSelector, { visible: true, timeout: 30000 });
            await page.type(passwordSelector, DTC_PASS || 'TEST_PASS');
        } catch (e) {
            console.error('⚠️ Password field fallback...');
            await page.type('#password1 > input', DTC_PASS || 'TEST_PASS');
        }
        
        console.log('   Clicking Login...');
        const loginSuccess = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span.p-button-label'));
            const loginSpan = spans.find(el => el.textContent.includes('เข้าสู่ระบบ'));
            if (loginSpan) { loginSpan.click(); return true; }
            const btn = document.querySelector('button[type="submit"]');
            if (btn) { btn.click(); return true; }
            return false;
        });

        await page.waitForFunction(() => !document.querySelector('#Username'), { timeout: 90000 });
        console.log('✅ Login Success');

        // ---------------------------------------------------------
        // Step 2: Navigate to Report
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Go to Report Page...');
        
        try {
            // ใช้ domcontentloaded เพื่อหลีกเลี่ยง timeout จาก network traffic
            await page.goto('https://gps.dtc.co.th/v2/report-main/car-usage/status', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (err) {
            console.log('⚠️ Navigation timeout (Normal for GPS sites), checking page content...');
        }

        // รอให้แน่ใจว่าเข้ามาหน้า Report แล้วจริงๆ
        try {
            await page.waitForSelector('div.layout-main, div.layout-menu-container', { timeout: 20000 });
            console.log('✅ Report Page Structure Loaded');
        } catch (e) {
            console.log('⚠️ Page structure wait failed, attempting Click Fallback...');
            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('span, a, div'));
                const target = elements.find(el => el.innerText && el.innerText.trim() === 'รายงานสถานะ');
                if (target) target.click();
            });
            await new Promise(r => setTimeout(r, 5000));
        }

        // ---------------------------------------------------------
        // Step 3: Fill Form
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Check & Fill Form...');
        
        const speedInputSelector = 'div:nth-of-type(8) input'; 
        
        // 3.0 เช็คว่ามีช่องกรอกความเร็วหรือยัง?
        let isFormReady = false;
        try {
            await page.waitForSelector(speedInputSelector, { visible: true, timeout: 5000 });
            isFormReady = true;
        } catch(e) {}
        
        if (!isFormReady) {
            console.log('   Form input not found. Selecting "ความเร็วเกิน(กำหนดค่าเอง)" from dropdown...');
            
            try {
                // 1. คลิกเปิด Dropdown (Trigger)
                const dropdownTrigger = 'div.scroll-main div:nth-of-type(4)'; 
                await page.waitForSelector(dropdownTrigger, { timeout: 10000 });
                await page.click(dropdownTrigger);
                console.log('   Clicked Dropdown Trigger');
                
                // รอให้ Dropdown List กางออกมาก่อน (สำคัญ)
                await page.waitForSelector('.p-dropdown-items', { visible: true, timeout: 5000 });

                // 2. เลือก Item โดยใช้ ID: pv_id_32_2 (ตามที่ระบุ)
                const targetId = '#pv_id_32_2';
                console.log(`   Clicking option by ID: ${targetId}`);
                
                try {
                    // พยายามเลือกด้วย ID ก่อน
                    await page.waitForSelector(targetId, { visible: true, timeout: 3000 });
                    await page.click(targetId);
                    console.log(`   Clicked ID ${targetId} successfully.`);
                } catch (err) {
                    console.log(`⚠️ ID ${targetId} not found, trying Text fallback...`);
                    // Fallback: ใช้ XPath หาจาก Text (ถ้า ID เปลี่ยน)
                    const optionText = 'ความเร็วเกิน(กำหนดค่าเอง)';
                    const optionXPath = `//li[contains(@class, 'p-dropdown-item')]//span[contains(text(), '${optionText}')]`;
                    
                    const options = await page.$x(optionXPath);
                    if (options.length > 0) {
                        await page.evaluate(el => el.click(), options[0]);
                        console.log(`   Clicked "${optionText}" option via Text.`);
                    } else {
                        throw new Error(`Option not found via ID (${targetId}) or Text.`);
                    }
                }
                
            } catch (e) {
                console.log('⚠️ Error selecting report type:', e.message);
                throw e; // ถ้าเลือกรายงานไม่ได้ ก็ไปต่อไม่ได้
            }
        } else {
            console.log('   Form input already visible.');
        }

        // 3.1 รอให้ฟอร์มโหลดจริงๆ
        console.log('   Waiting for Speed Input field...');
        await page.waitForSelector(speedInputSelector, { visible: true, timeout: 60000 });
        
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

        for (let i = 0; i < 300; i++) { 
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            const target = files.find(f => f.endsWith('.csv') && !f.endsWith('.crdownload'));
            if (target) { finalFile = target; break; }
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
