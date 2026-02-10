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
    console.log('🚀 Starting Bot (Step 3.3: Spacebar Method)...');

    /*
    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete.');
        process.exit(1); 
    }
    */

    const downloadPath = path.join(__dirname, 'downloads');
    if (fs.existsSync(downloadPath)) fs.rmSync(downloadPath, { recursive: true, force: true });
    fs.mkdirSync(downloadPath);

    let browser = null;
    let page = null;

    try {
        console.log('🖥️ Launching Browser...');
        browser = await puppeteer.launch({
            headless: 'new', // ใช้ 'new' สำหรับ Server
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
            await page.type('input[type="password"]', DTC_PASS || 'TEST_PASS');
        } catch (e) {
            await page.type('#password1 > input', DTC_PASS || 'TEST_PASS');
        }
        
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
        await new Promise(r => setTimeout(r, 2000));

        // ---------------------------------------------------------
        // Step 2: Navigate Directly to Status Report
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Navigate to Report Link...');
        try {
            await page.goto('https://gps.dtc.co.th/v2/report-main/car-usage/status', { 
                waitUntil: 'domcontentloaded', 
                timeout: 60000 
            });
            console.log('✅ Navigated to Status Report Page.');
        } catch (err) {
            console.log('⚠️ Navigation timeout, checking content...');
        }

        try {
            await page.waitForSelector('div.layout-main, div.layout-menu-container', { timeout: 20000 });
        } catch(e) { console.log('⚠️ Page structure wait warning.'); }

        // ---------------------------------------------------------
        // Step 3: Check & Fill Form
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Fill Form...');
        
        const speedInputSelector = 'div:nth-of-type(8) input'; 
        
        // --- 3.1 เลือกข้อมูลสถานะ (Report Type) ---
        let isFormReady = false;
        try {
            await page.waitForSelector(speedInputSelector, { visible: true, timeout: 5000 });
            isFormReady = true;
        } catch(e) {}
        
        if (!isFormReady) {
            console.log('   Selecting Status Info (Report Type)...');
            try {
                // 1. คลิกเปิด Dropdown
                const triggerXPath = "//div[contains(@class, 'scroll-main')]//div[4]//span[contains(@class, 'p-dropdown-label')] | //span[contains(text(), 'ความเร็วเกิน(กำหนดค่าเอง)')]";
                await page.waitForXPath(triggerXPath, { visible: true, timeout: 10000 });
                const [trigger] = await page.$x(triggerXPath);
                if (trigger) await trigger.click();
                else await page.click('div.scroll-main div.p-dropdown');
                
                // รอ List
                await page.waitForSelector('.p-dropdown-items, [role="listbox"]', { visible: true, timeout: 5000 });

                // 2. เลือก Item
                const optionXPath = `
                    //li[@role='option'][@aria-label='ความเร็วเกิน(กำหนดค่าเอง)'] | 
                    //li[@role='option']//span[contains(text(), 'ความเร็วเกิน(กำหนดค่าเอง)')]
                `;
                await page.waitForXPath(optionXPath, { visible: true, timeout: 5000 });
                const [option] = await page.$x(optionXPath);
                if (option) {
                    await option.click();
                    console.log('   Selected: ความเร็วเกิน(กำหนดค่าเอง)');
                } else {
                    throw new Error('Option element not found in list');
                }
            } catch (e) {
                console.error('⚠️ Error selecting report type:', e.message);
                try {
                     const opt = await page.$x("//li//span[contains(text(), 'ความเร็วเกิน')]");
                     if(opt.length > 0) await opt[0].click();
                } catch(err){}
            }
        } else {
            console.log('   Form input already visible.');
        }

        // รอฟอร์มโหลด
        console.log('   Waiting for Speed Input field...');
        await page.waitForSelector(speedInputSelector, { visible: true, timeout: 60000 });
        
        // --- 3.2 เลือกกลุ่มรถ (Vehicle Group) ---
        console.log('   Selecting Vehicle Group...');
        try {
            await new Promise(r => setTimeout(r, 1000));
            // คลิกเปิด Dropdown
            const groupTrigger = 'div:nth-of-type(5) > div.flex-column span, div:nth-of-type(5) .p-dropdown';
            await page.click(groupTrigger);
            await new Promise(r => setTimeout(r, 1000));

            // เลือก Item
            const groupOptionSelector = 'li[aria-label="กลุ่มทั้งหมด"]';
            await page.waitForSelector(groupOptionSelector, { visible: true, timeout: 5000 });
            await page.click(groupOptionSelector);
            console.log('   Selected: กลุ่มทั้งหมด');
        } catch (e) { console.log('⚠️ Group selection skipped/failed: ' + e.message); }

        // --- 3.3 เลือกรถ (Checkbox All) - SPACEBAR METHOD ---
        console.log('   Selecting All Vehicles (Spacebar Method)...');
        try {
            // 1. คลิกเปิด Dropdown (กรุณาเลือกรถ)
            const vehicleSelectSelector = 'div.p-multiselect-label-container';
            await page.waitForSelector(vehicleSelectSelector, { visible: true, timeout: 5000 });
            await page.click(vehicleSelectSelector);
            console.log('   Opened Vehicle Multiselect.');
            
            await new Promise(r => setTimeout(r, 1000));

            // 2. เช็คสถานะและกด Spacebar
            const checkboxWrapperSelector = 'div.p-multiselect-header > div.p-checkbox';
            const checkboxInputSelector = 'div.p-multiselect-header > div.p-checkbox > input';
            
            // รอให้ปุ่มปรากฏ
            await page.waitForSelector(checkboxWrapperSelector, { visible: true, timeout: 5000 });

            // ตรวจสอบว่าติ๊กอยู่แล้วหรือไม่
            const isChecked = await page.evaluate((inputSel, wrapperSel) => {
                const input = document.querySelector(inputSel);
                const wrapper = document.querySelector(wrapperSel);
                if (input && (input.checked || input.getAttribute('aria-label') === 'All items selected')) return true;
                if (wrapper && wrapper.classList.contains('p-highlight')) return true;
                return false;
            }, checkboxInputSelector, checkboxWrapperSelector);

            if (isChecked) {
                console.log('   Checkbox ALREADY selected. Skipping.');
            } else {
                console.log('   Checkbox NOT selected. Pressing Spacebar...');
                
                // พยายาม Focus ไปที่ checkbox wrapper
                // (บางครั้ง input ซ่อนอยู่ focus ไม่ได้ ต้อง focus ที่ wrapper)
                try {
                    await page.focus(checkboxWrapperSelector);
                } catch (e) {
                    // Fallback: ถ้า focus wrapper ไม่ได้ ลอง focus input
                    await page.focus(checkboxInputSelector).catch(() => {});
                }
                
                // กด Spacebar
                await page.keyboard.press('Space');
                console.log('   Pressed Spacebar.');
            }
            
        } catch (e) {
            console.log('⚠️ Checkbox selection error: ' + e.message);
        }
        
        // ปิด Dropdown
        await page.keyboard.press('Escape');

        // --- 3.4 วันที่ (Date Range) ---
        console.log('   Setting Date Range...');
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); 
        
        // Start Date: 1st of current month - 2 days
        const startDate = new Date(currentYear, currentMonth, 1);
        startDate.setDate(startDate.getDate() - 2); 
        
        // End Date: Last day of current month
        const endDate = new Date(currentYear, currentMonth + 1, 0); 
        
        const pad = (n) => n < 10 ? '0' + n : n;
        const formatDateTime = (date, isEnd = false) => {
            const d = pad(date.getDate());
            const m = pad(date.getMonth() + 1);
            const y = date.getFullYear();
            const time = isEnd ? '23:59:59' : '00:00:00';
            return `${d}/${m}/${y} ${time}`;
        };

        const startDateStr = formatDateTime(startDate, false);
        const endDateStr = formatDateTime(endDate, true);
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
        // Step 4: Search & Export
        // ---------------------------------------------------------
        console.log('4️⃣ Step 4: Search & Export...');
        
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

        console.log('   Waiting for Data...');
        await new Promise(r => setTimeout(r, 10000));

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

        await new Promise(r => setTimeout(r, 2000));

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
            const csvBtn = await page.$x("//span[contains(text(), 'CSV')]");
            if (csvBtn.length > 0) await csvBtn[0].click();
        }

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

        console.log('📧 Sending Email...');
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
            } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
