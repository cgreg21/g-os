# G-Os pour GNOME Shell

Extension fonctionnelle inspirée de l'ergonomie de G-Os, déclarée compatible avec GNOME Shell 50 et 51. Le design est confié à un thème personnel séparé, basé sur les feuilles GNOME Shell WhiteSur puis ajusté pour la barre et le Dock ; l'extension ne contient pas de style décoratif.

- Barre supérieure personnalisée sur chaque écran, avec nom de l'application active et menu donnant accès aux applications, à la vue d'ensemble et aux préférences. La barre native GNOME est masquée pendant l'activation puis restaurée à la désactivation.
- Composants natifs GNOME et classes CSS stables pour leur habillage par le thème personnel.
- Dock sur chaque écran : applications favorites et ouvertes, dossiers personnalisés, point sous les applications en cours et accès à la grille d'applications. Toutes les icônes se réorganisent par glisser-déposer et peuvent être mélangées ; les dossiers s'ouvrent en grille ou en pile. Il se masque en plein écran.
- Chaque barre affiche l'application active, l'horloge locale, la recherche, les notifications et les progressions. Ses icônes Wi-Fi, Bluetooth, son et batterie ouvrent Quick Settings depuis l'écran concerné ; l'icône utilisateur ouvre les actions de session. Les barres et leurs menus sont reconstruits lors des branchements, débranchements et changements d'écran principal.
- Préférences : affichage du Dock et des applications ouvertes, réservation d'espace pour les fenêtres, taille, marge et animation des icônes (dont un mode Magnification en vague distinct d'Agrandir), rayon des coins du Dock de 0 à 48 px (28 px par défaut), widgets d'horloge et de calendrier, hauteur de la barre réglable de 24 à 48 px (26 px par défaut) et padding horizontal/vertical. La taille du texte et des icônes suit la hauteur intérieure ; le nom de l'application s'adapte à la largeur disponible sur chaque écran.

En mode Magnification, le fond suit la largeur de la rangée agrandie et se rétracte au repos ; sur les côtés, il suit sa hauteur. La réservation d'espace pour les fenêtres reste fixe et l'habillage reste défini par le thème externe.

Le Dock reprend les favoris GNOME : modifie-les depuis la grille d'applications ou la vue d'ensemble. Les favoris se réorganisent par glisser-déposer. La page Dock permet d'ajouter et retirer des dossiers via le sélecteur GTK, de les réorganiser et de choisir leur ouverture en grille ou en pile. Le dash GNOME natif reste masqué pendant toute l'activation de l'extension ; le Dock personnalisé ouvre la grille d'applications. La préférence « Position du Dock » permet de choisir le bas, la gauche ou la droite sur tous les écrans. La position basse reste le réglage par défaut. Le Dock devient défilable s'il dépasse la largeur disponible en bas ou la hauteur disponible sur les côtés ; les Docks latéraux laissent la barre supérieure dégagée. La taille et la marge intérieure des icônes sont réglables séparément. Le sélecteur « Animation au survol » propose agrandissement, soulèvement ou rebond ; le mode rebond anime aussi le lancement d'une application. L'option « Empêcher les fenêtres de passer sous le Dock », désactivée par défaut, réserve le bord correspondant à sa position sur chaque écran.

Dans « Dossiers du Dock », chaque dossier dispose de son propre sélecteur : « Par défaut », « Pile » ou « Grille ». « Par défaut » suit le réglage global « Ouverture par défaut des dossiers ». Les choix sont conservés par URI, indépendamment de la position du dossier. La pile présente des icônes droites et alignées au-dessus du dossier du Dock, avec les noms alignés à droite juste à leur gauche. Son habillage appartient aux thèmes externes clair et sombre.

La section « Options par défaut des vues » règle séparément la taille du texte et des icônes pour Pile et Grille. Elle propose aussi l'espace entre les icônes et le nombre maximal de fichiers pour Pile, ainsi que les espaces horizontal et vertical, le nombre de colonnes et le nombre de lignes pour Grille. Le bouton d'options de chaque dossier permet de personnaliser ces valeurs ou de revenir aux valeurs générales. Les limites de fichiers et de lignes concernent les dossiers de fichiers ; les dossiers d'applications gardent tous leurs membres accessibles par défilement. Les vues qui dépassent l'écran restent défilables.

Le masquage automatique révèle le Dock dans une bande de 10 px le long du bord concerné. L'option « Masquer le Dock sous les fenêtres » le fait glisser hors de son bord si une fenêtre visible recouvre sa zone; il revient quand cette zone est libre. Les deux modes peuvent être utilisés séparément. Les animations des icônes respectent la réduction des animations. Les animations de fenêtre restent celles de GNOME.

Les icônes système de la barre ouvrent des menus indépendants. Son propose le muet sur l’icône, le curseur de volume, un séparateur et les sorties audio disponibles. Wi-Fi et Bluetooth disposent de leur bascule et de leurs listes natives. Batterie affiche la charge, l’autonomie ou le temps de charge, et les profils d’alimentation disponibles. Les services matériels et l’authentification restent ceux de GNOME ; les sous-menus réutilisés sont restaurés à la fermeture.

Le système de widgets accepte Flux avec déclarations inspirées de Python, sources HTTP et templates YAML/Mustache, le langage déclaratif Widget Simple en JSON et des dossiers JavaScript natifs. Les widgets du bureau sont indépendants par écran ; les widgets du Dock et leur configuration sont communs à tous les écrans. Les gestionnaires proposent l'import confirmé et le verrouillage, ainsi que la grille et le premier plan pour le bureau. Ils s’ouvrent depuis le clic droit sur le bureau, Launchpad ou la page Widgets. Le premier accès migre les widgets existants. Voir [WIDGETS.md](WIDGETS.md) pour les formats, la configuration générée et l’API. Le HTML reste hors du périmètre actuel.

