# Breach Team

Shoot tactique en vue de dessus, temps réel, une seule unité. HTML5 / Canvas, sans dépendance ni build. Tous les graphismes sont dessinés par le code (`js/sprites.js`) : aucun asset externe.

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
| Viser / tirer | souris / clic gauche (maintenu pour le fusil) |
| Recharger | `R` |
| Changer d'arme | `1` / `2` / molette |
| Ouvrir une porte | avancer dedans ou `E` |
| Grenade flash | `G` ou clic droit (vers le curseur) |
| Pause | `Échap` |

Objectif : neutraliser tous les suspects sans mourir ni tuer d'otage.

## Structure

- `js/levels.js` : cartes ASCII (murs, sols, portes, mobilier, ennemis, otages).
- `js/map.js` : grille, raycast, ligne de vue, A* (utilisé par les ennemis).
- `js/entities.js` : armes, joueur, ennemis, otages.
- `js/game.js` : entrées, déplacement, portes, balles, grenades, IA, brouillard de guerre.
- `js/sprites.js` : dessin procédural des sols, murs, mobilier, personnages et décalques.
- `js/render.js` : caméra, calque statique, décalques persistants, brouillard, viseur.
- `js/ui.js` : HUD et overlays.
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
