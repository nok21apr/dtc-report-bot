const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// รับค่าจาก GitHub Secrets
const DTC_USER = process.env.DTC_USER || 'ttkmbc';
const DTC_PASS = process.env.DTC_PASS || 'mbcgps';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_TO;

(async () => {
    console.log('🚀 Starting Bot (UI.Vision Logic Ported)...');

    if (!EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets not found.');
        process.exit(1);
    }

    const downloadPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath);

    let browser = null;
    let page = null;

    try {
        console.log('🖥️ Launching Chrome...');
        
        browser = await puppeteer.launch({
            headless: 'new',
            protocolTimeout: 300000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });

        page = await browser.newPage();
        
        // Timeout 5 นาที ตาม Logic UI.Vision (เผื่อโหลดนาน)
        page.setDefaultNavigationTimeout(300000); 
        page.setDefaultTimeout(300000);

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // --- Step 1: เปิดหน้าล็อกอิน ---
        console.log('1. Opening Login Page...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        // --- Step 2-4: กรอกรหัสและเข้าสู่ระบบ ---
        console.log('2-4. Logging in...');
        await page.waitForSelector('#txtname', { visible: true });
        await page.type('#txtname', DTC_USER, { delay: 50 }); 
        await page.type('#txtpass', DTC_PASS, { delay: 50 });
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('#btnLogin')
        ]);

        // --- Step 5: หยุดรอ 5 วินาที (ตาม UI.Vision) ---
        console.log('5. Pausing 5s (UI.Vision logic)...');
        await new Promise(r => setTimeout(r, 5000));
        
        // --- Step 6: เปิดหน้ารายงานโดยตรง ---
        console.log('6. Navigating to Report_03.php...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // --- Step 7: หยุดรอ 5 วินาที (ตาม UI.Vision) ---
        console.log('7. Pausing 5s for form load...');
        await new Promise(r => setTimeout(r, 5000));
        
        // --- Step 8: กำหนดความเร็วสูงสุด ---
        console.log('8. Setting Speed Max...');
        await page.waitForSelector('#speed_max', { visible: true });
        await page.evaluate(() => document.getElementById('speed_max').value = ''); // Clear ก่อน
        await page.type('#speed_max', '55');

        // --- Step 9-12: คำนวณและกรอกวันที่ (สูตรจาก UI.Vision) ---
        console.log('9-12. Setting Date Range (UI.Vision Formula)...');
        
        // Logic จาก UI.Vision: 
        // Start Date: วันที่ 1 ของเดือนปัจจุบัน ลบไป 2 วัน
        // End Date: วันสุดท้ายของเดือนปัจจุบัน
        
        const now = new Date();
        const thaiDate = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
        
        // คำนวณ startDate (เหมือน executeScript ในข้อ 9)
        const dStart = new Date(thaiDate);
        dStart.setDate(1); // ไปวันที่ 1 ของเดือน
        dStart.setDate(dStart.getDate() - 2); // ถอยหลัง 2 วัน
        
        // คำนวณ endDate (เหมือน executeScript ในข้อ 11)
        const yEnd = thaiDate.getFullYear();
        const mEnd = thaiDate.getMonth() + 1;
        const lastDayObj = new Date(yEnd, mEnd, 0); // วันสุดท้ายของเดือน
        
        const formatDate = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        const startDateString = `${formatDate(dStart)} 00:00`;
        const endDateString = `${yEnd}-${String(mEnd).padStart(2, '0')}-${String(lastDayObj.getDate()).padStart(2, '0')} 23:59`;

        console.log(`📅 Date Range: ${startDateString} to ${endDateString}`);

        // Inject ค่าและ Trigger Event
        await page.evaluate((start, end) => {
            const date9 = document.getElementById('date9');
            const date10 = document.getElementById('date10');
            
            date9.value = start;
            date10.value = end;
            
            // Trigger events
            date9.dispatchEvent(new Event('change', { bubbles: true }));
            date10.dispatchEvent(new Event('change', { bubbles: true }));
        }, startDateString, endDateString);

        // --- Step 13: เลือกนาที ---
        console.log('13. Selecting Minute...');
        await page.select('#ddlMinute', '1');

        // --- Step 14: เลือกทะเบียน "ทั้งหมด" (JavaScript Logic) ---
        console.log('14. Selecting Truck "All"...');
        await page.evaluate(() => {
            const selectElement = document.getElementById('ddl_truck');
            const options = selectElement.options;
            for (var i = 0; i < options.length; i++) {
                if (options[i].text.includes('ทั้งหมด')) {
                    selectElement.value = options[i].value;
                    break;
                }
            }
            var event = new Event('change', { bubbles: true });
            selectElement.dispatchEvent(event);
        });

        // --- Step 15: คลิกปุ่มค้นหา ---
        console.log('15. Clicking Search...');
        try {
            await page.waitForSelector("span[onclick='sertch_data();']", { visible: true, timeout: 5000 });
            await page.click("span[onclick='sertch_data();']");
        } catch (e) {
            console.warn('⚠️ Search button selector failed, executing script directly...');
            await page.evaluate(() => { if(typeof sertch_data === 'function') sertch_data(); });
        }
        
        // --- Step 16: รอข้อมูล 120 วินาที (UI.Vision pause 120000) ---
        // เราใช้ waitForSelector แทน pause เพื่อความฉลาดกว่า (ถ้ามาเร็วกก็ไปเลย)
        console.log('16. Waiting for Export button (Max 120s)...');
        try {
            await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
        } catch (e) {
            console.error('❌ Export button not found within 120s.');
            await page.screenshot({ path: path.join(downloadPath, 'error_no_export.png') });
            throw new Error('Export button missing (Screenshot saved)');
        }

        // --- Step 17: รอ Export พร้อม (UI.Vision waitForElementVisible) ---
        // (ทำไปแล้วในขั้นตอน 16)

        // --- Step 18: คลิกปุ่ม Export ---
        console.log('18. Clicking Export...');
        await page.click('#btnexport');

        // รอไฟล์ดาวน์โหลด
        console.log('⏳ Waiting for file download...');
        let fileName;
        // รอ 3 นาที
        for (let i = 0; i < 180; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (fs.existsSync(downloadPath)) {
                const files = fs.readdirSync(downloadPath);
                fileName = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
                if (fileName) break;
            }
        }

        if (!fileName) throw new Error("File download timeout");
        
        const filePath = path.join(downloadPath, fileName);
        console.log(`✅ File downloaded: ${fileName}`);

        await browser.close();
        browser = null;

        // ส่งเมล
        console.log('📧 Sending email...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS
            }
        });

        await transporter.sendMail({
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            subject: `รายงาน DTC Overspeed Report - ${startDateString.split(' ')[0]}`,
            text: `รายงานประจำวัน (สร้างจาก Logic UI.Vision)\nช่วงเวลา: ${startDateString} ถึง ${endDateString}`,
            attachments: [{ filename: fileName, path: filePath }]
        });

        console.log('🎉 Done! Email sent.');

    } catch (error) {
        console.error('❌ Fatal Error:', error);
        
        if (page && !page.isClosed()) {
            try {
                const screenshotPath = path.join(downloadPath, 'fatal_error.png');
                await page.screenshot({ path: screenshotPath });
                console.log(`📸 Screenshot saved at: ${screenshotPath}`);
            } catch (e) {
                console.error('Could not take screenshot');
            }
        }

        if (browser) await browser.close();
        process.exit(1);
    }
})();
