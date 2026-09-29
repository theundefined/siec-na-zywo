# Sieć na żywo — źródła danych

Strona powstała jako czytelniejszy odpowiednik aplikacji **Energetyczny Kompas** (PSE, `pl.pse.alert_energetyczny` 1.5.0, Flutter) —
korzysta z tych samych publicznych źródeł, ale nie jest z nią związana.
Czysty HTML/CSS/JS, bez zależności i bez backendu: wszystkie źródła mają `Access-Control-Allow-Origin: *`,
więc przeglądarka pobiera dane bezpośrednio.

Uruchomienie lokalne (moduły ES wymagają serwera HTTP, nie `file://`) — patrz `README.md` w katalogu głównym.
Aplikacja instaluje się jak PWA (`manifest.webmanifest`, `sw.js`: pliki strony network-first, dane zawsze z sieci).

## Źródła danych (wyciągnięte z `libapp.so` aplikacji)

### API raportów PSE (OData)
`https://api.raporty.pse.pl/api/` — aplikacja używa lustra `https://apimpdv2-bmgdhhajexe8aade.a01.azurefd.net/api/`
(identyczne dane; strona używa go jako zapasowego). Domyślny rozmiar strony to 100 rekordów i odpowiedź nie zawiera
`nextLink`, więc zawsze trzeba podawać `$first`.

| Endpoint | Zapytanie | Zawartość |
|---|---|---|
| `pdgsz` | `business_date eq 'D' and is_active eq true` | Godziny zalecanego użytkowania/oszczędzania. `usage_fcst`: 0 zalecane użytkowanie, 1 normalne, 2 zalecane oszczędzanie, 3 wymagane ograniczanie. Bez `is_active` → wszystkie wersje prognozy (historia). |
| `kse-load` | `business_date eq 'D'` | Zapotrzebowanie KSE, kwadranse: `load_fcst`, `load_actual` [MW]. |
| `his-gen-pal-sire` | `business_date eq 'D'` (`$first=10000`) | Generacja wg źródeł, kwadranse. `value` to tekst z przecinkiem (`"58,965"`) [MW]. `alias_entsoe` to kody ENTSO-E (B01 biomasa, B02 węgiel brunatny, B03 gaz koksowniczy, B04 gaz, B05 węgiel kamienny, B06 olej, B10 szczytowo-pompowe, B11/B12 woda, B15 inne OZE/biogaz, B16 PV, B17 odpady, B18 wiatr morski, B19 wiatr lądowy, B20 inne). |
| `rce-pln` | `business_date eq 'D'` | Rynkowa cena energii, kwadranse [zł/MWh]. |
| `przeplywy-mocy` | `business_date eq 'D'` | Przepływy fizyczne na granicach (`section_code` np. `PL-DE`, `UA-PL`), kwadranse. Niezależnie od kierunku w kodzie: `value` < 0 = eksport, > 0 = import; eksport netto = −Σ `value`. Nie używany przez aplikację. |
| `his-wlk-cal` | `business_date eq 'D'` | Wielkości bilansowe KSE, kwadranse; `jgm` < 0 = pompowanie w elektrowniach szczytowo-pompowych, `swm_p`/`swm_np` = saldo wymiany. Nie używany przez aplikację. |

Bilans: produkcja (`his-gen-pal-sire`) − zapotrzebowanie (`kse-load`) − eksport netto ≈ pompowanie (−`jgm`),
z dokładnością do kilkudziesięciu MW. Pełny wykaz endpointów: `https://api.raporty.pse.pl/api/openapi`.

Pułapki:
- `dtime` to **koniec** przedziału (`00:15` = 00:00–00:15), a w `pdgsz` to **początek** godziny.
- W dniu zmiany czasu lokalne pola mają postać `02a:15:00`, a doba ma 92/100 kwadransów (23/25 godzin). Oś czasu
  budujemy wyłącznie z pól `*_utc`.

### Pliki aplikacji
`https://files.energetycznykompas.pl/datafile/`

| Plik | Zawartość |
|---|---|
| `przesyly.json` | Stan bieżący (co ok. minutę): przepływy na granicach (`wartosc` < 0 = eksport, `wartosc_plan`, `rownolegly` = profil synchroniczny DE+CZ+SK), podsumowanie (zapotrzebowanie, generacja, cieplne, PV, wiatr lądowy/morski, wodne, częstotliwość), status IGCC/CMO. |
| `RCEm.json` | Miesięczna rynkowa cena energii (RCEm) wg lat. |
| `alert.json` | Komunikat w aplikacji (`show`, `title`, `body`). |

### Moc osiągalna (wykres „Wykorzystanie mocy źródeł”)
API PSE nie udostępnia mocy według rodzajów źródeł, więc wartości są wpisane w stałą `CAPACITY` w `app.js`
i trzeba je aktualizować ręcznie, raz w miesiącu:
- **ARE S.A.** (statystyka publiczna), https://www.are.waw.pl/badania-statystyczne/prezentacja-wybranych-danych,
  wykres „Moc elektryczna osiągalna (stan na koniec miesiąca) wg rodzajów paliw i technologii wytwarzania”.
  Dane są osadzone w HTML strony (Next.js, `self.__next_f`). ARE nie rozdziela wiatru na lądowy i morski.
