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
    console.log('🚀 Starting Bot (Fix Shift Key & Date Overlay)...');

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
        page.setDefaultNavigationTimeout(600000);
        page.setDefaultTimeout(600000);
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

        await page.waitForFunction(() => !document.querySelector('#Username'), { timeout: 10000 });
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
            await page.waitForSelector('div.layout-main, div.layout-menu-container', { timeout: 30000 });
        } catch(e) { console.log('⚠️ Page structure wait warning.'); }

        // ---------------------------------------------------------
        // Step 3: Check & Fill Form
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Fill Form...');
        
        const speedInputSelector = 'div:nth-of-type(8) input'; 
        
        // --- 3.1 เลือกข้อมูลสถานะ (Report Type) ---
        let isFormReady = false;
        try {
            await page.waitForSelector(speedInputSelector, { visible: true, timeout: 10000 });
            isFormReady = true;
        } catch(e) {}
        
        if (!isFormReady) {
            console.log('   Selecting Status Info (Report Type)...');
            try {
                const timeout = 10000;
                const targetPage = page;
                
                // 1. คลิก Dropdown (แก้ไขตาม Code แนบ)
                await puppeteer.Locator.race([
                    targetPage.locator('::-p-aria(รถวิ่ง)'),
                    targetPage.locator('div:nth-of-type(4) > div.flex-column span'),
                    targetPage.locator(':scope >>> div:nth-of-type(4) > div.flex-column span'),
                    targetPage.locator('::-p-text(รถวิ่ง)')
                ])
                    .setTimeout(timeout)
                    .click({
                      offset: {
                        x: 416.24652099609375,
                        y: 9.86456298828125,
                      },
                    });

                // 2. พิมพ์ค้นหา (แก้ไขตาม Code แนบ)
                await puppeteer.Locator.race([
                    targetPage.locator('div.p-dropdown-panel input'),
                    targetPage.locator('::-p-xpath(/html/body/div[4]/div[1]/div/input)'),
                    targetPage.locator(':scope >>> div.p-dropdown-panel input')
                ])
                    .setTimeout(timeout)
                    .fill('ความเร็วเกิน(กำหนดค่าเอง)');

                // 3. เลือกรายการ (แก้ไขตาม Code แนบ: ArrowDown -> ArrowUp -> Enter -> Up)
                // ตาม Code ที่แนบมา: Down, Up, Enter, Up 
                // แต่ปกติการเลือก dropdown ต้องกด Down ไปที่ item แล้ว Enter
                // Code แนบ:
                // await targetPage.keyboard.down('ArrowDown');
                // await targetPage.keyboard.up('ArrowDown');
                // await targetPage.keyboard.down('Enter');
                // await targetPage.keyboard.up('Enter');
                
                await targetPage.keyboard.down('ArrowDown');
                await targetPage.keyboard.up('ArrowDown');
                
                await targetPage.keyboard.down('Enter');
                await targetPage.keyboard.up('Enter');
                
                console.log('   Selected: Report Type (via Puppeteer Record Flow with Filter).');
                
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.error('⚠️ Error selecting report type:', e.message);
                try {
                     const opt = await page.$x("//li//span[contains(text(), 'ความเร็วเกิน(กำหนดค่าเอง)')]");
                     if(opt.length > 0) await opt[0].click();
                } catch(err){}
            }
        } else {
            console.log('   Form input already visible.');
        }

        // รอฟอร์มโหลด
        console.log('   Waiting for Speed Input field...');
        await page.waitForSelector(speedInputSelector, { visible: true, timeout: 60000 });
        
        // --- 3.2 & 3.3 เลือกกลุ่มรถและรถ (Strict Puppeteer Record Flow) ---
        console.log('   Selecting Vehicle Group & All Vehicles (Strict Puppeteer Record)...');
        try {
            const timeout = 10000;
            const targetPage = page;

            // 1. คลิก Dropdown ข้อมูลกลุ่มรถ
            await puppeteer.Locator.race([
                targetPage.locator('div:nth-of-type(5) path'),
                targetPage.locator('::-p-xpath(//*[@id="pv_id_40"]/div/svg/path)'),
                targetPage.locator(':scope >>> div:nth-of-type(5) path')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 2.22296142578125,
                    y: 2.8023681640625,
                  },
                });
            
            await new Promise(r => setTimeout(r, 1000));

            // 2. คลิกเลือก "กลุ่มทั้งหมด"
            await puppeteer.Locator.race([
                targetPage.locator('::-p-aria(กลุ่มทั้งหมด[role="option"]) >>>> ::-p-aria([role="generic"])'),    
                targetPage.locator(':scope >>> #pv_id_40_0 > span.p-dropdown-item-label')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 44.375,
                    y: 11.27081298828125,
                  },
                });

            await new Promise(r => setTimeout(r, 10000));

            // 3. กด Tab เพื่อไปที่ช่องกรุณาเลือกรถ
            await targetPage.keyboard.down('Tab');
            await targetPage.keyboard.up('Tab');
            await new Promise(r => setTimeout(r, 1000));

            // 4. กด Enter เพื่อเปิด Dropdown รถ
            await targetPage.keyboard.down('Enter');
            await targetPage.keyboard.up('Enter');
            await new Promise(r => setTimeout(r, 1000)); // รอหน้าต่างกาง

            // 5. กด ArrowDown 1 ครั้งเพื่อโฟกัสรายการแรก
            await targetPage.keyboard.down('ArrowDown');
            await targetPage.keyboard.up('ArrowDown');
            await new Promise(r => setTimeout(r, 1000));

            // 6. กด Shift ค้าง และ ArrowDown 1000 ครั้ง
            console.log('   Holding Shift and pressing ArrowDown 1000 times...');
            try {
                await targetPage.keyboard.down('Shift');
                
                const numberOfTrucks = 1000;
                for (let i = 0; i < numberOfTrucks; i++) {
                    await targetPage.keyboard.down('ArrowDown');
                    await targetPage.keyboard.up('ArrowDown');
                    // แทรกจังหวะพักนิดหน่อยให้บราวเซอร์ทำงานทัน ไม่ค้าง
                    if (i % 50 === 0) await new Promise(r => setTimeout(r, 10)); 
                }
                console.log('   Selection Loop Completed.');
            } finally {
                // บังคับปล่อย Shift เสมอ ไม่ว่าสำเร็จหรือ Error
                await targetPage.keyboard.up('Shift');
                console.log('   Released Shift Key.');
            }
            
            // ปิด Dropdown
            await targetPage.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
            console.log('⚠️ Group/Vehicle selection error: ' + e.message);
            await page.keyboard.up('Shift').catch(() => {});
        }

        // --- 3.4 วันที่ (Date Range) [SAFE CLEAR] ---
        console.log('   Setting Date Range...');
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); 
        
        const startDate = new Date(currentYear, currentMonth, 1);
        startDate.setDate(startDate.getDate() - 2); 
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
        
        // ใช้วิธีล้างค่าด้วย JavaScript โดยตรง (แก้ปัญหาพิมพ์ซ้อน)
        await page.evaluate((selector) => {
            const input = document.querySelector(selector);
            if (input) input.value = '';
        }, dateInputSelector);
        
        // พิมพ์ค่าใหม่ลงไป
        await page.type(dateInputSelector, fullDateString, { delay: 10 });
        await page.keyboard.press('Tab');

        // 3.5 Speed
        console.log('   Setting Speed 55...');
        try {
            const timeout = 5000;
            const targetPage = page;
            
            await puppeteer.Locator.race([
                targetPage.locator('::-p-aria([role="main"]) >>>> ::-p-aria([role="spinbutton"])'),
                targetPage.locator('div:nth-of-type(8) input'),
                targetPage.locator('::-p-xpath(//*[@id="app"]/div/main/div[2]/div/div[2]/div[2]/div/div/div[2]/div/div[8]/div[2]/div/input)'),
                targetPage.locator(':scope >>> div:nth-of-type(8) input')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 49.35760498046875,
                    y: 22.861083984375,
                  },
                });
                
            await puppeteer.Locator.race([
                targetPage.locator('::-p-aria([role="main"]) >>>> ::-p-aria([role="spinbutton"])'),
                targetPage.locator('div:nth-of-type(8) input'),
                targetPage.locator('::-p-xpath(//*[@id="app"]/div/main/div[2]/div/div[2]/div[2]/div/div/div[2]/div/div[8]/div[2]/div/input)'),
                targetPage.locator(':scope >>> div:nth-of-type(8) input')
            ])
                .setTimeout(timeout)
                .fill('55');
                
            await targetPage.keyboard.down('Tab');
            await targetPage.keyboard.up('Tab');
            
            await targetPage.keyboard.down('Tab');
            await targetPage.keyboard.up('Tab');
            
            await targetPage.keyboard.down(' ');
            await targetPage.keyboard.up(' ');
            
            await targetPage.keyboard.down('Tab');
            await targetPage.keyboard.up('Tab');

        } catch (e) {
            console.log('⚠️ Speed configuration error: ' + e.message);
        }

        // 3.6 Duration
        console.log('   Setting Duration 1 min...');
        try {
            const timeout = 5000;
            const targetPage = page;
            
            await puppeteer.Locator.race([
                targetPage.locator('::-p-aria(\\(กม./ชม\\) ระบุ นาที)'),
                targetPage.locator('#customselect'),
                targetPage.locator('::-p-xpath(//*[@id="customselect"])'),
                targetPage.locator(':scope >>> #customselect')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 10.45135498046875,
                    y: 7.1180419921875,
                  },
                });

            await puppeteer.Locator.race([
                targetPage.locator('div:nth-of-type(9) div.align-items-center > input'),
                targetPage.locator('::-p-xpath(//*[@id="app"]/div/main/div[2]/div/div[2]/div[2]/div/div/div[2]/div/div[9]/div[2]/div[3]/input)'),
                targetPage.locator(':scope >>> div:nth-of-type(9) div.align-items-center > input'),
                targetPage.locator('::-p-text(10)')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 46.8367919921875,
                    y: 17.65966796875,
                  },
                });

            await puppeteer.Locator.race([
                targetPage.locator('div:nth-of-type(9) div.align-items-center > input'),
                targetPage.locator('::-p-xpath(//*[@id="app"]/div/main/div[2]/div/div[2]/div[2]/div/div/div[2]/div/div[9]/div[2]/div[3]/input)'),
                targetPage.locator(':scope >>> div:nth-of-type(9) div.align-items-center > input'),
                targetPage.locator('::-p-text(10)')
            ])
                .setTimeout(timeout)
                .fill('');

            await targetPage.keyboard.down('Backspace');
            await targetPage.keyboard.up('Backspace');
            await targetPage.keyboard.down('Backspace');
            await targetPage.keyboard.up('Backspace');
            await targetPage.keyboard.down('Backspace');
            await targetPage.keyboard.up('Backspace');

            await puppeteer.Locator.race([
                targetPage.locator('div:nth-of-type(9) div.align-items-center > input'),
                targetPage.locator('::-p-xpath(//*[@id="app"]/div/main/div[2]/div/div[2]/div[2]/div/div/div[2]/div/div[9]/div[2]/div[3]/input)'),
                targetPage.locator(':scope >>> div:nth-of-type(9) div.align-items-center > input'),
                targetPage.locator('::-p-text(10)')
            ])
                .setTimeout(timeout)
                .fill('1');

            await targetPage.keyboard.down('Tab');
            await targetPage.keyboard.up('Tab');
            
        } catch (e) {
            console.log('⚠️ Duration configuration error: ' + e.message);
        }

        // ---------------------------------------------------------
        // Step 4: Search & Export
        // ---------------------------------------------------------
        console.log('4️⃣ Step 4: Search & Export...');
        
        try {
            const timeout = 5000;
            const targetPage = page;

            console.log('   Clicking Search Button (1/2)...');
            await puppeteer.Locator.race([
                targetPage.locator('div.flex > div.h-full > div > div > div.flex > button:nth-of-type(2) > div > span'),
                targetPage.locator('::-p-xpath(//*[@id="app"]/div/main/div[2]/div/div[2]/div[2]/div/div/div[4]/button[2]/div/span)'),
                targetPage.locator(':scope >>> div.flex > div.h-full > div > div > div.flex > button:nth-of-type(2) > div > span')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 5.3089599609375,
                    y: 7.21527099609375,
                  },
                });

            // รอ 1 วินาทีก่อนกดครั้งที่ 2
            await new Promise(r => setTimeout(r, 1000));

            console.log('   Clicking Search Button (2/2)...');
            await puppeteer.Locator.race([
                targetPage.locator('div.flex > div.h-full > div > div > div.flex > button:nth-of-type(2) > div > span'),
                targetPage.locator('::-p-xpath(//*[@id="app"]/div/main/div[2]/div/div[2]/div[2]/div/div/div[4]/button[2]/div/span)'),
                targetPage.locator(':scope >>> div.flex > div.h-full > div > div > div.flex > button:nth-of-type(2) > div > span')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 5.3089599609375,
                    y: 7.21527099609375,
                  },
                });

            console.log('   Waiting for Data...');
            // รอให้ตารางข้อมูลโหลดเสร็จก่อนค่อยกด Export
            await new Promise(r => setTimeout(r, 400000)); 

            console.log('   Clicking Export Menu...');
            await puppeteer.Locator.race([
                targetPage.locator('span:nth-of-type(1) svg'),
                targetPage.locator(':scope >>> span:nth-of-type(1) svg')
            ])
                .setTimeout(timeout)
                .click({
                  offset: {
                    x: 10.8367919921875,
                    y: 0.90277099609375,
                  },
                });

            // รอหน้าต่างย่อย Export โหลด
            await new Promise(r => setTimeout(r, 10000));

            console.log('   Selecting CSV Option (via Keyboard)...');
            await targetPage.keyboard.down('ArrowDown');
            await targetPage.keyboard.up('ArrowDown');
            await new Promise(r => setTimeout(r, 1000));

            await targetPage.keyboard.down('ArrowDown');
            await targetPage.keyboard.up('ArrowDown');
            await new Promise(r => setTimeout(r, 1000));

            await targetPage.keyboard.down('Enter');
            await targetPage.keyboard.up('Enter');

        } catch (e) {
            console.log('⚠️ Search & Export error: ' + e.message);
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
            text: `ถึง ผู้เกี่ยวข้อง\nเรื่อง : ความเร็วเกินประจำวัน\n\nสิ่งที่แนบมา\nไฟล์รายงาน CSV: ${finalFile}\n\nด้วยความนับถือ\nDTC BOT REPORT`,
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



