# Reste à faire

État des chantiers ouverts au 18 octobre 2026. Les points sont classés par ordre d'intérêt au sein
de chaque section.

## Mode siège

- **L'intervention ratisse mieux depuis le 18 octobre** : le secteur suivant est le plus proche à pied et une pièce vue
  compte comme fouillée. En parties simulées de 100 s où les défenseurs restent immobiles et ne tirent pas, elle
  évacue tous les otages sur les dix cartes, ce qu'elle ne faisait pas toujours avant, et fait 8 demi-tours par minute
  au lieu de 11. Le siège est donc plus dur à tenir : l'équilibre (préparation, vagues) est à reprendre en jeu.

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

- **Les trinômes autonomes marchent en file derrière un chef depuis le 18 octobre, réglés à l'estime** (`SQUAD_FILE`,
  `SQUAD_LINE`, `SQUAD_PACE`, `SQUAD_DOOR_PAUSE`, `SQUAD_SPREAD`, `SQUAD_WAIT`, `SQUAD_CATCH` en tête de `js/game.js`) :
  le chef au pas (70 % de sa vitesse, sans bruit de pas), 0,6 s sur le seuil de chaque porte, quatre secondes au plus à
  attendre un retardataire. En parties simulées (le joueur immobile et hors jeu), ils ratissent moitié moins vite à la
  minute, et les trinômes se rencontrent vers la dixième ou la trentième seconde au lieu de la dixième au plus. En duel
  de trois contre trois, l'équilibre entre les camps n'a pas bougé au-delà du hasard (sur 72 parties : intervention 30,
  groupe armé 32, au lieu de 32 et 23). Limites : sur une arène en anneau (le Chantier), deux trinômes qui tournent dans
  le même sens se courent après une à deux minutes avant de se croiser ; dans un couloir, le chef tire seul plus souvent
  (60 % des coups du trinôme, au lieu de la moitié) faute de place pour ses équipiers ; le dernier ne regarde derrière
  lui qu'une seconde sur cinq en marche ; un équipier coincé est abandonné au bout de quatre secondes et rejoint en
  courant. L'intervention du siège, qui n'est pas en trinômes, avance toujours à pleine vitesse et sans chef. Rien
  n'a été joué à la main.
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
- **Ratissage et contacts réglés à l'estime** (`SWEEP_SEEN`, `SWEEP_AHEAD`, `CONTACT_HOLD`, `SQUAD_SEARCH` en tête de
  `js/game.js`). En parties simulées de deux minutes (le joueur immobile et hors jeu), un chef de trinôme autonome fait
  3 à 8 demi-tours par minute (18 avant la refonte du ratissage) ; ses équipiers en font un peu plus, le temps que la
  file se reforme derrière lui après un virage. Les demi-tours du chef viennent presque tous du ratissage : on entre
  dans une pièce sans issue, on en ressort. Rien n'a été joué à la main.
- **Les deux trinômes d'en face se partagent le ratissage, pas leurs contacts** : l'un ne vient au secours de l'autre
  que s'il entend ses coups de feu de près (`HEAR_GO`). Le second trinôme de votre camp vous laisse votre part du
  bâtiment, mais ne sait pas ce que vous avez vu, et ne vous suit pas.
- **Le groupe armé ne se met jamais en colonne** et n'entre pas à la grenade : il franchit les portes comme il vient.
- **Pas de réapparition ni de manches** : une seule manche, à l'élimination.
- **Les trinômes ne se replient pas** : blessé ou en infériorité, un trinôme continue d'avancer ; personne ne tient un
  angle en attendant l'adversaire. Les arrières ne sont couverts qu'à l'arrêt, et par coups d'œil en marche.

## Guerre totale

- **Tout est réglé à l'estime, et la bataille est très meurtrière.** Cinq minutes (`WAR_TIME`), six secondes avant le
  retour d'un trinôme (`WAR_RESPAWN`), un couloir par trinôme avancé par étapes de quatre cases (`WAR_STEP`). En parties
  simulées sans le joueur (il reste à sa base), les armées se rencontrent vers la dixième seconde et la bataille compte
  environ 160 morts en cinq minutes, 75 à 90 par armée : chaque homme vit une trentaine de secondes. Depuis que les
  trinômes autonomes marchent en file, au pas (18 octobre), on en compte plutôt 110 à 170 (130 en moyenne), et l'Usine,
  pleine de portes, est la moins meurtrière. Ni joué à la main, ni comparé d'une carte à l'autre. Leviers : `WAR_RESPAWN`, `WAR_STEP`, `SQUAD_MILITANT`, les armes de l'IA.
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

