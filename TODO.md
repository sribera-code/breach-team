# Reste à faire

État des chantiers ouverts au 10 octobre 2026. Les points sont classés par ordre d'intérêt au sein
de chaque section.

## Mode siège

- **Équilibrage à faire.** Tout est en dur dans `SIEGE_WAVES` et `Game.startSiege` (10 s de préparation,
  3 vagues de 3 opérateurs contre 9 défenseurs, 6 s de répit après une vague éliminée, 30 s au plus entre deux
  vagues) et dans les armes `hk416op` / `mp5op`. Aucune de ces valeurs
  n'a été jouée par un humain : elles sortent de parties simulées.
- **Colonnes de l'intervention réglées à l'estime** (`AI_STACK_*`, `WAVE_CHARGES` en tête de `js/game.js`) : une porte
  fermée sur deux (85 % quand la menace est derrière), au plus une colonne toutes les 8 s, flash à partir de trois,
  une charge par vague. En parties simulées de deux minutes : une à trois colonnes par partie. Limites : la charge
  demande à chacun un poste à plus de 1,4 case de la porte, sinon on entre porte ouverte (une porte sur dix environ) ;
  charge et flash ne se combinent pas ; un opérateur resté hors de la colonne attend à distance que la porte s'ouvre ;
  une charge posée par une colonne entièrement abattue reste sur la porte sans jamais sauter.
- **Grenades à fragmentation à régler** : 200 de dégâts au centre, rayon de 3,5 cases, 2 s de mèche. Les complices
  n'en lancent pas, seul le joueur (ou celui qui reprend la main) en a.
- **Les otages ne bougent que sous escorte.** L'intervention les relève et les fait sortir, mais ils ne
  fuient jamais d'eux-mêmes, et le preneur d'otages ne peut pas les déplacer (les regrouper près de lui, ou
  reprendre celui qu'une escorte abattue a laissé près d'une sortie).
- **Les opérateurs entrent par une ouverture, ils ne l'ouvrent pas depuis dehors.** L'extérieur n'existe
  pas dans le jeu : ils apparaissent dans l'embrasure ou la fenêtre, avec un geste d'entrée. On ne peut
  donc ni les voir approcher, ni les surprendre avant qu'ils ne soient dedans.
- **Rien n'empêche de camper une seule ouverture** si la carte n'en a que deux. Plus d'entrées par carte,
  ou des vagues qui entrent par deux endroits à la fois, rendraient la défense moins statique.

## Mode trinômes

- **Équilibre à éprouver en jeu.** En parties simulées sans le joueur (il reste immobile au départ, ses deux coéquipiers
  avec lui, et l'adversaire ne le vise pas), le camp de l'intervention l'emporte 7 fois sur 12, celui du groupe armé
  1 fois sur 12 : face à des défenseurs immobiles, l'intervention gagne par ses flashs et ses entrées en colonne. En duel
  de trois contre trois, à découvert, les deux camps font désormais jeu égal. Ces chiffres datent d'avant le
  13 octobre : depuis, les armes du groupe armé sont plus précises (`akH` / `ak74H`, et celles du joueur), ses hommes
  portent des accessoires (`MILITANT_KITS` : silencieux, laser, poignée) et l'intervention tire en rafales de trois au
  lieu de quatre, à la cadence réelle du HK416. Rien de cela n'a été remesuré. Leviers : `SQUAD_MILITANT` (santé,
  réaction, champ de vision, grenades), les armes `akH` / `ak74H`, `MILITANT_KITS`, `WAVE_CHARGES`, `AI_STACK_*`.
- **Les lots d'accessoires de l'IA sont tirés au hasard, pas choisis** : un homme ne monte pas un silencieux parce
  qu'il veut surprendre, ni ne coupe son laser pour se cacher. Les lasers de l'IA restent allumés en permanence.
- **Les trinômes autonomes ne se répartissent pas le bâtiment** : chacun balaie ses secteurs depuis son entrée, sans
  savoir ce que l'autre trinôme de son camp a déjà nettoyé, et un contact n'est partagé qu'au sein d'un trinôme.