Le catalogue comprend aussi Notes, Tâches, Calculatrice, Minuteur, Chronomètre, Horloge mondiale, Moniteur système et Stockage. Ces widgets utilisent une configuration et un état indépendants par instance, avec résumé et panneau de détail dans le Dock. Ils sont ajoutés au catalogue sans être activés automatiquement.

Les piles sont rapprochées du Dock et leurs lignes sont compactes : avec les tailles initiales, le pas entre les lignes passe de 64 à 58 px. Le texte reste à gauche de l’icône, avec un écart de 8 px. Les tailles de texte et d’icônes et l’espacement personnalisé entre les lignes restent respectés, pour les dossiers de fichiers et d’applications.

Les grilles ont des marges et des cellules plus compactes, sans changer les espacements configurés. Le bouton « Ouvrir le dossier » est bleu uniquement au survol ; au clavier, le focus est signalé par un contour.

Dans « Options par défaut des vues » et dans les options de chaque dossier de fichiers, « Tri » propose le nom, la taille ou la date de modification, en ordre croissant ou décroissant, séparément pour Pile et Grille. Les dossiers restent en premier et le tri précède les limites d’affichage. Les groupes d’applications conservent leur ordre manuel.

La section « Barre supérieure » permet d’afficher ou masquer indépendamment l’horloge, la recherche, le bouton de préférences et les boutons Wi-Fi, Bluetooth, Son et Batterie, sur chaque écran. Tous sont visibles par défaut. Les menus Applications et Session restent disponibles ; les préférences restent accessibles depuis le menu Session même si leur bouton est masqué.

« Fond du Dock » propose le thème actuel, un fond discret, opaque ou transparent, avec des couleurs adaptées aux thèmes clair et sombre. Seul le fond change : les icônes restent visibles, et bordure et ombre se règlent séparément. La marge intérieure gauche et droite est réglable de 0 à 48 px (9 px par défaut), indépendamment des marges haute et basse.

La section « Disposition » permet aussi de régler la distance au bord de l’écran (0 à 48 px) et l’espacement entre les éléments (0 à 20 px), puis d’afficher ou masquer la bordure et l’ombre du Dock. Les valeurs initiales sont 12 px et 5 px, avec bordure et ombre visibles. La distance participe à la réservation d’espace et au masquage automatique ; le mode collé au maximisé la ramène temporairement à zéro. « Distance entre le Dock et les fenêtres » réserve une marge supplémentaire de 0 à 48 px au-dessus du Dock, ou côté intérieur pour un Dock latéral, sans déplacer le Dock. Cette marge nécessite « Empêcher les fenêtres de passer sous le Dock », vaut 0 px par défaut et s’annule temporairement en mode collé au maximisé, comme la distance au bord ; les deux distances sont restaurées au démaximiser. Masquer la bordure conserve sa place pour ne pas déplacer les icônes. Les thèmes clair et sombre prennent en charge ces options.

La section « Animations » des préférences du Dock regroupe le mode de survol, sa durée et son intensité (25 à 100 %), ainsi que l’activation des animations au lancement. En mode « Magnification », le nombre d’icônes agrandies de chaque côté se règle de 1 à 8 et leur agrandissement maximal de 100 à 400 % (180 % par défaut). Le lancement propose le comportement actuel (rebond avec le survol Rebond, animation GNOME sinon), un rebond indépendant du survol ou l’animation GNOME. La durée et l’intensité du rebond sont réglables ; sa fin restaure le survol ou la magnification sans interrompre le suivi du pointeur. La durée du masquage et de l’apparition est réglable de 0 à 1000 ms ; 0 rend la transition immédiate. « Courbe des slides du Dock » propose le comportement actuel, une courbe linéaire, progressive ou vive pour le masquage, l’apparition et le maximisé. Le glissement au maximisé possède une durée distincte et nécessite la réservation d’espace. Les réglages GNOME de réduction ou de désactivation des animations restent prioritaires.

Pendant la réorganisation des applications, favoris, dossiers et raccourcis, les icônes voisines se décalent pour montrer la nouvelle position. Tous ces éléments partagent un ordre commun, enregistré au dépôt et appliqué sur chaque écran. Les séparateurs de groupes disparaissent après la première personnalisation. Une application ouverte déplacée ne devient pas favorite ; sa place est conservée lorsqu'elle disparaît puis réapparaît, comme celle des raccourcis temporairement masqués. Une annulation restaure la disposition précédente. Le Dock reste visible pendant le geste, et les déplacements respectent la réduction des animations.

Depuis Nautilus, un ou plusieurs dossiers peuvent être glissés sur la page « Dock » des préférences pour les ajouter au Dock. Les fichiers, dossiers inaccessibles et doublons sont ignorés ; aucun fichier n'est déplacé ni copié. Le dépôt direct d'un dossier de fichiers sur le Dock Shell n'est pas pris en charge.

Les dossiers d'applications se créent en déposant une application au centre d'une autre icône du Dock ; un survol central affiche l'aperçu de regroupement. Déposer une application sur un groupe existant l'y ajoute, et les bords restent disponibles pour réorganiser le Dock. Les applications regroupées ne sont plus affichées séparément, mais leurs favoris GNOME sont conservés. Les dossiers restent déplaçables et partagent l'ordre commun du Dock.

Dans « Dock → Dossiers d’applications », le bouton de création ouvre un éditeur de nom et de membres avec recherche. Chaque groupe peut utiliser une image personnalisée ou l'aperçu 2x2 des quatre premières applications, ainsi que « Par défaut », « Pile » ou « Grille ». Le dépôt de lanceurs `.desktop` dans cette section crée aussi un groupe. Les grands groupes sont défilables pour garder tous leurs membres accessibles ; les cellules de grille ont une taille commune et les libellés de la pile ne se chevauchent pas. Dissoudre un dossier supprime uniquement le groupe, pas les applications installées.

