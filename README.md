# 🎲 Játékgyűjtemény

Ingyenes, GitHub Pages-en hosztolt játékgyűjtemény. A főoldalon ikonok
formájában találod a játékokat, rájuk kattintva egy aloldalon nyílik meg az
adott játék. Jelenleg három játék van benne: egy **multiplayer Colorcards**
(UNO-szerű kártyajáték), egy **Hajócsata**, és egy **Holland kocsma**
(klasszikus lerakós kártyajáték) – mindegyikben kb. minden házi szabály be-
és kikapcsolható, és a weboldal a telefon kezdőképernyőjéről elindítva
appként viselkedik (lásd az "App mód" szakaszt).

---

## Hogyan működik ez ingyenesen, szerver nélkül?

A GitHub Pages csak **statikus fájlokat** (HTML/CSS/JS) tud kiszolgálni –
nincs saját szerver, adatbázis. Egy valós idejű multiplayer játékhoz viszont
kell valami, ami **összeköti a telefonokat**.

Erre a **Firebase Firestore** ingyenes csomagját (Spark plan) használjuk:
- minden játékos böngészője feliratkozik egy "szoba" dokumentumra,
- amikor valaki lép (lerak egy lapot, húz, stb.), a böngészője módosítja ezt
  a dokumentumot,
- a Firestore valós időben (másodtörtrész alatt) elküldi a frissítést
  mindenki másnak.

Ez teljesen elég egy körökre osztott játékhoz, mint az UNO, és a Firebase
ingyenes kerete (napi ~50 000 olvasás/írás) bőven elég baráti/családi
használatra.

**Korlát, amit érdemes tudni:** nincs bejelentkezés és nincs "szerver oldali
játékvezető" – minden ellenőrzés a kliensek (a játékosok böngészői) oldalán
fut. Ez baráti társaságban semmilyen gondot nem jelent, de azt jelenti, hogy
egy technikailag hozzáértő, szándékosan csaló játékos elméletileg
manipulálhatná a saját böngészőjéből küldött üzeneteket. Ha ez fontos
szempont (pl. versenyjáték idegenekkel), egy ilyen "ingyenes statikus oldal"
megoldás nem alkalmas – ahhoz egy valódi backend (pl. Cloud Functions) kellene.

---

## Fájlstruktúra

```
game-hub/
├── index.html              ← főoldal, játék ikonok
├── style.css                ← főoldal stílus
├── manifest.json              ← PWA manifest ("App mód" – lásd lent)
├── icons/                      ← App-ikonok (helyőrzők, lásd "App mód")
│   ├── icon-192.png
│   └── icon-512.png
├── firestore.rules           ← Firestore biztonsági szabályok (lásd lent)
├── test-engine.mjs            ← fejlesztői tesztek a Colorcards motorhoz (opcionális)
├── test-hollandkocsma-engine.mjs ← fejlesztői tesztek a Holland kocsma motorhoz (opcionális)
├── README.md                 ← ez a fájl
└── games/
    ├── uno/                    ← ez a mappa a "Colorcards" játék (a régi UNO elnevezés maradványa)
    │   ├── index.html         ← Colorcards képernyők (lobbi, játéktábla, stb.)
    │   ├── style.css           ← Colorcards stílus
    │   ├── firebase-config.js  ← IDE KELL BEÍRNOD a saját Firebase configodat
    │   ├── game-engine.js      ← a teljes Colorcards szabálykönyv (tiszta logika)
    │   └── main.js             ← UI + Firebase összekötés
    ├── battleships/
    │   └── index.html          ← Hajócsata (önálló fájlban, saját motorral)
    └── hollandkocsma/
        ├── index.html         ← Holland kocsma képernyők (lobbi, felkészülés, játéktábla, stb.)
        ├── style.css           ← Holland kocsma stílus
        ├── firebase-config.js  ← IDE IS be kell írnod a saját Firebase configodat
        ├── game-engine.js      ← a teljes Holland kocsma szabálykönyv (tiszta logika)
        └── main.js             ← UI + Firebase összekötés
```

---

## 1. lépés – GitHub repó és GitHub Pages

