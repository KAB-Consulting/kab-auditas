// AVNIS administratorių užimtumo statistikos rinkiklis (GitHub Actions robotas).
// Prisijungia prie AVNIS, per mygtuką „Administratorių statistika" (/app/selections) SSO
// būdu atidaro atranka.avnt.lt statistiką, pasirenka datą, atsisiunčia „Excel" eksportą,
// jį išnagrinėja ir įkelia į Supabase (avnis-stats-import).
//
// Aplinkos kintamieji (iš GitHub Secrets):
//   AVNIS_USERNAME, AVNIS_PASSWORD, AVNIS_STATS_KEY
//   STAT_DATE (nebūtinas) - YYYY-MM-DD; tuščias = vakar diena (Europe/Vilnius)

import { chromium } from 'playwright';
import fs from 'node:fs';

const USER = process.env.AVNIS_USERNAME;
const PASS = process.env.AVNIS_PASSWORD;
const IMPORT_KEY = process.env.AVNIS_STATS_KEY;

const LOGIN_URL = 'https://avnis.avnt.lt/account/login';
const SELECTIONS_URL = 'https://avnis.avnt.lt/app/selections';
const IMPORT_URL = 'https://pezhnbcsifxnrswsdhui.supabase.co/functions/v1/avnis-stats-import';

const SEL = {
  user: 'input[name="userNameOrEmailAddress"]',
  pass: 'input[name="password"]',
  loginBtn: '#LoginButton',
  statsBtn: 'Administratorių statistika', // mygtuko tekstas /app/selections puslapyje
  date: '#RadDatePickerData_dateInput',
  searchBtn: '#RadButton_Search_input',
  excelBtn: '#RadButton_xmlx_input',
};

function ymdVilnius(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Telerik „Excel" eksportas yra HTML lentelė (.xls). Ištraukiam eilutes su „N-" numeriais.
function parseStats(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c; const cells = [];
    while ((c = cellRe.exec(m[1]))) {
      cells.push(
        c[1].replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&ndash;/g, '-')
          .replace(/\s+/g, ' ').trim()
      );
    }
    if (cells.length >= 6 && /^N-/.test(cells[0])) {
      rows.push([cells[0], cells[1], cells[2], cells[3], cells[4], cells[5]]);
    }
  }
  return rows;
}

async function dump(page, tag) {
  try { await page.screenshot({ path: `error-${tag}.png`, fullPage: true }); } catch { /* ignore */ }
  try { fs.writeFileSync(`error-${tag}.html`, await page.content()); } catch { /* ignore */ }
}

async function main() {
  if (!USER || !PASS || !IMPORT_KEY) {
    throw new Error('Trūksta secrets: AVNIS_USERNAME / AVNIS_PASSWORD / AVNIS_STATS_KEY.');
  }
  const statDate = (process.env.STAT_DATE || '').trim() || ymdVilnius(-1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statDate)) throw new Error('Bloga STAT_DATE reikšmė: ' + statDate);
  console.log('Statistikos data:', statDate);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'lt-LT', viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);

  try {
    // 1) Prisijungimas prie AVNIS
    console.log('Jungiamasi prie AVNIS…');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(SEL.user, { timeout: 30000 });
    await page.fill(SEL.user, USER);
    await page.fill(SEL.pass, PASS);
    await page.click(SEL.loginBtn);
    await page.waitForTimeout(4000);
    await page.waitForLoadState('networkidle').catch(() => {});
    if (/\/account\/login/.test(page.url())) {
      await page.waitForTimeout(3000);
      if (/\/account\/login/.test(page.url())) {
        await dump(page, 'login');
        throw new Error('Nepavyko prisijungti prie AVNIS (likome prisijungimo puslapyje). Patikrinkite AVNIS_USERNAME / AVNIS_PASSWORD.');
      }
    }
    console.log('AVNIS prisijungimas OK. URL:', page.url());

    // 2) Iš AVNIS SSO būdu atidaryti atranką („Administratorių statistika" mygtukas)
    console.log('Atidaromas atrankos statistikos langas iš AVNIS…');
    await page.goto(SELECTIONS_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    const statBtn = page.getByRole('button', { name: SEL.statsBtn });
    await statBtn.waitFor({ timeout: 30000 });

    // Mygtukas atidaro atranką naujame lange (SSO perdavimas). Pagaunam tą langą.
    let work = null;
    try {
      const [popup] = await Promise.all([
        ctx.waitForEvent('page', { timeout: 20000 }),
        statBtn.click(),
      ]);
      work = popup;
      console.log('Atsidarė naujas langas.');
    } catch {
      work = page; // atsarginis variantas: atsidarė tame pačiame lange
      console.log('Naujas langas neatsidarė – dirbame tame pačiame.');
    }
    work.setDefaultTimeout(45000);
    await work.bringToFront().catch(() => {});
    await work.waitForLoadState('domcontentloaded').catch(() => {});

    // Atranka gali atlikti kelis SSO peradresavimus – palaukiam datos lauko
    try {
      await work.waitForSelector(SEL.date, { timeout: 45000 });
    } catch {
      await dump(work, 'atranka');
      console.error('Atranka lango URL:', work.url());
      throw new Error('Atranka statistika neatsidarė (nerastas datos laukas). Lango URL: ' + work.url());
    }
    console.log('Atranka atidaryta:', work.url());

    // 3) Datos parinkimas – reikia realių klavišų, kad Telerik RadDatePicker priimtų
    console.log('Nustatoma data ir ieškoma…');
    await work.click(SEL.date);
    await work.keyboard.press('Control+A');
    await work.keyboard.type(statDate, { delay: 40 });
    await work.keyboard.press('Enter');
    await work.click(SEL.searchBtn);
    await work.waitForTimeout(3000);
    await work.waitForLoadState('networkidle').catch(() => {});

    // 4) „Excel" eksporto atsisiuntimas
    console.log('Atsisiunčiamas Excel eksportas…');
    const [download] = await Promise.all([
      work.waitForEvent('download', { timeout: 60000 }),
      work.click(SEL.excelBtn),
    ]);
    const filePath = await download.path();
    const text = fs.readFileSync(filePath).toString('utf8');

    // 5) Nagrinėjimas
    const rows = parseStats(text);
    console.log('Rasta įrašų:', rows.length, rows.length ? `(${rows[0][0]} … ${rows[rows.length - 1][0]})` : '');
    if (!rows.length) {
      fs.writeFileSync('error-export.html', text.slice(0, 200000));
      throw new Error('Eksporto faile nerasta „N-" įrašų. Patikrinkite error-export.html artefaktą.');
    }

    // 6) Įkėlimas į Supabase
    console.log('Įkeliama į sistemą…');
    const res = await fetch(IMPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-key': IMPORT_KEY },
      body: JSON.stringify({ stat_date: statDate, rows }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error('Įkėlimas nepavyko (HTTP ' + res.status + '): ' + JSON.stringify(d));
    }
    console.log(`✓ Įkelta ${d.imported} įrašų datai ${d.stat_date}.`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('KLAIDA:', e.message);
  process.exit(1);
});
