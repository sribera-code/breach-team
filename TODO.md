# Reste à faire

État des chantiers ouverts au 18 septembre 2026. Les points sont classés par ordre d'intérêt au sein
de chaque section.

## Mode siège

Le mode est jouable de bout en bout, mais c'est un premier jet.

- **L'équipe d'intervention ne lance pas de grenades flash.** C'est le manque le plus visible : l'IA de
  grenade n'existe que pour le joueur (`Game.throwFlash`). Il faudrait qu'un opérateur bloqué devant une
  porte fermée ou un couloir tenu dégoupille avant d'entrer — ce qui rendrait l'assaut bien plus crédible
  et donnerait un sens défensif aux portes entrebâillées.
- **Équilibrage à faire.** Tout est en dur dans `Game.startSiege` (20 s de préparation, 180 s à tenir,
  renforts de 2 toutes les 45 s, 3 vagues) et dans les armes `hk416op` / `mp5op`. Aucune de ces valeurs
  n'a été jouée par un humain : elles sortent de parties simulées.
- **Les opérateurs n'ont pas d'objectif d'extraction.** Ils nettoient le bâtiment secteur par secteur et
  traquent le bruit ; ils ignorent les otages. Prévu à la conception : atteindre un otage et le sortir
  devrait faire perdre la partie au joueur.
- **Les complices ne réagissent pas au bruit.** `Game.noise` ne parcourt que `this.enemies` ; en siège,
  les complices (des `Teammate`) n'entendent donc rien et attendent les ordres.
- **Munitions infinies pour les complices.** Ils portent les armes ennemies (`mag: Infinity`) et ne
  rechargent jamais. Acceptable, mais incohérent avec le reste.
- **Briefing générique.** Le texte du mode siège est le même pour les trois missions ; les `LEVELS` n'ont
  qu'un briefing, écrit côté intervention. La liste des missions annonce « n suspects » quel que soit le mode.
- **Un seul point d'entrée.** L'assaut arrive toujours par le `S` de la carte. Plusieurs entrées, ou une
  entrée tirée au sort, rendraient la préparation moins mécanique.

## Portes et visibilité

- **`E` n'referme pas une porte entrouverte** : il l'ouvre en grand (pour enchaîner après avoir jeté un
  œil), et il faut redescendre les crans à la molette pour fermer. C'est un choix, pas un bug, mais il
  mérite d'être rejoué : c'est le geste le plus fréquent.
- **Le premier cran d'entrebâillement est très avare.** À 0,25, on ne voit rien de face et il faut se
  placer du côté de l'ouverture. C'est géométriquement juste (l'épaisseur du mur fait tunnel), mais si
  ça frustre, c'est une seule valeur à bouger : `DOOR_STEPS` dans `js/map.js`.
- **La fibre optique n'est pas réglée finement** : 150° sur 6 cases, 0,7 s de mise en place. Elle est
  peut-être trop généreuse par rapport au coup d'œil par l'entrebâillement.
- **Les suspects et les opérateurs n'utilisent ni fibre ni entrebâillement.** Ils ouvrent toujours en grand.

## Outillage

- **Aucun test dans le dépôt.** Les scénarios utilisés pendant le développement (traversée des portes,
  champ de vision par cran, gestes, ordres de couverture, enchaînement des écrans de fin, partie de siège
  complète) tournent dans Chrome sans interface, mais vivent hors du dépôt. Les verser dans un dossier
  `tests/` avec une page d'index permettrait de les rejouer après chaque changement.
- **Mesurer les performances dans un vrai navigateur.** Les mesures faites jusqu'ici viennent du mode sans
  interface, où le rendu logiciel domine tout et varie du simple au quadruple. La simulation, elle, reste
  sous 0,3 ms par image.

## Confort de jeu

- **Pas de réglage de difficulté.** Ni pour l'assaut, ni pour le siège.
- **Pas de sauvegarde de progression** : les missions sont toutes accessibles, rien n'est débloqué ni retenu.
- **Le son est minimal** : bruits synthétisés, pas de spatialisation. En siège, entendre d'où vient un bruit
  compte pourtant beaucoup.
