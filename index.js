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
    console.log('🚀 Starting Bot (Step 2-3: Fix Navigation Flow & New Tab)...');

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
        // Step 2: Click "Report" Icon (Opens New Tab)
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Clicking Report Icon...');
        
        // รอให้หน้า Dashboard โหลดและปุ่ม Report ปรากฏ
        // Selector: img src="...report02.svg"
        const reportIconSelector = 'img[src*="report02.svg"]';
        await page.waitForSelector(reportIconSelector, { visible: true, timeout: 60000 });
        
        // เตรียมจับ Tab ใหม่ที่จะเด้งขึ้นมา
        const newPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));
        
        // คลิกปุ่มรายงาน
        await page.click(reportIconSelector);
        console.log('   Clicked Report Icon. Waiting for new tab...');

        // สลับไปใช้ page object ของ Tab ใหม่
        const reportPage = await newPagePromise;
        if (!reportPage) throw new Error('❌ New tab did not open or failed to capture.');
        
        // ตั้งค่าให้กับ Page ใหม่
        await reportPage.bringToFront();
        await reportPage.setViewport({ width: 1920, height: 1080 });
        // ต้องตั้ง Download Path ให้ Tab ใหม่ด้วย
        const clientNew = await reportPage.target().createCDPSession();
        await clientNew.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });
        
        // รอให้หน้า Main Report โหลดเสร็จ
        await reportPage.waitForNetworkIdle({ idleTime: 500, timeout: 60000 }).catch(() => {});
        console.log('✅ Switched to Report Tab.');

        // ---------------------------------------------------------
        // Step 3: Click "Status Report" (รายงานสถานะ)
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Clicking "Status Report"...');
        
        // ค้นหาเมนู "รายงานสถานะ"
        const statusMenuXPath = "//span[contains(text(), 'รายงานสถานะ')]";
        await reportPage.waitForXPath(statusMenuXPath, { visible: true, timeout: 30000 });
        const [statusBtn] = await reportPage.$x(statusMenuXPath);
        
        if (statusBtn) {
            await statusBtn.click();
            console.log('   Clicked "Status Report" menu.');
        } else {
            throw new Error('❌ Menu "รายงานสถานะ" not found.');
        }

        // รอให้เปลี่ยนหน้าไปที่ URL .../car-usage/status
        try {
            await reportPage.waitForFunction("window.location.href.includes('car-usage/status')", { timeout: 60000 });
            console.log('✅ Arrived at Status Report Page.');
        } catch (e) {
            console.log('⚠️ URL check timeout, checking content directly...');
        }

        // ---------------------------------------------------------
        // Step 4 & 5: Fill Form (On reportPage)
        // ---------------------------------------------------------
        console.log('4️⃣ Step 4 & 5: Check & Fill Form...');
        
        // ใช้ reportPage แทน page ตั้งแต่จุดนี้เป็นต้นไป
        const speedInputSelector = 'div:nth-of-type(8) input'; 
        
        // 4.1 เลือก Report Type: "ความเร็วเกิน(กำหนดค่าเอง)"
        let isFormReady = false;
        try {
            await reportPage.waitForSelector(speedInputSelector, { visible: true, timeout: 5000 });
            isFormReady = true;
        } catch(e) {}
        
        if (!isFormReady) {
            console.log('   Form input not found. Selecting Report Type...');
            try {
                // 1. คลิกเปิด Dropdown (Trigger)
                const dropdownTrigger = 'div.scroll-main div.p-dropdown, div.scroll-main div:nth-of-type(4)'; 
                await reportPage.waitForSelector(dropdownTrigger, { timeout: 10000 });
                await reportPage.click(dropdownTrigger);
                console.log('   Clicked Report Dropdown Trigger');
                
                await new Promise(r => setTimeout(r, 1000));

                // 2. เลือก Item จาก aria-label
                const reportOptionSelector = 'li[aria-label="ความเร็วเกิน(กำหนดค่าเอง)"]';
                await reportPage.waitForSelector(reportOptionSelector, { visible: true, timeout: 5000 });
                await reportPage.click(reportOptionSelector);
                console.log('   Selected Report Type: ความเร็วเกิน(กำหนดค่าเอง)');
                
            } catch (e) {
                console.log('⚠️ Error selecting report type:', e.message);
                throw e; 
            }
        } else {
            console.log('   Form input already visible.');
        }

        // รอฟอร์มโหลด
        console.log('   Waiting for Speed Input field...');
        await reportPage.waitForSelector(speedInputSelector, { visible: true, timeout: 60000 });
        
        // 4.2 Vehicle Group: "กลุ่มทั้งหมด"
        console.log('   Selecting Vehicle Group...');
        try {
            await new Promise(r => setTimeout(r, 1000));
            const groupTrigger = 'div:nth-of-type(5) > div.flex-column span, div:nth-of-type(5) .p-dropdown';
            await reportPage.click(groupTrigger);
            await new Promise(r => setTimeout(r, 1000));

            const groupOptionSelector = 'li[aria-label="กลุ่มทั้งหมด"]';
            await reportPage.waitForSelector(groupOptionSelector, { visible: true, timeout: 5000 });
            await reportPage.click(groupOptionSelector);
            console.log('   Selected Group "กลุ่มทั้งหมด"');
        } catch (e) { console.log('⚠️ Skipping Group Selection / Error: ' + e.message); }

        // 4.3 Select All Vehicles
        console.log('   Selecting All Vehicles...');
        const vehicleSelectSelector = 'div.p-multiselect-label-container';
        await reportPage.waitForSelector(vehicleSelectSelector);
        await reportPage.click(vehicleSelectSelector);
        await new Promise(r => setTimeout(r, 1000));

        const selectAllContainer = 'div.p-multiselect-header div.p-checkbox';
        try {
            await reportPage.waitForSelector(selectAllContainer, { visible: true, timeout: 5000 });
            await reportPage.click(selectAllContainer);
            console.log('   Clicked Select All Checkbox.');
        } catch (e) { console.log('⚠️ Select All Checkbox not found.'); }
        
        await reportPage.keyboard.press('Escape');

        // 4.4 Date Range (Last day of prev month (-2 days) to Last day of current month)
        console.log('   Setting Date Range...');
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); 
        
        // Start: 1st of current month - 2 days (Matches user example 30/01 for a Feb run)
        const startDate = new Date(currentYear, currentMonth, 1);
        startDate.setDate(startDate.getDate() - 2); 
        
        // End: Last day of current month
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
        await reportPage.click(dateInputSelector, { clickCount: 3 });
        await reportPage.keyboard.press('Backspace');
        await reportPage.type(dateInputSelector, fullDateString, { delay: 10 });
        await reportPage.keyboard.press('Tab');

        // 4.5 Speed
        console.log('   Setting Speed 55...');
        await reportPage.click(speedInputSelector, { clickCount: 3 });
        await reportPage.type(speedInputSelector, '55');

        // 4.6 Duration
        console.log('   Setting Duration 1 min...');
        const durationInputSelector = 'div:nth-of-type(9) div.align-items-center > input';
        if (await reportPage.$(durationInputSelector)) {
            await reportPage.click(durationInputSelector, { clickCount: 3 });
            await reportPage.type(durationInputSelector, '1');
        }

        // ---------------------------------------------------------
        // Step 5: Search & Export
        // ---------------------------------------------------------
        console.log('5️⃣ Step 5: Search & Export...');
        
        // Search Button
        const searchBtnXPath = "//*[@id='app']/div/main/div[2]/div/div[2]/div[2]/div/div/div[4]/button[2]";
        const searchBtn = await reportPage.$x(searchBtnXPath);
        if (searchBtn.length > 0) {
            await searchBtn[0].click();
        } else {
            await reportPage.evaluate(() => {
                 const buttons = document.querySelectorAll('button');
                 if(buttons.length > 0) buttons[buttons.length - 1].click();
            });
        }

        // Wait for Data
        console.log('   Waiting for Data...');
        await new Promise(r => setTimeout(r, 10000)); // Hard wait for grid load

        // Export
        console.log('   Clicking Export Menu...');
        try {
            await reportPage.waitForSelector('.p-toolbar-group-right', { timeout: 30000 }).catch(() => {});
            const menuClicked = await reportPage.evaluate(() => {
                const toolbar = document.querySelector('.p-toolbar-group-right, .flex.justify-content-end');
                if (toolbar) {
                    const btn = toolbar.querySelector('button, div[role="button"]');
                    if (btn) { btn.click(); return true; }
                }
                return false;
            });
            if (!menuClicked) {
                const exBtn = await reportPage.$x("//*[@id='pv_id_38' or contains(@id, 'pv_id_')]/div/svg");
                if (exBtn.length > 0) await exBtn[0].click();
            }
        } catch (e) { console.log('⚠️ Export Menu Click Failed'); }

        await new Promise(r => setTimeout(r, 2000));

        // Select CSV
        console.log('   Selecting CSV Option...');
        const csvSelected = await reportPage.evaluate(() => {
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
            const csvBtn = await reportPage.$x("//span[contains(text(), 'CSV')]");
            if (csvBtn.length > 0) await csvBtn[0].click();
        }

        // Wait for File
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

        // Email
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
                // Capture screenshot on error (try both pages)
                await page.screenshot({ path: path.join(downloadPath, 'error_screenshot_login.png'), fullPage: true });
            } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
