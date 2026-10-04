# Reste à faire

État des chantiers ouverts au 4 octobre 2026. Les points sont classés par ordre d'intérêt au sein
de chaque section.

## Mode siège

- **Équilibrage à faire.** Tout est en dur dans `SIEGE_WAVES` et `Game.startSiege` (10 s de préparation,
  3 vagues de 3 opérateurs contre 9 défenseurs, 6 s de répit après une vague éliminée, 30 s au plus entre deux
  vagues) et dans les armes `hk416op` / `mp5op`. Aucune de ces valeurs
  n'a été jouée par un humain : elles sortent de parties simulées.
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

## Portes, fenêtres et visibilité

- **`E` n'referme pas une porte entrouverte** : il l'ouvre en grand (pour enchaîner après avoir jeté un
  œil), et il faut redescendre les crans à la molette pour fermer. C'est un choix, pas un bug, mais il
  mérite d'être rejoué : c'est le geste le plus fréquent.
- **Le premier cran d'entrebâillement reste avare.** À 0,3, on ne voit rien de face et il faut se placer
  du côté de l'ouverture. C'est géométriquement juste (l'épaisseur du mur fait tunnel) ; si ça frustre,
  c'est une seule valeur à bouger : `DOOR_STEPS` dans `js/map.js`.
- **La fibre optique n'est pas réglée finement** : 150° sur 6 cases, 0,7 s de mise en place. Elle est
  peut-être trop généreuse par rapport au coup d'œil par l'entrebâillement.
- **Les suspects et les opérateurs n'utilisent ni fibre ni entrebâillement.** Ils ouvrent toujours en
  grand — ils lancent en revanche une flash avant d'entrer quand ils savent où était la menace.
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

- **Hôtel, Banque et Centre de données n'ont été jouées que par les tests.** Leur équilibre (nombre
  d'entrées, longueur des allées entre les baies, couvert du hall de la banque) reste à éprouver à la main,
  dans les deux modes.

## Fait depuis la dernière version

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

Version précédente :

Entrées multiples par carte (portes extérieures et fenêtres, avec choix du point d'entrée en assaut et
vagues qui alternent en siège) · pièce d'entrée toujours vide en assaut (cartes revues, garde dans le code) · siège en
vagues comptées au lieu d'un chrono, sans temps mort entre deux vagues · flashs lancées par l'IA d'assaut · otages récupérables par l'intervention
(et partie perdue quand il n'en reste plus) · complices qui réagissent au bruit et rechargent · briefing de
siège propre à chaque mission · suite de tests dans `tests/`.
