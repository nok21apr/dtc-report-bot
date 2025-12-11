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

// ฟังก์ชันช่วยตื๊อ (Retry Helper)
async function retryOperation(operation, maxRetries, delay, opName) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            console.warn(`⚠️ ${opName} failed (Attempt ${i + 1}/${maxRetries}): ${error.message}`);
            if (i === maxRetries - 1) throw error;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

(async () => {
    console.log('🚀 Starting Bot (Auto-Retry Mode)...');

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
                '--disable-accelerated-2d-canvas',
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        
        // Timeout สั้นลง เพื่อให้ Fail เร็วแล้ว Retry (60 วินาที)
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        await page.emulateTimezone('Asia/Bangkok');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // ---------------------------------------------------------
        // Step 1: Login (with Retry)
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('🔐 Step 1: Accessing Login Page...');
            await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
            
            console.log('   Waiting for login form...');
            await page.waitForSelector('#txtname', { visible: true, timeout: 30000 }); // รอแค่ 30 วิพอ
            
            console.log('   Typing credentials...');
            // Clear & Type
            await page.evaluate(() => {
                document.querySelector('#txtname').value = '';
                document.querySelector('#txtpass').value = '';
            });
            await page.type('#txtname', DTC_USER);
            await page.type('#txtpass', DTC_PASS);
            
            console.log('   Clicking Login...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => console.log('   Navigation timeout ignored')),
                page.click('#btnLogin')
            ]);

            // Check Success
            console.log('   Verifying login...');
            // ถ้ารหัสผู้ใช้หายไป แปลว่า Login ผ่าน
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 10000 });
            console.log('✅ Login Verified!');
        }, 3, 5000, "Login Process"); // ลอง 3 ครั้ง พักครั้งละ 5 วิ

        // ---------------------------------------------------------
        // Step 2: Report Page (with Retry)
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('📄 Step 2: Navigate to Report Page...');
            await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
            
            // เช็คว่าหลุด Login ไหม
            if (await page.$('#txtname')) {
                throw new Error('Session lost, redirected to login page');
            }
            // เช็คว่าฟอร์มมาไหม
            await page.waitForSelector('#speed_max', { visible: true, timeout: 30000 });
        }, 3, 3000, "Navigate Report");

        // ---------------------------------------------------------
        // Step 3: Fill Form
        // ---------------------------------------------------------
        console.log('📝 Step 3: Fill Report Form');
        
        // Direct Inject (เสถียรสุด)
        await page.evaluate(() => {
            // Speed
            const speed = document.getElementById('speed_max');
            speed.value = '55';
            speed.dispatchEvent(new Event('input', { bubbles: true }));

            // Date Calculation
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

            // Set Dates
            const d9 = document.getElementById('date9');
            const d10 = document.getElementById('date10');
            d9.value = startDate;
            d10.value = endDate;
            
            // Trigger Events
            [d9, d10].forEach(el => {
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur'));
            });

            // Select Options
            const ddlMinute = document.getElementById('ddlMinute');
            ddlMinute.value = '1';
            
            const ddlTruck = document.getElementById('ddl_truck');
            for (let opt of ddlTruck.options) {
                if (opt.text.includes('ทั้งหมด')) {
                    ddlTruck.value = opt.value;
                    ddlTruck.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        });

        // ---------------------------------------------------------
        // Step 4: Search & Export (with Retry)
        // ---------------------------------------------------------
        console.log('🔍 Step 4: Search & Export');

        await retryOperation(async () => {
            console.log('   Clicking Search...');
            await page.evaluate(() => {
                if (typeof sertch_data === 'function') sertch_data();
                else document.querySelector("span[onclick='sertch_data();']").click();
            });

            console.log('   Waiting for Export button...');
            await page.waitForSelector('#btnexport', { visible: true, timeout: 60000 });
            
            console.log('   Clicking Export...');
            // กดปุ่ม Export
            await page.click('#btnexport');
            
            // รอไฟล์เริ่มโหลด (เช็คว่ามีไฟล์งอกมาไหมภายใน 10 วิ)
            console.log('   Checking download start...');
            await new Promise((resolve, reject) => {
                let checkCount = 0;
                const interval = setInterval(() => {
                    checkCount++;
                    const files = fs.readdirSync(downloadPath);
                    if (files.some(f => f.endsWith('.xlsx') || f.endsWith('.xls'))) {
                        clearInterval(interval);
                        resolve();
                    }
                    if (checkCount > 10) { // 10 วินาที
                        clearInterval(interval);
                        reject(new Error("Download didn't start in 10s"));
                    }
                }, 1000);
            });
        }, 3, 5000, "Search & Export");

        // ---------------------------------------------------------
        // Step 5: Verify Download Completion
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Finalizing Download...');
        let foundFile = null;
        // รอไฟล์โหลดเสร็จ (ขนาดไฟล์หยุดนิ่ง หรือ นามสกุลถูกต้อง)
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            foundFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
            // ถ้าเจอไฟล์แล้ว และไม่มีไฟล์ .crdownload (กำลังโหลด) ก็ถือว่าเสร็จ
            if (foundFile && !files.some(f => f.endsWith('.crdownload'))) break;
        }

        if (!foundFile) throw new Error('File download failed');

        console.log(`✅ Downloaded: ${foundFile}`);
        await browser.close();

        // ---------------------------------------------------------
        // Step 6: Send Email
        // ---------------------------------------------------------
        console.log('📧 Step 6: Sending Email...');
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
            try { await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') }); } catch (e) {}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
