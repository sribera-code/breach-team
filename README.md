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

**Assaut** — le mode d'origine : vous menez l'intervention avec Bravo et Charlie et vous nettoyez le bâtiment sans perdre un seul otage ; les faire sortir les met à l'abri, mais n'est pas exigé. Le point d'entrée est tiré au sort à chaque partie — le briefing ne dit pas lequel est sorti, vous le découvrez sur place — et il vous laisse le fixer si vous préférez : chaque carte a plusieurs portes extérieures et fenêtres, et la pièce par laquelle vous entrez est toujours vide : le premier contact se fait derrière une porte.

**Siège** — vous incarnez le chef du groupe armé. Vous connaissez les lieux (le plan vous est acquis dès le départ), vous êtes neuf — vous et huit complices, chacun à son poste et sans ordres à recevoir : personne ne commande personne —, vous verrouillez les portes, et une équipe d'intervention donne l'assaut après dix secondes de préparation — par une porte extérieure ou une fenêtre, sans que vous sachiez laquelle. Elle progresse secteur par secteur, converge sur les coups de feu, lance des flashs avant d'entrer là où elle vous a entendu, et attaque en **trois vagues de trois opérateurs**, chaque fois par une autre ouverture. Pas de temps mort : la vague suivante entre six secondes après l'élimination de la précédente, ou au bout de trente secondes si celle-ci tient encore. Le HUD indique la vague en cours (« Vague 2 / 3 »). Repoussez la dernière et les négociations aboutissent.

Chaque carte a ses otages : trois à l'Entrepôt, quatre aux Bureaux, à l'Hôtel et à la Banque, cinq à la Villa et au Centre de données. Quand une vague entre, la minimap fait clignoter en rouge la pièce où elle arrive, avec une flèche sur l'ouverture franchie. Vous perdez si tout votre groupe tombe (à votre mort, vous reprenez la main dans un complice), ou s'il ne vous reste plus aucun otage vivant : tous morts, ou évacués par l'intervention. Un opérateur qui trouve un otage le relève et l'emmène vers la sortie la plus proche ; s'il l'atteint, l'otage est perdu pour vous. Abattez l'escorte en route : l'otage se remet à genoux là où il est, jusqu'à ce qu'un autre opérateur vienne le chercher. Perdre un otage ne met pas fin à la partie tant qu'il en reste un. L'intervention ne tire jamais avec un otage dans l'axe ou juste derrière sa cible : elle se décale pour trouver un angle. Garder un otage près de soi protège donc vraiment. Les otages sont votre seule protection.

L'équipement suit le camp : AKM, Uzi, Škorpion vz. 61 ou Remington 870 en arme principale, Makarov, Tokarev TT-33 ou Glock en arme de poing, et **deux grenades à fragmentation** au lieu des flashs (`Espace`). Elles éclatent au bout de deux secondes et tuent dans un rayon d'environ une case, blessent jusqu'à trois cases et demie, vous et vos otages compris ; un mur ou une porte fermée arrête l'éclat. Pas de fibre optique de ce côté. Les opérateurs sont plus précis et portent un gilet ; vous frappez plus fort et connaissez le terrain. Portes, grenades et tir à travers les battants sont vos meilleurs outils. Les opérateurs, eux, lancent des flashs, mais seulement quand la trajectoire est libre (jamais contre une porte fermée) et jamais sur leurs équipiers ; leur propre camp détourne les yeux et n'est gêné que si l'éclair part à ses pieds.

## Missions

Six cartes : Entrepôt, Bureaux, Villa, Hôtel (chambres sur un long couloir, hall de marbre, restaurant et cuisines), Banque (grand hall à piliers, guichets, salle des coffres, salle informatique) et Centre de données (quai de chargement, salle des serveurs en allées parallèles, supervision). L'écran « Missions » montre le plan de chacune, avec ses portes, ses fenêtres et ses ouvertures sur l'extérieur ; les postes des suspects et des otages, tirés au sort à chaque partie, n'y figurent pas.

## Contrôles