1. Hozz létre egy ingyenes GitHub fiókot, ha még nincs: https://github.com/join
2. Kattints a jobb felső **+** ikonra → **New repository**.
   - Név: pl. `jatekgyujtemeny` (bármi lehet)
   - Állítsd **Public**-ra (a GitHub Pages ingyenes csomagja ezt kéri)
   - Ne tegyél bele README-t (mi már hoztunk egyet)
3. Töltsd fel ezt a teljes `game-hub` mappa tartalmát a repóba:
   - Legegyszerűbb: a repó "Add file" → **Upload files** gombjával húzd be az
     összes fájlt és mappát (a mappastruktúrát a böngésző megtartja, ha az
     egész `games` mappát egyben húzod be).
   - Ha ismered a `git`-et: `git init`, `git add .`, `git commit -m "init"`,
     `git remote add origin <repó URL>`, `git push -u origin main`.
4. A repóban: **Settings → Pages**.
   - "Build and deployment" → Source: **Deploy from a branch**
   - Branch: `main` (vagy `master`), mappa: `/ (root)` → **Save**
5. Pár perc múlva az oldal elérhető lesz itt:
   `https://<felhasznalonev>.github.io/<repo-nev>/`

---

## 2. lépés – Firebase projekt és Firestore

1. Nyisd meg: https://console.firebase.google.com
2. **Add project** → adj neki egy nevet (pl. `jatekgyujtemeny`) →
   a Google Analytics kérdésnél választhatod a "nem" opciót → **Create**.
3. A projekt áttekintő oldalon kattints a **`</>` (Web)** ikonra egy új
   webalkalmazás regisztrálásához. Adj neki egy nevet (pl. "uno"), nem kell
   Firebase Hosting.
4. Megjelenik egy `firebaseConfig` objektum kulcsokkal (`apiKey`,
   `authDomain`, `projectId`, stb.) – **ezt másold ki**, a következő lépésben
   kell.
5. A bal oldali menüben: **Build → Firestore Database → Create database**.
   - Válassz egy hozzád közeli régiót (pl. `eur3 (europe-west)`).
   - Indulhat **production mode**-ban – a szabályokat a következő lépésben
     mi magunk állítjuk be.
6. A Firestore **Rules** fülön cseréld ki a tartalmat a repóban található
   `firestore.rules` fájl tartalmára, majd **Publish**.

---

## 3. lépés – Config beillesztése a kódba

