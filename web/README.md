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
API PSE nie udostępnia mocy według rodzajów źródeł. `scripts/fetch_data.py` pobiera ją automatycznie ze strony ARE do
`data/capacity.json` (kategorie mapowane po nazwie, kontrola sumy); stała `CAPACITY` w `app.js` jest tylko zapasem:
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

### Pozostałe zbiory Eurostatu (strona „Prąd”: `stats.js`, strona „Gaz”: sekcje „Na co idzie gaz” i „Uzależnienie od importu”)
Eurostat odrzuca zbyt wiele równoczesnych zapytań (odpowiedź bez CORS → „Failed to fetch”) — `eurostat()` w `common.js`
wysyła najwyżej dwa naraz i ponawia nieudane.

| Zbiór | Zawartość | Uwagi |
|---|---|---|
| `nrg_cb_pem` | produkcja prądu netto wg paliw, miesięcznie, GWh | dla PL w 2016 tylko woda — pomijamy miesiące bez `C0000`; `RA000` nie obejmuje szczytowo-pompowych; węgiel kamienny i brunatny łącznie |
| `nrg_cb_em` | import, eksport, `AIM` prądu, miesięcznie | ok. 3 miesiące opóźnienia |
| `nrg_ind_ren` | oficjalny udział OZE: `REN`, `REN_ELC`, `REN_HEAT_CL`, `REN_TRA` [%] | rocznie |
| `nrg_ind_id` | uzależnienie od importu wg paliw [%] | rocznie; ujemne = eksporter netto |
| `nrg_pc_204` / `nrg_pc_205` | ceny prądu dla gospodarstw domowych / firm, półrocznie | `NAC` = zł; UE-27 tylko w EUR/PPS — przeliczamy kursem z polskich cen |
| `nrg_pc_204_c` | składniki ceny (energia, sieć, podatki i opłaty), rocznie | pasmo DC (2,5–5 MWh) |
| `nrg_d_hhq` | zużycie w gospodarstwach domowych wg zastosowania | prąd w `GWH`, gaz tylko w `TJ`/`TJ_GCV` |

Miesięcznego wydobycia gazu (`IPRD` w `nrg_cb_gasm`) dla Polski brak od 09.2023 — miesięczny udział importu liczymy z ENTSOG.
Ceny gazu dla gospodarstw domowych (`nrg_pc_202`) dla Polski kończą się na 2023-S2.

### Podzakładki Dzienne / Miesięczne / Roczne
- Sekcje i linki spisu mają `data-view="d|m|r"`; zakładka w `?v=m|r` (hash zajmują kotwice sekcji). `initTabs()` w `common.js`.
- Zakładki miesięczna i roczna ładują dane przy pierwszym otwarciu (mniej zapytań do Eurostatu); po przełączeniu wykresy są
  przerysowywane (w ukrytym kontenerze miałyby złą szerokość). Zmiana dnia / zakresu czyści tylko swoje grupy wykresów (`clearGroups`).
- Wykresy miesięczne mają przełącznik 2 lata / 5 lat / całość (`rangeSeg`, zapamiętywany w `localStorage`).
- Roczne: wybór roku. Bilans gazu 1990–2024 (`nrg_bal_c`, `G3000`) — grupy + `STATDIFF` sumują się dokładnie do `GIC`
  we wszystkich latach (inne przetwarzanie = `TI_E − TI_EHG_E`, bo przed 1997 r. `TI_NSP_E` jest puste, a są np. gazownie `TI_GW_E`).
  Gaz w domach wg zastosowania od 2010. Prąd: produkcja brutto wg paliw (`nrg_bal_peh`, `GEP`; węgiel kamienny =
  `C0000X0350-0370 − C0220`, „Inne” = reszta do `TOTAL`) i zużycie (`nrg_bal_c`, `E7000`: FC + `NRG_E` + `DL` + `TI_E`
  = produkcja + import − eksport).
- `nrg_ind_ren`: wskaźniki `REN_HEAT_CL` i `REN_TRA` bywają publikowane rok później niż `REN`/`REN_ELC`.

### Potok danych (`scripts/fetch_data.py`, GitHub Actions) i świeżość
- Źródła są niezależne: gdy któreś zawiedzie, skrypt zapisuje ostatnią opublikowaną kopię z GitHub Pages (z polem `stale`),
  więc wdrożenie nie pada. Każdy plik ma `fetched` i `dataAsOf`.
- `staleNote()` w `common.js` pokazuje ostrzeżenie, gdy dane są starsze niż zwykle dla źródła (ENTSOG 3 dni, TGE 3 dni,
  ARE 120 dni, Eurostat miesięczny gaz 90 / prąd 150 dni, roczny 820 dni, `przesyly.json` 20 min, pomiary PSE dziś 2 godz.)
  albo gdy plik z workflow nie był odświeżany od > 30 godz.