| Action | Commande |
|---|---|
| Se déplacer | `ZQSD` / `WASD` / flèches |
| Marche / course | `A` (AZERTY) / `Q` (QWERTY) ou `Maj` (on commence en marche, qui est silencieuse) |
| Viser / tirer | souris / clic gauche (maintenu pour les armes automatiques) |
| Recharger | `R` ou clic molette |
| Changer d'arme | `1` / `2` / `Alt` |
| Laser | `L` allume / éteint le laser de l'arme qui en porte un |
| Porte | `E` ouvre / ferme d'un coup ; molette : fermée ↔ entrebâillée ↔ entrouverte ↔ ouverte (chaque cran est un geste) |
| Fibre optique | `F` maintenu devant une porte fermée ou entrouverte |
| Grenade flash | `Espace` ou `G` maintenu : la mèche part à la fin de l'armement, la grenade au relâchement |
| Ramasser une arme | `V` près d'un corps (échange avec l'arme de même catégorie) |
| Otage | `H` près d'un otage : il se relève et vous suit ; `H` à nouveau : il attend à genoux |
| Équipe | `T` suivre / tenir ; clic droit : aller là (sur soi : suivre) |
| Direction à couvrir | clic droit **maintenu**, puis tirer vers la direction avant de relâcher |
| Minimap | `M` (affichée par défaut) |
| Pause | `Échap` |

Objectif : neutraliser tous les suspects, sans perdre toute l'équipe ni tuer d'otage. C'est gagné dès que le dernier suspect tombe, que les otages soient dehors ou non ; les escorter jusqu'à une porte extérieure ou une fenêtre les met à l'abri en attendant. Si vous tombez, vous continuez dans un coéquipier.

En maintenant le clic droit, une flèche part du point visé : la direction tracée est confiée à celui des deux coéquipiers qui se place de ce côté. Une fois sur place, il garde cet angle au lieu de choisir lui-même son point d'intérêt, jusqu'à l'ordre suivant ; un contact reste prioritaire.

## Armes

L'équipement se choisit dans l'écran de briefing (le choix est mémorisé) : une arme principale — ou un bouclier — et une arme de poing, chacune avec ses accessoires. Les armes sont réelles ; calibre, cadence, capacité et masse reprennent les données constructeur, les dégâts suivent le calibre et la mobilité découle de la masse.

| Catégorie | Arme | Calibre | Capacité | Cadence | À travers une porte | Bruit (cases) |
|---|---|---|---|---|---|---|
| Fusil d'assaut | HK416 A5 | 5,56×45 mm OTAN | 30 | 850 cps/min | 55 % | 16 · silencieux 4 |
| Fusil d'assaut | FN SCAR-H CQC | 7,62×51 mm OTAN | 20 | 600 cps/min | 70 % | 18 · silencieux 5 |
| Pistolet mitrailleur | HK MP5A3 | 9×19 mm | 30 | 800 cps/min | 40 % | 14 · silencieux 2,5 |
| Pistolet mitrailleur | HK MP7A1 | 4,6×30 mm | 40 | 950 cps/min | 50 % | 14 · silencieux 3 |
| Fusil à pompe | Remington 870 | 12/70 chevrotine | 6 | pompe | 20 % | 18 |
| Fusil à pompe | Benelli M4 Super 90 | 12/70 chevrotine | 7 | semi-auto | 20 % | 18 |
| Arme de poing | Glock 17 | 9×19 mm | 17 | semi-auto | 40 % | 13 · silencieux 2,5 |
| Arme de poing | HK USP .45 | .45 ACP | 12 | semi-auto | 30 % | 13 · silencieux 2 |

« À travers une porte » est la part des dégâts qui subsiste après avoir traversé un battant : il n'arrête pas les balles, il les affaiblit et les dévie un peu (deux portes au maximum). Les murs, eux, arrêtent tout. « Bruit » est la distance à laquelle le coup de feu s'entend en plein air (voir **Bruit et silencieux**).

Les fusils à pompe se rechargent cartouche par cartouche ; tirer interrompt le rechargement. Recharger s'anime : l'arme s'incline, la main lâche le garde-main, descend chercher un chargeur, le remonte dans le puits et réarme — pour vous comme pour les coéquipiers.

### Accessoires

Ils se choisissent arme par arme, sous la fiche de chacune, et chaque arme garde les siens : un silencieux sur le HK416 ne passe pas au MP5.

