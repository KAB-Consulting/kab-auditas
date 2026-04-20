# KAB Auditas — Klausimynų sistema

KAB Consulting klientų klausimynų sistema — pasirengimo nemokumo procesui ir įmonių dokumentų auditavimo konsultacijoms.

## Struktūra

- `index.html` — Kliento matomas klausimynas (nuoroda: `?t=ACCESS_TOKEN`)
- `admin.html` — Admin panelė (tik KAB Consulting darbuotojams)

## Technologijos

- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Backend:** Supabase (Database + Storage + Edge Functions)
- **Email:** Resend API
- **Hosting:** GitHub Pages

## Apie duomenis

- Kliento dokumentai saugomi Supabase Storage (Frankfurt, ES) ne ilgiau 90 dienų
- Po peržiūros dokumentai perkeliami į KAB Consulting Microsoft 365 aplinką
- Visos Supabase prieigos apsaugotos Row Level Security politikomis

## Kontaktai

KAB Consulting
Klaipėda, Lietuva
📧 klausk@kab.lt

## Licenzija

Privatus projektas — skirtas tik KAB Consulting naudojimui.