- **Le groupe armé ne se met jamais en colonne** et n'entre pas à la grenade : il franchit les portes comme il vient.
- **Pas de réapparition ni de manches** : une seule manche, à l'élimination.

## Guerre totale

- **Tout est réglé à l'estime, et la bataille est très meurtrière.** Cinq minutes (`WAR_TIME`), six secondes avant le
  retour d'un trinôme (`WAR_RESPAWN`), un couloir par trinôme avancé par étapes de quatre cases (`WAR_STEP`). En parties
  simulées sans le joueur (il reste à sa base), les armées se rencontrent vers la dixième seconde et la bataille compte
  environ 160 morts en cinq minutes, 75 à 90 par armée : chaque homme vit une trentaine de secondes. Ni joué à la main,
  ni comparé d'une carte à l'autre. Leviers : `WAR_RESPAWN`, `WAR_STEP`, `SQUAD_MILITANT`, les armes de l'IA.
- **Pas de protection à la réapparition.** Un trinôme revient dans sa base même si l'adversaire y est : rien n'empêche
  de camper la base d'en face. Ni zone interdite, ni invulnérabilité de quelques secondes, ni base de repli.
- **Les trinômes autonomes ne se coordonnent pas entre couloirs.** Chacun tient sa bande et ne partage un contact
  qu'avec les siens ; un flanc enfoncé n'appelle pas les autres. Pas d'objectif à tenir ou à prendre (drapeau, zone) :
  seul le décompte des morts compte.
- **Les ordres ne vont qu'à votre trinôme**, et l'on ne peut pas reprendre la main dans un autre trinôme de son armée
  (on attend les renforts). Pas de choix d'équipement entre deux réapparitions : on revient avec celui du briefing.
- **Les champs de bataille (Village, Port, Usine) n'ont été joués que par les tests** et par des parties simulées.
  Dessinés par symétrie, ils gardent une petite dissymétrie : un meuble déborde d'une demi-case à droite et en bas de sa
  case, si bien que son reflet n'est pas exactement à la même place.
- **Le rendu des grandes cartes reste à mesurer dans un vrai navigateur.** Le brouillard et les calques de la carte ne
  se recomposent plus qu'à l'écran, mais une armée entière, c'est neuf cônes de vision à découper à chaque image.

## Mode escorte

- **Tout est réglé à l'estime** : 100 points de vie et un gilet souple pour le VIP, priorité de tir absolue
  sur lui dès qu'il est en vue (`VIP_SWITCH`, le temps de pivoter vers lui), deux cases sans terroriste autour du point B (`GOAL_MARGIN`), dix
  terroristes par carte, barème de la note. Les trois cartes (Ambassade, Palais de justice, Hôpital) n'ont été
  jouées que par les tests, qui y mènent le VIP de A à B sans adversaire : leur difficulté reste à éprouver à la main.
- **Le VIP ne fait que suivre ou attendre.** Il ne cherche pas de lui-même un abri sous le feu (il s'accroupit,
  c'est tout), et les coéquipiers ne se placent pas pour le couvrir : ils restent en formation autour du joueur.
  Un coéquipier peut s'arrêter sur le VIP accroupi, comme sur un otage à genoux.
- **Le commando ne change pas de tactique** : mêmes postes, rondes et alerte qu'en assaut, avec la seule priorité
  de tir. Pas de chasse organisée au VIP, pas d'embuscade au point B, pas de renforts.
- **Pas de limite de temps**, et la note ne tient pas compte de la durée.

## Portes, fenêtres et visibilité

- **Meubles collés aux portes sur les anciennes cartes.** Sur les Bureaux (portes 13,4 et 28,4), la Villa (18,5) et
  le Centre de données (5,10), un bureau ou une rangée bouche l'embrasure d'un côté ; d'autres portes (Entrepôt,
  Banque, Villa) ont un meuble qui frôle le passage à une case. Les cartes d'escorte sont vérifiées par les tests ;
  celles-ci non.

- **`E` n'referme pas une porte entrouverte** : il l'ouvre en grand (pour enchaîner après avoir jeté un
  œil), et il faut redescendre les crans à la molette pour fermer. C'est un choix, pas un bug, mais il
  mérite d'être rejoué : c'est le geste le plus fréquent.
