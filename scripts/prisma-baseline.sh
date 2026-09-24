#!/usr/bin/env bash
# Baslinjerar produktionsdatabasen för Prisma Migrate (engångsjobb).
#
# Bakgrund: databasen byggdes upp innan Prisma Migrate användes, så den
# saknar tabellen _prisma_migrations. `prisma migrate deploy` stoppar då med
# P3005 ("The database schema is not empty"). Det här skriptet talar om för
# Prisma vilka migreringar som redan finns i databasen - efter det kan
# `prisma migrate deploy` köras vid varje deploy igen.
#
# Säkert att köra: skriptet ÄNDRAR INGA TABELLER. Det
#   1. hämtar DATABASE_URL från Vercel till en temporär fil (raderas efteråt),
#   2. jämför databasen med prisma/schema.prisma,
#   3. stoppar om de skiljer sig - då behöver skillnaden lösas först,
#   4. annars (efter att du svarat ja) markerar alla migreringar som körda.
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

echo "2/4  Jämför databasen med prisma/schema.prisma…"
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
if [ "$code" -eq 2 ]; then
  echo
  echo "     Databasen skiljer sig från schemat. INGET har ändrats."
  echo "     Det här saknas eller skiljer sig (från databasen till schemat):"
  echo "     ------------------------------------------------------------"
  grep -v "^Loaded Prisma config\|^Prisma schema loaded" "$TMP/diff.txt" | sed 's/^/     /'
  echo "     ------------------------------------------------------------"
  echo "     Klistra in utskriften ovan till Claude så löser vi skillnaden först."
  exit 2
fi
echo "     Databasen matchar schemat exakt."

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
