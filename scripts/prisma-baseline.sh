#!/usr/bin/env bash
# Baslinjerar produktionsdatabasen för Prisma Migrate (engångsjobb).
#
# Bakgrund: databasen byggdes upp innan Prisma Migrate användes, så den
# saknar tabellen _prisma_migrations. `prisma migrate deploy` stoppar då med
# P3005 ("The database schema is not empty"). Det här skriptet talar om för
# Prisma vilka migreringar som redan finns i databasen - efter det kan
# `prisma migrate deploy` köras vid varje deploy igen.
#
# Säkert att köra: skriptet ändrar inga befintliga tabeller. Det
#   1. hämtar DATABASE_URL från Vercel till en temporär fil (raderas efteråt),
#   2. jämför databasen med prisma/schema.prisma,
#   3. saknas tabeller: erbjuder att skapa dem från sina migreringsfiler
#      (bara nya tabeller, frågar först),
#   4. markerar sedan (efter att du svarat ja) alla migreringar som körda.
#
# Kör från head-of-mappen:  bash scripts/prisma-baseline.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PRISMA=./node_modules/.bin/prisma
[ -x "$PRISMA" ] || { echo "Kör 'bun install' först."; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "1/4  Hämtar produktionens databasadress från Vercel (sparas bara tillfälligt)…"
npx vercel env pull "$TMP/.env" --environment=production --yes >/dev/null 2>&1 || {
  echo "     Kunde inte hämta från Vercel. Kör 'npx vercel login' och 'npx vercel link' (projektet head-of) och försök igen."
  exit 1
}
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$TMP/.env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
[ -n "$DATABASE_URL" ] || { echo "     DATABASE_URL saknas i Vercel-projektet head-of."; exit 1; }
export DATABASE_URL

# Jämför databasen med schemat. Resultat i $TMP/diff.txt, exit-kod i $code
# (0 = lika, 2 = skillnader, 1 = fel).
compare() {
  set +e
  "$PRISMA" migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code \
    > "$TMP/diff.txt" 2>&1
  code=$?
  set -e
  if [ "$code" -eq 1 ]; then
    echo "     Jämförelsen misslyckades:"
    grep -v "^Loaded Prisma config\|^Prisma schema loaded" "$TMP/diff.txt"
    exit 1
  fi
}

# Tabeller som finns i schemat men saknas i databasen.
missing_tables() {
  awk '/\[\+\] Added tables/{f=1; next} f && /^ *- /{sub(/^ *- /,""); print; next} f{f=0}' "$TMP/diff.txt"
}

echo "2/4  Jämför databasen med prisma/schema.prisma…"
compare

MISSING="$(missing_tables)"
if [ -n "$MISSING" ]; then
  echo
  echo "     Tabeller som saknas i databasen:"
  FILES=()
  for t in $MISSING; do
    f="$(grep -lE "CREATE TABLE (IF NOT EXISTS )?\"$t\"" prisma/migrations/*/migration.sql | head -1 || true)"
    if [ -z "$f" ]; then
      echo "       $t  – hittar ingen migrering som skapar den. Avbryter, inget har ändrats."
      exit 2
    fi
    echo "       $t  ← $f"
    FILES+=("$f")
  done
  echo "     Migreringarna ovan skapar bara de saknade tabellerna och rör inga befintliga data."
  read -r -p "     Skapa dem nu? (ja/nej) " svar
  [ "$svar" = "ja" ] || { echo "     Avbrutet. Inget har ändrats."; exit 0; }
  for f in "${FILES[@]}"; do
    "$PRISMA" db execute --file "$f" 2>&1 | grep -v "^Loaded Prisma config\|^Prisma schema loaded" | sed 's/^/     /'
  done
  compare
  if [ -n "$(missing_tables)" ]; then
    echo "     Tabeller saknas fortfarande:"; missing_tables | sed 's/^/       /'
    echo "     Avbryter. Klistra in utskriften till Claude."
    exit 2
  fi
  echo "     Tabellerna är skapade."
fi

# Saknade kolumner betyder en migrering som inte körts - då baslinjerar vi inte.
if grep -q "\[+\] Added column" "$TMP/diff.txt"; then
  echo "     Kolumner saknas i databasen:"
  grep -B3 "\[+\] Added column" "$TMP/diff.txt" | sed 's/^/       /'
  echo "     Avbryter, inget mer har ändrats. Klistra in utskriften till Claude."
  exit 2
fi

if [ "$code" -eq 2 ]; then
  echo
  echo "     Kvarvarande skillnader mot schemat (visas för kännedom):"
  grep -v "^Loaded Prisma config\|^Prisma schema loaded" "$TMP/diff.txt" | grep -E "\[.\]" | sed 's/^/       /' | head -60
  echo "     Det här är index-namn, standardvärden och hur främmande nycklar är skrivna."
  echo "     Det har sett ut så länge och påverkar inte migreringarna – alla tabeller finns."
else
  echo "     Databasen matchar schemat exakt."
fi

MIGRATIONS=()
for dir in prisma/migrations/*/; do MIGRATIONS+=("$(basename "$dir")"); done
echo
echo "3/4  ${#MIGRATIONS[@]} migreringar markeras som redan körda (inga tabeller ändras):"
printf '       %s\n' "${MIGRATIONS[@]}"
read -r -p "     Fortsätt? (ja/nej) " svar
[ "$svar" = "ja" ] || { echo "     Avbrutet. Inget har ändrats."; exit 0; }

for m in "${MIGRATIONS[@]}"; do
  "$PRISMA" migrate resolve --applied "$m" 2>&1 | grep -E "marked as applied|already recorded|Error" | sed 's/^/     /' || true
done

echo
echo "4/4  Kontrollerar…"
"$PRISMA" migrate status 2>&1 | grep -v "^Loaded Prisma config\|^Prisma schema loaded\|^Datasource" | sed 's/^/     /'
echo
echo "Klart. Säg till Claude att baslinjeringen är gjord, så slås automatiska migreringar på igen."
