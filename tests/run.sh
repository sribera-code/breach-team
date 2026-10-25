#!/usr/bin/env bash
# Lance la suite de non-régression sans interface : Chrome (ou Chromium, ou Edge) ouvre tests/index.html en mode
# headless, et l'on affiche le bilan et les échecs. Code de sortie 0 si tout passe.
#
#   bash tests/run.sh               toute la suite (plusieurs minutes)
#   bash tests/run.sh porte         seulement les tests dont le nom contient « porte »
#   bash tests/run.sh --sim 'mode=squads&n=6'
#                                   le banc d'équilibrage (tests/sim.html, voir son en-tête) : affiche son rapport
#
# CHROME=/chemin/vers/chrome pour choisir le navigateur.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

find_browser() {
  if [ -n "${CHROME:-}" ]; then echo "$CHROME"; return; fi
  local c
  for c in google-chrome google-chrome-stable chromium chromium-browser chrome msedge; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
  done
  for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" \
           "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
           "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
           "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [ -x "$c" ]; then echo "$c"; return; fi
  done
  echo "Aucun navigateur Chrome, Chromium ou Edge trouvé (indiquez-le par CHROME=...)" >&2
  exit 2
}

# URL file:// du dossier des tests (chemin Windows sous Git Bash)
dir_url() {
  local d="$here"
  if command -v cygpath >/dev/null 2>&1; then d="$(cygpath -m "$here")"; fi
  case "$d" in /*) echo "file://$d" ;; *) echo "file:///$d" ;; esac
}

# Décodage minimal des entités HTML de la page sauvée
unhtml() { sed -e 's/&lt;/</g' -e 's/&gt;/>/g' -e 's/&quot;/"/g' -e "s/&#39;/'/g" -e 's/&amp;/\&/g'; }

browser="$(find_browser)"
page="index.html"
query=""
if [ "${1:-}" = "--sim" ]; then
  page="sim.html"
  query="?${2:-}"
elif [ -n "${1:-}" ]; then
  # (le filtre passe dans l'URL : espaces et caractères spéciaux encodés)
  query="?grep=$(printf '%s' "$1" | od -An -tx1 | tr -d ' \n' | sed 's/../%&/g')"
fi

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
flags=(--headless=new --disable-gpu --no-first-run --no-default-browser-check --allow-file-access-from-files
       --virtual-time-budget=36000000 --dump-dom)
# (sur un serveur d'intégration continue lancé en root, le bac à sable de Chrome refuse de démarrer)
if [ -n "${CI:-}" ] || [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then flags+=(--no-sandbox); fi

start=$(date +%s)
"$browser" "${flags[@]}" "$(dir_url)/$page$query" > "$out" 2>/dev/null || true
took=$(( $(date +%s) - start ))

flat="$(tr -d '\r' < "$out" | tr '\n' '\v')"
title="$(printf '%s' "$flat" | grep -o '<title>[^<]*</title>' | head -n1 | sed -e 's/<[^>]*>//g')"

if [ "$page" = "sim.html" ]; then
  printf '%s' "$flat" | grep -o '<pre id="report">[^<]*</pre>' | sed -e 's/<[^>]*>//g' | tr '\v' '\n' | unhtml
  echo "($title, ${took} s)"
  [ "$title" = "DONE" ]
  exit $?
fi

summary="$(printf '%s' "$flat" | grep -o '<div id="summary"[^>]*>[^<]*</div>' | sed -e 's/<[^>]*>//g' | unhtml)"
printf '%s' "$flat" | grep -o '<div class="ko">[^<]*</div>' | sed -e 's/<[^>]*>//g' | tr '\v' '\n' | unhtml || true
[ -n "$summary" ] || summary="Pas de bilan : la page n’a pas fini de charger (erreur de script ?)"
echo "$summary — ${took} s"
[ "$title" = "PASS" ]