La page « Widgets » permet d'activer l'horloge et le calendrier sur chaque écran et de régler leur largeur. Les cartes restent derrière les fenêtres, leur position peut être déplacée à la souris et est conservée entre les sessions.

Dans « Widgets → Widgets du Dock », l'horloge et la date peuvent être activées séparément. Ces widgets sont désactivés par défaut, partagent l'ordre du Dock par glisser-déposer et ouvrent le calendrier GNOME au clic. Un clic droit propose « 1×1 », de la taille d'une icône, ou « Large », la présentation initiale. Ce choix est conservé séparément pour chaque widget et appliqué sur tous les écrans. Leur hauteur suit celle des icônes et ils pivotent sur les bords gauche et droit ; leur apparence est définie dans les thèmes Shell externes. Le mode Magnification agrandit les icônes voisines sans déformer les widgets.

La feuille embarquée définit uniquement la géométrie nécessaire aux composants : dimensions minimales, espacement et contraintes de texte. Elle n'impose ni couleurs, ni ombres, ni arrondis, ni typographie. Les composants réutilisent les styles natifs quand ils existent. « Adapter la disposition de la barre » applique le style du thème aux barres personnalisées ; la clé historique `panel-style` est conservée pour compatibilité.

Le thème personnel peut cibler `.g-os-dock`, `.g-os-dock-item`, `.g-os-secondary-panel`, `.g-os-popup`, `.g-os-notification-badge`, `.g-os-transfer-progress`, `.g-os-transfer-progress-fill` et `.g-os-download-details`. Les pseudo-classes `:active-app`, `:starting` et `:needs-attention` exposent les états fonctionnels. L'apparence des badges, du remplissage de progression et des états est à définir dans ce thème, pas dans l'extension.

Les branchements, débranchements et changements d'écran principal reconstruisent les Docks et les barres personnalisées. Chaque barre réserve un espace pour les fenêtres et se masque en plein écran.

Les mêmes applications, dossiers et widgets apparaissent sur tous les Docks, indépendamment de l'écran de leurs fenêtres. Avec le filtre d'espace actif, un clic simple privilégie une fenêtre correspondante, même sans parcours cyclique. Une fenêtre non minimisée de l'espace courant est préférée ; en l'absence de correspondance, le lancement natif reste disponible, notamment pour les favoris.

L'option « Limiter les applications ouvertes à l’espace courant », désactivée par défaut, s'applique à tous les écrans. Les favoris restent visibles partout ; les autres applications suivent les fenêtres présentes dans l'espace actif, y compris celles affichées sur tous les espaces. La liste s'actualise lors des changements d'espace et des déplacements de fenêtres entre espaces.

Le bouton Applications de chaque barre ouvre le même menu : vue d'ensemble, grille d'applications, recherche, affichage/restauration du bureau, préférences, paramètres système, verrouillage de session et fermeture explicite de l'application active. Le dash GNOME natif est masqué dans la grille d'applications pour éviter le doublon avec le Dock, puis restauré à la sortie de la grille ou à la désactivation de l'extension. La commande de fermeture affiche le nom de l'application et reste désactivée si l'application focalisée ne fournit pas d'action de fermeture. L'accès aux paramètres nécessite que l'application GNOME correspondante soit installée. Le verrouillage respecte les restrictions de session et n'est déclenché que par une action explicite. Chaque menu est rattaché à sa barre et retiré lors du débranchement de l'écran.

Les horloges des barres utilisent l'horloge native GNOME et suivent les préférences horaires du système, notamment le format 12/24 heures et les options de date et de secondes. Un objet d'horloge est partagé entre les écrans et libéré à la désactivation ; aucun rafraîchissement personnalisé chaque seconde n'est nécessaire.

Les préférences sont organisées en quatre pages : Dock, Raccourcis, Barre et fenêtres, Widgets. La page Dock gère aussi les dossiers personnalisés et leur mode d’ouverture. La recherche native permet de retrouver les réglages. Dans Maintenance, le bouton « Rétablir les réglages par défaut » demande une confirmation avant de réinitialiser les paramètres de l'extension ; Annuler est la réponse par défaut. Les thèmes externes, les clés verrouillées et la sauvegarde de la disposition précédente des boutons de fenêtre sont préservés.

Les options dépendantes sont grisées lorsque leur fonctionnalité principale est désactivée : filtres sans affichage des applications ouvertes, délai sans masquage automatique et raccourcis sans leur interrupteur général. Masquer le Dock désactive ses contrôles dépendants mais laisse son interrupteur principal accessible. Ces changements de disponibilité n'effacent pas les valeurs enregistrées et respectent les clés verrouillées par le système. Les abonnements de suivi sont retirés à la fermeture des préférences.

## Interactions du Dock et recherche

Chaque Dock est accessible depuis le sélecteur de panneaux GNOME, normalement ouvert par Ctrl+Alt+Tab. Son entrée indique le numéro d'écran ; la sélectionner révèle aussi un Dock masqué automatiquement. Les boutons affichent leur infobulle au focus clavier et le Dock défile pour garder le bouton ciblé visible, horizontalement ou verticalement. Échap rend le focus aux fenêtres. Les Docks masqués par le plein écran sont exclus grâce au repère de visibilité natif du sélecteur.

