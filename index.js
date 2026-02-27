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
    console.log('🚀 Starting Bot (Optimized & Fast-Fail Mode)...');

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
        
        // 💡 แก้ไข 1: ลด Global Timeout ลงเหลือ 60 วินาที 
        // ถ้าเว็บมีปัญหา หรือหา Element ไม่เจอ จะได้ Error ตัดจบใน 1 นาที ไม่ต้องรอ 5 นาที
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        await page.emulateTimezone('Asia/Bangkok');
        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });

        // ---------------------------------------------------------
        // Step 1: Login
        // ---------------------------------------------------------
        console.log('1️⃣ Step 1: Login...');
        await page.goto('https://gps.dtc.co.th/ultimate/index.php', { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('#txtname', { visible: true });
        await page.type('#txtname', DTC_USER);
        await page.type('#txtpass', DTC_PASS);
        
        console.log('   Clicking Login...');
        await Promise.all([
            page.evaluate(() => document.getElementById('btnLogin').click()),
            // รอจนกว่าช่องกรอกชื่อจะหายไป เป็นสัญญาณว่า Login ผ่าน
            page.waitForFunction(() => !document.querySelector('#txtname'))
        ]);
        console.log('✅ Login Success');

        // ---------------------------------------------------------
        // Step 2: Navigate to Report
        // ---------------------------------------------------------
        console.log('2️⃣ Step 2: Go to Report Page...');
        await page.goto('https://gps.dtc.co.th/ultimate/Report/Report_03.php', { waitUntil: 'domcontentloaded' });
        
        // ---------------------------------------------------------
        // Step 3: Fill Form
        // ---------------------------------------------------------
        console.log('3️⃣ Step 3: Fill Form...');
        
        await page.waitForSelector('#speed_max', { visible: true });
        await page.waitForSelector('#ddl_truck', { visible: true }); 
        
        // รอสักนิดเพื่อให้ Dropdown โหลดข้อมูลจาก Server มาให้ครบ
        await new Promise(r => setTimeout(r, 2000));

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
            
            document.getElementById('date9').dispatchEvent(new Event('change'));
            document.getElementById('date10').dispatchEvent(new Event('change'));

            document.getElementById('ddlMinute').value = '1';
            
            var selectElement = document.getElementById('ddl_truck'); 
            var options = selectElement.options; 
            for (var i = 0; i < options.length; i++) { 
                if (options[i].text.includes('ทั้งหมด')) { 
                    selectElement.value = options[i].value; 
                    break; 
                } 
            } 
            var event = new Event('change', { bubbles: true }); 
            selectElement.dispatchEvent(event);
        });

        // ---------------------------------------------------------
        // Step 4: Search
        // ---------------------------------------------------------
        console.log('4️⃣ Step 4: Search...');
        await page.evaluate(() => {
            if(typeof sertch_data === 'function') sertch_data();
            else document.querySelector("span[onclick='sertch_data();']").click();
        });

        // ---------------------------------------------------------
        // Step 5: Smart Wait (แทนที่ Hard Wait 5 นาที)
        // ---------------------------------------------------------
        console.log('⏳ Step 5: Waiting for Data Loading...');
        
        // รอให้ปุ่ม Export ปรากฏขึ้นมา (ให้เวลาหาปุ่มสูงสุด 2 นาที)
        await page.waitForSelector('#btnexport', { visible: true, timeout: 120000 });
        
        // 💡 แก้ไข 2: ใช้ Network Idle แทนการรอ 5 นาทีแบบตายตัว
        // รอจนกว่าการดึงข้อมูล (Network Requests) จะนิ่งสนิทเป็นเวลา 2 วินาที (ให้เวลาสูงสุด 2 นาที)
        try {
            await page.waitForNetworkIdle({ idleTime: 2000, timeout: 120000 });
        } catch (e) {
            console.log('⚠️ Network Idle timeout, assuming data is loaded and proceeding...');
        }
        
        // รอเผื่อการ Render หน้าจออีกเล็กน้อย (3 วินาที)
        await new Promise(r => setTimeout(r, 3000));
        console.log('✅ Data Loaded.');

        // ---------------------------------------------------------
        // Step 6: Export & Download
        // ---------------------------------------------------------
        console.log('6️⃣ Step 6: Exporting...');
        
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath });
        await page.evaluate(() => document.getElementById('btnexport').click());
        
        console.log('   Waiting for file...');
        let finalFile = null;

        // 💡 แก้ไข 3: ลดจำนวนรอบการรอไฟล์ลง หากมีปัญหาจะได้ตัดจบใน 2 นาที (120 รอบ)
        for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const files = fs.readdirSync(downloadPath);
            const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
            if (target) {
                finalFile = target;
                break;
            }
            if (i > 0 && i % 20 === 0) console.log(`   ...still waiting (${i}s)`);
        }

        if (!finalFile) {
            console.warn('⚠️ Retry clicking Export...');
            await page.evaluate(() => document.getElementById('btnexport').click());
            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const files = fs.readdirSync(downloadPath);
                const target = files.find(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.endsWith('.crdownload'));
                if (target) { finalFile = target; break; }
            }
        }

        if (!finalFile) throw new Error('❌ Download Timeout: File never arrived.');

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
            subject: `รายงาน DTC Report - ${new Date().toLocaleDateString()}`,
            text: `ถึง ผู้เกี่ยวข้อง\nไฟล์: ${finalFile}\nด้วยความนับถือ\n DTC BOT REPORT`,
            attachments: [{ filename: finalFile, path: path.join(downloadPath, finalFile) }]
        });

        console.log('🎉 Mission Complete!');

    } catch (error) {
        console.error('❌ FATAL ERROR:', error.message);
        if (page && !page.isClosed()) {
            try { 
                await page.screenshot({ path: path.join(downloadPath, 'fatal_error.png') }); 
                console.log('📸 Screenshot saved as fatal_error.png');
            } catch(e){}
        }
        if (browser) await browser.close();
        process.exit(1); // ส่งสัญญาณให้ GitHub Actions รู้ว่ารันล้มเหลว
    }
})();