- **Wiatr morski:** Baltic Power, 76 × 15 MW = 1140 MW (https://balticpower.pl/o-projekcie/). Farma jest w rozruchu
  i nie weszła do mocy osiągalnej ARE; w lipcu 2026 ARE podało 1140,283 MW nowych instalacji wiatrowych
  (łącznie z rozruchem technologicznym).

### Obciążenie połączeń transgranicznych
Przełącznik w sekcji „Wymiana międzynarodowa” (`FLOW_REFS` w `app.js`; kolejne źródła dodaje się jako nowy wpis):
- **% mocy technicznej** — `TECH_CAPACITY`. Potwierdzone tylko SwePol (HVDC, 600 MW). Połączenia AC (DE, CZ, SK, UA,
  LT po synchronizacji w 2025 r.) nie mają jednej stałej przepustowości; wartości `null` do uzupełnienia.
  Uwaga: eksport na Litwę osiągał 974 MW, więc dawne „500 MW LitPol” już nie obowiązuje.
- **% maks. historycznego** — największy przepływ w danym kierunku w ostatnich 12 mies., liczony zapytaniami
  `przeplywy-mocy?$filter=section_code eq 'PL-DE' and business_date ge '…'&$orderby=value asc&$first=1`
  (`PL-XX` < 0 = eksport, `XX-PL` > 0 = import); wynik trzymany w `localStorage` przez dobę.
- Kandydat na później: JAO Publication Tool (`publicationtool.jao.eu/core/api/data/maxExchanges`) — zdolności
  godzinowe dla granic Core, ale bez nagłówka CORS (wymaga pobierania po stronie serwera/crona).

### Pozostałe endpointy PSE użyte na stronie
| Endpoint | Sekcja | Uwagi |
|---|---|---|
| `energy-prices` | Ceny RDN i RB | `csdac_pln` (RDN), `cen_cost` (CEN), `ceb_pp_cost` (CEB, jak w raporcie PSE), `cor_cost` (COR), `balance` (EN, MWh/15 min), `sk_cost` (SK). Wartości rozliczeniowe z opóźnieniem 1–2 dni. |
| `price-fcst` | Ceny RDN i RB | Bieżące, wstępne `cen_fcst`, `cor_fcst`, `imb_energy`, `contracting` (`short`/`long`) — do czasu rozliczenia. |
| `sk` | Ceny RDN i RB | Stan kontraktacji: prognozy `sk_d_fcst` (D), `sk_d1_fcst` (D-1). Ujemne = system krótki. |
| `poze-redoze` | Redukcje OZE | `pv_/wi_red_balance` i `_network` [MW], wartości ujemne = redukcja. |
| `gen-jw` | Elektrownie | Moc każdej JWCD co 15 min (~10 tys. rekordów/dobę); `operating_mode` „Pobór” = pompowanie (ujemne). |
| `pk5l-wp` | Prognoza 7 dni | Plan koordynacyjny: godzinowo, wiele miesięcy naprzód; `plan_dtime` = koniec godziny. |
| `lolp` | LOLP | `b0..b9` poziomy rezerwy [MW], `p0..p9` prawdopodobieństwo niedoboru; stałe w okresach `ojnz_id`. |
| `rcco2` | CO₂ | Cena EUA dziennie, EUR i PLN. |

## Zakładka „Gaz” (`gaz.html`, `gas.js`)

Wspólny kod obu stron (pobieranie z PSE, czas, tabele, wykresy, motyw) jest w `common.js`.

### ENTSOG Transparency Platform (bez klucza, CORS `*`)
`https://transparency.entsog.eu/api/v1/operationaldatas?operatorKey=PL-TSO-0002&indicator=Physical Flow,Firm Technical&periodType=day&from=…&to=…&timezone=CET&limit=-1`
— rok danych to jedno zapytanie (~0,7 MB po kompresji, ~3 s). `PL-TSO-0001` to GAZ-SYSTEM jako operator gazociągu jamalskiego (punkt Mallnow).
Kilka wartości po przecinku działa dla `indicator`, ale **nie** dla `operatorKey` (zwraca 404 „No result found”, tak samo jak brak danych).
Filtr `pointDirection` działa, ale jest kilkanaście razy wolniejszy niż pobranie całego operatora.

- Dane dobowe (doba gazowa 6:00–6:00), kWh/d; godzinowych dla Polski brak. `value` bywa liczbą albo tekstem.
- Trwająca doba ma dane cząstkowe — strona ją pomija, podobnie jak końcowe doby z wyraźnie mniejszą liczbą raportujących punktów.
- Kierunek z perspektywy systemu przesyłowego: magazyn `entry` = odbiór z magazynu, `exit` = zatłaczanie.
- `Firm Technical` przychodzi jako okresy (`periodFrom`–`periodTo`), nie dzień po dniu.
- Pomijane: punkty wirtualne `VTP-*` i `ITP-00293` (połączenie sieci GAZ-SYSTEM z gazociągiem jamalskim — wewnętrzne).

| Grupa | Punkty |
|---|---|
| Wydobycie krajowe | `PRD-00153`, `FNC-00008` (odazotownie), `PRD-00218` (L), minus `PRD-00219` |
| Baltic Pipe / LNG | `ITP-10009` Faxe, `LNG-00006` Świnoujście |
| Niemcy | `ITP-00497` GCP, `ITP-00096` Mallnow |
| Czechy | `ITP-00158` Cieszyn, `DIS-00195` Branice, `DIS-00204` Zlate Hory |
| Słowacja / Ukraina / Litwa | `ITP-00177` Vyrava, `ITP-10008`, `ITP-00556` Santaka (na wykresie dostaw Słowacja i Ukraina to jedna warstwa — paleta ma 8 barw, a import z Ukrainy jest marginalny) |
| Magazyny | `UGS-00426` Wierzchowice, `UGS-00425` GIM Sanok, `UGS-00424` GIM Kawerna, `UGS-00322` Janowice (LNG) |
| Odbiór | `DIS-00013`/`DIS-00193` dystrybucja (netto), `FNC-00002`/`FNC-00040`/`FNC-00007` odbiorcy przesyłowi |

Suma wejść − suma wyjść to kilka–kilkadziesiąt GWh/d (akumulacja w gazociągach, pomiary) przy obrocie 400–1200 GWh/d.

### PSE
`his-gen-pal-sire` z `$select=business_date,alias_sire,value` i filtrem `alias_sire eq 'GZ' or alias_sire eq 'GK'` — rok kwadransów
(~70 tys. rekordów) w ~1,5 s. Doby kalendarzowe, nie gazowe.

### Niedostępne bez klucza / serwera
- Zapełnienie magazynów i terminal LNG: GIE AGSI+/ALSI (darmowy klucz API w nagłówku `x-key`).
- Ceny gazu TGE (RDNg, TGEgasDA): brak API i CORS — wymaga crona.
- Portal SWI GAZ-SYSTEM: chroniony przez Incapsula.

### Ceny gazu TGE — stan prawny (sprawdzony 29.09.2026)
- Regulamin strony tge.pl: dane „wyłącznie do użytku osobistego i w celach informacyjnych” (§1 ust. 3), obowiązek wskazania TGE jako
  źródła (§4 ust. 2); inne wykorzystanie, w tym „dystrybucja, reprodukcja, modyfikacja, wyświetlanie” wymaga odrębnej, odpłatnej umowy (§5 ust. 3).
- „Polityka dotycząca danych rynkowych TGE” (v2.0, 12.11.2024): dane opóźnione (>15 min) są bezpłatne (pkt 2.4), chyba że odbiorca
  odpłatnie je redystrybuuje lub sprzedaje oparte na nich produkty (pkt 2.5).
- Wniosek: prywatny, lokalny wrapper — OK; publiczna strona z danymi TGE — najpierw zgoda TGE.

### Ceny gazu (sekcja „Ceny gazu na giełdzie”)
`https://energy-api.instrat.pl/api/prices/gas_price_rdn_daily?date_from=…` — TGEgasDA (zł/MWh, wolumen MWh), dane TGE w opracowaniu
Instrat, licencja CC BY-NC 4.0 (użycie informacyjne dozwolone, wymagane podanie źródła, bez celów komercyjnych). API ma CORS tylko dla
energy.instrat.pl, dlatego `scripts/fetch_data.py` zapisuje `web/data/gas-prices.json` podczas wdrożenia (GitHub Actions).
Endpoint `gas_price_rtt` (kontrakty terminowe) zwraca obecnie pustą listę.

### Na co idzie gaz — Eurostat (CORS `*`, CC BY 4.0, bez klucza)
- `nrg_cb_gasm?geo=PL&siec=G3000&unit=TJ_GCV&nrg_bal=IC_OBS&nrg_bal=TI_EHG_MAP` — miesięcznie: zużycie krajowe i wsad do
  energetyki zawodowej, **ciepło spalania**, opóźnienie ok. 1 miesiąca.
- `nrg_bal_c?geo=PL&siec=G3000&unit=GWH` — rocznie pełny bilans (gospodarstwa, przemysł wg branż, elektrociepłownie zawodowe
  i przemysłowe, produkcja prądu `GEP` i ciepła `GHP` z gazu), **wartość opałowa**, opóźnienie ponad rok.
- Suma miesięcy za 2024 (219,6 TWh GCV) vs bilans roczny (197,3 TWh NCV) — różnica to przelicznik GCV/NCV ≈ 1,11.
  `TI_EHG_MAP` miesięcznie (29,3 TWh GCV w 2024) jest niższe niż suma zawodowych pozycji rocznych (32,3 TWh NCV) — inna sprawozdawczość.
- `TI_NRG_FC_IND_NE` = `FC_NE` (agregat) — nie sumować podwójnie.