- **Le premier cran d'entrebâillement reste avare.** À 0,3, on ne voit rien de face et il faut se placer
  du côté de l'ouverture. C'est géométriquement juste (l'épaisseur du mur fait tunnel) ; si ça frustre,
  c'est une seule valeur à bouger : `DOOR_STEPS` dans `js/map.js`.
- **La fibre optique n'est pas réglée finement** : 150° sur 6 cases, 0,7 s de mise en place. Elle est
  peut-être trop généreuse par rapport au coup d'œil par l'entrebâillement.
- **Les suspects et les opérateurs n'utilisent pas la fibre.** Les suspects ouvrent toujours en grand ; les
  opérateurs aussi, sauf en colonne, où ils entrebâillent pour glisser une flash.
- **Une fenêtre ne se casse pas.** On voit et on tire au travers, on ne la franchit pas à pied, et elle
  reste intacte quoi qu'il arrive.

## Outillage

- **Couverture des tests.** `tests/index.html` couvre les armes, les portes, la visibilité, la traversée,
  la fibre, les ordres, les entrées, le siège et les écrans. Manquent : le rendu (rien ne vérifie ce qui
  est réellement dessiné) et les entrées clavier/souris réelles, simulées ici au niveau de `game.input`.
- **Mesurer les performances dans un vrai navigateur.** Les mesures faites jusqu'ici viennent du mode sans
  interface, où le rendu logiciel domine tout et varie du simple au quadruple. La simulation, elle, reste
  sous 0,3 ms par image.

## Bruit et IA

- **Réglages du bruit à éprouver en jeu.** Portées (`w.noise`, portes, pas), coûts des murs et des portes
  (`SOUND_WALL`, `SOUND_DOOR`) et seuils d'attention (`HEAR_*`, `SUSPICION_*`, `RESPONDERS`) sortent de parties
  simulées : depuis l'entrée, une rafale sans silencieux fait venir un ou deux suspects, la même au silencieux
  personne. À rejouer à la main, surtout en siège où les opérateurs convergent sur ce qu'ils entendent.
- **Le tir dans une porte n'est réglé qu'à l'estime** : 2,5 s de rafales, ±0,6 case autour du point visé, riposte quand une
  balle sortie d'une porte passe à moins de 1,2 case (`BLIND_*` en tête de `js/game.js`). Seuls les suspects de l'assaut le font :
  ni les complices du siège, ni les coéquipiers, ni l'intervention (qui ne tire pas à l'aveugle avec des otages possibles derrière).
- **Les opérateurs du siège n'ont pas de silencieux**, et les suspects ne se replient ni ne se barricadent :
  ils viennent voir, puis rentrent.

## Équipement

- **La vitesse suit la masse des armes** (3,5 % par kilo, toutes armes portées) ; le gilet et le bouclier gardent un
  coefficient à part plutôt que de peser au kilo, et une arme de poing seule (moins de 1,4 kg) donne déjà la vitesse
  maximale. À unifier si l'on veut que tout pèse pareil.

- **Boucliers à éprouver en jeu.** Arc couvert (±60° et ±66°), vitesse (×0,88 et ×0,74), gêne de la tenue
  d'une main (×1,35 et ×1,5) et champ de vision (110° et 95°) sortent du calcul, pas d'une partie jouée. Les
  suspects ne cherchent pas à contourner un porteur de bouclier : ils tirent dedans.
- **Pas de bouclier chez les coéquipiers ni chez les opérateurs du siège.** Seul le joueur en prend un en assaut.
- **Le laser n'est réglé qu'à l'estime** : dispersion en mouvement divisée par deux, et un suspect qui voit le
  faisceau vient voir au bout de trois coups d'œil (0,6 s). Les coéquipiers n'en ont pas.

## Sommation, lampe, serrures, charges, entrée coordonnée

- **Tout est réglé à l'estime** : chances de reddition (`surrenderChance`), sept secondes avant qu'un suspect
  rendu laissé seul reprenne son arme, vue à quatre cases dans le noir, faisceau de 44° sur douze cases, une
  porte sur trois verrouillée, quatre secondes de crochetage, souffle de la charge. À rejouer à la main.