Lors d'une actualisation ou d'une reconstruction du Dock, la cible clavier est conservée par identifiant d'application ou de raccourci sur le même écran. Si elle disparaît, le bouton voisin disponible prend le relais. Aucune restauration n'est tentée si l'écran ou le Dock n'est plus disponible, si l'écran est en plein écran ou si le focus a été déplacé vers un autre composant pendant l'opération.

Les changements de liste d'applications ou de favoris ne reconstruisent pas un Dock tant qu'un de ses menus est ouvert. Les compteurs, notifications et progressions continuent d'être actualisés ; les autres écrans ne sont pas bloqués. La liste différée est appliquée après la fermeture du menu. Les changements de réglages et de configuration des écrans peuvent toujours imposer une reconstruction immédiate, et la désactivation annule toute reconstruction en attente.

L'option « Parcourir les fenêtres de l’application active au clic » est désactivée par défaut. Lorsqu'elle est activée, des clics simples sur l'application déjà active passent à ses fenêtres suivantes dans l'espace de travail courant, dans un ordre stable. Les fenêtres exclues de la barre des tâches sont ignorées. Sans filtre, les autres cas conservent le comportement natif. La vue d'ensemble ouverte, les clics modifiés et le clic central conservent toujours les actions natives.

Lorsque le filtre par écran est actif, ce parcours se limite aussi aux fenêtres du moniteur du Dock cliqué. Les autres actions natives du lanceur restent inchangées.

Les raccourcis du Dock, activés par défaut et masquables dans les préférences, donnent accès au dossier personnel, au dossier Téléchargements configuré par le système, à la corbeille et à la vue des fenêtres et espaces de travail GNOME. Les emplacements sont ouverts avec le gestionnaire de fichiers par défaut. Le bouton Corbeille ne supprime rien et ne vide pas la corbeille. Si aucun dossier Téléchargements n'est configuré, son bouton n'est pas affiché. Une notification signale les échecs d'ouverture.

Un clic droit sur Fichiers ouvre un menu donnant accès au dossier personnel et aux dossiers Bureau, Téléchargements, Documents, Images, Musique et Vidéos configurés dans le système. Les destinations absentes ou identiques sont omises. Le clic simple ouvre toujours le dossier personnel et la commande de menu contextuel reste disponible au clavier. Le menu garde le Dock visible ; un dossier configuré mais inaccessible produit une notification à l'ouverture, sans modification de fichiers.

Le groupe « Raccourcis du Dock » permet de choisir indépendamment Fichiers, Téléchargements, Corbeille, Bureau et Fenêtres et espaces de travail. Tous sont sélectionnés par défaut. L'interrupteur général masque le groupe sans effacer ces choix. Aucun séparateur vide n'est conservé si aucun raccourci n'est affichable. Masquer Téléchargements annule son menu en cours de chargement ; masquer Corbeille arrête son suivi.

L'icône Corbeille distingue son état vide ou plein et affiche le nombre d'éléments dans son infobulle et son libellé accessible. Un seul suivi Gio actualise tous les écrans. Si la surveillance n'est pas prise en charge, une vérification est effectuée toutes les quinze secondes. Si le compteur n'est pas disponible, le libellé indique « état indisponible », sans prétendre que la corbeille est vide. Le suivi s'arrête lorsque les raccourcis ou le Dock sont masqués dans les préférences, ou lorsque l'extension est désactivée.

Un clic droit sur Téléchargements ouvre un menu avec les douze fichiers visibles les plus récemment modifiés du dossier et une action pour ouvrir le dossier. Le clic simple continue d'ouvrir le dossier. Le menu est également accessible au clavier par la commande de menu contextuel. Les dossiers, fichiers cachés et liens symboliques sont exclus ; la liste ne garantit pas que les téléchargements soient terminés. La lecture est asynchrone, annulée à la fermeture du menu, et les dossiers vides ou inaccessibles affichent un état explicite.

Chaque fichier récent affiche son icône, son type et sa date locale de modification lorsque ces métadonnées sont disponibles. Les noms longs sont tronqués visuellement dans une colonne de largeur fixe, mais restent complets dans le libellé accessible. Le type est obtenu à partir des métadonnées rapides Gio ; aucun fichier n'est lancé pour construire le menu. L'activation simple d'une entrée ouvre le fichier avec l'application par défaut.

Dans ce menu, Ctrl+clic ou Ctrl+Entrée révèle le fichier dans son dossier via le service natif `org.freedesktop.FileManager1`, sans ouvrir le fichier. Si ce service est indisponible, le dossier parent est ouvert à la place, sans garantie de sélection du fichier.

Les noms réels se terminant par `.part`, `.partial` ou `.crdownload` sont signalés comme « Fichier partiel possible », sans déduire qu'un transfert est encore actif. Leur activation simple révèle leur emplacement au lieu de lancer leur contenu. Un renommage vers un nom final supprime ce traitement à la prochaine actualisation. Cette détection de suffixes ne garantit pas qu'un fichier sans marqueur soit terminé et ne modifie aucun fichier.

Pendant son ouverture, le menu Téléchargements surveille le dossier et regroupe les changements rapprochés avant de relire la liste. Une seule lecture est active à la fois et l'ancienne liste reste visible durant l'actualisation. Le focus clavier est conservé sur le même fichier, ou revient à « Ouvrir le dossier » si le fichier disparaît. La commande « Actualiser » reste disponible, notamment si la surveillance n'est pas prise en charge. La fermeture du menu arrête la surveillance et annule les opérations restantes.

Le raccourci « Afficher le bureau », présent sur chaque Dock, minimise les fenêtres minimisables de l'espace de travail courant sur tous les écrans. Un second clic sur « Restaurer les fenêtres » restaure uniquement celles minimisées par ce bouton. Les fenêtres déjà minimisées, exclues de la barre des tâches, fermées ou rouvertes manuellement ne sont pas restaurées. Une fenêtre déplacée vers un autre espace entre-temps conserve son état. Le suivi est indépendant par espace de travail et les fenêtres encore suivies sont restaurées lorsque l'extension est désactivée.

