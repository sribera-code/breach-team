# Breach Team

Shoot tactique en vue de dessus, temps réel : un opérateur et deux coéquipiers pilotés par l'IA. HTML5 / Canvas, sans dépendance ni build. Tous les graphismes sont dessinés par le code (`js/sprites.js`) : aucun asset externe.

## Lancer

Ouvrir `index.html` dans un navigateur, ou servir le dossier :

```
python -m http.server 8000
```

puis aller sur http://localhost:8000.

## Déployer sur Render

Le dépôt contient un Blueprint (`render.yaml`) qui publie le jeu comme site statique gratuit. Sur [Render](https://render.com/) : **New → Blueprint**, choisir ce dépôt, puis **Apply**. Le build se contente de copier `index.html`, `css/` et `js/` dans `public/` (les tests et la doc ne sont pas publiés), et chaque push sur la branche suivie redéploie le site.

Sans Blueprint, **New → Static Site** fonctionne aussi, avec ces réglages :

| Champ | Valeur |
|---|---|
| Build Command | `rm -rf public && mkdir -p public && cp -r index.html css js public/` |
| Publish Directory | `public` |

## Cinq modes

Au lancement, on choisit d'abord le **mode**, puis la **carte** (chaque mode a les siennes, voir **Cartes**), puis l'**équipement** au briefing. Un fil en haut du briefing (« 1. Mode › 2. Carte › 3. Équipement ») ramène d'un clic au choix du mode ou de la carte ; en pause et en fin de partie, les boutons « Cartes » et « Modes » aussi. Les deux camps des trinômes et de la guerre totale n'ont qu'une carte de mode : le camp se choisit au briefing.

**Assaut** — le mode d'origine : vous menez l'intervention avec Bravo et Charlie et vous neutralisez les suspects (abattus, ou rendus et menottés) sans perdre un seul otage ; les faire sortir les met à l'abri, mais n'est pas exigé. Le point d'entrée est tiré au sort à chaque partie — le briefing ne dit pas lequel est sorti, vous le découvrez sur place — et il vous laisse le fixer si vous préférez : chaque carte a plusieurs portes extérieures et fenêtres, et la pièce par laquelle vous entrez est toujours vide : le premier contact se fait derrière une porte.

**Siège** — vous incarnez le chef du groupe armé. Vous connaissez les lieux (le plan vous est acquis dès le départ), vous êtes neuf — vous et huit complices, chacun à son poste et sans ordres à recevoir : personne ne commande personne —, vous verrouillez les portes, et une équipe d'intervention donne l'assaut après dix secondes de préparation — par une porte extérieure ou une fenêtre, sans que vous sachiez laquelle. Elle progresse secteur par secteur, converge sur les coups de feu, lance des flashs avant d'entrer là où elle vous a entendu, et attaque en **trois vagues de trois opérateurs**, chaque fois par une autre ouverture. De temps en temps — plus souvent quand elle vous sait derrière —, deux opérateurs ou plus se mettent en colonne de part et d'autre d'une porte fermée, comme votre équipe en assaut, puis entrent : porte ouverte en grand, flash glissée par l'entrebâillement (à trois, s'il leur en reste), ou charge de brèche (une par vague) qui souffle la porte et sonne tout ce qui se tient derrière. Pas de temps mort : la vague suivante entre six secondes après l'élimination de la précédente, ou au bout de trente secondes si celle-ci tient encore. Le HUD indique la vague en cours (« Vague 2 / 3 »). Repoussez la dernière et les négociations aboutissent.

Chaque carte a ses otages : trois à l'Entrepôt, quatre aux Bureaux, à l'Hôtel et à la Banque, cinq à la Villa et au Centre de données. Quand une vague entre, la minimap fait clignoter en rouge la pièce où elle arrive, avec une flèche sur l'ouverture franchie. Vous perdez si tout votre groupe tombe (à votre mort, vous reprenez la main dans un complice), ou s'il ne vous reste plus aucun otage vivant : tous morts, ou évacués par l'intervention. Un opérateur qui trouve un otage le relève et l'emmène vers la sortie la plus proche ; s'il l'atteint, l'otage est perdu pour vous. Abattez l'escorte en route : l'otage se remet à genoux là où il est, jusqu'à ce qu'un autre opérateur vienne le chercher. Perdre un otage ne met pas fin à la partie tant qu'il en reste un. L'intervention ne tire jamais avec un otage dans l'axe ou juste derrière sa cible : elle se décale pour trouver un angle. Garder un otage près de soi protège donc vraiment. Les otages sont votre seule protection.

L'équipement suit le camp : AKM, AK-74, Uzi, Škorpion vz. 61 ou Remington 870 en arme principale, Makarov, Tokarev TT-33 ou Glock en arme de poing, et **deux grenades à fragmentation** au lieu des flashs (`Espace`). Elles éclatent au bout de deux secondes et tuent dans un rayon d'environ une case, blessent jusqu'à trois cases et demie, vous et vos otages compris ; un mur ou une porte fermée arrête l'éclat. Pas de fibre optique de ce côté. Les opérateurs sont plus précis et portent un gilet ; vous frappez plus fort et connaissez le terrain. Portes, grenades et tir à travers les battants sont vos meilleurs outils. Les opérateurs, eux, lancent des flashs, mais seulement quand la trajectoire est libre (jamais contre une porte fermée) et jamais sur leurs équipiers ; leur propre camp détourne les yeux et n'est gêné que si l'éclair part à ses pieds.

**Escorte** — vous menez Bravo et Charlie et vous conduisez un VIP du point A, où vous venez de le rejoindre, jusqu'à la zone d'extraction, le point B, à travers des pièces tenues par un commando de dix terroristes. Le VIP vous suit dès le départ, comme un otage escorté ; près de lui, `H` le fait attendre à couvert (accroupi, il fait une petite cible), `H` à nouveau et il repart. Il n'ouvre pas les portes et se jette à terre quand on tire près de lui, mais il porte un gilet souple sous sa veste (les balles d'arme de poing, de 9 mm et la chevrotine n'y font que la moitié de leurs dégâts) et tient quelques balles : 100 points de vie ; à moitié de ses forces, il boite et suit moins vite. Le commando est là pour lui : un terroriste qui le voit lui tire dessus, avant vous, et lâche même l'opérateur avec qui il échangeait des tirs pour se tourner vers lui. Seul votre corps (ou votre bouclier) dans l'axe arrête ses balles : placez-vous entre eux, gardez-le hors des lignes de tir, faites-le attendre derrière une porte le temps de nettoyer la pièce suivante. Si vous tombez, il suit celui qui reprend la main. La mission est accomplie dès qu'il entre, vivant, dans la zone B — hachurée de vert au sol, elle bat sur la minimap même inexplorée, et le HUD donne sa direction —, quels que soient les terroristes encore debout ; elle échoue s'il meurt, ou si toute l'équipe tombe. Personne n'est posté dans la pièce du point A ni à moins de deux cases de la zone B ; ailleurs, les postes sont tirés au sort comme en assaut, avec rondes, portes verrouillées et alerte générale. L'équipement est celui de l'assaut (gilets et boucliers compris), et le courant peut être coupé.

**Trinômes** — deux trinômes contre deux, l'intervention contre le groupe armé, dans le camp de votre choix (un seul bouton de mode ; le camp se choisit à gauche du briefing, chacun avec son équipement, gardé à part). Pas d'otage ni de poste : les quatre trinômes entrent dans le bâtiment. Vous menez le vôtre — vous et deux coéquipiers, avec tous les ordres habituels (`T`, clic droit, colonne, entrée à la flash) — par l'ouverture choisie ; le second trinôme de votre camp (Delta, Echo et Fox côté intervention ; Sacha, Dimitri et Goran côté groupe armé) entre par l'ouverture la plus proche de la vôtre et progresse seul ; les deux trinômes d'en face entrent par les ouvertures les plus éloignées, hors de vue de la vôtre. Un trinôme autonome balaie le bâtiment depuis son entrée, converge sur ce qu'il entend du camp d'en face, partage aussitôt ce que chacun apprend et reste groupé (celui qui a pris de l'avance attend les autres). Ceux de l'intervention ont des flashs et une charge de brèche, et se mettent de temps en temps en colonne sur une porte ; ceux du groupe armé, aussi solides et aussi vifs qu'un opérateur, ont deux grenades à fragmentation chacun, qu'ils ne lancent jamais à moins de quatre cases et demie ni près des leurs, et des accessoires sur leur arme (silencieux, laser, poignée, chargeur long : voir **Accessoires**). Dans ce mode, une balle touche qui se trouve sur sa route, ami ou ennemi, des deux côtés. Pas de sommation. Si vous tombez, vous reprenez la main dans un coéquipier, puis, votre trinôme à terre, dans un homme de l'autre trinôme de votre camp, avec son arme. Le premier camp entièrement hors de combat a perdu ; la note tient compte de votre camp resté debout et des adversaires neutralisés. Dans le HUD, le second trinôme figure en italique sous vos coéquipiers (« Progresse », « En colonne », « Entre »...), et l'objectif compte qui reste debout de chaque côté.

**Guerre totale** — deux armées de trois trinômes s'affrontent sans relâche pendant **cinq minutes** sur un champ de bataille en plein air, l'intervention contre le groupe armé, dans le camp de votre choix. Chaque armée part de sa base (hachurée au sol, bleue pour la vôtre, rouge pour l'autre ; au briefing, vous choisissez la vôtre ou laissez le sort décider). Vous menez le trinôme du centre, avec les ordres habituels ; les deux autres trinômes de votre armée (Delta, Echo et Fox, puis Golf, Hotel et India côté intervention ; Sacha, Dimitri et Goran, puis Lev, Petar et Yuri côté groupe armé) tiennent chacun un flanc, et les trois d'en face ont aussi chacun leur couloir : le champ de bataille est coupé en trois bandes d'une base à l'autre, et un trinôme autonome avance dans la sienne par étapes, puis la reprend dans l'autre sens, en convergeant sur tout ce qu'il voit ou entend de l'adversaire. **Un trinôme dont plus personne n'est debout revient de sa base six secondes plus tard**, frais. Le vôtre aussi : si vous tombez, vous reprenez d'abord la main dans un coéquipier ; votre trinôme anéanti, le HUD décompte les renforts et vous repartez de la base avec deux coéquipiers frais et l'équipement choisi au briefing (jamais dans un homme d'un autre trinôme). Le champ de bataille est connu d'avance (la minimap le montre en entier), mais l'adversaire ne se voit que dans le champ de vision de votre armée. Chaque homme abattu compte un point pour l'armée d'en face ; le chrono décompte, et au bout des cinq minutes l'armée qui a le plus de points l'emporte — à égalité, personne. La note tient compte de l'issue (40, 20 pour une égalité), de la part de votre armée dans le décompte (30), de vos propres éliminations (4 points chacune, 20 au plus) et de votre trinôme tenu (10, moins 5 chaque fois qu'il revient de la base) ; seules vos balles dans votre camp coûtent des points. Une égalité ne dépasse pas C. Les corps tombés depuis longtemps, hors de vue, finissent par disparaître.

## Cartes

Chaque mode a ses cartes, pensées pour ce qu'on y fait. L'écran du choix de la carte montre le plan de chacune, avec ses portes, ses fenêtres et ses ouvertures sur l'extérieur (ses points A et B en escorte, ses bases en guerre totale) ; les postes des suspects et des otages, tirés au sort à chaque partie, n'y figurent pas.

**Les bâtiments à otages**, que l'assaut et le siège se partagent (chacun a son briefing de siège) : Entrepôt, Bureaux, Villa, Hôtel (chambres sur un long couloir, hall de marbre, restaurant et cuisines), Banque (grand hall à piliers, guichets, salle des coffres, salle informatique) et Centre de données (quai de chargement, salle des serveurs en allées parallèles, supervision), et deux cartes en plein air, bien plus grandes : la Maison de maître (au milieu d'un jardin clos de haies, avec garage, cabane, terrasse et bassin) et le Corps de ferme (logis, grange et sellerie, atelier, autour d'une grande cour gravillonnée, avec verger et mare). En plein air, on arrive par les entrées du terrain, au bord de la carte, et il faut traverser le jardin à découvert : les haies arrêtent le regard et les balles, les arbres non.

**L'assaut** y ajoute le Musée (grande galerie à piliers sous une verrière, salles de vitrines, atelier de restauration). **Le siège** y ajoute deux bâtiments pensés pour la défense, un cœur à tenir et quatre ou cinq accès à surveiller : la Mairie (salle des pas perdus au centre, salle du conseil, salle des mariages, cabinet du maire, archives) et le Supermarché (surface de vente en longues allées, sas d'entrée, réserve et quai de livraison, chambre froide).

**L'escorte**, quatre cartes traversées d'un coin à l'autre, avec plusieurs chemins possibles : l'Ambassade (l'ambassadeur, de la salle forte au garage, par les salons et le grand hall ou par le secrétariat et les cuisines), le Palais de justice (le témoin protégé, de la salle des témoins à la cour des fourgons, par la salle d'audience et la salle des pas perdus, ou par les archives et le greffe), l'Hôpital (le ministre, de sa chambre au quai des urgences, par le long couloir coupé de portes coupe-feu, par les chambres qui communiquent, ou par la salle d'attente et le bloc opératoire) et la Gare (le ministre, du salon d'honneur au parvis des taxis, par la salle des pas perdus, le buffet et les guichets, ou par le couloir souterrain et le quai).

**Les trinômes**, trois arènes symétriques, ouvertes sur chaque façade, sans suspect ni otage : le Lycée (classes, long couloir, réfectoire, CDI, préau), la Galerie marchande (atrium et fontaine, boutiques à vitrines, aire de restauration) et le Chantier (en plein air : un immeuble en construction, ses poteaux et ses murs à moitié montés, clos d'une palissade à quatre portails).

**La guerre totale**, trois champs de bataille symétriques avec une base à chaque bout et trois couloirs de l'une à l'autre : le Village (deux ruisseaux franchis par trois ponts, église, place et fontaine, école, fermes), le Port (deux quais face à face, un bassin franchi par une passerelle, hangars et dédale de conteneurs) et l'Usine (ateliers, entrepôts, cours de livraison et chaufferie au centre). Sacs de sable, caisses, palettes et arbres y font des abris contre le pas, pas contre les balles.

## Contrôles

| Action | Commande |
|---|---|
| Se déplacer | `ZQSD` / `WASD` / flèches |
| Marche / course | `A` (AZERTY) / `Q` (QWERTY) ou `Maj` (on commence en marche, qui est silencieuse) |
| Viser / tirer | souris / clic gauche (maintenu pour les armes automatiques) |
| Recharger | `R` ou clic molette |
| Changer d'arme | `1` / `2` / `Alt` |
| Laser | `L` allume / éteint le laser de l'arme qui en porte un |
| Lampe | `X` allume / éteint la lampe (et celles des coéquipiers) |
| Porte | `E` ouvre / ferme d'un coup (crochète une porte verrouillée) ; molette : fermée ↔ entrebâillée ↔ entrouverte ↔ ouverte (chaque cran est un geste) |
| Charge de brèche | `B` devant une porte fermée : poser ; `B` à nouveau : mise à feu |
| Sommation | `C` : « Police ! À terre ! » |
| Fibre optique | `F` maintenu devant une porte fermée ou entrouverte |
| Grenade | `Espace` ou `G` maintenu : la mèche part à la fin de l'armement, la grenade au relâchement |
| Changer de grenade | `N` : flash ↔ fragmentation (lot mixte de l'intervention) |
| Ramasser une arme | `V` près d'un corps (échange avec l'arme de même catégorie) |
| Otage / VIP / menottes | `H` près d'un otage : il se relève et vous suit ; `H` à nouveau : il attend à genoux. Près du VIP (escorte) : il attend à couvert, ou repart. Près d'un suspect rendu : le menotter |
| Équipe | `T` suivre / tenir ; clic droit : aller là (sur soi : suivre ; sur une porte fermée : en colonne, prêts à entrer ; à nouveau sur la même porte : entrée à la flash) |
| Direction à couvrir | clic droit **maintenu**, puis tirer vers la direction avant de relâcher |
| Minimap | `M` (affichée par défaut) |
| Pause | `Échap` (libère aussi la souris, qu'un clic dans le jeu reprend : verrouillée, elle ne bute plus sur le bord de la fenêtre) |

Objectif : neutraliser tous les suspects, sans perdre toute l'équipe ni tuer d'otage. C'est gagné dès que le dernier suspect tombe, que les otages soient dehors ou non ; les escorter jusqu'à une porte extérieure ou une fenêtre les met à l'abri en attendant. Si vous tombez, vous continuez dans un coéquipier.

En maintenant le clic droit, une flèche part du point visé : la direction tracée est confiée à celui des deux coéquipiers qui se place de ce côté. Une fois sur place, il garde cet angle au lieu de choisir lui-même son point d'intérêt, jusqu'à l'ordre suivant ; un contact reste prioritaire.

## Armes

L'équipement se choisit dans l'écran de briefing (le choix est mémorisé), qui tient sur un seul écran : à gauche le plan, où l'on clique l'ouverture par laquelle entrer ; au milieu une arme principale — ou un bouclier — et une arme de poing, chacune avec ses accessoires ; à droite leurs fiches, qui restent à la même place d'une arme à l'autre pour les comparer. Les armes sont réelles ; calibre, cadence, capacité et masse reprennent les données constructeur, les dégâts suivent le calibre et la vitesse découle de la masse : celle de toutes les armes que vous portez, en main ou à la bretelle, accessoires compris (3,5 % de vitesse par kilo ; passer à l'arme de poing ne rend pas plus rapide, le fusil pèse toujours dans le dos). Le gilet et le bouclier ralentissent en plus, chacun selon son coefficient.

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

### Bilan de l'équipement

En haut de la colonne des caractéristiques, au briefing, un bilan résume ce qu'on emporte et se met à jour à chaque choix :

- **Charge** : la masse totale, armes et accessoires, gilet et bouclier compris ;
- **Vitesse** : celle du jeu, rapportée à la plus grande possible (une arme de poing seule) : la masse de toutes les armes portées, accessoires compris, puis le gilet lourd et le bouclier ; la ligne du dessous dit ce qui ralentit (« armes 4,5 kg · gilet lourd ×0,86 ») ;
- **Dégâts encaissés** (avec un gilet ou un bouclier) : la part des dégâts d'une balle qui vous touche, selon l'arme d'en face (pistolet, Uzi et fusil à pompe d'un côté, AKM et AK-74 de l'autre) et le côté d'où elle vient (face, flanc, dos), du vert au rouge. C'est le calcul même du jeu : plaques de face et de dos, bouclier de face seulement.

### Accessoires

Ils se choisissent arme par arme, sous la fiche de chacune, et chaque arme garde les siens : un silencieux sur le HK416 ne passe pas au MP5. Chaque bouton porte l'icône de son accessoire (silencieux, laser, lampe, poignée, chargeur, lunette), coché dans le coin quand il est monté ; la fiche de l'arme reprend les icônes devant l'effet de chacun.

- **Silencieux** (fusils d'assaut, pistolets mitrailleurs, armes de poing ; pas les fusils à pompe ; côté groupe armé, en trinômes et en guerre totale seulement) : voir **Bruit et silencieux**. Les coéquipiers ont leur propre choix, à part (ligne « Équipe »).
- **Lampe** (toute arme à rail, comme le laser) : elle éclaire un cône devant l'arme, sur douze cases. Inutile dans un bâtiment éclairé ; courant coupé, c'est elle qui fait voir loin. Prise en face à moins de six cases, elle éblouit un suspect, qui met six dixièmes de seconde de plus à viser. Mais dans le noir, elle se voit de loin. `X` l'éteint ou la rallume, celles de l'équipe avec (voir **Courant coupé**).
- **Poignée avant** (HK416, SCAR-H, MP5 ; en trinômes et en guerre totale, AKM et AK-74 ; le MP7 a déjà la sienne, repliable) : la main avant tient l'arme en rafale. Chaque tir ouvre la dispersion d'un quart de moins, son plafond baisse de 15 %, le recul de 30 %. Rien ne change au premier coup. 150 g de plus. Un tireur de l'IA ramène aussi son arme sur la cible plus vite entre deux rafales.
- **Chargeur grande capacité** : PMAG de 40 pour le HK416, chargeur de 33 pour le Glock 17, rallonge de tube de deux cartouches pour le Remington 870 ; côté groupe armé (siège, trinômes et guerre totale), tambour de 75 pour l'AKM, chargeur de 45 du RPK-74 pour l'AK-74, chargeur de 40 pour l'Uzi. On recharge moins souvent, mais la réserve ne change pas : autant de cartouches en tout. L'arme s'alourdit (1,3 kg pour le tambour) et le rechargement s'allonge de 10 % (40 % pour le tambour).
- **Lunette** (ACOG 4×32 sur le HK416, ELCAN SpecterDR sur le SCAR-H, Hensoldt 4×24 sur le MP5, PSO-1 sur le rail latéral de l'AKM et de l'AK-74 ; ni arme de poing, ni fusil à pompe, ni MP7, qui garde son point rouge) : elle ne sert qu'à l'arrêt. Immobile, l'arme épaulée et l'œil posé (quatre dixièmes de seconde), on voit 60 % plus loin dans l'axe de l'arme (une pointe de ±12° au bout du cône de vision), la dispersion de base est divisée par deux, la portée efficace et la portée de la balle s'allongent de moitié, et l'on peut viser plus loin : le point visé reste où il est et la vue glisse vers lui (à mi-chemin entre vous et lui, sans vous faire sortir de l'écran), le viseur suivant son point à l'écran. Même arrivé au bord de l'écran en courant, il retrouve ainsi de la marge pour viser plus loin. Le viseur s'entoure alors d'un cercle bleu et le HUD affiche « LUNETTE ». Au moindre pas, pendant un geste, un rechargement, la fibre ou une grenade dégoupillée, elle quitte l'œil et il ne reste que son poids (400 à 650 g). Courant coupé, elle ne fait pas voir plus loin dans le noir.
- **Laser** (toute arme à rail : pas l'Uzi, le Škorpion, le Makarov ni le Tokarev, et l'AKM et l'AK-74 seulement en trinômes et en guerre totale) : le point montre où part la balle sans épauler, ce qui divise par deux la dispersion due au déplacement (barre « En mouvement » de la fiche), et la gêne de la tenue d'une main derrière un bouclier ; à l'arrêt, arme épaulée, il n'apporte rien. Mais un faisceau se voit : un adversaire qui aperçoit le trait ou le point dans son champ se tourne vers sa source, et s'il le voit encore, il vient voir. `L` l'éteint ou le rallume ; il s'éteint de lui-même pendant un geste, un rechargement, la fibre ou une grenade dégoupillée. Les lasers de l'IA (le groupe armé des trinômes et de la guerre totale) se voient de la même façon, là où vous voyez.

**Le groupe armé des trinômes et de la guerre totale vient équipé**, quand celui du siège tient un bâtiment avec ce qu'il a. Ses AK prennent un garde-main à rails (laser, lampe, poignée, dessiné en polymère sombre à la place du bois) et un silencieux — PBS-1 sur l'AKM, PBS-4 sur l'AK-74, chacun avec sa munition subsonique ; l'Uzi prend un manchon de 9 mm, le Škorpion son silencieux d'origine, sans rien perdre : son 7,65 Browning est subsonique d'origine. Au briefing de ce camp, ces boutons s'ouvrent (en siège, ils restent grisés et la bulle dit pourquoi), et une ligne « Complices » montre l'arme et les accessoires de chacun. Chaque homme que mène l'IA dans ce camp (vos complices, les autres trinômes de votre camp, ou ceux d'en face) reçoit un lot tiré au sort : poignée et laser, silencieux et poignée, chargeur long et laser, silencieux seul, poignée et chargeur long. Son chargeur reste sans fin, mais l'arme ramassée sur son corps garde tout ce qu'elle porte, tambour compris.

### Boucliers

Un bouclier balistique se prend à la place de l'arme principale (assaut seulement). Tenu au bras gauche, il ne laisse que l'arme de poing, tirée d'une main par-dessus le bord, donc moins précise ; on emporte deux chargeurs de plus, et on ne ramasse qu'une arme de poing. Il couvre l'avant : les balles de son niveau s'y arrêtent dans une gerbe d'étincelles, celles qui le dépassent le traversent en perdant un quart de leurs dégâts. De flanc et de dos, on est à découvert.

| Bouclier | Niveau | Format | Masse | Arrête | Vitesse | Champ de vision |
|---|---|---|---|---|---|---|
| Léger | NIJ IIIA | 50 × 90 cm | 7,3 kg | armes de poing, pistolets mitrailleurs 9 mm, chevrotine | ×0,88 | 110° |
| Lourd | NIJ III | 55 × 95 cm | 14 kg | tout, balles de fusil comprises | ×0,74 | 95° |

### Gilets

En assaut et en escorte, on choisit son gilet au briefing : les deux sont proposés côte à côte, sous les accessoires, avec leur icône, et celui qu'on porte est en surbrillance ; en jeu, il s'affiche à côté de la santé (« SANTÉ · Gilet lourd »), avec le bouclier s'il y en a un. Une balle arrêtée par le gilet ne laisse que le choc, et dérange un instant la visée ; une balle qui le perce frappe de tous ses dégâts. Seul le joueur choisit : Bravo et Charlie gardent leur équipement.

| Gilet | Niveau | Masse | Arrête | Choc | Vitesse |
|---|---|---|---|---|---|
| Souple (par défaut) | NIJ IIIA | 2,5 kg | tout autour : armes de poing, pistolets mitrailleurs 9 mm, chevrotine | moitié des dégâts | ×1 |
| Lourd à plaques | NIJ IV | 11 kg | le souple, plus des plaques devant et derrière (±55°) qui arrêtent aussi les balles de fusil | moitié (souple), 30 % (plaque) | ×0,86 |

C'est la classe de perforation des armes qui décide, comme pour les boucliers : une balle d'AK traverse le gilet souple, mais s'arrête sur une plaque, de face ou de dos ; de flanc, seul le gilet souple protège.

Les suspects portent surtout des Kalachnikov (AKM, parfois AK-74) : face à eux, le bouclier léger ne suffit pas. Le 4,6 mm du MP7 et le 7,62 Tokarev, plus rapides que le 9 mm, le traversent aussi.

Personne n'a la même arme : à chaque partie, coéquipiers, opérateurs d'assaut et suspects tirent la leur au sort dans le lot de leur camp. Les coéquipiers en ont toujours deux différentes, et les suspects panachent Kalachnikov, pistolet, Uzi et fusil à pompe scié. Toute arme ramassée sur un corps devient sa version complète, avec de vraies munitions.

L'IA tire à la cadence réelle de son arme (celle du modèle qu'on ramasse sur le corps), en rafales : trois coups en automatique pour les coéquipiers et l'intervention, quatre à six pour le groupe armé et les suspects, une paire au pistolet, un coup à la fois au fusil à pompe, dont la pompe impose son rythme. Entre deux rafales, le temps de ramener l'arme sur la cible, plus long quand elle relève fort (un AKM plus qu'un MP5). Rien n'est réglé au métronome : d'une rafale à l'autre, un coup de plus ou de moins, et une pause qui varie d'un quart.

**On n'est pas pris pour cible depuis le hors-champ.** L'IA (suspects, opérateurs, trinômes, coéquipiers) voit jusqu'à douze ou quatorze cases, mais n'ouvre le feu qu'à neuf au plus, quelle que soit la portée de son arme : plus loin, elle se rapproche d'abord. L'écran, de son côté, montre toujours au moins sept cases au-dessus et au-dessous de son centre (sur un écran large, c'est la hauteur qui manquait), et la vue se décale vers le curseur : en visant vers le bord de l'écran, on voit dix cases et demie devant soi. Un tireur qui vous vise peut donc être à l'écran, pourvu que vous regardiez de son côté.

## Bruit et silencieux

Tout ce qui fait du bruit s'entend à une certaine distance : un coup de feu (13 à 18 cases selon l'arme), une explosion, une serrure arrachée, une porte ouverte en grand (5 cases, 1,5 en l'entrebâillant), l'impact d'une balle dans un mur (2,5), un corps qui tombe, un cri, des pas de course (2 à 2,5). **Marcher est silencieux.** Le son se propage dans le bâtiment comme on l'attend : il contourne les angles par les portes ouvertes, et chaque mur traversé lui coûte trois cases, chaque porte fermée une case et demie, chaque vitre un peu moins.

Un suspect qui entend quelque chose se tourne vers le bruit et s'inquiète. Un bruit fort (tir, explosion, cri) ou des bruits qui se répètent le font venir voir : deux au plus sur un même bruit, les autres guettent de ce côté, et une fusillade qui dure finit par attirer tout le monde. Faute de trouver, il cherche un instant puis regagne son poste. Celui qui vous repère crie l'alerte ; celui qui découvre le corps d'un des siens aussi. Un « ? » jaune au-dessus d'un suspect veut dire qu'il cherche (pâle : qu'il guette). Les coups de feu de ses camarades l'alertent aussi : un échange de tirs fait venir du renfort.

Ce que vous entendez sans le voir s'affiche autour de votre personnage : un arc dans la direction du bruit, d'autant plus épais et opaque que le bruit est fort. Rouge pour un tir, jaune pour une porte, gris pour des pas ou une grenade qui rebondit, orange (avec un « ! ») pour un cri, rose pour un corps qui tombe, blanc pour une explosion. Après chacun de vos propres bruits, un halo clair montre jusqu'où il a porté.

**Silencieux** : au briefing, arme par arme pour vous, et pour vos coéquipiers sur la ligne « Équipe », sous le gilet : « Silencieux » ou « Sans », le choix retenu en surbrillance, et dessous l'arme que Bravo et Charlie ont reçue (🔇 quand elle porte un silencieux). Un tir ne s'entend plus qu'à 2 à 5 cases selon le calibre ; un silencieux freine les gaz, pas la balle. Le 5,56, le 7,62 et le 4,6 restent donc supersoniques : ni puissance ni portée perdues, mais on entend encore le claquement de près. Le 9 mm ne se tait presque plus qu'avec une munition subsonique, plus lente : 10 % de dégâts en moins, 15 % de portée efficace et 10 % de portée en moins. Le .45 ACP, subsonique d'origine, se tait sans rien perdre. Côté groupe armé, en trinômes, l'AKM et l'AK-74 passent eux aussi à une munition subsonique (3 cases, mêmes pertes que le 9 mm), l'Uzi de même (2,5) ; le Škorpion, en 7,65 Browning, se tait sans rien perdre (2). La fiche de l'arme, au briefing, dit ce que chaque accessoire lui change. L'arme s'alourdit (un peu de mobilité en moins) et s'allonge, la flamme de bouche disparaît presque. Pas de silencieux sur un fusil à pompe : les coéquipiers en changent quand on leur en fait monter. Une balle manquée claque toujours contre le mur, et un corps qui tombe s'entend : le silence n'est jamais total.

## Gestes

Manœuvrer une porte ou lancer une flash occupe les deux mains : le geste dure un instant (le temps de manœuvrer la poignée plus la course du battant : environ 0,55 s pour ouvrir ou fermer en grand, 0,37 s pour entrouvrir, 0,29 s pour entrebâiller, et 0,45 s pour dégoupiller et armer le bras), pendant lequel on ne tire pas, on avance au ralenti et le viseur s'ouvre en grand ; la visée met encore un peu moins d'une seconde à se replacer ensuite. L'anneau du viseur montre l'avancement, comme pour un rechargement. Coéquipiers et suspects sont soumis aux mêmes délais — les suspects sont un peu plus lents sur les portes.

## Portes

Une porte a quatre crans : fermée, entrebâillée, entrouverte, ouverte. Tant qu'elle n'est pas grande ouverte, le battant arrête le regard : on ne voit que par l'entrebâillement, et il faut être tout près — et plutôt du côté de l'ouverture — pour découvrir quelque chose. Concrètement, à une case de la porte, un battant entrouvert donne environ 90° de champ contre 74° pour un simple entrebâillement vu de côté (et rien de face) ; à trois cases en retrait, on ne voit plus rien tant que la porte n'est pas ouverte. Le battant ouvert masque lui aussi un pan de la pièce. Cela vaut dans les deux sens : un suspect derrière une porte entrouverte ne vous voit pas davantage.

On se glisse dans l'embrasure dès le cran « entrouverte » : une porte entrebâillée, elle, ne laisse passer que le regard. Glisser une grenade par l'entrebâillement demande aussi le cran « entrouverte ». Une porte fermée cache, mais ne protège pas : on tire à travers, dans les deux sens. Ce qui se passe derrière reste caché : les traçantes, les gerbes et taches de sang, les impacts, les douilles et le corps d'un suspect abattu à l'aveugle n'apparaissent qu'une fois que vous (ou un coéquipier) avez vu l'endroit.

**Un suspect tire dans la porte derrière laquelle il vous sait.** S'il vous a vu par l'entrebâillement ou la porte ouverte, refermer ou vous effacer derrière le battant ne suffit pas : il arrose la porte quelques secondes là où il vous a vu disparaître, une rafale après l'autre et un peu au jugé, puis vient voir (au fusil à pompe, cette chevrotine tirée au jugé ne fait pas sauter la serrure). Même chose si vous tirez à travers une porte et que vos balles le frôlent ou le touchent : il riposte dans la porte, vers l'endroit d'où le coup est parti. Après un coup d'œil, on s'écarte donc de la porte — un mur, lui, arrête tout. L'équipe d'intervention du siège ne tire jamais ainsi à l'aveugle : des otages pourraient se trouver derrière.

**Au fusil à pompe, on ouvre une porte en tirant dedans** : cinq plombs dans la serrure et le pêne saute, le battant s'ouvre d'un coup. Il faut une rafale groupée — des impacts espacés de plus de trois secondes ne comptent plus — et la porte ne se referme plus ensuite, le bois éclaté restant visible à la place de la poignée. Ça marche dans les deux camps : un suspect au fusil à pompe entre chez vous de la même façon.

On ne peut pas refermer une porte si quelqu'un (vous compris) ou une grenade se trouve dans l'embrasure ; le message dit lequel. Toute autre manœuvre refusée est annoncée elle aussi — porte déjà fermée, déjà grande ouverte, ou en train de bouger.

Certaines portes sont **fermées à clé** (environ une sur trois, tirées au sort à chaque partie, en assaut). `E` ou la molette lance alors le crochetage : quatre secondes, presque sans bruit, arme basse ; la porte est ensuite déverrouillée et c'est à vous de choisir comment l'ouvrir. Une serrure rouge, sur la porte et sur la minimap, marque celles qu'on a essayées. Pour aller plus vite : la chevrotine dans la serrure, ou une charge. Les suspects, eux, ont les clés. Bravo et Charlie crochètent aussi les portes verrouillées sur leur trajet.

**Charge de brèche** : deux par mission. `B` devant une porte fermée pose une charge sur le battant, de votre côté (1,4 s) ; `B` à nouveau la fait sauter, où que vous soyez. La porte vole en éclats et ne se referme plus ; derrière, tout ce qui se tient à moins de deux cases et demie de l'embrasure est sonné (jusqu'à quatre secondes), même plaqué contre le mur à côté du cadre ou derrière le battant rabattu : le souffle part de toute l'embrasure. Tout contre le battant, on est aussi blessé — un otage aussi : regardez d'abord à la fibre. De votre côté, écartez-vous à plus d'une case et demie. L'explosion s'entend dans tout le bâtiment. Si quelqu'un ouvre la porte avant la mise à feu, la charge tombe.

## Grenades

Une grenade lancée vole par-dessus le mobilier (tables, plantes, caisses, canapés...) : seuls les murs, les fenêtres et les portes l'arrêtent en l'air. Une fois retombée, elle roule et rebondit sur les meubles qu'elle rencontre ; tombée sur une table ou un lit, elle en roule jusqu'au sol. Les opérateurs de l'IA en tiennent compte pour décider s'ils lancent.

Dégoupiller et armer le bras prend 0,45 s. **La mèche commence à brûler à la fin de ce geste, pas au lancer** : tant que vous gardez `Espace`, la grenade reste en main et le compte à rebours tourne. L'anneau du viseur passe au rouge et se vide. Une fois au sol, la grenade porte le même anneau : il se vide dès qu'elle touche le sol, et rougit dans la dernière demi-seconde. Relâchez, et elle part vers le curseur avec le temps déjà brûlé : de quoi la faire éclater en l'air ou à l'arrivée, sans laisser le temps de la fuir. Gardez-la jusqu'au bout et elle vous explose dans la main. Tant qu'elle est dégoupillée, vous ne tirez pas et vous ne rechargez pas.

**Le lot de grenades se choisit au briefing**, dans le camp de l'intervention (ligne « Grenades », sous le gilet) : trois flashs (le choix par défaut), deux flashs et une grenade à fragmentation (« Mixte »), ou deux grenades à fragmentation. La flash aveugle et sonne sans blesser, otages compris ; la fragmentation éclate au bout de deux secondes et tue dans un rayon de trois cases et demie, vous, les vôtres et les otages compris, mais un mur ou une porte fermée arrête l'éclat : pour une pièce tenue où personne n'attend d'être sauvé. `N` passe d'une sorte à l'autre ; le HUD montre celle en main (« Flash 2 ») et, à côté, ce qui reste de l'autre (« · Frag 1 (N) »). La dernière d'une sorte lancée, l'autre passe en main d'elle-même. Bravo et Charlie gardent leurs deux flashs pour l'entrée à la flash ; une colonne n'entre pas tant que votre grenade, flash ou fragmentation, n'a pas éclaté. Le groupe armé n'a pas le choix : deux grenades à fragmentation.

## Minimap

En haut à droite, un plan réduit du bâtiment montre ce que vous avez déjà exploré : les pièces, le mobilier, les portes (fermée, entrouverte, ouverte) et les fenêtres, votre équipe, les otages connus (en vert ceux qui vous suivent) et les adversaires visibles en ce moment. Tant que vous escortez un otage, les sorties y battent en vert ; en escorte, c'est la zone d'extraction (le point B) qui bat, dès le départ, et le VIP y figure en or. En siège, le plan est complet dès le départ, puisque vous connaissez les lieux, et la pièce où une vague d'assaut vient d'entrer y clignote en rouge pendant huit secondes. En guerre totale aussi, le champ de bataille est connu d'avance : votre base y figure en bleu, celle d'en face en rouge, et toute votre armée y apparaît. `M` la replie.

## Fibre optique

Devant une porte fermée ou entrouverte, maintenir `F` glisse une fibre sous le battant : après un geste de mise en place, vous découvrez un large cône (150°, 6 cases) de la pièce voisine, suspects et otages compris, sans ouvrir ni faire de bruit. Tant que vous observez, vous ne tirez pas et vous ne rechargez pas ; le moindre pas, l'ouverture de la porte ou le relâchement de la touche retire la fibre.

## Coéquipiers

**Entrée coordonnée** : un clic droit sur une porte fermée met Bravo et Charlie en colonne de part et d'autre de l'embrasure, de votre côté (« En colonne » dans le HUD, puis « Équipe en position »). Dès que la porte s'ouvre — vous l'ouvrez, la charge la souffle, la chevrotine fait sauter la serrure —, ils entrent chacun vers l'angle de la pièce de son côté et surveillent le fond. Si une flash est dégoupillée ou en vol, ils attendent qu'elle éclate. Tout autre ordre annule la colonne.

**Entrée à la flash** : un second clic droit sur la porte de la colonne leur laisse tout faire. Celui qui tient le poste d'où une grenade passe par l'entrebâillement entrouvre la porte (il la crochète d'abord si elle est verrouillée), glisse une flash dans la pièce, et, dès l'éclair, l'ouvre en grand : ils entrent sur des suspects aveuglés. Le bon poste dépend du sens du battant : s'il s'ouvre vers la pièce, on lance du côté des gonds, en biais ; s'il s'ouvre vers vous, du côté du bord libre. Chaque coéquipier emporte deux flashs (le HUD de l'équipe les compte) : à la mise en colonne, celui qui en a encore prend le bon poste, et s'il est à court au moment de l'ordre, ils échangent leurs places. Quand le battant, ouvert contre un mur, ne laisse aucun angle, la porte est ouverte en grand avant le lancer, ou le lanceur va se placer là d'où la flash passe. Plus une flash dans l'équipe : on vous le dit, et la colonne attend que vous ouvriez.

Bravo et Charlie ne tirent jamais à travers vous ni à travers un otage, et ils tiennent compte de la gerbe de leur arme : plus elle s'ouvre, plus ils exigent de marge avant de presser la détente. Quand l'axe reste bouché, ils se décalent pour dégager l'angle plutôt que d'attendre, et un ordre de déplacement l'emporte sur un contact : ils rompent et progressent en gardant le suspect en joue.

## Sommation et arrestation

`C` crie « Police ! À terre ! ». Chaque suspect que vous voyez à moins de sept cases peut se rendre : il lâche son arme, se met à genoux, les mains sur la tête, et plus personne ne lui tire dessus. Ses chances dépendent de la situation : presque à coup sûr s'il est aveuglé par une flash ou sonné par une charge et blessé ; bien plus s'il est pris de dos ou tenu en joue par plusieurs d'entre vous ; bien moins s'il est en plein échange de tirs ou si un complice se tient à côté de lui. Approchez-vous et `H` le menotte (1,6 s). Un suspect compte comme neutralisé une fois menotté ; s'il ne reste que des suspects rendus, le HUD le rappelle. Un suspect rendu que plus personne de l'équipe ne voit pendant sept secondes ramasse son arme et reprend le combat. Le cri s'entend comme tout cri : les autres viennent voir. La minimap montre en orange un suspect rendu, en gris un suspect menotté.

## Note de fin de mission

Chaque mission est notée sur 100, de S à D, avec le détail ligne par ligne. En assaut : mission accomplie (25), otages en vie (30, moins 4 par otage blessé), otages évacués (10), suspects arrêtés plutôt qu'abattus (20), équipe indemne (15) ; un suspect abattu après sa reddition coûte 15 points, chaque balle dans un coéquipier 3, l'alerte générale 5. En siège : assaut repoussé (40), otages encore entre vos mains (30), groupe debout (20), opérateurs neutralisés (10). En escorte : VIP exfiltré (35), santé du VIP (35, au prorata de ses points de vie), équipe indemne (20), discrétion (10 sans alerte générale) ; chaque balle de l'équipe dans le VIP coûte 10 points (une charge de brèche aussi), un suspect abattu après sa reddition 15, une balle dans un coéquipier 3. En guerre totale : voir le mode. Nul besoin de tout nettoyer pour avoir S. Une mission échouée ne dépasse pas D, une égalité pas C. Votre meilleure note par mission et par mode est gardée dans le navigateur.

## Courant coupé

Au briefing (colonne de gauche, en assaut), vous pouvez couper le courant avant d'entrer (ligne « Courant » : « Laissé » ou « Coupé », le choix retenu en surbrillance). Le bâtiment est alors dans le noir : on ne voit qu'à quatre cases, vous comme les suspects, sauf ce qu'éclaire une lampe. Un tireur sans silencieux se trahit un instant par la flamme de son arme ; un silencieux, lui, ne s'allume pas. Bravo et Charlie reçoivent une lampe et allument ou éteignent la leur avec vous (`X`). Le courant qui tombe inquiète les suspects, sans leur dire d'où viendra la menace. Une lampe allumée fait voir loin, mais se voit de loin : tout l'art est de l'allumer au bon moment.

## Dispositions

Rien ne se mémorise d'une partie à l'autre : à chaque chargement, les postes des terroristes et des otages sont tirés au sort parmi les emplacements de la carte et un quadrillage de cases libres, bien répartis. En siège, votre propre poste change aussi. En assaut, aucun poste ne tombe dans la pièce par laquelle vous entrez ; en escorte, ni dans la pièce du point A, ni près du point B.

## Rondes et alerte générale

En assaut, deux suspects tirés au sort ne tiennent pas un poste : ils font une ronde au pas (à un peu plus de la moitié de leur vitesse) entre deux ou trois points, chaque étape faisant de quatre à douze cases de chemin, avec une pause de deux à cinq secondes à chaque point pour regarder autour d'eux. Ils ont les clés et ouvrent les portes sur leur route ; aucune ronde ne passe par la pièce d'entrée. Un bruit les fait aller voir comme les autres, puis ils reprennent leur ronde. Observez avant d'entrer : une pièce vide peut ne pas le rester.

Un suspect qui vous a vu, vous ou un coéquipier, et reste debout trois secondes donne l'**alerte générale** : un « ! » rouge au-dessus de lui, dont l'anneau se remplit, le signale. Le temps où il est sonné ne compte pas ; abattu, rendu ou menotté avant, il ne prévient personne. L'alerte une fois donnée (une seule fois par mission, le HUD l'affiche), tous les autres suspects se tournent vers l'endroit signalé, réagiront 30 % plus vite, et les deux plus proches viennent voir. Elle coûte 5 points à la note de fin.

## Otages

À genoux, tête baissée, un otage est une petite cible. Une première blessure légère ne le tue pas (sa chemise se tache de sang et le HUD l'annonce), mais une deuxième blessure, ou une blessure grave (45 points de dégâts ou plus d'un coup : éclat de grenade proche, balle lourde), le tue.

**Un otage n'est sauvé qu'une fois sorti du bâtiment.** Près de lui, `H` le relève (un bref geste, arme basse) : il vous suit, les mains sur la tête, et plusieurs otages se mettent en file derrière vous. `H` à nouveau sur le plus proche, il attend à genoux. Debout, il fait une cible plus large, et il se jette à terre dès qu'on tire près de lui, le temps que ça cesse. Il n'ouvre pas les portes : laissez-les au moins entrouvertes derrière vous (le HUD vous prévient s'il reste bloqué), et on ne peut pas refermer une porte sur lui. Amenez-le devant une porte extérieure ouverte ou une fenêtre : il franchit l'ouverture (une fenêtre s'enjambe, c'est un peu plus long) et il est évacué. Si vous tombez, ceux qui vous suivaient se remettent à genoux. Les sortir n'est pas exigé — la mission est accomplie dès que tous les suspects sont neutralisés —, mais un otage dehors ne risque plus rien, et un seul otage tué fait échouer la mission. Le HUD compte les suspects restants et les otages évacués.

## Relais et armes au sol

Si vous tombez, la partie ne s'arrête pas : après un court instant, vous reprenez la main dans le coéquipier debout le plus proche, avec son arme, de vraies munitions (sa réserve n'est plus illimitée), une flash et les charges de brèche qui vous restaient. La mission n'est perdue que lorsque toute l'équipe est à terre.

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

## Ajouter une carte

Ajouter une entrée dans la liste du mode (`js/levels.js`) : `LEVELS` pour un bâtiment à otages que l'assaut et le siège se partagent, `ASSAULT_LEVELS` ou `SIEGE_LEVELS` pour l'un des deux seulement, `ESCORT_LEVELS` pour l'escorte, `SQUAD_LEVELS` pour les trinômes, `WAR_LEVELS` pour la guerre totale. Une case ASCII vaut 32 px ; au chargement, la carte est convertie en grille fine de 16 px : les murs n'ont qu'une petite case d'épaisseur, les portes font 48 px de large et les meubles occupent un bloc de 32 px. Légende :

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
| `A` | escorte : point de départ du VIP et de l'équipe |
| `Z` | escorte : zone d'extraction, le point B (plusieurs cases en bloc ; trois rangées au moins, que le VIP qui suit à distance y entre) |
| `1` `2` | guerre totale : les bases des deux armées (un bloc de cases chacune, assez grand pour trois trinômes) |
| `c` `B` `T` `p` `b` `k` | caisse, baril, table, plante, lit, bureau (bloquent le passage, pas la vue ; une grenade lancée passe par-dessus) |
| `s` `r` `a` `R` `P` `C` | canapé, rayonnage, armoire, baie de serveurs, palette chargée, comptoir (idem) |
| `g` | sacs de sable (idem ; alignés, ils forment un muret) |
| `#` isolé dans une pièce | pilier |
| `"` `_` `+` `-` | plein air : herbe / gravier / dallage de terrasse / asphalte |
| `h` | plein air : haie (arrête le pas, le regard et les balles, comme un mur) |
| `O` | plein air : entrée du terrain, au bord de la carte (par où l'on arrive) |
| `t` `~` | plein air : arbre, bassin ou ruisseau (bloquent le passage, pas la vue) |

Une carte en plein air (`outdoor: true`) n'a pas de vide autour : tout le rectangle est du terrain, clos de haies, et l'on y entre par les `O`. Les portes et fenêtres de la maison donnent alors sur le jardin et ne sont pas des ouvertures sur l'extérieur. Personne n'y est posté dehors : suspects et otages restent sous un toit.

Lit, canapé, rayonnage, armoire, baie de serveurs et comptoir se mettent dos au mur voisin, et plusieurs cases alignées du même meuble se dessinent d'un seul tenant (`sss` : un canapé trois places).

Ne placez ni ennemi ni otage dans une pièce qui donne sur une ouverture (`X` ou `W`) : c'est la zone d'entrée de l'équipe. Le jeu déplace de toute façon derrière la porte la plus proche quiconque s'y trouverait, et `tests/index.html` signale la carte fautive.

Une carte d'escorte a un `A` et une zone de `Z`, pas d'otage, et ne poste aucun terroriste dans la pièce du point A. Le VIP suit en file : laissez une case libre de tout meuble de part et d'autre de chaque porte intérieure, dans l'axe du passage (`tests/index.html` le vérifie), sinon il s'accroche au coin du meuble.

Une arène des trinômes n'a ni suspect ni otage, mais au moins quatre ouvertures, bien séparées (les deux trinômes d'en face entrent hors de vue du vôtre). Un champ de bataille de la guerre totale a ses deux bases, `1` et `2`, aucune ouverture sur l'extérieur, ni suspect ni otage, et des portes dégagées d'une case de part et d'autre ; mieux vaut le dessiner symétrique, pour que les deux armées se valent. Attention en le dessinant par symétrie : un meuble déborde d'une demi-case à droite et en bas de sa case, si bien que son reflet n'est pas exactement à la même distance du mur.