- **Les coéquipiers ne menottent pas** et ne font pas de sommation : seul le joueur arrête.
- **L'entrée coordonnée est simple** : chacun file vers l'angle de son côté. Pas d'entrée en croix, pas de
  coéquipier qui ouvre ou lance la flash lui-même au signal.
- **Pas de courant coupé en siège**, ni de lampe pour l'intervention ou le groupe armé.
- **La note de fin ne tient pas compte du temps** ni de la discrétion.

## Poignée, chargeur, gilets, rondes, alerte générale

- **Tout est réglé à l'estime** : poignée (−25 % d'ouverture par tir, −30 % de recul), chargeurs (rechargement +10 %,
  +40 % pour le tambour), gilets (moitié des dégâts sur le souple, 30 % sur une plaque, ±55° de plaques, ×0,86 de
  vitesse), deux rondes par mission au pas (×0,55), trois secondes avant l'alerte générale, réaction ×0,7 ensuite.
- **Le gilet souple par défaut adoucit l'assaut** : les suspects au pistolet, à l'Uzi ou au fusil scié ne font plus
  que la moitié de leurs dégâts au joueur. À rejouer : si c'est trop facile, réduire la couverture (tête et bras).
- **Les coéquipiers n'ont pas de gilet à choisir**, et ni les suspects ni l'intervention du siège n'en portent.
- **Les rondes ne referment pas les portes** derrière elles : au fil de la partie, le bâtiment s'ouvre.
- **L'alerte générale ne change que la vigilance** : personne ne se replie, ne se barricade ni ne menace un otage.

## Confort de jeu

- **Pas de réglage de difficulté.** Ni pour l'assaut, ni pour le siège.
- **Pas de sauvegarde de progression** : les missions sont toutes accessibles, rien n'est débloqué ; seule la
  meilleure note de chaque mission est retenue.
- **Le son est minimal** : bruits synthétisés, pas de spatialisation. En siège, entendre d'où vient un bruit
  compte pourtant beaucoup.

## Cartes

- **Cartes en plein air jouées seulement par les tests** (Maison de maître, Corps de ferme). La traversée du jardin à
  découvert est peut-être trop punitive face aux fenêtres : quelques couverts de plus (murets, voitures) aideraient. Les
  arbres ne cachent rien (comme tout le mobilier) et les haies arrêtent les balles comme un mur. Pas de carte d'escorte
  en plein air.

- **Hôtel, Banque et Centre de données n'ont été jouées que par les tests.** Leur équilibre (nombre
  d'entrées, longueur des allées entre les baies, couvert du hall de la banque) reste à éprouver à la main,
  dans les deux modes.
- **Les dix nouvelles cartes n'ont été jouées que par les tests** : Musée (assaut), Mairie et Supermarché (siège), Gare
  (escorte), Lycée, Galerie marchande et Chantier (trinômes), Village, Port et Usine (guerre totale).
- **Les trinômes n'ont plus que trois cartes**, leurs arènes : les bâtiments à otages, pensés pour l'assaut, n'y sont
  plus. Trois arènes, c'est peu ; en dessiner d'autres, ou rouvrir aux trinômes les deux cartes en plein air.
- **Les meilleures notes sont rangées par numéro de carte** (`breach.best.<mode>.<i>`) : on ajoute les cartes en fin de
  liste pour ne pas les mélanger.

## Fait depuis la dernière version

Mode guerre totale : deux armées de trois trinômes, cinq minutes de combat sur des champs de bataille en plein air
(Village, Port, Usine), un trinôme anéanti revient de sa base six secondes plus tard, le vôtre compris ; l'armée qui
abat le plus d'adversaires l'emporte (égalité possible) · chaque mode a ses cartes : le Musée pour l'assaut, la Mairie
et le Supermarché pour le siège, la Gare pour l'escorte, trois arènes symétriques pour les trinômes (Lycée, Galerie
marchande, Chantier) · on choisit le mode, puis la carte, puis l'équipement (fil « Mode › Carte › Équipement » au
briefing) · sacs de sable et asphalte · brouillard et calques de la carte recomposés seulement à l'écran.