Le masquage automatique est optionnel dans les préférences et désactivé par défaut. Lorsqu'il est activé, approche le pointeur du bord choisi, en face du Dock, sur l'écran voulu pour le révéler. Il disparaît après le délai choisi dans « Délai de masquage (ms) », réglable de 100 à 2000 ms et fixé à 300 ms par défaut, sauf si un menu est ouvert ou si un de ses éléments a le focus clavier. Les zones de révélation ne sont pas actives en plein écran. Le Dock reste présent sur chaque écran lorsque le masquage automatique est désactivé.

- Survol : nom de l'application dans une infobulle.
- Clic : ouvrir l'application ou retrouver ses fenêtres avec le comportement natif GNOME.
- Clic droit : fenêtres ouvertes, nouvelle fenêtre, ajout/retrait des favoris et quitter, selon les actions disponibles pour l'application.
- Clic central ou Ctrl+clic : nouvelle fenêtre si l'application le permet.
- Avant personnalisation de l'ordre, un séparateur distingue les favoris des autres applications ouvertes ; l'application active est mise en évidence.
- Pour les applications ayant plusieurs fenêtres, l'infobulle et le libellé accessible indiquent leur nombre. Le menu contextuel présente aussi une ligne de compteur non interactive, actualisée pendant son ouverture sans remplacer les commandes natives. Les filtres d'écran et d'espace courant sont respectés ; les fenêtres minimisées sont comptées et celles exclues de la barre des tâches sont ignorées.
- Une application du Dock dont GNOME signale le démarrage expose l'état `:starting` et le libellé « démarrage en cours ». Aucun démarrage n'est simulé au clic et aucune animation supplémentaire n'est imposée. Les badges de notifications restent disponibles.
- Une application du Dock dont une fenêtre réclame de l'attention expose l'état `:needs-attention` et un libellé accessible adapté, sans activation automatique ni clignotement. L'état disparaît quand la demande est retirée ou quand les fenêtres concernées sont consultées ou fermées. Les fenêtres exclues de la barre des tâches sont ignorées ; les demandes déjà présentes sont prises en compte à l'activation.
- Recherche : depuis le menu principal ou le bouton de recherche des barres secondaires. La recherche utilise la vue d'ensemble GNOME, pas une copie de Spotlight.

Le raccourci Super+Espace est activable dans les préférences et désactivé par défaut. Si GNOME l'utilise déjà, notamment pour changer de langue, la recherche utilise temporairement Ctrl+Alt+Espace, ou Ctrl+Super+Espace si le premier secours est occupé. Le choix enregistré reste intact et redevient actif lorsque le conflit disparaît ; aucun raccourci système n'est supprimé ou modifié par l'extension. Les favoris se gèrent par le menu contextuel ou depuis GNOME, pas par glisser-déposer dans ce Dock.

## Fichiers du bureau

Un clic sélectionne une icône ; un double-clic l'ouvre avec son application par défaut. Ctrl+clic ajoute ou retire un élément de la sélection. Glisser sur une zone vide trace un rectangle de sélection (Ctrl conserve la sélection précédente).

La grille conserve des emplacements distincts lorsqu'elle dépasse la capacité de l'écran : le bureau devient défilable verticalement. La hauteur des lignes tient compte des libellés, et l'alignement à droite conserve une marge de 24 pixels. Le menu du fond reste accessible par clic droit dans la zone vide.

Le clic droit propose les actions adaptées aux fichiers, dossiers et périphériques : ouvrir avec une application compatible, copier/couper/coller, créer un dossier, renommer, déplacer vers la corbeille, afficher les propriétés, démonter ou éjecter. Les propriétés s'ouvrent dans le gestionnaire de fichiers. Le menu est propre à G-Os et n'inclut pas les extensions de menus de Nautilus. Les copies ne remplacent pas automatiquement les fichiers existants.

## Notifications et progression

Les icônes du Dock affichent le nombre de notifications encore présentes dans le centre de notifications GNOME pour l'application correspondante, avec un badge plafonné visuellement à `99+`. Le total exact apparaît dans les barres supérieures. Il inclut les notifications système sans application identifiable ; il ne représente pas uniquement les notifications non lues.

Les applications qui publient le signal D-Bus `com.canonical.Unity.LauncherEntry.Update` affichent une fine barre de progression de 4 pixels en bas de leur icône, sans pourcentage superposé. Sa largeur reste fixe et son remplissage suit la progression ; la valeur reste disponible pour l'accessibilité. Les barres supérieures indiquent le pourcentage lorsqu'une seule application signale une activité, ou le nombre d'applications lorsqu'il y en a plusieurs. Une application peut agréger plusieurs opérations dans sa progression : ce nombre n'est donc pas un nombre de fichiers ou de transferts.

La progression disparaît lorsque l'application la masque ou lorsque son émetteur D-Bus se ferme. Les transferts déjà démarrés avant l'activation apparaissent à la prochaine mise à jour publiée. Le suivi ne remplace pas un service du même nom déjà actif, notamment celui de Dash to Dock.

La même progression est reprise dans l'infobulle de l'application et son libellé accessible, sans remplacer le compteur de notifications ni les états de démarrage et d'attention. Les infobulles visibles se mettent à jour sans recréer les icônes et peuvent revenir à la ligne dans leur largeur contrainte. Aucun pourcentage ne remplace la fine barre sous l'icône.

