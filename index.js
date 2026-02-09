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
    console.log('🚀 Starting Bot (Step 3: ARIA Label Update)...');

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
            const passwordSelector = 'input[type="password"]';
            await page.waitForSelector(passwordSelector, { visible: true, timeout: 30000 });
            await page.type(passwordSelector, DTC_PASS || 'TEST_PASS');
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

        // ---------------------------------------------------------
        // Step 2: Navigate to Report
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Go to Report Page...');
        try {
            await page.goto('https://gps.dtc.co.th/v2/report-main/car-usage/status', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (err) {
            console.log('⚠️ Navigation timeout, checking page content...');
        }

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
        // Step 3: Fill Form (Updated with ARIA Labels)
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Check & Fill Form...');
        
        const speedInputSelector = 'div:nth-of-type(8) input'; 
        
        // 3.0 Report Type: "ความเร็วเกิน(กำหนดค่าเอง)"
        let isFormReady = false;
        try {
            await page.waitForSelector(speedInputSelector, { visible: true, timeout: 5000 });
            isFormReady = true;
        } catch(e) {}
        
        if (!isFormReady) {
            console.log('   Form input not found. Selecting Report Type...');
            try {
                // 1. คลิกเปิด Dropdown (Trigger)
                // พยายามหาจากโครงสร้างหน้าเว็บ (มักจะเป็น Dropdown ตัวแรกๆ ใน Main Scroll)
                const dropdownTrigger = 'div.scroll-main div.p-dropdown, div.scroll-main div:nth-of-type(4)'; 
                await page.waitForSelector(dropdownTrigger, { timeout: 10000 });
                await page.click(dropdownTrigger);
                console.log('   Clicked Report Dropdown Trigger');
                
                // รอ Animation
                await new Promise(r => setTimeout(r, 1000));

                // 2. เลือก Item โดยใช้ aria-label="ความเร็วเกิน(กำหนดค่าเอง)"
                // หมายเหตุ: ใช้ li[role="option"] หรือ li เฉยๆ
                const reportOptionSelector = 'li[aria-label="ความเร็วเกิน(กำหนดค่าเอง)"]';
                console.log(`   Clicking option: ${reportOptionSelector}`);
                
                await page.waitForSelector(reportOptionSelector, { visible: true, timeout: 5000 });
                await page.click(reportOptionSelector);
                console.log('   Selected Report Type successfully.');
                
            } catch (e) {
                console.log('⚠️ Error selecting report type:', e.message);
                throw e; 
            }
        } else {
            console.log('   Form input already visible.');
        }

        // 3.1 รอให้ฟอร์มโหลด
        console.log('   Waiting for Speed Input field...');
        await page.waitForSelector(speedInputSelector, { visible: true, timeout: 60000 });
        
        // 3.2 Vehicle Group: "กลุ่มทั้งหมด"
        console.log('   Selecting Vehicle Group...');
        try {
            await new Promise(r => setTimeout(r, 1000));
            
            // 1. คลิกเปิด Dropdown (ถัดจาก Report Type)
            const groupTrigger = 'div:nth-of-type(5) > div.flex-column span, div:nth-of-type(5) .p-dropdown';
            await page.click(groupTrigger);
            await new Promise(r => setTimeout(r, 1000));

            // 2. เลือก Item โดยใช้ aria-label="กลุ่มทั้งหมด"
            const groupOptionSelector = 'li[aria-label="กลุ่มทั้งหมด"]';
            console.log(`   Clicking group option: ${groupOptionSelector}`);
            
            // ใช้ evaluate click เพื่อความชัวร์ หรือ Puppeteer click
            // บางครั้ง aria-label อยู่ใน span ข้างใน
            const foundGroup = await page.evaluate((sel) => {
                // ลองหา li ที่มี aria-label ตรงๆ
                let item = document.querySelector(sel);
                if (!item) {
                    // ถ้าไม่เจอ ลองหา li ที่มี text ว่า "กลุ่มทั้งหมด"
                    const lis = document.querySelectorAll('li.p-dropdown-item');
                    for (const li of lis) {
                        if (li.innerText.includes('กลุ่มทั้งหมด') || li.getAttribute('aria-label') === 'กลุ่มทั้งหมด') {
                            item = li;
                            break;
                        }
                    }
                }
                if (item) {
                    item.click();
                    return true;
                }
                return false;
            }, groupOptionSelector);
            
            if(foundGroup) console.log('   Selected Group "กลุ่มทั้งหมด"');
            else console.log('⚠️ Group Option not found (might rely on default).');

        } catch (e) { console.log('⚠️ Skipping Group Selection.'); }

        // 3.3 Select All Vehicles
        console.log('   Selecting All Vehicles...');
        // คลิกเปิด MultiSelect
        const vehicleSelectSelector = 'div.p-multiselect-label-container';
        await page.waitForSelector(vehicleSelectSelector);
        await page.click(vehicleSelectSelector);
        await new Promise(r => setTimeout(r, 1000));

        // คลิก Checkbox "Select All"
        // ใช้ selector ที่เจาะจงไปที่ checkbox ใน header ของ panel
        // หลีกเลี่ยงการใช้ aria-label ของ input ตรงๆ เพราะอาจเปลี่ยนจาก "Select All" เป็น "Unselect All"
        const selectAllContainer = 'div.p-multiselect-header .p-checkbox';
        
        console.log(`   Clicking Select All Checkbox: ${selectAllContainer}`);
        try {
            await page.waitForSelector(selectAllContainer, { visible: true, timeout: 5000 });
            await page.click(selectAllContainer);
            console.log('   Clicked Select All Checkbox.');
        } catch (e) {
            console.log('⚠️ Select All Checkbox not found.');
        }
        
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
        // Step 6: Export & Download
        // ---------------------------------------------------------
        console.log('6️⃣ Step 6: Exporting (CSV)...');
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

        await new Promise(r => setTimeout(r, 5000));

        // เลือก CSV
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

        // รอไฟล์ CSV
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
