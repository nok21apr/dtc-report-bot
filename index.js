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

(async () => {
    console.log('🚀 Starting Bot (Force Login Mode)...');

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
                '--window-size=1920,1080',
                '--lang=th-TH,th'
            ]
        });

        page = await browser.newPage();
        page.setDefaultNavigationTimeout(180000); // 3 นาที
        page.setDefaultTimeout(180000);

        await page.emulateTimezone('Asia/Bangkok');

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadPath,
        });

        // ---------------------------------------------------------
        // Step 1: Open Page
        // ---------------------------------------------------------
        console.log('🌐 Step 1: Opening DTC Website...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        // รอให้เห็นช่อง User ชัวร์ๆ
        await page.waitForSelector('#txtname', { visible: true, timeout: 60000 });

        // ---------------------------------------------------------
        // Step 2: Login (Force Mode)
        // ---------------------------------------------------------
        console.log('🔐 Step 2: Attempting Login...');
        
        // พิมพ์รหัส (พิมพ์ช้าๆ ให้ชัวร์)
        await page.type('#txtname', DTC_USER, { delay: 100 });
        await page.type('#txtpass', DTC_PASS, { delay: 100 });

        // ถ่ายรูปก่อนกด เพื่อเช็คว่าพิมพ์ถูกไหม
        await page.screenshot({ path: path.join(downloadPath, 'debug_before_click.png') });

        console.log('👉 Clicking Login (JS Trigger)...');
        
        // 🔴 เทคนิคแก้: ใช้ JS กดปุ่มแทนการคลิกเมาส์ (ชัวร์กว่า 100%)
        await page.evaluate(() => {
            const loginBtn = document.getElementById('btnLogin');
            if(loginBtn) {
                loginBtn.click(); // กดแบบ JS
            } else {
                // ถ้าหา ID ไม่เจอ ลองหาจาก Form
                document.forms[0].submit(); // สั่งส่งฟอร์มดื้อๆ เลย
            }
        });

        console.log('⏳ Waiting for redirection...');
        
        // 🔴 เทคนิคแก้: ไม่รอ Navigation แต่รอให้ "ช่อง User หายไป"
        try {
            await page.waitForFunction(() => !document.querySelector('#txtname'), { timeout: 20000 });
            console.log('✅ Login Success: Login form disappeared.');
        } catch (e) {
            console.log('⚠️ Login might be stuck. Checking URL...');
            // ถ้า timeout ลองเช็ค URL ว่าเปลี่ยนไหม
            if (page.url().includes('index.php')) {
                console.error('❌ Login Failed: Still on login page.');
                await page.screenshot({ path: path.join(downloadPath, 'error_login_stuck.png') });
                
                // ลองกดซ้ำอีกที (Last Resort)
                console.log('🔄 Retrying click...');
                await page.click('#btnLogin');
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        // รอแถม 5 วินาที
        await new Promise(r => setTimeout(r, 5000));

        // ---------------------------------------------------------
        // Step 3: Force Navigate to Report
        // ---------------------------------------------------------
        console.log('📄 Step 3: Going to Report Page...');
        // ไม่สนว่า Login ผ่านไหม สั่งกระโดดไปหน้ารายงานเลย ถ้า Login ติด session จะทำงานเอง
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });

        // เช็คว่าเด้งกลับมาหน้า Login ไหม
        const isLoginPage = await page.$('#txtname');
        if (isLoginPage) {
            // ถ้ายังเจอช่อง User แปลว่า Login ไม่เข้าจริงๆ
            await page.screenshot({ path: path.join(downloadPath, 'fatal_login_failed.png') });
            throw new Error('❌ FATAL: Cannot bypass login page. Please check Username/Password.');
        }

        // ---------------------------------------------------------
        // Step 4: Fill Form & Export
        // ---------------------------------------------------------
        console.log('📝 Step 4: Fill & Export');
        
        await page.waitForSelector('#speed_max', { visible: true, timeout: 60000 });
        
        // Direct Inject Value
        await page.evaluate(() => {
            document.getElementById('speed_max').value = '55';
            
            // Date Logic
            var d = new Date(); d.setDate(1); d.setDate(d.getDate() - 2); 
            var y = d.getFullYear(); var m = d.getMonth() + 1; var day = d.getDate(); 
            var start = y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day + ' 00:00';

            var d2 = new Date(); var y2 = d2.getFullYear(); var m2 = d2.getMonth() + 1; 
            var last = new Date(y2, m2, 0).getDate(); 
            var end = y2 + '-' + (m2 < 10 ? '0' : '') + m2 + '-' + (last < 10 ? '0' : '') + last + ' 23:59';

            document.getElementById('date9').value = start;
            document.getElementById('date10').value = end;
            
            // Trigger Change
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));

            document.getElementById('ddlMinute').value = '1';
            
            // Truck Select
            const sel = document.getElementById('ddl_truck');
            for(let o of sel.options) {
                if(o.text.includes('ทั้งหมด')) { 
                    sel.value = o.value; 
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    break; 
                }
            }
        });

        // Search
        console.log('🔍 Clicking Search...');
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else document.querySelector("span[onclick='sertch_data();']").click();
        });

        // Wait Export
        console.log('⏳ Waiting for Export button...');
        await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });

        // Export
        console.log('⬇️ Clicking Export...');
        await page.click('#btnexport');

        // Download Check
        console.log('⏳ Downloading...');
        let foundFile;
        for(let i=0; i<180; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const f = fs.readdirSync(downloadPath).find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
            if(f) { foundFile = f; break; }
        }

        if(!foundFile) throw new Error('Download Timeout');
        
        console.log(`✅ File: ${foundFile}`);
        await browser.close();

        // Send Email
        console.log('📧 Sending Email...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS }
        });

        await transporter.sendMail({
            from: `"DTC Bot" <${EMAIL_USER}>`,
            to: EMAIL_TO,
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString()}`,
            text: `ระบบ Login สำเร็จและดึงรายงานแล้วครับ`,
            attachments: [{ filename: foundFile, path: path.join(downloadPath, foundFile) }]
        });

        console.log('🎉 Done!');

    } catch (error) {
        console.error('❌ FATAL ERROR:', error);
        if (page && !page.isClosed()) {
            try { await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') }); } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1);
    }
})();