- **GitHub wyłącza zaplanowane workflow w publicznych repozytoriach po ok. 60 dniach bez aktywności w repozytorium** —
  wtedy ostrzeżenia o nieodświeżanych plikach są jedynym sygnałem; wystarczy dowolny commit albo ręczne uruchomienie workflow.

### Dlaczego nie JAO
Regulamin JAO (jao.eu/terms-conditions) zabrania pobierania danych botami („scraping, or the use of bots … is strictly
prohibited”) i ich rozpowszechniania bez pisemnej zgody; dozwolony jest tylko użytek wewnętrzny. Dlatego MaxBex nie jest
używany na publicznej stronie — wymagałby zgody JAO (contact@jao.eu).

### Dłuższe zakresy, wybór kraju, parametry cen
- Gaz dziennie: 30 / 90 dni, 12 miesięcy, 2 lata, 5 lat. ENTSOG archiwizuje dane starsze niż 5 lat (zapytanie zwraca komunikat
  o archiwum), więc maksimum to 1820 dni; pobieranie porcjami po roku. Powyżej ~400 dni wykresy pokazują średnie tygodniowe
  (`slice()` w `gas.js`, energia w okresie przez `esum` × liczba dób w przedziale). Porcje są przetwarzane od razu (mało pamięci),
  pobranie 5 lat trwa ok. 25 s; zakresy dłuższe niż rok nie są zapamiętywane (każda wizyta startuje od najwyżej 12 miesięcy).
- Przed maj 2022 działały punkty z Białorusi: `ITP-00104` Kondratki (gazociąg jamalski, PL-TSO-0001), `ITP-00092` Wysokoje,
  `ITP-00094` Tietierowka — grupa „Import z Białorusi”; tranzyt jamalski do Niemiec to eksport przez Mallnow (`ITP-00096` exit).
  Bilans wejścia − wyjścia na 5 latach: −20…+50 GWh/d (średnie tygodniowe) przy obrocie ~500 GWh/d.
- Historia nowego API PSE zaczyna się 2024-06-14 (`his-gen-pal-sire`, `rcco2`, `pk5l-wp`) — gaz w produkcji prądu i CO₂ nie
  sięgają dalej. `pk5l-wp` ma pełne dane godzinowe na ponad miesiąc naprzód (sekcja „Prognoza”: 7 / 14 / 31 dni).
- Kraj dla sekcji Eurostatu (`GEO` w `common.js`, `?kraj=FR` lub zapamiętany wybór): dane dzienne zawsze dla Polski.
  Ceny: Polska w zł (`NAC`), pozostałe kraje w euro. Energia jądrowa (`N9000`) ma własną serię; serie zerowe są ukrywane,
  a przy 9 seriach miesięcznych wiatr lądowy i morski są łączone (paleta ma 8 barw). Kraje bez gazu (np. Cypr) mają w
  Eurostacie zera zamiast braków — traktowane jak brak danych.
- Ceny prądu: wybór rocznego zużycia domu (5 pasm `nrg_pc_204`; w `nrg_pc_204_c` pasmo DE ma kod `KWH_LE15000`)
  i porównania z UE w PPS albo euro.

### Paliwo elektrowni JWCD
API PSE (`gen-jw`, `pdwkseub`, `unav-pk5l`) nie podaje paliwa jednostek. `PLANT_FUEL` w `app.js` przypisuje je ręcznie według
informacji właścicieli (stan: 09.2026; m.in. Gryfino = bloki gazowo-parowe 9 i 10 Dolnej Odry, Połaniec 2-Pasywna = „Zielony
Blok” na biomasę, Zwartowo = farma PV ok. 204 MW, Rybnik = bloki węglowe do czasu uruchomienia bloku gazowego). Nowe nazwy
elektrowni z API trafiają do „paliwo nieznane” i są wymienione w przypisie sekcji — wtedy trzeba uzupełnić listę.