- **Silencieux** (fusils d'assaut, pistolets mitrailleurs, armes de poing ; pas les fusils à pompe) : voir **Bruit et silencieux**. Les coéquipiers ont leur propre bouton, à part.
- **Laser** (toute arme à rail : pas l'AKM, l'Uzi, le Škorpion, le Makarov ni le Tokarev) : le point montre où part la balle, ce qui divise par deux la dispersion due au déplacement, et la gêne de la tenue d'une main derrière un bouclier. Mais un faisceau se voit : un suspect qui aperçoit le trait ou le point dans son champ se tourne vers sa source, et s'il le voit encore, il vient voir. `L` l'éteint ou le rallume ; il s'éteint de lui-même pendant un geste, un rechargement, la fibre ou une grenade dégoupillée.

### Boucliers

Un bouclier balistique se prend à la place de l'arme principale (assaut seulement). Tenu au bras gauche, il ne laisse que l'arme de poing, tirée d'une main par-dessus le bord, donc moins précise ; on emporte deux chargeurs de plus, et on ne ramasse qu'une arme de poing. Il couvre l'avant : les balles de son niveau s'y arrêtent dans une gerbe d'étincelles, celles qui le dépassent le traversent en perdant un quart de leurs dégâts. De flanc et de dos, on est à découvert.

| Bouclier | Niveau | Format | Masse | Arrête | Vitesse | Champ de vision |
|---|---|---|---|---|---|---|
| Léger | NIJ IIIA | 50 × 90 cm | 7,3 kg | armes de poing, pistolets mitrailleurs 9 mm, chevrotine | ×0,88 | 110° |
| Lourd | NIJ III | 55 × 95 cm | 14 kg | tout, balles de fusil comprises | ×0,74 | 95° |

Les suspects portent surtout des AKM : face à eux, le bouclier léger ne suffit pas. Le 4,6 mm du MP7 et le 7,62 Tokarev, plus rapides que le 9 mm, le traversent aussi.

Personne n'a la même arme : à chaque partie, coéquipiers, opérateurs d'assaut et suspects tirent la leur au sort dans le lot de leur camp. Les coéquipiers en ont toujours deux différentes, et les suspects panachent Kalachnikov, pistolet, Uzi et fusil à pompe scié. Toute arme ramassée sur un corps devient sa version complète, avec de vraies munitions.

## Bruit et silencieux

Tout ce qui fait du bruit s'entend à une certaine distance : un coup de feu (13 à 18 cases selon l'arme), une explosion, une serrure arrachée, une porte ouverte en grand (5 cases, 1,5 en l'entrebâillant), l'impact d'une balle dans un mur (2,5), un corps qui tombe, un cri, des pas de course (2 à 2,5). **Marcher est silencieux.** Le son se propage dans le bâtiment comme on l'attend : il contourne les angles par les portes ouvertes, et chaque mur traversé lui coûte trois cases, chaque porte fermée une case et demie, chaque vitre un peu moins.

Un suspect qui entend quelque chose se tourne vers le bruit et s'inquiète. Un bruit fort (tir, explosion, cri) ou des bruits qui se répètent le font venir voir : deux au plus sur un même bruit, les autres guettent de ce côté, et une fusillade qui dure finit par attirer tout le monde. Faute de trouver, il cherche un instant puis regagne son poste. Celui qui vous repère crie l'alerte ; celui qui découvre le corps d'un des siens aussi. Un « ? » jaune au-dessus d'un suspect veut dire qu'il cherche (pâle : qu'il guette). Les coups de feu de ses camarades l'alertent aussi : un échange de tirs fait venir du renfort.

Ce que vous entendez sans le voir s'affiche autour de votre personnage : un arc dans la direction du bruit, d'autant plus épais et opaque que le bruit est fort. Rouge pour un tir, jaune pour une porte, gris pour des pas ou une grenade qui rebondit, orange (avec un « ! ») pour un cri, rose pour un corps qui tombe, blanc pour une explosion. Après chacun de vos propres bruits, un halo clair montre jusqu'où il a porté.

**Silencieux** : au briefing, arme par arme pour vous, et d'un seul bouton pour vos coéquipiers. Un tir ne s'entend plus qu'à 2 à 5 cases selon le calibre ; le 5,56, le 7,62 et le 4,6 restent supersoniques (on entend encore le claquement de près), le 9 mm et le .45, tirés en subsonique, presque plus — mais leur balle porte un peu moins loin et frappe un peu moins fort. L'arme s'alourdit (un peu de mobilité en moins) et s'allonge, la flamme de bouche disparaît presque. Pas de silencieux sur un fusil à pompe : les coéquipiers en changent quand on leur en fait monter. Une balle manquée claque toujours contre le mur, et un corps qui tombe s'entend : le silence n'est jamais total.

## Gestes

Manœuvrer une porte ou lancer une flash occupe les deux mains : le geste dure un instant (le temps de manœuvrer la poignée plus la course du battant : environ 0,55 s pour ouvrir ou fermer en grand, 0,37 s pour entrouvrir, 0,29 s pour entrebâiller, et 0,45 s pour dégoupiller et armer le bras), pendant lequel on ne tire pas, on avance au ralenti et le viseur s'ouvre en grand ; la visée met encore un peu moins d'une seconde à se replacer ensuite. L'anneau du viseur montre l'avancement, comme pour un rechargement. Coéquipiers et suspects sont soumis aux mêmes délais — les suspects sont un peu plus lents sur les portes.

## Portes

