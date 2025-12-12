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

// ฟังก์ชัน Retry (ช่วยให้บอทตื๊อเก่งขึ้น)
async function retryOperation(operation, maxRetries, delay, opName) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`🔄 [${opName}] Attempt ${i + 1}/${maxRetries}`);
            return await operation();
        } catch (error) {
            console.warn(`⚠️ [${opName}] Failed: ${error.message}`);
            lastError = error;
            if (i < maxRetries - 1) {
                console.log(`⏳ Waiting ${delay/1000}s before retry...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

(async () => {
    console.log('🚀 Starting Bot (Stability & Download Fix)...');

    if (!DTC_USER || !DTC_PASS || !EMAIL_USER || !EMAIL_PASS) {
        console.error('❌ Error: Secrets incomplete.');
        process.exit(1);
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
                '--lang=th-TH,th',
                // ป้องกัน Chrome หลับระหว่างรอนานๆ
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        });

        page = await browser.newPage();
        // Timeout รวม 20 นาที
        page.setDefaultNavigationTimeout(1200000);
        page.setDefaultTimeout(1200000);

        await page.emulateTimezone('Asia/Bangkok');
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // ---------------------------------------------------------
        // Step 1: Login (Retry Logic)
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('🌐 Loading Login Page...');
            await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            await page.waitForSelector('#txtname', { visible: true, timeout: 120000 });
            
            console.log('🔐 Filling Credentials...');
            await page.evaluate(() => {
                document.querySelector('#txtname').value = '';
                document.querySelector('#txtpass').value = '';
            });
            await page.type('#txtname', DTC_USER);
            await page.type('#txtpass', DTC_PASS);
            
            console.log('👉 Clicking Login...');
            // ใช้ page.click (เมาส์จริง) ผสมกับ waitForFunction
            await Promise.all([
                page.click('#btnLogin'),
                // เพิ่มเวลารอตรวจสอบผลเป็น 60 วินาที (จากเดิม 10-30 วิ) เผื่อเว็บช้า
                page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 120000 })
            ]);
            console.log('✅ Login Success');
        }, 3, 10000, "Login Step");

        // ---------------------------------------------------------
        // Step 2-4: Navigate & Fill Form
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('📄 Navigating to Report...');
            await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            await page.waitForSelector('#speed_max', { visible: true, timeout: 120000 });
            
            console.log('📝 Filling Form...');
            await page.evaluate(() => {
                document.getElementById('speed_max').value = '55';
                
                // Logic วันที่
                var d = new Date(); d.setDate(1); d.setDate(d.getDate() - 2); 
                var y = d.getFullYear(); var m = d.getMonth() + 1; var day = d.getDate(); 
                var start = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

                var d2 = new Date(); var y2 = d2.getFullYear(); var m2 = d2.getMonth() + 1; 
                var last = new Date(y2, m2, 0).getDate(); 
                var end = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (last < 10 ? '0' : '') + last + ' 23:59';

                document.getElementById('date9').value = start;
                document.getElementById('date10').value = end;
                document.getElementById('ddlMinute').value = '1';
                
                const sel = document.getElementById('ddl_truck');
                for(let o of sel.options) {
                    if(o.text.includes('ทั้งหมด')) { sel.value = o.value; break; }
                }
                
                // Trigger Events
                document.getElementById('date9').dispatchEvent(new Event('change'));
                document.getElementById('date10').dispatchEvent(new Event('change'));
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            });

            console.log('🔍 Clicking Search...');
            // เลื่อนหาปุ่มก่อนกด (เผื่ออยู่นอกจอ)
            await page.evaluate(() => {
                const btn = document.querySelector("span[onclick='sertch_data();']");
                if(btn) {
                    btn.scrollIntoView();
                    btn.click();
                } else if(typeof sertch_data === 'function') {
                    sertch_data();
                }
            });
        }, 3, 5000, "Navigate & Fill Form");

        // ---------------------------------------------------------
        // Step 5: Wait Data (120s Hard Wait)
        // ---------------------------------------------------------
        console.log('⏳ Waiting 120s for Data (UI.Vision Standard)...');
        await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        await new Promise(r => setTimeout(r, 120000));
        console.log('✅ Data Ready.');

        // ---------------------------------------------------------
        // Step 6: Export (Improved Click & Wait)
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('⬇️ Exporting...');
            
            // ย้ำสิทธิ์
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

            // เลื่อนหาปุ่ม Export และกดด้วยเมาส์จริง (เสถียรกว่า JS ในบางเคส)
            const exportBtn = await page.$('#btnexport');
            if (exportBtn) {
                // เลื่อนมาให้เห็น
                await page.evaluate(el => el.scrollIntoView(), exportBtn);
                // กด
                await exportBtn.click();
            } else {
                // ถ้าหา Element ไม่เจอ ลองกดด้วย JS
                await page.evaluate(() => document.getElementById('btnexport').click());
            }
            
            console.log('   Waiting for file (Up to 180s)...');
            // รอ 3 นาทีต่อรอบ
            for (let i = 0; i < 180; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                // หาไฟล์ Excel
                if (files.some(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'))) {
                    return; // เจอแล้ว ออกเลย
                }
                // ถ้ามีไฟล์ .crdownload แปลว่ากำลังมา ให้รอต่อ
                if (files.some(f => f.endsWith('.crdownload'))) {
                    if (i % 10 === 0) console.log('      Downloading in progress...');
                }
            }
            throw new Error('File download timed out (180s)'); // เพื่อให้ Retry ทำงาน
        }, 3, 10000, "Export Step"); // Retry 3 ครั้ง พัก 10 วิ

        // ---------------------------------------------------------
        // Final Check & Email
        // ---------------------------------------------------------
        const finalFile = fs.readdirSync(downloadPath).find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
        
        if (!finalFile) throw new Error('❌ Final Check: No file found.');
        console.log(`✅ Success! File: ${finalFile}`);
        
        await new Promise(r => setTimeout(r, 5000));
        await browser.close();

        console.log('📧 Sending Email...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        await transporter.sendMail({
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString()}`,
            text: `ดาวน์โหลดสำเร็จ (Stable Fix)\nไฟล์: ${finalFile}`,
            attachments: [{ filename: finalFile, path: path.join(downloadPath, finalFile) }]
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