Version précédente :

Deux cartes en plein air, plus grandes (Maison de maître, Corps de ferme) : herbe, gravier, terrasse, haies, arbres,
bassin, entrées du terrain au bord de la carte · mode trinômes : deux trinômes contre deux, l'intervention contre le groupe armé, dans le camp de son choix ; votre
trinôme à vos ordres, le second de votre camp autonome, ceux d'en face par les ouvertures hors de vue de la vôtre ;
trinômes qui partagent leurs contacts et restent groupés ; relais dans votre trinôme puis dans l'autre ·
siège : l'intervention se met de temps en temps en colonne sur une porte fermée et entre porte ouverte, à la flash
(à trois, s'il lui en reste) ou à la charge (une par vague), comme l'équipe du joueur au clic droit · le souffle d'une
charge part de toute l'embrasure : il sonne aussi qui se tient contre le mur à côté du cadre ou derrière le battant ·
deux agents de front dans une embrasure ne s'y bloquent plus l'un l'autre.

Mode escorte : trois cartes (Ambassade, Palais de justice, Hôpital) où l'équipe conduit un VIP du point A à la zone
d'extraction, à travers les pièces tenues par le commando ; VIP qui suit ou attend à couvert (H), visé en priorité,
relayé avec le joueur, note de fin propre au mode · un otage accroché à l'angle d'un meuble s'en dégage d'un pas de côté.
Briefing : icônes des accessoires et des gilets, les deux gilets côte à côte (celui qu'on porte en surbrillance, et
rappelé en jeu à côté de la santé), bilan de la charge, de la vitesse et des dégâts encaissés selon l'arme et le côté ·
la vitesse dépend du poids de toutes les armes portées, accessoires compris, et non plus de celle qu'on a en main ·
entrée à la flash (second clic droit sur la porte de la colonne : entrebâillement, flash, porte grande ouverte, entrée ;
deux flashs par coéquipier) · en escorte, les terroristes tirent sur le VIP dès qu'ils le voient.

Plus tôt :

Les suspects tirent dans la porte derrière laquelle ils vous ont vu disparaître, ou d'où l'on vient de leur tirer dessus · silencieux sans perte sur les balles supersoniques et le .45, munition subsonique plus faible pour le 9 mm, effets des accessoires détaillés au briefing · Neutraliser tous les suspects suffit pour gagner en assaut · boucliers balistiques léger et lourd, avec l'arme
de poing seule · accessoires choisis arme par arme au briefing : silencieux et laser (`L`), et un silencieux pour
les coéquipiers à part ·
Otages à escorter jusqu'à une sortie pour les mettre à l'abri (H en assaut, les opérateurs en siège) ·
Bruit propagé à travers le bâtiment (murs et portes l'étouffent), suspects qui se tournent, vont voir à deux,
puis rentrent à leur poste, crient l'alerte et découvrent les corps · bruits entendus affichés autour du joueur ·
Trois cartes (Hôtel, Banque, Centre de données) · trois sols (moquette, marbre, tôle striée) et six meubles
(canapé, rayonnage, armoire, baie de serveurs, palette, comptoir), adossés au mur et d'un seul tenant quand on
les aligne · grenades qui passent par-dessus le mobilier en vol · pièce d'arrivée de chaque vague signalée sur la
minimap en siège · plan de chaque carte sur l'écran des missions · ouvertures nommées d'après leur façade, sans
doublon.

Versions antérieures :

Entrées multiples par carte (portes extérieures et fenêtres, avec choix du point d'entrée en assaut et
vagues qui alternent en siège) · pièce d'entrée toujours vide en assaut (cartes revues, garde dans le code) · siège en
vagues comptées au lieu d'un chrono, sans temps mort entre deux vagues · flashs lancées par l'IA d'assaut · otages récupérables par l'intervention
(et partie perdue quand il n'en reste plus) · complices qui réagissent au bruit et rechargent · briefing de
siège propre à chaque mission · suite de tests dans `tests/`.