## Stratégie

- **Tout est réglé à l'estime et rien n'a été joué à la main** (`STRAT_SPACING`, `STRAT_ARRIVE`, `STRAT_LEASH`, `STRAT_VIEW`,
  `STRAT_PAN` en tête de `js/game.js` et `js/render.js`). Les tests mènent les ordres un à un (déplacement, étapes, tenue,
  attaque, colonne à la porte, grenade, pause tactique, retour de la base) et font tourner chaque champ de bataille avec des
  ordres au hasard ; en partie simulée, trois trinômes envoyés à 16 cases arrivent en 5 à 13 s selon qu'ils se battent en route.
- **Les règles sont celles de la guerre totale** : le décompte des morts au bout de cinq minutes. Pas de point à tenir ni
  de zone à prendre, ce qui donnerait plus de sens à la manœuvre ; pas de choix d'équipement ni de composition des trinômes.
- **L'armée d'en face n'a pas de commandant** : ses trois trinômes ratissent leur couloir comme en guerre totale, sans se
  concentrer ni se replier. Concentrer vos trois trinômes sur un couloir suffit sans doute à l'emporter.
- **Les ordres restent simples** : un trinôme envoyé tire en route sans poursuivre, un trinôme qui tient ne bouge pas même
  pris à revers ; pas de patrouille, pas de « tenir le feu », pas de groupes enregistrés (Ctrl + numéro). Une colonne ne se
  forme qu'à l'ordre (la porte cliquée) ; en route, une porte fermée s'ouvre comme elle vient.
- **Le rendu d'une armée entière vue de haut reste à mesurer dans un vrai navigateur** : toute la carte à l'écran, c'est
  tout le brouillard et dix-huit personnages à redessiner à chaque image.

## Stratégie : assaut

- **Équilibre réglé en parties simulées, jamais joué à la main** (`DEFENSE_RATIO`, `DEFENSE_CLEAR`, `DEFENSE_OUTSIDE`,
  `DEFENSE_PATROLS`, `DEFENSE_STATS`, `DEFENSE_WEAPONS` en tête de `js/game.js`). Vos trois trinômes laissés à eux-mêmes (`R`,
  aucun ordre) contre 27 hommes : avec les suspects de l'assaut tels quels, ils gagnent en 40 à 100 s en gardant quatre à six
  hommes ; avec les hommes des trinômes (`SQUAD_MILITANT`, AKM et AK-74 de précision), ils sont anéantis en moins de 40 s
  après en avoir abattu un tiers ; avec les réglages retenus (armes des suspects, 100 points de vie, 0,4 s de réaction), ils
  gagnent environ quatre parties sur neuf, de peu dans un sens comme dans l'autre (une à quatre survivants, un à sept
  défenseurs restants). Un commandant qui concentre ses trinômes et entre à la flash devrait faire mieux : à vérifier.
- **L'alerte générale tombe presque à chaque partie** : un défenseur qui voit un opérateur et tient trois secondes, sur un
  terrain ouvert, c'est la règle. Le terrain entier se met alors sur ses gardes, et la ligne « Discrétion » de la note ne
  se gagne qu'en avançant à couvert.
- **Les postes dehors sont souvent à découvert.** Sur le Village, qui a peu de bâtiments, une dizaine de défenseurs sur 27
  au plus sont sous un toit ; dehors, un poste à deux petites cases d'un mur, d'une haie, d'un arbre ou de sacs de sable
  compte comme abrité, sans qu'il tourne le dos à l'abri ni ne regarde vers votre base.
- **Le groupe armé ne se replie ni ne se regroupe** : comme les suspects de l'assaut, chacun tient son poste, vient voir ce
  qu'il entend et rentre. Pas de défense en profondeur, pas de renforts venus de l'autre base, pas de grenades.
- **Les textes des champs de bataille parlent de deux armées** (« chaque armée part d'un bout ») : ils sont écrits pour la
  guerre totale et repris tels quels. La seconde base reste peinte en rouge, sans rôle dans ce mode.
- **Pas de limite de temps**, et la note ne tient pas compte de la durée.

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

- **Balles à leur vitesse réelle, à éprouver en jeu.** Une case vaut un mètre ; la balle part à sa vitesse à la bouche
  (260 à 900 m/s) et vole jusqu'au premier obstacle (80 m au plus, `BULLET_REACH`). En guerre totale simulée, les morts
  croisées (A abat B et B abat A à moins de 0,6 s) passent de 11 % des morts à 2 %, pour un nombre de morts à peu près
  inchangé. Conséquences pas encore jouées : l'IA touche mieux une cible qui court (plus besoin d'anticiper), et une
  balle manquée file désormais dans la pièce d'après, par une porte ouverte, au risque d'un otage qu'on ne voit pas
  (ceux des suspects aussi). Si c'est trop, réduire `BULLET_REACH`.
