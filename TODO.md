# Reste à faire

État des chantiers ouverts au 27 septembre 2026. Les points sont classés par ordre d'intérêt au sein
de chaque section.

## Mode siège

- **Équilibrage à faire.** Tout est en dur dans `SIEGE_WAVES` et `Game.startSiege` (10 s de préparation,
  3 vagues de 3 opérateurs contre 9 défenseurs, 6 s de répit après une vague éliminée, 30 s au plus entre deux
  vagues) et dans les armes `hk416op` / `mp5op`. Aucune de ces valeurs
  n'a été jouée par un humain : elles sortent de parties simulées.
- **Grenades à fragmentation à régler** : 200 de dégâts au centre, rayon de 3,5 cases, 2 s de mèche. Les complices
  n'en lancent pas, seul le joueur (ou celui qui reprend la main) en a.
- **Les otages ne bougent pas.** Ils attendent sur place qu'on vienne les chercher. Les voir fuir vers
  l'intervention, ou pouvoir les regrouper, changerait beaucoup la tension.
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

## Confort de jeu

- **Pas de réglage de difficulté.** Ni pour l'assaut, ni pour le siège.
- **Pas de sauvegarde de progression** : les missions sont toutes accessibles, rien n'est débloqué ni retenu.
- **Le son est minimal** : bruits synthétisés, pas de spatialisation. En siège, entendre d'où vient un bruit
  compte pourtant beaucoup.

## Cartes

- **Hôtel, Banque et Centre de données n'ont été jouées que par les tests.** Leur équilibre (nombre
  d'entrées, longueur des allées entre les baies, couvert du hall de la banque) reste à éprouver à la main,
  dans les deux modes.

## Fait depuis la dernière version

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
