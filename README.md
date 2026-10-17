# Stremio to Trakt Migrator

Μεταφορά της βιβλιοθήκης σου από το **Stremio** στο **Trakt.tv**, απευθείας από τον browser.
*Move your Stremio library to Trakt.tv, right from your browser (Greek & English UI).*

**▶ Live:** https://petrosfs.github.io/Stremio-to-Trakt-Migrator/

## Δυνατότητες

- **Σύνδεση με τον λογαριασμό Stremio:** η βιβλιοθήκη φορτώνεται μόνη της, με email/κωδικό ή χωρίς κωδικό μέσω link.stremio.com. Εναλλακτικά: ανέβασμα αρχείου JSON ή της σελίδας βιβλιοθήκης του Stremio Web (.html).
- **Επεισόδια που έχεις δει:** αποκωδικοποιεί το πεδίο `state.watched` του Stremio και στέλνει στο History κάθε επεισόδιο ξεχωριστά. Τη λίστα επεισοδίων τη δίνει το Cinemeta.
- **Σωστές κατηγορίες:**
  - **Watchlist:** όσα είναι στη βιβλιοθήκη και δεν τα έχεις δει.
  - **History:** ταινίες και επεισόδια που έχεις δει.
  - **Προς Θέαση:** ό,τι έχεις ξεκινήσει, μαζί με το τρέχον επεισόδιο.

  Τα αφαιρεμένα από τη βιβλιοθήκη κρατάνε μόνο το ιστορικό τους.
- **Χωρίς διπλές προβολές:** πριν την αποστολή διαβάζει τι υπάρχει ήδη στο Trakt και το παραλείπει. Προεπισκόπηση «τι θα σταλεί».
- **Προορισμοί:** κάθε κατηγορία πάει όπου διαλέξεις: Watchlist, History, δική σου λίστα ή πουθενά.
- **Επιλογή & αναζήτηση:** μπορείς να κρατήσεις ή να εξαιρέσεις στοιχεία ένα-ένα, να διορθώσεις ημερομηνίες θέασης και να δεις εξώφυλλα.
- **Αναίρεση:** αφαιρεί από το Trakt ό,τι πρόσθεσε η τελευταία μεταφορά.
- **Εξαγωγή:** CSV ή ZIP (JSON + CSV).
- **Ελληνικά / English, PWA** (εγκατάσταση στο κινητό).

Όλα τρέχουν στον browser σου. Δεν υπάρχει server: τα δεδομένα στέλνονται μόνο στο Stremio, στο Cinemeta και στο Trakt.

## Κλειδιά Trakt

Η σύνδεση γίνεται με δική σου εφαρμογή στο Trakt:

1. Άνοιξε το https://trakt.tv/oauth/applications/new
2. **Name:** ό,τι θέλεις
3. **Redirect URI:** `urn:ietf:wg:oauth:2.0:oob`
4. **Javascript (CORS) origins:** η διεύθυνση του site, π.χ. `https://petrosfs.github.io`
5. Αποθήκευσε και βάλε το **Client ID** και το **Client Secret** στις ρυθμίσεις (εικονίδιο κλειδιού).

Τα κλειδιά μένουν αποθηκευμένα μόνο σε αυτόν τον browser.

## Ανάπτυξη

Χρειάζεται Node.js 20 ή νεότερο.

```bash
npm install
npm run dev        # τοπικός server
npm test           # unit tests (Vitest)
npm run build
npm run test:e2e   # end-to-end tests (Playwright, με mock APIs)
```

Για τα e2e tests χρειάζεται πρώτα `npx playwright install chromium`.

Κάθε push στο `main` τρέχει όλα τα tests και, αν περάσουν, δημοσιεύει στο GitHub Pages.

## Τεχνολογίες

React 19 · TypeScript · Vite · Tailwind CSS · fflate · Vitest · Playwright · Trakt API v2 · Stremio API · Cinemeta