Limite : les copies et téléchargements ne sont pas exposés universellement par GNOME. Un gestionnaire de fichiers ou navigateur qui ne publie pas ce protocole n'affichera pas de pourcentage ici. L'extension ne déduit pas de progression à partir de la taille des fichiers et ne peut pas déterminer une pause, une erreur ou le temps restant sans information de l'application.

Sur l'installation testée avec Nautilus 50.4, le gestionnaire de fichiers ne
contient pas l'intégration Unity LauncherEntry. Ses copies ne fournissent donc
pas la progression attendue par le Dock. L'indicateur de transferts de Nautilus
reste disponible dans sa fenêtre. Le scénario natif `G_OS_PROGRESS_ONLY=1`
vérifie séparément la réception D-Bus, le remplissage visible à 50 % et la
disparition de la barre à la fin, sans effectuer de copies utilisateur.

## Installation

Depuis le dossier source de l'extension, dans une session GNOME Shell 50 ou 51 :

```sh
mkdir -p ~/.themes
cp -r ../macos-theme/G-Os ~/.themes/
npm ci
npm run build
mkdir -p ~/.local/share/gnome-shell/extensions/g-os@greg.local
cp -r dist/. ~/.local/share/gnome-shell/extensions/g-os@greg.local/
```

Déconnecte-toi et reconnecte-toi pour que GNOME Shell détecte l'extension, puis active-la :

```sh
gnome-extensions enable g-os@greg.local
gnome-extensions prefs g-os@greg.local
```

Dans GNOME Tweaks, sélectionne `G-Os` comme thème Applications. Pour choisir également son thème Shell, active l'extension User Themes, puis sélectionne `G-Os` dans son réglage. Le thème reste dans le dossier du workspace, à côté de l'extension ; la feuille CSS embarquée par l'extension garde ses composants fonctionnels autonomes.

### Applications Flatpak

Les applications Flatpak sont isolées du thème installé sur l'hôte. Avec Flatpak et `gsettings` installés, lance depuis la racine du workspace :

```sh
sh ./G-Os/install-flatpak-theme.sh
```

Le script installe une extension GTK 3 utilisateur sous `$XDG_DATA_HOME/flatpak/extension`, sélectionnée automatiquement par les runtimes qui prennent en charge le point d'extension GTK 3. Il ne donne pas aux applications d'accès supplémentaire au système de fichiers. Ferme puis relance les applications Flatpak pour appliquer le thème. GTK 4 n'a pas le même point d'extension GTK 3, et les applications libadwaita peuvent ignorer les thèmes personnalisés.

L'identifiant `g-os@greg.local` est conservé depuis le squelette initial. Pour désactiver l'extension :

```sh
gnome-extensions disable g-os@greg.local
```

## Configuration

`config.json` est la source unique des métadonnées G-Os, des valeurs par défaut
et des limites des réglages de l'extension. Les valeurs sont du JSON natif.
Après modification, `npm run build` régénère `metadata.json`, le schéma GSettings
et la distribution `dist`. Ne modifie pas directement les fichiers générés.
Les choix enregistrés dans les préférences restent dans GSettings et ne sont
pas effacés par une reconstruction.

Les icônes de la topbar et du lanceur d'applications du Dock sont indépendantes.
Chaque sélecteur propose les icônes du thème actuel avec recherche et aperçu,
un bouton de parcours d'image et un retour au logo GNOME. La cloche de la barre
ouvre la liste native des notifications ; son point rouge indique les non-lues.
Les bannières GNOME disposent de neuf positions dans « Barre et fenêtres ».

## Cover Flow Alt+Tab

Alt+Tab affiche les fenêtres ouvertes sous forme de Cover Flow : une grande
fenêtre centrale et des miniatures latérales inclinées. Alt+Maj+Tab revient en
arrière ; le relâchement d'Alt active la sélection et Échap annule. Le sélecteur
conserve la gestion modale et clavier de GNOME et restaure ses gestionnaires
d'origine lorsque l'option est désactivée.

Dans « Barre et fenêtres → Fenêtres », l'option Cover Flow active la fonction,
permet de limiter les fenêtres à l'espace courant et règle la transition de
0 à 500 ms (180 ms par défaut). Les valeurs sont centralisées dans `config.json`.
Les animations réduites de GNOME sont respectées. Les extensions qui remplacent
également Alt+Tab peuvent entrer en conflit et ne doivent pas être activées
simultanément.

Le test natif `G_OS_COVERFLOW_TEST=1` vérifie les touches réelles, les clones 3D,
le cadrage compact, la fermeture d'une fenêtre et la restauration du sélecteur.
Le dossier `switcher` doit être inclus dans le paquet de l'extension.

## Aperçus des fenêtres

Les icônes d'applications du Dock affichent une miniature en direct par fenêtre
après un survol de 500 ms. Un clic sur une miniature active sa fenêtre ; le
bouton de fermeture demande sa fermeture normale. Le panneau reste accessible
lorsque le pointeur quitte l'icône pour rejoindre l'aperçu et maintient le Dock
visible pendant l'interaction. Les docks du bas, de gauche et de droite sont pris
en charge, avec défilement pour plusieurs fenêtres.

Dans « Dock → Comportement », « Aperçus des fenêtres au survol » active la fonction
et « Délai des aperçus de fenêtres (ms) » règle le délai de 100 à 3000 ms.
Les valeurs par défaut sont dans `config.json` : `dock-window-previews` et
`dock-window-preview-delay`. Les aperçus sont fermés dans la vue Activités,
pendant le verrouillage, lors du masquage du Dock et à la destruction de l'icône.

Le test natif `G_OS_WINDOW_PREVIEW_TEST=1` vérifie les clones réels, le délai,
son annulation et l'activation au pointeur dans les trois positions du Dock.

## Menu global