Nyisd meg a `games/uno/firebase-config.js` **és** a
`games/hollandkocsma/firebase-config.js` fájlt, és írd át bennük a
placeholder értékeket a 2. lépésben kapott `firebaseConfig` objektum valódi
értékeire (mindkét fájlban ugyanaz az érték kerül – a két játék ugyanazt a
Firebase projektet használja, csak külön Firestore kollekciót):

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "jatekgyujtemeny-xxxx.firebaseapp.com",
  projectId: "jatekgyujtemeny-xxxx",
  storageBucket: "jatekgyujtemeny-xxxx.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890",
};
```

Mentsd el, töltsd fel (commitold) a GitHub repóba. Ennyi – nincs build
lépés, nincs `npm install`, a böngésző közvetlenül a Firebase CDN-ről tölti
be a szükséges JS modulokat.

> Ezek az értékek **nem titkos kulcsok** – nyugodtan kerülhetnek nyilvános
> repóba. A védelmet a Firestore Rules adja, nem ez a fájl.

---

## 4. lépés – Tesztelés

1. Nyisd meg a GitHub Pages linket telefonon (vagy több böngészőablakban).
2. Az első eszközön: adj meg egy nevet → **Új szoba létrehozása**. Megkapod a
   4 karakteres szobakódot.
3. A többi eszközön: ugyanaz a név mező + **Csatlakozás kóddal** → írd be a
   kódot (vagy a "Megosztás / másolás" gombbal küldött linket nyisd meg –
   abban a kód előre kitöltődik).
4. Amikor mindenki csatlakozott, bárki elindíthatja a játékot a lobbiban.

> **Egyedül tesztelnél?** Mindkét kártyajáték (Colorcards, Holland kocsma)
> rejt egy fejlesztői "bot módot": kattints 10×-et gyorsan a kezdőképernyő
> címére, megjelenik egy 🛠️ gomb jobb alul – ezzel buta botokat adhatsz a
> lobbihoz, akik maguktól lépnek. (A Colorcards game-engine.js-t a
> `node test-engine.mjs`, a Holland kocsmáét a
> `node test-hollandkocsma-engine.mjs` paranccsal tesztelheted Node.js-szel,
> a böngészőtől függetlenül.)

---

## App mód (kezdőképernyőről indítva, böngészősáv nélkül)

A `manifest.json` + a játékoldalak `<head>`-jébe tett meta tag-ek miatt, ha
valaki a telefonján **"Hozzáadás a kezdőképernyőhöz"** (Android Chrome) vagy
**"Add to Home Screen"** (iOS Safari, a Megosztás gombból) opciót választja
a weboldalon, az így létrejövő ikon böngészősáv nélkül, önálló alkalmazásként
nyílik meg.

- Ezt bármelyik oldalról megteheted (főoldal vagy egy konkrét játék) – mind
  a hármat felkészítettük rá.
- **Ikon cseréje**: az `icons/icon-192.png` és `icons/icon-512.png` egyelőre
  helyőrző "GC" ikonok. Cseréld le őket ugyanazzal a fájlnévvel és
  méretekkel (négyzet alakú PNG, lekerekített sarok nélkül – azt az
  operációs rendszer maga rajzolja rá) saját logódra.
- **Kártyahátlap**: a Holland kocsma lefordított lapjainak hátoldala is egy
  egyszerű, CSS-sel rajzolt mintázat (lásd `games/hollandkocsma/style.css`,
  a `.card-back` szabály feletti komment jelzi) – ha szeretnél saját
  kártyahát-képet, ott tudod becserélni egy `background-image`-re.
- Ha nem szeretnéd ezt a funkciót, egyszerűen töröld a `<link rel="manifest">`
  és `apple-mobile-web-app-*` sorokat a `<head>`-ekből.

---

## Hogyan adj hozzá új játékot a főoldalhoz?

1. Hozz létre egy új mappát: `games/<jatek-neve>/` a saját
   `index.html`/`style.css`/JS fájljaiddal. (A `games/hollandkocsma/` mappa
   jó kiindulási példa, ha multiplayer, testreszabható szabályú,
   Firebase-es játékot tervezel.)
2. A gyökér `index.html`-ben másold le egy meglévő `<a class="game-tile">`
   blokkot, és:
   - állítsd a `href`-et `games/<jatek-neve>/index.html`-re,
   - cseréld le az ikont (emoji) és a leírást.
3. (Opcionális) ha a játék is multiplayer és Firebase-t használ, a
   `games/uno/firebase-config.js`-hez hasonlóan a saját mappájában hozz létre
   egy configot – nyugodtan használhatja **ugyanazt** a Firebase projektet,
   csak más Firestore kollekciót (pl. `hkRooms`, ahogy a Holland kocsma is
   teszi), és bővítsd a `firestore.rules`-t egy hasonló `match` blokkal az
   új kollekcióra.
4. Az "App mód" automatikusan működni fog az új játékra is, ha a `<head>`-be
   bemásolod a meglévő játékok `manifest`/`apple-mobile-web-app-*` meta
   tag-jeit (lásd lent).

---

## UNO szabályok – mit lehet testreszabni?

A lobbiban minden szabály élőben módosítható, amíg a játék el nem indul.
Minden játékos ugyanazt látja és módosíthatja (nincs külön "házigazda"
jogosultság, hogy senki ne ragadjon be, ha az első csatlakozó kiesik).

| Szabály | Leírás |
|---|---|
| **Kezdő lapok száma** | Hány lapot kap mindenki kezdéskor (alap: 7, állítható 3–10). |
| **+2 lapok halmozhatók** | Húzás helyett rárakható egy másik +2, a húzás összeadódik a következő játékosnak. |
| **+4 lapok halmozhatók** | Ugyanez +4-re. |
| **Vegyes halmozás (+2 ↔ +4)** | +4-re +2 is rakható és fordítva – csak akkor van hatása, ha az előző kettő közül legalább az egyik be van kapcsolva. |
| **Beugrás (jump-in)** | Ha valakinek pontosan ugyanolyan lapja van (szín ÉS érték egyezik a dobott lappal), bármikor lerakhatja, akkor is, ha nem ő jön – és onnantól ő lesz a soron lévő. |
| **7-es / 0-s szabály** | 7-es lerakásakor választhatsz egy játékost, és lapot cseréltek egymással. 0-s lerakásakor mindenki továbbadja a teljes kézkártyáját a következő játékosnak (az aktuális irány szerint). |
| **Húzás lerakható lapig** | Ha nem tudsz lerakni, addig húzol, amíg nem lesz lerakható lapod (vagy elfogy a pakli). |
| **Kötelező lerakni a húzott lapot** | Ha a húzott lapod lerakható lenne, azt KELL lerakni – nem teheted félre. |
| **+4 megkérdőjelezhető** | A célzott játékos "kihívhatja" a +4-et. Ha a kijátszónak valóban nem volt lapja az előző színből, sikeres a kihívás és *a kijátszó* húzza a büntető lapokat helyette; ha hazudott a kihívó, a kihívó húz még +2 büntetőt. |
| **Büntetőlapok elfelejtett UNO-ért** | Ha valakinek 1 lapja marad és nem mond "UNO"-t, mások "rajtakaphatják" – ennyi lapot kell ekkor húznia. |
| **Játékmód** | *Egy kör*: az nyer, aki elsőként kiürül, ezzel vége a játéknak. *Pontverseny*: a kör végén a győztes megkapja a többiek kézben maradt lapjainak pontértékét (számok = névértékük, akció lapok = 20, vad lapok = 50), és új kör kezdődik, amíg valaki el nem éri a cél pontszámot. |
| **Cél pontszám** | Pontverseny módban eddig mennek a körök (alap: 500). |

### Standard szabályok, amik mindig érvényesek
- Szín vagy érték egyezés szükséges a lapok lerakásához (a vad lapok
  kivételével, amik mindig lerakhatók).
- Kihagyás (Skip), Irányváltás (Reverse), +2, Vad lap (+0/+4 színválasztással)
  a megszokott módon működnek. 2 fős játékban az Irányváltás úgy működik,
  mint a Kihagyás (a soron lévő játékos újra jön).
- Ha elfogy a húzópakli, a dobott lapok (a legfelső kivételével)
  megkeverve újra húzópakli lesznek.

---

## Holland kocsma szabályok – mit lehet testreszabni?

A szabályok forrása: a [Holland kocsma Wikipédia-cikke](https://hu.wikipedia.org/wiki/Holland_kocsma_(k%C3%A1rtyaj%C3%A1t%C3%A9k))
(nemzetközi nevein Shithead / Karma / Palace / Shed). A lobbiban – a
Colorcards-hoz hasonlóan – minden szabály élőben módosítható, amíg a játék
el nem indul, és játék közben bármikor megnyitható egy "Gyorstalpaló"
(krétatábla stílusú szabály-összefoglaló) a játéktábla tetején lévő
"📋 Szabályok" gombbal.

| Szabály | Leírás |
|---|---|
| **Lapok az asztalon (le / fel)** | Hány lapot kap mindenki lefordítva, és ugyanennyit rájuk felfordítva (alap: 4). |
| **Kezdő lapok a kézben** | Hány lapot kap mindenki kezdéskor, és a húzópakliból mindig ennyire egészíti ki, amíg az tart (alap: 4). |
| **Kettes = újraindító** | A 2-es bármilyen lapra lerakható, és utána bármilyen lap jöhet. |
| **Tízes = égető lap** | A 10-es bármilyen lapra lerakható; elégeti (kiveszi a játékból) a teljes dobott paklit, és újra ugyanaz a játékos jön. |
| **Ötös = visszafordító** | Az 5-ös bármilyen lapra lerakható; utána a következő lapnak legfeljebb ötösnek kell lennie (eredetileg opcionális szabály, alapból ki van kapcsolva). |
| **Négy egyforma lap éget** | Ha a dobott pakli tetején (akár több lépésben) összegyűlik 4 egyforma értékű lap, a pakli automatikusan elég. |
| **Páros lerakás tiltása** | Két egyforma lapot nem rakhatsz le együtt – csak egyesével, vagy hárommal/többel egyszerre (eredetileg opcionális nehezítés). |
| **Vak húzás megengedett** | Ha nincs lerakható lapod, húzhatsz vakon a pakli tetejéről, és megpróbálhatod azonnal lejátszani – ha nem jó, az egész dobott paklit fel kell venned. |
| **Pakli bármikor felvehető** | Akkor is felveheted a teljes dobott paklit, ha lenne lerakható lapod – néha taktikus döntés (blöff) lehet. |

### Standard menet, ami mindig érvényes
- A cél: szabadulj meg az összes lapodtól – előbb a kezedből (mindig
  húzol, amíg a pakliban van lap), utána a felfordított, végül a
  lefordított (vakon kijátszott) asztali lapjaidból.
- Aki nem tud lerakni, felveszi az egész dobott paklit a kezébe.
- Aki elsőként kiürül, megússza a kört; aki utoljára marad lapokkal, ő
  veszít. A lobbiban "Következő kör" gombbal újra lehet osztani – a
  vesztések kör-számonként összeadódnak, amíg vissza nem léptek a lobbiba.

### Húzópakli mérete
A kiosztáshoz szükséges 52 lapos paklikból annyi kerül összekeverve, hogy a
kiosztás UTÁN is maradjon legalább ~16 lap (illetve játékosonként 4) a
húzópakliban – így pl. 4 játékosnál, alapbeállítással (4 lap mindenhol) már
2 pakli (104 lap) kerül összekeverésre, nem csak 1.

### Vizuális visszajelzések
- Ha valaki felveszi a teljes dobott paklit (kötelezően vagy blöffből), a
  kártyái (neked: a kezed, másoknak: a kártyájuk a játékoslistában) egy
  pillanatra pirosan felvillannak.
- A dobott lap alatt egy szám mutatja, hány lap van jelenleg a dobott
  pakliban – ennyit kellene felvenni, ha valaki nem tud lerakni. Ugyanilyen
  szám van a húzópakli alatt is, hány lap maradt benne.
- Egy lapot a "Lerakás" gombbal **és** felfelé húzva (swipe) is le lehet
  rakni: nem kell pontosan a pakliig húzni, elég egy határozott felfelé
  mozdulat, így véletlen koppintásra/remegésre nem rakódik le semmi.

---

## Ismert korlátok

- **Nincs igazi "anti-cheat"** – lásd a fenti magyarázatot. Baráti körben nem
  probléma.
- **Lecsatlakozás kezelése**: ha valaki bezárja a böngészőt játék közben, a
  helye megmarad (nem omlik össze a sorrend). Ha pont az ő köre lenne és nem
  tér vissza, bárki rákattinthat a *"Lecsatlakozott játékos átugrása"*
  gombra a játéktábla alján.
- **Modern böngésző szükséges** (Chrome, Safari, Edge, Firefox – minden
  2022 utáni verzió jó) a `structuredClone` és ES modulok miatt.
- **4 karakteres szobakód** ≈ 1 millió kombináció – elég egy adott
  pillanatban aktív szobákhoz, de ne várj el tőle banki szintű biztonságot.
- A Firebase ingyenes csomagja napi kvótával rendelkezik (kb. 50 000
  dokumentum-olvasás/írás naponta). Egy átlagos UNO parti pár száz
  művelet – ez baráti használatra bőven elég, csak ne hagyj nyitva 0
  játékossal egy szobát órákig feleslegesen.

---

## Hibaelhárítás

- **"A szoba már nem létezik" / nem töltődik be semmi**: ellenőrizd, hogy a
  `firebase-config.js`-ben minden mező helyesen van kitöltve, és hogy a
  Firestore adatbázis létre van hozva a Firebase konzolban.
- **Konzol hibaüzenet `permission-denied`**: a Firestore Rules nincs
  publikálva, vagy nem egyezik a `firestore.rules` tartalmával – nézd át a
  2. lépés 6. pontját.
- **A oldal "üres" GitHub Pages-en, de helyben működik**: ellenőrizd, hogy a
  GitHub Pages "root" mappából szolgál ki, és hogy a fájlnevek/útvonalak
  kis-nagybetűre érzékenyek (Linux szerver) – pl. `games/uno/index.html`,
  nem `Games/UNO/Index.html`.