- **Chevrotine en gerbe serrée** (`pattern` : 1,5° pour le Remington 870, 2° pour le Benelli, 3° pour le canon scié
  des suspects, au lieu d'une dispersion de 5,5 à 7° par plomb). À quelques mètres, toute la charge arrive : le fusil à
  pompe est bien plus meurtrier, de près comme à neuf mètres, dans les mains de l'IA aussi. Pas de perte d'énergie des
  plombs avec la distance.
- **Pas de chute des dégâts avec la distance, ni de ricochet** : une balle frappe à 30 m comme à 3 m, et s'arrête sur
  un mur ou un meuble sans rebondir.

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

## Cadrage et portée de tir de l'IA

- **Réglés à l'estime, pas joués à la main** : sept cases au moins au-dessus et au-dessous du centre de l'écran
  (`VIEW_HALF`), vue décalée vers le curseur de 40 % de l'écart, jusqu'à la moitié de la demi-hauteur (`LOOK_AHEAD`,
  `LOOK_MAX` en tête de `js/render.js`), l'IA qui n'ouvre le feu qu'à neuf cases (`AI_FIRE_RANGE`). Sur un portable
  (1366 × 657), le zoom passe de 2 à 1,47 : les personnages sont nettement plus petits qu'avant. Si c'est trop, réduire
  `VIEW_HALF` demande de réduire `AI_FIRE_RANGE` d'autant.
- **La guerre totale change de rythme** : les armées ne s'accrochent plus à quinze cases mais à neuf, en se rapprochant.
  L'équilibre et le nombre de morts (TODO plus haut) sont à remesurer.
- **Le joueur garde l'avantage de la portée** : il tire à la portée de son arme (la lunette comprise), l'IA non.

## Grenades de l'intervention

- **Aucune masse pour les grenades** : le lot ne change pas la vitesse. Les coéquipiers gardent leurs deux flashs quel que
  soit le lot du joueur, et l'IA de l'intervention n'a que des flashs.
- **Le lot mixte ne se règle qu'à deux flashs et une fragmentation** : pas de dosage libre.

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

IA des agents autonomes (trinômes, guerre totale, intervention du siège) : le secteur suivant est le plus proche à
pied, choisi pour tout le trinôme et gardé jusqu'à ce qu'on l'ait vu, au lieu du premier de la liste à vol d'oiseau
de l'entrée, qui faisait zigzaguer d'un bord à l'autre ; une pièce qu'on a sous les yeux compte comme ratissée ; les deux
trinômes d'en face se partagent le bâtiment ; un contact se garde (une vue avant un bruit, le plus proche d'abord), on
fouille là où il n'a rien donné, et l'on vient en renfort des siens qui se battent tout près · armes : vitesse réelle
des balles (de 260 à 900 m/s), qui volent jusqu'au premier obstacle et laissent une trace fugace ; gerbe de chevrotine
serrée autour du point visé ; munition subsonique à 300 m/s ; la fiche du briefing affiche la vitesse de la balle.

Version précédente :

Mode guerre totale : deux armées de trois trinômes, cinq minutes de combat sur des champs de bataille en plein air
(Village, Port, Usine), un trinôme anéanti revient de sa base six secondes plus tard, le vôtre compris ; l'armée qui
abat le plus d'adversaires l'emporte (égalité possible) · chaque mode a ses cartes : le Musée pour l'assaut, la Mairie
et le Supermarché pour le siège, la Gare pour l'escorte, trois arènes symétriques pour les trinômes (Lycée, Galerie
marchande, Chantier) · on choisit le mode, puis la carte, puis l'équipement (fil « Mode › Carte › Équipement » au
briefing) · sacs de sable et asphalte · brouillard et calques de la carte recomposés seulement à l'écran · le lot de
grenades de l'intervention se choisit au briefing (trois flashs, mixte deux flashs et une fragmentation, ou deux
fragmentations ; `N` change de grenade en main) · l'IA n'ouvre plus le feu au-delà de neuf cases, et l'écran montre au
moins sept cases en hauteur, la vue décalée vers le curseur : plus de tir venu du hors-champ.

Avant encore :

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