Le menu global lit les menus GTK `GMenuModel` / `GActionGroup` et les arbres
`com.canonical.dbusmenu` exportés par les applications. Les lecteurs sont
raccordés aux panneaux actuels, avec leurs classes de style existantes.
L'option « Afficher le menu global des applications compatibles » se trouve
dans « Barre et fenêtres » (`global-menu-enabled` dans `config.json`).

Cette version suit le focus, les sous-menus, les états activés et cochés et les
modifications du modèle. Elle garde les menus locaux des applications visibles
et conserve les actions générales de la topbar lorsqu'aucun menu n'est exporté.
Le changement de fenêtre ou la disparition d'un service libère ses menus et
abonnements. Le test GNOME natif force une application GTK sur Wayland et vérifie
l'association à sa fenêtre, les clics distants, les états cochés et le nettoyage,
sans dépendre du registrar X11.

DBusMenu et son registrar sont activés par défaut pour maximiser la compatibilité
avec les applications X11 / XWayland (`global-menu-dbus-enabled`). Le registrar associe les
menus aux identifiants X11 et suit un registrar existant sans le remplacer.
Les inscriptions sont vérifiées et retirées lorsque leur client disparaît.
L'extension ne masque pas les menus locaux ; leur exporteur peut toutefois
adapter leur affichage lorsqu'un registrar est disponible.

| Application / protocole | X11 / XWayland | Wayland |
| --- | --- | --- |
| GTK qui exporte `GMenuModel` / `GActionGroup` | Pris en charge | Pris en charge et testé nativement |
| AppMenu Registrar + DBusMenu avec identifiant de fenêtre X11 | Pris en charge | Non pris en charge par cette association |
| Qt/KDE, wxWidgets, Firefox, Electron, applications sandboxées | Pris en charge si leur exporteur fournit AppMenu Registrar + DBusMenu | Dépend d'un export Wayland compatible |
| GTK4/libadwaita | Pas d'export de barre garanti | Pas d'export de barre garanti |

Les fenêtres Wayland natives ne sont jamais associées par approximation : un
exporteur compatible doit fournir le menu et son association à la fenêtre. Le
support d'un toolkit ne peut pas être ajouté uniquement dans l'extension si ses
applications n'exportent pas l'un de ces protocoles ; elles nécessitent alors
leur module d'intégration AppMenu/DBusMenu côté application. Le
test DBusMenu natif est exécuté seulement avec une fenêtre X11 ; dans un banc
headless Wayland il est explicitement ignoré. Les tests unitaires couvrent le
décodage et la validation des arbres DBusMenu.

Le contrôle fonctionnel utilise `G_OS_GLOBAL_MENU_TEST=1`, `GDK_BACKEND=x11`,
`MACOS_VISUAL_OUTPUT` et `--extra-filter Gjs` avec le banc GNOME ci-dessous.
Il lit les métadonnées de la distribution pour identifier l'extension et
n'effectue aucune mesure de performance.

## Limites

Le thème GTK ne peut pas imposer son apparence aux applications libadwaita qui ignorent volontairement les thèmes GTK personnalisés. Le menu global dépend des informations exportées par les applications et ne peut pas reconstruire universellement leurs menus. La réservation du Dock reste optionnelle et désactivée par défaut. D'autres extensions de Dock ou de personnalisation de la barre peuvent entrer en conflit.

Le schéma GSettings, la présence des fichiers du thème et les comportements simulés sont vérifiés. Le rendu de l'extension doit être contrôlé avec le test headless sur la version GNOME Shell ciblée ; le thème Shell G-Os actif a été chargé sous GNOME Shell 51.1 sans erreur CSS.

## Test local

Les sources TypeScript sont organisées dans `src/dock`, `src/desktop`, `src/panel`, `src/media`, `src/shared` et `src/widgets`. Les points d'entrée sont `src/extension.ts` et `src/prefs.ts`. La construction produit les modules JavaScript, les ressources et le schéma compilé dans `dist` ; GNOME Shell charge cette distribution, pas les fichiers TypeScript.

### TypeScript

`npm run typecheck` vérifie maintenant tous les fichiers de `src/`, avec les réglages stricts des modules concernés et un contrôle de compatibilité pour l'ensemble du runtime. La génération n'utilise plus `--noCheck`. La vérification des valeurs null reste désactivée dans la configuration générale ; certaines API privées de GNOME sont décrites par des types structurels locaux. Soup n'a pas de paquet GIR installé dans les dépendances TypeScript et conserve une déclaration ambiante limitée. Les types GNOME ciblent la version 51 ; des exécutions natives sous GNOME 50 restent nécessaires. Les widgets externes conservent leur API JavaScript `widget.js`. Voir le [guide TypeScript de GJS](https://gjs.guide/extensions/development/typescript.html).

```sh
npm ci
npm test
npm run test:coverage
npm run test:ui
```

`npm run test:coverage` compile temporairement Flux sans bundle ses bibliothèques
externes, puis mesure le code chargé par la suite sans compter ces dépendances.

Le test simule les acteurs et API GNOME pour vérifier la logique de l'extension ; il n'exécute pas les menus natifs ni le rendu GNOME Shell.

