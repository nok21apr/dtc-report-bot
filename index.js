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

// ฟังก์ชัน Retry (หัวใจสำคัญของความเสถียร)
async function retryOperation(operation, maxRetries, delay, opName) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            console.log(`🔄 Attempt ${i + 1}/${maxRetries}: ${opName}`);
            return await operation();
        } catch (error) {
            console.warn(`⚠️ ${opName} failed: ${error.message}`);
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
    console.log('🚀 Starting Bot (Ultimate Resilience Mode)...');

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
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        // เพิ่ม Timeout เป็น 30 นาที (เผื่อ Retry หลายรอบ)
        page.setDefaultNavigationTimeout(1800000);
        page.setDefaultTimeout(1800000);

        await page.emulateTimezone('Asia/Bangkok');
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // ---------------------------------------------------------
        // Step 1: Login with Smart Retry
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('🌐 Loading Login Page...');
            // ลองเข้าเว็บ (ถ้าครั้งแรกพัง จะ Retry)
            await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // รอให้ช่อง User มาจริงๆ
            await page.waitForSelector('#txtname', { visible: true, timeout: 30000 });
            
            console.log('🔐 Filling Credentials...');
            await page.evaluate(() => {
                document.querySelector('#txtname').value = '';
                document.querySelector('#txtpass').value = '';
            });
            await page.type('#txtname', DTC_USER);
            await page.type('#txtpass', DTC_PASS);
            
            console.log('👉 Clicking Login...');
            await Promise.all([
                // รอหน้าเปลี่ยน หรือ รอให้ปุ่ม Login หายไป
                page.evaluate(() => document.getElementById('btnLogin').click()),
                page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 30000 })
            ]);
            console.log('✅ Login Success');
        }, 3, 10000, "Login Step"); // ลอง 3 ครั้ง พัก 10 วิ

        // ---------------------------------------------------------
        // Step 2-4: Navigate & Fill Form
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('📄 Navigating to Report...');
            await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
            
            await page.waitForSelector('#speed_max', { visible: true, timeout: 30000 });
            
            console.log('📝 Filling Form...');
            await page.evaluate(() => {
                document.getElementById('speed_max').value = '55';
                
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
            await page.evaluate(() => {
                if(typeof sertch_data === 'function') sertch_data();
                else document.querySelector("span[onclick='sertch_data();']").click();
            });
        }, 3, 5000, "Navigate & Fill Form");

        // ---------------------------------------------------------
        // Step 5: Wait Data (120s)
        // ---------------------------------------------------------
        console.log('⏳ Waiting 120s for Data (Mandatory)...');
        await page.waitForSelector('#btnexport', { visible: true, timeout: 300000 });
        await new Promise(r => setTimeout(r, 120000));
        console.log('✅ Data Ready.');

        // ---------------------------------------------------------
        // Step 6: Export (Retry Logic)
        // ---------------------------------------------------------
        await retryOperation(async () => {
            console.log('⬇️ Exporting...');
            
            // ย้ำสิทธิ์อีกรอบ
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

            await page.evaluate(() => document.getElementById('btnexport').click());
            
            console.log('   Waiting for file...');
            // รอ 3 นาทีต่อรอบการกด
            for (let i = 0; i < 180; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                if (files.some(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'))) {
                    return; // เจอไฟล์แล้ว จบฟังก์ชัน Retry เลย
                }
            }
            throw new Error('File not received in 180s'); // โยน Error เพื่อให้ Retry Loop ทำงาน (กดใหม่)
        }, 3, 5000, "Export Step");

        // ---------------------------------------------------------
        // Final Check & Email
        // ---------------------------------------------------------
        const finalFile = fs.readdirSync(downloadPath).find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
        
        if (!finalFile) throw new Error('❌ Final Check: No file found.');
        console.log(`✅ Success! File: ${finalFile}`);
        
        await new Promise(r => setTimeout(r, 5000)); // รอเขียนไฟล์จบ
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
            text: `ดาวน์โหลดสำเร็จ (Resilience Mode)\nไฟล์: ${finalFile}`,
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