Une porte a quatre crans : fermée, entrebâillée, entrouverte, ouverte. Tant qu'elle n'est pas grande ouverte, le battant arrête le regard : on ne voit que par l'entrebâillement, et il faut être tout près — et plutôt du côté de l'ouverture — pour découvrir quelque chose. Concrètement, à une case de la porte, un battant entrouvert donne environ 90° de champ contre 74° pour un simple entrebâillement vu de côté (et rien de face) ; à trois cases en retrait, on ne voit plus rien tant que la porte n'est pas ouverte. Le battant ouvert masque lui aussi un pan de la pièce. Cela vaut dans les deux sens : un suspect derrière une porte entrouverte ne vous voit pas davantage.

On se glisse dans l'embrasure dès le cran « entrouverte » : une porte entrebâillée, elle, ne laisse passer que le regard. Glisser une grenade par l'entrebâillement demande aussi le cran « entrouverte ». Une porte fermée cache, mais ne protège pas : on tire à travers, dans les deux sens. Ce qui se passe derrière reste caché : les traçantes, les gerbes et taches de sang, les impacts, les douilles et le corps d'un suspect abattu à l'aveugle n'apparaissent qu'une fois que vous (ou un coéquipier) avez vu l'endroit.

**Au fusil à pompe, on ouvre une porte en tirant dedans** : cinq plombs dans la serrure et le pêne saute, le battant s'ouvre d'un coup. Il faut une rafale groupée — des impacts espacés de plus de trois secondes ne comptent plus — et la porte ne se referme plus ensuite, le bois éclaté restant visible à la place de la poignée. Ça marche dans les deux camps : un suspect au fusil à pompe entre chez vous de la même façon.

On ne peut pas refermer une porte si quelqu'un (vous compris) ou une grenade se trouve dans l'embrasure ; le message dit lequel. Toute autre manœuvre refusée est annoncée elle aussi — porte déjà fermée, déjà grande ouverte, ou en train de bouger.

## Grenades

Une grenade lancée vole par-dessus le mobilier (tables, plantes, caisses, canapés...) : seuls les murs, les fenêtres et les portes l'arrêtent en l'air. Une fois retombée, elle roule et rebondit sur les meubles qu'elle rencontre ; tombée sur une table ou un lit, elle en roule jusqu'au sol. Les opérateurs de l'IA en tiennent compte pour décider s'ils lancent.

Dégoupiller et armer le bras prend 0,45 s. **La mèche commence à brûler à la fin de ce geste, pas au lancer** : tant que vous gardez `Espace`, la grenade reste en main et le compte à rebours tourne. L'anneau du viseur passe au rouge et se vide. Une fois au sol, la grenade porte le même anneau : il se vide dès qu'elle touche le sol, et rougit dans la dernière demi-seconde. Relâchez, et elle part vers le curseur avec le temps déjà brûlé : de quoi la faire éclater en l'air ou à l'arrivée, sans laisser le temps de la fuir. Gardez-la jusqu'au bout et elle vous explose dans la main. Tant qu'elle est dégoupillée, vous ne tirez pas et vous ne rechargez pas.

## Minimap

En haut à droite, un plan réduit du bâtiment montre ce que vous avez déjà exploré : les pièces, le mobilier, les portes (fermée, entrouverte, ouverte) et les fenêtres, votre équipe, les otages connus (en vert ceux qui vous suivent) et les adversaires visibles en ce moment. Tant que vous escortez un otage, les sorties y battent en vert. En siège, le plan est complet dès le départ, puisque vous connaissez les lieux, et la pièce où une vague d'assaut vient d'entrer y clignote en rouge pendant huit secondes. `M` la replie.

## Fibre optique

Devant une porte fermée ou entrouverte, maintenir `F` glisse une fibre sous le battant : après un geste de mise en place, vous découvrez un large cône (150°, 6 cases) de la pièce voisine, suspects et otages compris, sans ouvrir ni faire de bruit. Tant que vous observez, vous ne tirez pas et vous ne rechargez pas ; le moindre pas, l'ouverture de la porte ou le relâchement de la touche retire la fibre.

## Coéquipiers

Bravo et Charlie ne tirent jamais à travers vous ni à travers un otage, et ils tiennent compte de la gerbe de leur arme : plus elle s'ouvre, plus ils exigent de marge avant de presser la détente. Quand l'axe reste bouché, ils se décalent pour dégager l'angle plutôt que d'attendre, et un ordre de déplacement l'emporte sur un contact : ils rompent et progressent en gardant le suspect en joue.

## Dispositions