`npm run test:ui` ouvre un tableau de bord terminal construit avec Blessed. Il s'adapte
à la taille de la fenêtre, permet de sélectionner un scénario à la souris ou au clavier,
et comporte des boutons cliquables pour lancer ou arrêter les tests. La liste des scénarios,
la progression et le journal en direct se réorganisent avec le terminal ; le journal colore
les erreurs, avertissements et réussites.
Le tableau de bord lance les tests unitaires, la matrice
d'interactions du Dock, les clics dans les zones transparentes, la portée du pointeur
sur le Dock agrandi à trois tailles et positions, l'audit des options d'apparence et
de géométrie, les animations et leurs reprises rapides, le stress des changements de réglages,
les interactions du bureau, l'audit de sa grille d'icônes, l'ajustement des widgets du Dock,
les menus du panneau, les notifications, les marges du Dock maximisé, l'audit de toutes
les clés GSettings (y compris les clés internes) ou un parcours quotidien simulé du Dock,
de la grille d'applications, des menus du panneau et des notifications synthétiques, ou l'ensemble.
L'audit des réglages restaure chaque valeur après vérification ; les données JSON et les
clés qui déclenchent des actions sont vérifiées sans leur injecter de contenu arbitraire.
Les touches fléchées et Entrée contrôlent la liste ; `q` annule un test en cours ou quitte.
`npm run test:ui -- --run appearance`
lance directement un scénario ; `--list` et `--help` affichent les commandes disponibles.
Les résultats, journaux et rapports
JSON sont conservés dans `~/.cache/g-os-extension/test-runs`. Chaque scénario GNOME
utilise un profil DConf, un dossier de données et une installation de l'extension
temporaires.

Pour le rendu réel, depuis un terminal système avec GNOME Shell 51.1 et ses outils de test installés :

```sh
npm run build
gnome-extensions pack --force --extra-source=dock --extra-source=desktop --extra-source=media --extra-source=panel --extra-source=shared --extra-source=switcher --extra-source=widgets --extra-source=licenses --extra-source=icons --extra-source=config.json --out-dir tests dist
runtime=$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/g-os-test-XXXXXX")
XDG_RUNTIME_DIR="$runtime" MACOS_THEME_DIR="$HOME/.themes/G-Os-Dark" MACOS_VISUAL_OUTPUT="$PWD/tests/artifacts" timeout 60s dbus-run-session -- gnome-shell-test-tool --headless --disable-animations --extension "$PWD/tests/g-os@greg.local.shell-extension.zip" "$PWD/tests/gnome-visual.js"
```

L'outil utilise un profil temporaire distinct, un répertoire runtime privé et une session D-Bus isolée pour éviter les conflits avec un autre compositeur de test. `MACOS_THEME_DIR` charge les overrides du thème dans le rendu headless. Les captures sont produites dans `tests/artifacts/g-os-desktop.png` et `tests/artifacts/g-os-menu.png`.

## Environnement de développement GNOME isolé

Le dépôt fournit un environnement de développement basé sur le même principe que
[G-OS Dock](https://github.com/cgreg21/g-os-dock) : GNOME Shell 51 est lancé dans
un Mutter Development Kit, sur Wayland et dans une session D-Bus indépendante.
Les préférences, données, extensions, caches et états GNOME sont conservés dans
`~/.local/share/g-os-dev`, sans modifier le profil de la session GNOME habituelle.

### Prérequis

- Fedora 45 ou CachyOS avec GNOME Shell 51.x.
- Node.js 20 ou plus récent.
- Mutter Development Kit (`mutter-devkit`).
- Une session graphique Wayland ou X11 pour lancer le DevKit.
- Les outils GNOME, GLib et `inotify-tools`.

Installation automatique des dépendances :

```sh
# Fedora 45
npm run dev:install:fedora

# CachyOS
npm run dev:install:cachyos
```

Puis, depuis la racine du dépôt :

```sh
npm ci
npm run dev:check
npm run dev
```

### Cycle de développement

Au démarrage, G-Os est compilé et copié dans le profil isolé sous
`$XDG_DATA_HOME/gnome-shell/extensions/g-os@greg.local`, puis activé dans le
GNOME Shell DevKit. Le processus surveille les modifications de `src/`,
`schemas/`, `config.json`, `metadata.json`, `stylesheet.css`, `icons/` et
`widgets/`.

Après chaque modification détectée, le projet est recompilé. Si la compilation
échoue, la version déjà déployée reste en place. Si elle réussit, G-Os est
redéployé et le Shell DevKit est redémarré afin de recharger proprement les
modules JavaScript ES mis en cache par GJS. Ferme la fenêtre DevKit ou utilise
`Ctrl+C` dans le terminal pour arrêter la session.

Le chemin du profil peut être personnalisé avant le lancement :

```sh
G_OS_DEV_HOME="$HOME/.local/share/g-os-dev-alt" npm run dev
```

### Tests et validation

Les commandes de validation du projet restent inchangées :

```sh
npm run build
npm test
npm run test:coverage
npm run test:ui
```

`npm run test:ui` reste le tableau de bord de tests du projet ; il ne remplace
pas la session DevKit interactive. La CI valide la syntaxe et ShellCheck des
scripts de développement, puis exécute le build et les tests unitaires. Le lancement du DevKit lui-même nécessite une session graphique
GNOME 51 locale.



## Dock Wayland : compagnon XDock

Sur Wayland, G-Os utilise temporairement **XDock**, un fork communautaire de Dash to Dock compatible GNOME Shell 49 à 51. Le code source est suivi dans `vendor/xdock` comme sous-module Git, séparé du code de G-Os et conservé sous sa licence GPL-2.0.

Le Dock G-Os historique reste dans le dépôt, mais il est masqué et libère sa réservation d’espace lorsque XDock est activé. Si le compagnon XDock est absent ou ne démarre pas, G-Os réactive automatiquement son Dock historique. Sous X11, le Dock historique reste utilisé, XDock annonçant une prise en charge Wayland uniquement.

Après un clone ou une mise à jour :

```sh
git submodule update --init --recursive
npm ci
npm run build
npm run build:deploy
```

Le déploiement installe G-Os et le compagnon XDock dans deux répertoires d’extensions GNOME distincts. G-Os demande ensuite au gestionnaire d’extensions GNOME d’activer XDock lorsque le Dock est activé dans ses préférences.