### Rezerwy, plan dobowy, ograniczenia bloków, przywołania na RB
| Endpoint | Sekcja | Uwagi |
|---|---|---|
| `his-bil-mocy` | Rezerwy mocy i ubytki | wykonany bilans mocy w szczycie porannym (`SR`) i wieczornym (`SW`), dobowo od 06.2024; `rez_jgw_wir` rezerwa wirująca, `rez_jgw_zim` zimna, ubytki `rk/rs/rb/ra` (remonty kapitalne/średnie/bieżące/awaryjne), `we` warunki eksploatacyjne (m.in. brak wiatru/słońca), `ciep`, `inw`; `_jg` aktywni uczestnicy RB, `_prb` pozostali. Bezwładności (inercji) PSE nie publikuje |
| `pdgopkd` / `pdgobpkd` | Plan PSE na dobę | PKD (dzień wcześniej) i BPKD (bieżący): `rez_over_demand` zapas w górę, `rez_under` rezerwa w dół, `ogr_mwe` planowane ograniczenia dostępności |
| `pdwkseub` | Ograniczenia i postoje | tylko jednostki ze zgłoszonymi ubytkami: `non_us_cap` ubytki elektrowniane, `grid_lim` sieciowe (suma `available_capacity` nie jest mocą systemu) |
| `ogr-oper` | Ograniczenia i postoje | polecenia PSE dla bloków w węzłach; liczby całkowite w `pol_min_power_of_unit_plant` / `pol_max_power_of_unit` to liczby bloków, pozostałe pola — MW (ustalone z danych, etykiety w UI PSE są niespójne) |
| `unav-pk5l` | Ograniczenia i postoje | postoje: `state` AK = aktywne (AN pomijamy), `reason` RA/RS/RK/RB/OS/WE/Q; ostatnia wersja po `mrid_zas` |
| `eb-rozl` | Przywołania RB | energia bilansująca dostarczona/odebrana, w tym aFRR, MWh/kwadrans, rozliczeniowo (1–2 dni) |
| `mbp-tp` + `mbu-tu`, `cmbp-tp` | Przywołania RB | rezerwy kupione w trybie podstawowym (godzinowo) i uzupełniającym (kwadransowo) — sumujemy; cena z trybu podstawowego |

Pominięte: `krb-rozl` (KB/KO/KCZ — w danych KCZ = KO − KB, niezgodnie z definicjami, które udało się znaleźć) i `csire-kpi*`
(brak opisów pól). Okresów zagrożenia rynku mocy nie ma w API.

### Trafność prognoz wiatru i PV (sekcja „Jak sprawdzają się prognozy wiatru i słońca”)
- Prognoza D-1: `pdgopkd` (`gen_wi`, `gen_fv`) — plan publikowany dzień wcześniej (ok. 15:40), jedna wersja na dobę.
- Prognoza bieżąca: `pk5l-wp` (`fcst_wi_tot_gen`, `fcst_pv_tot_gen`), godzinowo; dla minionych godzin każda godzina ma
  inną `publication_ts` (ostatnia wersja sprzed tej godziny).
- `pdgobpkd` się nie nadaje: dla minionych dób ma jedną wersję opublikowaną już po końcu doby.
- Wykonanie: `his-gen-pal-sire` (`WI` + `WM`, `ES`; zgodne z `wi`/`pv` w `his-wlk-cal`) plus redukcje z `poze-redoze`.
  PKD prognozuje produkcję bez redukcji (3.05.2026 w południe: PKD PV 12,4 GW ≈ produkcja 10,2 GW + redukcje 2,9 GW),
  więc prognozy porównujemy z „produkcją możliwą” = produkcja + redukcje. `pk5l-wp` w dniach dużych redukcji bywa niższa
  nawet od produkcji (PV 3.05.2026: −34% względem możliwej) — możliwe, że uwzględnia redukcje planowane, nieopisane przez PSE.

### Zakres dni w zakładce „Dzienne”
- Stan: `date` (ostatni dzień), `days` (1/3/7/14/31/92), `from`; w adresie `?d=` i `?dni=`. Wybór długości obok daty,
  strzałki przesuwają o całą długość, „1 dzień” wraca do pojedynczej doby. Najwcześniej 14.06.2024 (historia API PSE).
- Oddalenie wykresu przy pełnym widoku (przycisk −, Ctrl + kółko, klawisz „-”) przechodzi na następną długość
  (`onZoomOutFull` w `charts.js`, tylko wykresy grupy `day`).
- `pseDay(endpoint, perDay)` pobiera porcje po 7 dni wyrównane do stałego kalendarza (pamięć podręczna działa przy
  przesuwaniu/rozszerzaniu), najwyżej 4 zapytania naraz; odświeżanie co 5 min tylko, gdy zakres obejmuje dziś, i tylko porcji z dziś.
- Dane liczone na siatce kwadransów całego zakresu (kafelki i sumy energii z pełnych danych); `disp(grid)` uśrednia do
  wyświetlania: ≤ 3 dni kwadranse, ≤ 14 dni godziny, dłużej doby (od północy, z dobami 23/25 h). Wielkości w MWh na kwadrans
  (EN, SK, energia bilansująca) są wtedy średnimi na kwadrans (opisane w nagłówkach).
- Limity: praca elektrowni (`gen-jw`, ~10 tys. rekordów/dobę) i ubytki jednostek (`pdwkseub`, ~4 tys.) do 14 dni.
  Kompas dla wielu dni: pasek godzin dla każdej doby (aktualna wersja prognozy); historia wersji tylko dla jednego dnia.
- Sprawdzone: energia 7 dni = suma pojedynczych dni (kse-load, 2994 GWh dla 22–28.09.2026); zakres z 29.03.2026 ma 92
  kwadranse tej doby. 92 dni ładują się ok. 30 s.