Rien ne se mémorise d'une partie à l'autre : à chaque chargement, les postes des terroristes et des otages sont tirés au sort parmi les emplacements de la carte et un quadrillage de cases libres, bien répartis. En siège, votre propre poste change aussi. En assaut, aucun poste ne tombe dans la pièce par laquelle vous entrez.

## Otages

À genoux, tête baissée, un otage est une petite cible. Une première blessure légère ne le tue pas (sa chemise se tache de sang et le HUD l'annonce), mais une deuxième blessure, ou une blessure grave (45 points de dégâts ou plus d'un coup : éclat de grenade proche, balle lourde), le tue.

**Un otage n'est sauvé qu'une fois sorti du bâtiment.** Près de lui, `H` le relève (un bref geste, arme basse) : il vous suit, les mains sur la tête, et plusieurs otages se mettent en file derrière vous. `H` à nouveau sur le plus proche, il attend à genoux. Debout, il fait une cible plus large, et il se jette à terre dès qu'on tire près de lui, le temps que ça cesse. Il n'ouvre pas les portes : laissez-les au moins entrouvertes derrière vous (le HUD vous prévient s'il reste bloqué), et on ne peut pas refermer une porte sur lui. Amenez-le devant une porte extérieure ouverte ou une fenêtre : il franchit l'ouverture (une fenêtre s'enjambe, c'est un peu plus long) et il est évacué. Si vous tombez, ceux qui vous suivaient se remettent à genoux. Les sortir n'est pas exigé — la mission est accomplie dès que tous les suspects sont neutralisés —, mais un otage dehors ne risque plus rien, et un seul otage tué fait échouer la mission. Le HUD compte les suspects restants et les otages évacués.

## Relais et armes au sol

Si vous tombez, la partie ne s'arrête pas : après un court instant, vous reprenez la main dans le coéquipier debout le plus proche, avec son arme, de vraies munitions (sa réserve n'est plus illimitée) et une flash. La mission n'est perdue que lorsque toute l'équipe est à terre.

Chaque corps garde son arme au sol. Près d'un corps, `V` la ramasse, avec un bref geste pendant lequel vous ne tirez pas. Elle remplace l'arme de même catégorie (arme de poing contre arme de poing, arme principale contre arme principale), qui reste au sol à sa place : vous pouvez la reprendre plus tard, avec son chargeur entamé. Une arme prise à un suspect ou à un opérateur est rechargée comme une arme réelle, chargeur plein et réserve normale.

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

## Tests

Ouvrir `tests/index.html` dans un navigateur (servi par `python -m http.server`, ou directement en local) : la page joue une série de scénarios et affiche ce qui passe et ce qui casse. En ligne de commande, Chrome sans interface fait l'affaire ; le titre de la page vaut `PASS` ou `FAIL n` :

```
chrome --headless --allow-file-access-from-files --dump-dom tests/index.html
```

## Ajouter une mission

Ajouter une entrée dans `LEVELS` (`js/levels.js`). Une case ASCII vaut 32 px ; au chargement, la carte est convertie en grille fine de 16 px : les murs n'ont qu'une petite case d'épaisseur, les portes font 48 px de large et les meubles occupent un bloc de 32 px. Légende :

| Caractère | Sens |
|---|---|
| `#` | mur |
| `.` `,` `:` | sol béton / parquet / carrelage |
| `;` `=` `%` | sol moquette / dallage de marbre / tôle striée |
| espace | vide (hors bâtiment) |
| `D` | porte fermée |
| `X` | porte extérieure : un point d'entrée pour l'intervention |
| `W` | fenêtre : on voit et on tire au travers, on ne la franchit pas à pied ; point d'entrée pour l'intervention |
| `S` | départ du joueur |
| `E` `^` `v` `<` `>` | ennemi (aléatoire ou orienté) |
| `H` | otage |
| `c` `B` `T` `p` `b` `k` | caisse, baril, table, plante, lit, bureau (bloquent le passage, pas la vue ; une grenade lancée passe par-dessus) |
| `s` `r` `a` `R` `P` `C` | canapé, rayonnage, armoire, baie de serveurs, palette chargée, comptoir (idem) |
| `#` isolé dans une pièce | pilier |

Lit, canapé, rayonnage, armoire, baie de serveurs et comptoir se mettent dos au mur voisin, et plusieurs cases alignées du même meuble se dessinent d'un seul tenant (`sss` : un canapé trois places).

Ne placez ni ennemi ni otage dans une pièce qui donne sur une ouverture (`X` ou `W`) : c'est la zone d'entrée de l'équipe. Le jeu déplace de toute façon derrière la porte la plus proche quiconque s'y trouverait, et `tests/index.html` signale la carte fautive.
