# Breach Team

Shoot tactique en vue de dessus, temps réel : un opérateur et deux coéquipiers pilotés par l'IA. HTML5 / Canvas, sans dépendance ni build. Tous les graphismes sont dessinés par le code (`js/sprites.js`) : aucun asset externe.

## Lancer

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```
python -m http.server 8000
```

puis aller sur http://localhost:8000.

## Contrôles

| Action | Commande |
|---|---|
| Se déplacer | `ZQSD` / `WASD` / flèches |
| Marche / course | `A` (AZERTY) / `Q` (QWERTY) ou `Maj` (on commence en marche) |
| Viser / tirer | souris / clic gauche (maintenu pour les armes automatiques) |
| Recharger | `R` ou clic molette |
| Changer d'arme | `1` / `2` / `Alt` |
| Porte | `E` ouvre / ferme ; molette : fermée ↔ entrouverte ↔ ouverte |
| Grenade flash | `Espace` ou `G` (vers le curseur) |
| Équipe | `T` suivre / tenir ; clic droit : aller là (sur soi : suivre) |
| Direction à couvrir | clic droit **maintenu**, puis tirer vers la direction avant de relâcher |
| Pause | `Échap` |

Objectif : neutraliser tous les suspects sans mourir ni tuer d'otage.

En maintenant le clic droit, une flèche part du point visé : la direction tracée est confiée à celui des deux coéquipiers qui se place de ce côté. Une fois sur place, il garde cet angle au lieu de choisir lui-même son point d'intérêt, jusqu'à l'ordre suivant ; un contact reste prioritaire.

## Armes

L'équipement se choisit dans l'écran de briefing (le choix est mémorisé) : une arme principale et une arme de poing. Les armes sont réelles ; calibre, cadence, capacité et masse reprennent les données constructeur, les dégâts suivent le calibre et la mobilité découle de la masse.

| Catégorie | Arme | Calibre | Capacité | Cadence |
|---|---|---|---|---|
| Fusil d'assaut | HK416 A5 | 5,56×45 mm OTAN | 30 | 850 cps/min |
| Fusil d'assaut | FN SCAR-H CQC | 7,62×51 mm OTAN | 20 | 600 cps/min |
| Pistolet mitrailleur | HK MP5A3 | 9×19 mm | 30 | 800 cps/min |
| Pistolet mitrailleur | HK MP7A1 | 4,6×30 mm | 40 | 950 cps/min |
| Fusil à pompe | Remington 870 | 12/70 chevrotine | 6 | pompe |
| Fusil à pompe | Benelli M4 Super 90 | 12/70 chevrotine | 7 | semi-auto |
| Arme de poing | Glock 17 | 9×19 mm | 17 | semi-auto |
| Arme de poing | HK USP .45 | .45 ACP | 12 | semi-auto |

Les fusils à pompe se rechargent cartouche par cartouche ; tirer interrompt le rechargement. Bravo porte un HK416, Charlie un MP5.

## Coéquipiers

Bravo et Charlie ne tirent jamais à travers vous ni à travers un otage. Quand l'axe reste bouché, ils se décalent pour dégager l'angle plutôt que d'attendre, et un ordre de déplacement l'emporte sur un contact : ils rompent et progressent en gardant le suspect en joue.

## Structure

- `js/levels.js` : cartes ASCII (murs, sols, portes, mobilier, ennemis, otages).
- `js/map.js` : grille, raycast, ligne de vue, A* (utilisé par les ennemis).
- `js/entities.js` : catalogue d'armes (`WEAPONS`), équipement, joueur, coéquipiers, ennemis, otages.
- `js/game.js` : entrées, déplacement, portes, balles, grenades, IA, brouillard de guerre.
- `js/sprites.js` : dessin procédural des sols, murs, mobilier, personnages et décalques.
- `js/render.js` : caméra, calque statique, décalques persistants, brouillard, viseur.
- `js/ui.js` : HUD et overlays (briefing avec choix de l'équipement).
- `js/main.js` : événements et boucle.

## Ajouter une mission

Ajouter une entrée dans `LEVELS` (`js/levels.js`). Une case ASCII vaut 32 px ; au chargement, la carte est convertie en grille fine de 16 px : les murs n'ont qu'une petite case d'épaisseur, les portes font 48 px de large et les meubles occupent un bloc de 32 px. Légende :

| Caractère | Sens |
|---|---|
| `#` | mur |
| `.` `,` `:` | sol béton / parquet / carrelage |
| espace | vide (hors bâtiment) |
| `D` | porte fermée |
| `S` | départ du joueur |
| `E` `^` `v` `<` `>` | ennemi (aléatoire ou orienté) |
| `H` | otage |
| `c` `B` `T` `p` `b` `k` | caisse, baril, table, plante, lit, bureau (bloquent le passage, pas la vue) |
