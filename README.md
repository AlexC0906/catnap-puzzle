# 🐱 Mustăți

Un puzzle logic cu pisici, care rulează direct în browser. Fără instalare, fără dependențe.

## Regulile

Tabla de N×N e împărțită în N perne colorate. Pune N pisici astfel încât:

1. fiecare **rând** să aibă exact o pisică;
2. fiecare **coloană** să aibă exact o pisică;
3. fiecare **pernă colorată** să aibă exact o pisică;
4. **nicio pisică să nu le atingă** pe celelalte, nici măcar pe diagonală.

Fiecare puzzle are o singură soluție.

## Cum se joacă

| Acțiune | Mouse / touch | Tastatură |
|---|---|---|
| Pune × | un clic | `X` |
| Pune pisică | două clicuri (sau clic dreapta) | `C` |
| Mai multe × deodată | trage peste celule | |
| Mută-te pe tablă | | săgeți |
| Anulează | butonul „Anulează” | `Ctrl+Z` |

## Ce are

- **Puzzle-ul zilei**: același 8×8 pentru toată lumea, în fiecare zi
- Table de la **5×5 la 10×10**, generate la infinit
- Fiecare puzzle are un link propriu (`#p8-4242`) pe care îl poți trimite cuiva
- Greșelile se colorează imediat; opțional, × automate în jurul pisicilor
- Indicii, cronometru, recorduri salvate local, progres salvat
- Rezultat de copiat, cu emoji, ca la Wordle
- Temă luminoasă și întunecată, merge pe telefon

## Rulează local

Deschide `index.html` în browser. Atât.

## Teste

```bash
npm test
```

Testele verifică pentru fiecare mărime că puzzle-urile generate sunt valide, au zone conectate și **exact o soluție**.

## Cum funcționează generatorul

1. Așază aleator N pisici care respectă regulile (backtracking).
2. Crește N zone colorate pornind din fiecare pisică (flood-fill aleator).
3. Un solver numără soluțiile. Dacă găsește o a doua, mută o celulă dintre zone ca să o elimine și încearcă din nou.

Totul e determinist pe baza unui seed, așa că același seed dă mereu același puzzle.

## Publică pe GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root. Jocul va fi la `https://<user>.github.io/mustati/`.

## Licență

MIT
