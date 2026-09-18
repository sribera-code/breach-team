# Breach Team

Shoot tactique en vue de dessus, temps réel : un opérateur et deux coéquipiers pilotés par l'IA. HTML5 / Canvas, sans dépendance ni build. Tous les graphismes sont dessinés par le code (`js/sprites.js`) : aucun asset externe.

## Lancer

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```
python -m http.server 8000
```

puis aller sur http://localhost:8000.

## Deux modes

Le briefing propose deux rôles pour chaque mission.

**Assaut** — le mode d'origine : vous menez l'intervention avec Bravo et Charlie, vous nettoyez le bâtiment sans perdre d'otage.

**Siège** — vous incarnez le chef du groupe armé. Vous connaissez les lieux (le plan vous est acquis dès le départ), vous placez vos complices, vous verrouillez les portes, et une équipe d'intervention donne l'assaut par l'entrée de la carte après vingt secondes de préparation. Elle progresse secteur par secteur, converge sur les coups de feu, et reçoit des renforts toutes les quarante-cinq secondes : on ne gagne pas en les éliminant, mais en **tenant trois minutes**, le temps que les négociations aboutissent. Vous tombez, ou un otage meurt, et c'est perdu — les otages sont votre seule protection.

L'équipement suit le camp : AKM ou Remington 870, Makarov ou Glock. Les opérateurs sont plus précis et portent un gilet ; vous frappez plus fort et connaissez le terrain. Portes, fibre optique et tir à travers les battants sont vos meilleurs outils.

## Contrôles

| Action | Commande |
|---|---|
| Se déplacer | `ZQSD` / `WASD` / flèches |
| Marche / course | `A` (AZERTY) / `Q` (QWERTY) ou `Maj` (on commence en marche) |
| Viser / tirer | souris / clic gauche (maintenu pour les armes automatiques) |
| Recharger | `R` ou clic molette |
| Changer d'arme | `1` / `2` / `Alt` |
| Porte | `E` ouvre / ferme d'un coup ; molette : fermée ↔ entrebâillée ↔ entrouverte ↔ ouverte (chaque cran est un geste) |
| Fibre optique | `F` maintenu devant une porte fermée ou entrouverte |
| Grenade flash | `Espace` ou `G` (vers le curseur) |
| Équipe | `T` suivre / tenir ; clic droit : aller là (sur soi : suivre) |
| Direction à couvrir | clic droit **maintenu**, puis tirer vers la direction avant de relâcher |
| Pause | `Échap` |

Objectif : neutraliser tous les suspects sans mourir ni tuer d'otage.

En maintenant le clic droit, une flèche part du point visé : la direction tracée est confiée à celui des deux coéquipiers qui se place de ce côté. Une fois sur place, il garde cet angle au lieu de choisir lui-même son point d'intérêt, jusqu'à l'ordre suivant ; un contact reste prioritaire.

## Armes

L'équipement se choisit dans l'écran de briefing (le choix est mémorisé) : une arme principale et une arme de poing. Les armes sont réelles ; calibre, cadence, capacité et masse reprennent les données constructeur, les dégâts suivent le calibre et la mobilité découle de la masse.

| Catégorie | Arme | Calibre | Capacité | Cadence | À travers une porte |
|---|---|---|---|---|---|
| Fusil d'assaut | HK416 A5 | 5,56×45 mm OTAN | 30 | 850 cps/min | 55 % |
| Fusil d'assaut | FN SCAR-H CQC | 7,62×51 mm OTAN | 20 | 600 cps/min | 70 % |
| Pistolet mitrailleur | HK MP5A3 | 9×19 mm | 30 | 800 cps/min | 40 % |
| Pistolet mitrailleur | HK MP7A1 | 4,6×30 mm | 40 | 950 cps/min | 50 % |
| Fusil à pompe | Remington 870 | 12/70 chevrotine | 6 | pompe | 20 % |
| Fusil à pompe | Benelli M4 Super 90 | 12/70 chevrotine | 7 | semi-auto | 20 % |
| Arme de poing | Glock 17 | 9×19 mm | 17 | semi-auto | 40 % |
| Arme de poing | HK USP .45 | .45 ACP | 12 | semi-auto | 30 % |

La dernière colonne est la part des dégâts qui subsiste après avoir traversé une porte : un battant n'arrête pas les balles, il les affaiblit et les dévie un peu (deux portes au maximum). Les murs, eux, arrêtent tout.

Les fusils à pompe se rechargent cartouche par cartouche ; tirer interrompt le rechargement. Bravo porte un HK416, Charlie un MP5.

## Gestes

Manœuvrer une porte ou lancer une flash occupe les deux mains : le geste dure un instant (le temps de manœuvrer la poignée plus la course du battant : environ 0,55 s pour ouvrir ou fermer en grand, 0,37 s pour entrouvrir, 0,29 s pour entrebâiller, et 0,45 s pour dégoupiller et lancer), pendant lequel on ne tire pas, on avance au ralenti et le viseur s'ouvre en grand ; la visée met encore un peu moins d'une seconde à se replacer ensuite. L'anneau du viseur montre l'avancement, comme pour un rechargement. Coéquipiers et suspects sont soumis aux mêmes délais — les suspects sont un peu plus lents sur les portes.

## Portes

Une porte a quatre crans : fermée, entrebâillée, entrouverte, ouverte. Tant qu'elle n'est pas grande ouverte, le battant arrête le regard : on ne voit que par l'entrebâillement, et il faut être tout près — et plutôt du côté de l'ouverture — pour découvrir quelque chose. Concrètement, à une case de la porte, un battant entrouvert donne environ 90° de champ contre 74° pour un simple entrebâillement vu de côté (et rien de face) ; à trois cases en retrait, on ne voit plus rien tant que la porte n'est pas ouverte. Le battant ouvert masque lui aussi un pan de la pièce. Cela vaut dans les deux sens : un suspect derrière une porte entrouverte ne vous voit pas davantage.

Le passage ne se libère qu'à l'ouverture complète, et glisser une flash par l'entrebâillement demande au moins le cran « entrouverte ». Une porte fermée cache, mais ne protège pas : on tire à travers, dans les deux sens.

On ne peut pas refermer une porte si quelqu'un (vous compris) ou une grenade se trouve dans l'embrasure ; le message dit lequel. Toute autre manœuvre refusée est annoncée elle aussi — porte déjà fermée, déjà grande ouverte, ou en train de bouger.

## Fibre optique

Devant une porte fermée ou entrouverte, maintenir `F` glisse une fibre sous le battant : après un geste de mise en place, vous découvrez un large cône (150°, 6 cases) de la pièce voisine, suspects et otages compris, sans ouvrir ni faire de bruit. Tant que vous observez, vous ne tirez pas et vous ne rechargez pas ; le moindre pas, l'ouverture de la porte ou le relâchement de la touche retire la fibre.

## Coéquipiers

Bravo et Charlie ne tirent jamais à travers vous ni à travers un otage. Quand l'axe reste bouché, ils se décalent pour dégager l'angle plutôt que d'attendre, et un ordre de déplacement l'emporte sur un contact : ils rompent et progressent en gardant le suspect en joue.

Les chantiers ouverts et les réglages qui restent à faire sont listés dans [TODO.md](TODO.md).

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
