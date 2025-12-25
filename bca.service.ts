import puppeteer, { Browser, Page } from 'puppeteer';

export class BCAService {
    private browser: Browser | null = null;
    private page: Page | null = null;

    private async init() {
        this.browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--lang=id-ID,id',
                '--single-process'
            ]
        });
        this.page = await this.browser.newPage();

        // PAKSA HEADER BAHASA INDONESIA
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        });
        await this.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');
        await this.page.setViewport({ width: 375, height: 667 });
    }

    async login(username: string, password: string) {
        if (!this.page) return;

        // 1. WAJIB: Pasang handler popup SEBELUM navigasi
        // Ini untuk otomatis klik "OK" jika muncul alert "Silakan mengisi PIN"
        this.page.on('dialog', async dialog => {
            console.log('Menutup Popup Otomatis:', dialog.message());
            await dialog.accept();
        });

        try {
            await this.page.goto('https://m.klikbca.com/login.jsp', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // 2. Tunggu sebentar agar script internal KlikBCA (jsencrypt dll) dimuat
            await new Promise(res => setTimeout(res, 2000));

            // 3. Gunakan Evaluate untuk Input (Lebih Kuat dari page.type)
            // Cara ini tetap bisa mengisi kolom meskipun ada popup yang menghalangi
            await this.page.evaluate((user, pin) => {
                const userField = document.querySelector('#txt_user_id') as HTMLInputElement;
                const pinField = document.querySelector('#txt_pswd') as HTMLInputElement;

                if (userField) userField.value = user.toUpperCase();
                if (pinField) pinField.value = pin;
            }, username, password);

            console.log("Input UserID dan PIN berhasil disuntikkan.");

            // 4. Pastikan kolom terisi (Pengecekan Internal)
            const isFilled = await this.page.evaluate(() => {
                const pin = document.querySelector('#txt_pswd') as HTMLInputElement;
                return pin && pin.value.length > 0;
            });

            if (!isFilled) throw new Error("Gagal mengisi PIN ke dalam form.");

            // 5. Klik Login menggunakan evaluate (Menghindari error "not clickable")
            await Promise.all([
                this.page.evaluate(() => {
                    const btn = document.querySelector('input[name="value(Submit)"]') as HTMLButtonElement;
                    if (btn) btn.click();
                }),
                this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => { })
            ]);

            // 6. Cek apakah berhasil masuk atau ada error di halaman
            const content = await this.page.content();

            // Simpan screenshot untuk cek status terakhir di WSL
            await this.page.screenshot({ path: './screenshot/login_status.png' });

            if (content.includes('USER ID atau PASSWORD Anda salah')) {
                throw new Error("Kredensial Salah (Cek kembali UserID dan Password Alfanumerik Anda)");
            }

            if (!content.includes('MENU UTAMA')) {
                throw new Error("Gagal Login. Silakan cek file login_status.png untuk melihat apa yang terjadi.");
            }

            console.log("Login Berhasil!");

        } catch (err: any) {
            // Jika error, ambil screenshot terakhir sebelum browser tertutup
            if (this.page) await this.page.screenshot({ path: './screenshot/error_debug.png' });
            throw new Error(err.message);
        }
    }

    async getBalance(username: string, password: string) {
        await this.init();
        try {
            await this.login(username, password);
            if (!this.page) return;

            // 1. Navigasi ke Informasi Rekening
            await this.page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const target = links.find(a => a.innerText.includes('Informasi Rekening'));
                if (target) (target as HTMLElement).click();
            });
            await new Promise(res => setTimeout(res, 1000));

            // 2. Navigasi ke Informasi Saldo
            await this.page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const target = links.find(a => a.innerText.includes('Informasi Saldo'));
                if (target) (target as HTMLElement).click();
            });

            // 3. Tunggu Tabel
            await this.page.waitForSelector('table', { timeout: 10000 });

            // 4. Scrape data menggunakan Teks Seluruh Halaman (Lebih Akurat untuk kasus Anda)
            const result = await this.page.evaluate(() => {
                const fullText = document.body.innerText;

                // Regex untuk nomor rekening (10 digit)
                const rekMatch = fullText.match(/(\d{10})/);

                // Regex untuk saldo setelah kata IDR
                // Mencari pola: IDR [spasi] angka_dengan_koma_atau_titik
                const saldoMatch = fullText.match(/IDR\s+([\d,.]+)/);

                return {
                    rekening: rekMatch ? rekMatch[1] : 'Tidak Ditemukan',
                    saldoRaw: saldoMatch ? saldoMatch[1] : '0'
                };
            });

            if (!result || result.rekening === 'Tidak Ditemukan') {
                throw new Error("Gagal mengekstrak data dari halaman saldo.");
            }

            // 5. Logout
            await this.page.goto('https://m.klikbca.com/authentication.do?value(actions)=logout').catch(() => { });

            // --- LOGIKA PEMBERSIHAN ANGKA ---
            // BCA Mobile menggunakan format: 3,193.29 (Koma ribuan, Titik desimal)
            const cleanSaldo = result.saldoRaw
                .replace(/,/g, ''); // Hapus koma saja (karena titik adalah desimal)

            return {
                rekening: result.rekening,
                saldo: parseFloat(cleanSaldo)
            };

        } catch (err: any) {
            if (this.page) await this.page.screenshot({ path: './screenshot/error_balance.png' });
            throw new Error(err.message);
        } finally {
            if (this.browser) await this.browser.close();
        }
    }

    async getHistory(username: string, password: string) {
        await this.init();
        try {
            await this.login(username, password);
            if (!this.page) return;

            // 1. Navigasi ke Informasi Rekening
            await this.page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a')) as any[];
                const target = links.find(a => a.innerText.includes('Informasi Rekening'));
                if (target) target.click();
            });
            await new Promise(res => setTimeout(res, 1000));

            // 2. Navigasi ke Mutasi Rekening
            await this.page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a')) as any[];
                const target = links.find(a => a.innerText.includes('Mutasi Rekening'));
                if (target) target.click();
            });

            // 3. Form Input Tanggal & Klik Submit
            await this.page.waitForSelector('input.esub');
            await Promise.all([
                this.page.click('input.esub'),
                this.page.waitForNavigation({ waitUntil: 'networkidle2' })
            ]);

            // 4. Scrape Data Mutasi (Parser Sesuai HTML Baru)
            const result = await this.page.evaluate(() => {
                const transactions: any[] = [];
                const summary: any = {};

                // Ambil semua baris tabel
                const rows = Array.from(document.querySelectorAll('tr'));

                for (const row of rows) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const rowText = (row as HTMLElement).innerText || '';

                    // --- PARSING TRANSAKSI ---
                    // Mencari baris yang memiliki 3 kolom dan kolom terakhir berisi CR atau DB
                    if (cells.length === 3) {
                        const type = cells[2].textContent?.trim() || ''; // Kolom 3: CR / DB

                        if (type === 'CR' || type === 'DB') {
                            const tgl = cells[0].textContent?.trim() || ''; // Kolom 1: Tanggal
                            const ketRaw = cells[1].innerText.trim();       // Kolom 2: Keterangan

                            // Ambil nominal dari baris terakhir di kolom keterangan
                            const lines = ketRaw.split('\n');
                            const amountLine = lines[lines.length - 1];
                            const nominal = parseFloat(amountLine.replace(/,/g, ''));

                            transactions.push({
                                tanggal: tgl,
                                keterangan: lines.slice(0, -1).join(' ').trim(), // Gabungkan baris keterangan saja
                                nominal: nominal,
                                tipe: type
                            });
                        }
                    }

                    // --- PARSING RINGKASAN (SALDO AKHIR) ---
                    if (rowText.includes('SALDO AWAL')) summary.saldoAwal = rowText.split(':').pop()?.trim();
                    if (rowText.includes('SALDO AKHIR')) summary.saldoAkhir = rowText.split(':').pop()?.trim();
                    if (rowText.includes('MUTASI KREDIT')) summary.totalKredit = rowText.split(':').pop()?.trim();
                    if (rowText.includes('MUTASI DEBET')) summary.totalDebet = rowText.split(':').pop()?.trim();
                }

                return { transactions, summary };
            });

            // 5. Logout
            await this.page.goto('https://m.klikbca.com/authentication.do?value(actions)=logout').catch(() => { });

            // Kembalikan hasil yang sudah dibersihkan
            return {
                status: true,
                data: result.transactions,
                summary: {
                    saldo_awal: parseFloat(result.summary.saldoAwal?.replace(/,/g, '') || '0'),
                    saldo_akhir: parseFloat(result.summary.saldoAkhir?.replace(/,/g, '') || '0'),
                    total_kredit: parseFloat(result.summary.totalKredit?.replace(/,/g, '') || '0'),
                    total_debet: parseFloat(result.summary.totalDebet?.replace(/,/g, '') || '0'),
                }
            };

        } catch (err: any) {
            if (this.page) await this.page.screenshot({ path: './screenshot/error_mutasi.png' });
            throw new Error(err.message);
        } finally {
            if (this.browser) await this.browser.close();
        }
    }
}